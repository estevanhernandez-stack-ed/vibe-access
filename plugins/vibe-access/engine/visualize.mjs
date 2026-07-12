// visualize.mjs — the normalizer half (spec §4). Turns a vibe-access manifest or an
// MCP tools/list payload into one SurfaceView: a ToolView per tool plus surface-level facts.
// Read-only, pure, no I/O. The renderer (§5-6) and the --grade layer (§7) consume this.
//
// Two honesty rules that live here and may never be dropped:
//   (a) verify math is the full class decomposition — ran / gate-held / handle-gate-held /
//       open / error / unverified. handle-gate-held is NEVER folded into gate-held.
//   (b) tool count is never graded.

import { validateManifest } from './schema.mjs';
import { gradeSurface } from './grade.mjs';

export const TOOLVIEW_KEYS = [
  'name', 'purpose', 'purposeSource', 'purposeTemplated', 'kind', 'tier',
  'destructive', 'streaming', 'inputSchema', 'outputSchema', 'annotations',
  'consent', 'transport', 'prereqs', 'provenance', 'verification', 'group',
  'grades', 'badges',
];

export const SURFACEVIEW_KEYS = [
  'app', 'adapter', 'source', 'noSource', 'generatedAt', 'renderedAt', 'verifyRun',
  'discoveryRoute', 'counts', 'tools', 'findings', 'schemaGaps', 'axes', 'lede',
  'sidecar',
];

// Finding.severity order IS the headline picker order (§4.2, §6.1 band 6).
const SEVERITY_ORDER = [
  'breach', 'destructive-unclaimed', 'tier-conflict', 'error-cluster', 'validation', 'info',
];

const DAY_MS = 86400000;

export const ageInDays = (fromIso, toIso) => {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / DAY_MS));
};

// ---------------------------------------------------------------- §4.1 shape sniffing

export function sniffShape(json) {
  if (Array.isArray(json)) {
    return json.length > 0 && json.every((t) => t && typeof t.name === 'string') ? 'mcp-array' : null;
  }
  if (!json || typeof json !== 'object') return null;
  if (json.schemaVersion === 1 && Array.isArray(json.affordances)) return 'manifest';
  if (Array.isArray(json.tools)) return 'mcp-envelope';
  if (json.jsonrpc && json.result && Array.isArray(json.result.tools)) return 'mcp-jsonrpc';
  return null;
}

// ---------------------------------------------------------------- §4.3 the honest-render rules

// 4.3.1 effective description — overrides wins, always; never both, never two columns.
export const effectiveDescription = (aff) => aff?.overrides?.description ?? aff?.description ?? '';

// §8.1 — overrides.kind is the authored correction; map bakes it into the top-level field,
// but a hand-edited pre-map manifest still needs it honored here.
export const effectiveKind = (aff) => aff?.overrides?.kind ?? aff?.kind ?? null;

const KIND_WORD = { read: 'Read', act: 'Act', seed: 'Seed', reset: 'Reset', capture: 'Capture' };
const TEMPLATE_RE = /^(Act|Read):\s+(GET|POST|PUT|PATCH|DELETE)\s+\//;
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// 4.3.4 — a description is a machine template when it matches the scan phrasing OR is
// reconstructible from the transport block. 84 of 85 WeSeeYou entries convict here.
export function isTemplatedDescription(description, aff = null) {
  const d = norm(description);
  if (!d) return false;
  if (TEMPLATE_RE.test(d)) return true;
  if (!aff?.transport) return false;
  const kind = effectiveKind(aff);
  const word = KIND_WORD[kind] ?? kind;
  const rebuilt = norm(`${word}: ${aff.transport.method} ${aff.transport.path}`);
  return d.toLowerCase() === rebuilt.toLowerCase();
}

// 4.3.3 — transport.real is DERIVED. The manifest's transport.type is the literal string
// "http" for all 102 affordances in the corpus, including RoRoRo's gRPC-over-named-pipe.
export function realTransport({ declared, baseUrl, serverInfo } = {}) {
  if (baseUrl) {
    if (/^npipe:\/\//i.test(baseUrl)) return 'grpc-npipe';
    if (/^https?:\/\//i.test(baseUrl)) return 'http';
  }
  if (serverInfo) {
    if (serverInfo.transport === 'stdio' || serverInfo.command) return 'stdio';
    if (serverInfo.transport === 'streamable-http' || serverInfo.url) return 'streamable-http';
  }
  if (declared === 'http' && !baseUrl) return 'http';
  return 'unknown';
}

// 4.3.7 — "pass" means two different things. Classify, never count.
export function classifyVerification(verified) {
  const status = verified?.status ?? null;
  const detail = verified?.detail ?? '';
  if (/handle-gate-held/i.test(detail)) return 'handle-gate-held';
  if (/auth-gate-held/i.test(detail)) return 'gate-held';
  if (/auth-gate-open/i.test(detail)) return 'open';
  if (status === 'fail') return 'error';
  if (status === 'pass') return 'ran';
  return 'unverified';
}

// 4.3.6 — the captured token must be DOTTED, and a sentence-terminating period is never
// swallowed into the capture.
const CAP_RE = /capability\s+([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)/i;
const HOST_RE = /\bhost\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\b/;
export function mineCapability(description) {
  const d = String(description ?? '');
  const m = d.match(CAP_RE);
  if (m) return m[1];
  const h = d.match(HOST_RE);
  return h ? h[0] : null;
}

// §7.1 has-description — a description under 40 chars is a label, not a purpose. An MCP
// server that ships "Milestone CRUD." documents itself exactly as well as a scan template
// does, and the sheet says the same word for both.
export const MIN_DESCRIPTION_CHARS = 40;
export const isUndocumented = (t) =>
  !t.purpose || t.purposeTemplated || norm(t.purpose).length < MIN_DESCRIPTION_CHARS;

const HANDLE_GATE_RE = /handle ownership/i;
const DESTRUCTIVE_WORD_RE = /\b(delete|close|kill|stop|reset|wipe|drop|irreversibl)\w*\b/i;

// 4.3.5 — the destructive derivation ladder. declared > derived > unclaimed.
function deriveDestructive(purpose, kind, aff, mcpTool) {
  if (typeof aff?.destructive === 'boolean') {
    return { value: aff.destructive, provenance: 'declared' };
  }
  const hint = mcpTool?.annotations?.destructiveHint;
  if (typeof hint === 'boolean') return { value: hint, provenance: 'declared' };
  const shout = purpose.match(/\bDESTRUCTIVE\b/i);
  const word = kind === 'act' ? purpose.match(DESTRUCTIVE_WORD_RE) : null;
  const match = shout ?? word;
  if (match) {
    return {
      value: true,
      provenance: {
        derived: `inferred from the word "${match[0]}" in the description prose; no schema field carries it`,
      },
    };
  }
  return { value: null, provenance: 'unclaimed' };
}

const pathParamsOf = (path) => {
  const stars = String(path ?? '').split('/').filter((s) => s === '*');
  return stars.map((_, i) => ({ position: i + 1 }));
};

// Longest common path prefix across a group, cut at a '/' boundary (§6.1 band 5).
function sharedPrefixOf(paths) {
  const list = paths.filter(Boolean);
  if (list.length === 0) return null;
  let prefix = list[0];
  for (const p of list.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < p.length && prefix[i] === p[i]) i += 1;
    prefix = prefix.slice(0, i);
  }
  const cut = prefix.lastIndexOf('/');
  if (cut < 0) return null;
  const out = prefix.slice(0, cut + 1);
  return out === '/' || out === '' ? null : out;
}

const fileBase = (ref) =>
  String(ref ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/:\d+$/, '')
    .replace(/\.[a-z0-9]+$/i, '');

const firstPathSegment = (path) => {
  const seg = String(path ?? '').split('/').filter(Boolean);
  if (seg.length === 0) return null;
  return seg[0] === 'api' ? seg[1] ?? null : seg[0];
};

const nameToken = (name) => String(name ?? '').split(/[-_.]/)[0] || null;

// ---------------------------------------------------------------- ToolView factories

function toolViewFromAffordance(aff) {
  const purpose = effectiveDescription(aff);
  const kind = effectiveKind(aff);
  const purposeSource = aff?.overrides?.description ? 'overrides' : 'description';
  const destructive = deriveDestructive(purpose, kind, aff, null);
  const streaming = /server-streaming/i.test(purpose)
    ? {
        value: true,
        provenance: { derived: 'inferred from "Server-streaming" in the description prose; no schema field carries it' },
      }
    : { value: false, provenance: 'unclaimed' };
  const capability = aff?.authDetail ? mineCapability(aff.authDetail) ?? mineCapability(purpose) : mineCapability(purpose);
  const mode = aff?.auth ?? null;
  const handleGate = HANDLE_GATE_RE.test(purpose);
  const mechanismStated =
    mode === 'none' || mode === null ? true : capability !== null || !!aff?.authDetail || handleGate;
  const readOnly =
    kind === 'read'
      ? { value: true, provenance: { derived: 'kind=read in manifest — not an MCP declaration' } }
      : kind
        ? { value: false, provenance: { derived: `kind=${kind} in manifest — not an MCP declaration` } }
        : { value: null, provenance: 'unclaimed' };
  const [rawLine] = String(aff?.sourceRef ?? '').match(/:(\d+)$/) ?? [];
  const line = rawLine ? Number(rawLine.slice(1)) : null;

  return {
    name: aff.id,
    purpose,
    purposeSource,
    purposeTemplated: isTemplatedDescription(purpose, aff),
    kind,
    tier: aff?.overrides?.tier ?? aff?.tier ?? null,
    destructive,
    streaming,
    inputSchema: aff?.input ?? null,
    outputSchema: aff?.output ?? null,
    annotations: {
      readOnly,
      destructive: { value: destructive.value, provenance: destructive.provenance },
      idempotent: { value: null, provenance: 'unclaimed' },
      openWorld: { value: null, provenance: 'unclaimed' },
    },
    consent: {
      mode,
      capability,
      detail: aff?.authDetail ?? null,
      mechanismStated,
    },
    transport: {
      declared: aff?.transport?.type ?? null,
      real: 'unknown', // filled at surface level — it depends on the base URL
      method: aff?.transport?.method ?? null,
      path: aff?.transport?.path ?? null,
      sharedPrefix: null, // filled once the groups are known
      pathParams: pathParamsOf(aff?.transport?.path),
      baseUrl: null,
      corrected: false,
    },
    prereqs: [],
    provenance: {
      sourceRef: aff?.sourceRef ?? null,
      line,
      origin: aff?.origin ?? null,
    },
    verification: {
      status: aff?.verified?.status ?? null,
      class: classifyVerification(aff?.verified),
      detail: aff?.verified?.detail ?? null,
      runId: aff?.verified?.runId ?? null,
      at: aff?.verified?.at ?? null,
    },
    group: '',
    // §7 (the --grade layer) fills these. The bare sheet carries no letters.
    grades: null,
    badges: [],
  };
}

function toolViewFromMcp(tool) {
  const purpose = tool?.description ?? '';
  const ann = tool?.annotations ?? {};
  const declaredAnn = (v) =>
    typeof v === 'boolean' ? { value: v, provenance: 'declared' } : { value: null, provenance: 'unclaimed' };
  const readOnly = declaredAnn(ann.readOnlyHint);
  const kind = ann.readOnlyHint === true ? 'read' : 'act';
  const destructive = deriveDestructive(purpose, kind, null, tool);

  return {
    name: tool.name,
    purpose,
    purposeSource: 'mcp',
    purposeTemplated: isTemplatedDescription(purpose),
    kind,
    tier: null,
    destructive,
    streaming: { value: false, provenance: 'unclaimed' },
    inputSchema: tool?.inputSchema ?? null,
    outputSchema: tool?.outputSchema ?? null,
    annotations: {
      readOnly,
      destructive,
      idempotent: declaredAnn(ann.idempotentHint),
      openWorld: declaredAnn(ann.openWorldHint),
    },
    consent: { mode: null, capability: mineCapability(purpose), detail: null, mechanismStated: true },
    transport: {
      declared: null, // a tools/list payload carries no transport field
      real: 'unknown',
      method: null,
      path: null,
      sharedPrefix: null,
      pathParams: [],
      baseUrl: null,
      corrected: false,
    },
    prereqs: [],
    provenance: { sourceRef: null, line: null, origin: null },
    verification: { status: null, class: 'unverified', detail: null, runId: null, at: null },
    group: '',
    grades: null,
    badges: [],
  };
}

// ---------------------------------------------------------------- grouping (§6.1 band 3)

function assignGroups(tools, { noSource }) {
  const mined = tools.filter((t) => t.consent.capability);
  if (tools.length > 0 && mined.length / tools.length >= 0.5) {
    const familyOf = (cap) => {
      const seg = cap.split('.');
      return seg.length >= 3 ? seg[1] : seg[0];
    };
    const families = new Set(mined.map((t) => familyOf(t.consent.capability)));
    const residual = [];
    for (const t of tools) {
      if (t.consent.capability) {
        t.group = familyOf(t.consent.capability);
        continue;
      }
      const tokens = new Set(String(t.name).split(/[-_.]/));
      const joined = [...families].find((f) => tokens.has(f));
      if (joined) t.group = joined;
      else residual.push(t);
    }
    if (residual.length > 0) {
      const prefix = sharedPrefixOf(residual.map((t) => t.transport.path));
      const label = prefix ? prefix.replace(/^\/|\/$/g, '') : 'other';
      for (const t of residual) t.group = label;
    }
    return 'capability family';
  }

  const files = new Set(tools.map((t) => t.provenance.sourceRef).filter(Boolean));
  if (!noSource && files.size >= 3) {
    for (const t of tools) t.group = fileBase(t.provenance.sourceRef) || 'other';
    return 'source file';
  }

  const keyOf = (t) => firstPathSegment(t.transport.path) ?? nameToken(t.name);
  const tally = {};
  for (const t of tools) {
    const k = keyOf(t);
    if (k) tally[k] = (tally[k] ?? 0) + 1;
  }
  const kept = Object.entries(tally).filter(([, n]) => n >= 3).map(([k]) => k);
  if (kept.length === 0) {
    for (const t of tools) t.group = 'all tools';
    return 'flat';
  }
  for (const t of tools) {
    const k = keyOf(t);
    t.group = kept.includes(k) ? k : 'other';
  }
  return 'path prefix';
}

// ---------------------------------------------------------------- findings + counts

const finding = (id, severity, title, body, toolRefs) => ({
  id,
  severity,
  title,
  body,
  anchor: `#${id}`,
  toolRefs,
});

function buildFindings(tools, { source, discoveryRoute, validationErrors, counts, total }) {
  const out = [];

  if (validationErrors.length > 0) {
    out.push(
      finding(
        'validation',
        'validation',
        'This manifest does not validate against the vibe-access schema',
        `ajv reports ${validationErrors.length} error(s): ${validationErrors.join('; ')}. Rendered anyway — the tool built to explain a broken surface does not refuse to open one.`,
        []
      )
    );
  }

  for (const t of tools.filter((x) => x.verification.class === 'open')) {
    out.push(
      finding(
        `auth-gate-open:${t.name}`,
        'breach',
        `${t.name} claims auth: ${t.consent.mode} and answered a cold agent`,
        `Verify expected 401/403 and got a success. Verbatim: "${t.verification.detail}". The declared gate is not the gate that exists.`,
        [t.name]
      )
    );
  }

  // Within the severity, an explicit DESTRUCTIVE shout outranks a word-match inference —
  // the prose regex is noisy on purpose ("stop idle warnings" convicts), and the loudest
  // real one has to be the headline.
  const shouts = (t) => (/\bDESTRUCTIVE\b/i.test(t.purpose) ? 0 : 1);
  const suspects = tools
    .filter((x) => x.kind === 'act' && x.destructive.value === true && x.destructive.provenance !== 'declared')
    .sort((a, b) => shouts(a) - shouts(b));
  for (const t of suspects) {
    out.push(
      finding(
        `destructive-unclaimed:${t.name}`,
        'destructive-unclaimed',
        `${t.name} looks destructive and nothing declares it`,
        `${typeof t.destructive.provenance === 'object' ? t.destructive.provenance.derived : 'derived'}. An agent reading the schema alone cannot see this.`,
        [t.name]
      )
    );
  }

  for (const t of tools.filter((x) => x.tier === 'prod-safe' && x.destructive.value === true)) {
    out.push(
      finding(
        `tier-conflict:${t.name}`,
        'tier-conflict',
        `${t.name} asserts tier: prod-safe while its own description says it destroys state`,
        'tier: prod-safe is an assertion, not a safety proof. Printed as the contradiction it is, never silently reconciled.',
        [t.name]
      )
    );
  }

  const errorFiles = new Map();
  for (const t of tools.filter((x) => x.verification.class === 'error')) {
    // Key on the file, not the ref: a line number is not a subsystem. RoRoRo-shaped refs
    // carry :NN suffixes, which would otherwise fragment one dead file into one card per line
    // (and, since the id derives from the basename, collide every fragment onto one anchor).
    const key = (t.provenance.sourceRef ?? '(no source)').replace(/:\d+$/, '');
    if (!errorFiles.has(key)) errorFiles.set(key, []);
    errorFiles.get(key).push(t);
  }
  for (const [file, group] of errorFiles) {
    const details = [...new Set(group.map((t) => t.verification.detail).filter(Boolean))];
    out.push(
      finding(
        `error-cluster:${fileBase(file) || 'unknown'}`,
        'error-cluster',
        `${group.length} failing ${group.length === 1 ? 'affordance' : 'affordances'} in ${file}`,
        `One origin, ${group.length} tool ${group.length === 1 ? 'name' : 'names'} inside: ${group.map((t) => t.name).join(', ')}. Verbatim: ${details.join(' · ')}. Source: ${file}.`,
        group.map((t) => t.name)
      )
    );
  }

  // mined != declared (§13.1.5): a shape read out of the handler never closes the DECLARED gap.
  if (source === 'manifest' && counts.withDeclaredInputSchema === 0 && counts.withOutputSchema === 0) {
    const minedNote =
      counts.withMinedInputSchema > 0
        ? ` ${counts.withMinedInputSchema} carry an input shape mined from handler source — read out of the code, not declared by it.`
        : '';
    out.push(
      finding(
        'schema-coverage',
        'info',
        `0 of ${total} affordances declare an input or output schema`,
        `The manifest cannot tell you what to send or what comes back.${minedNote} Stated once here, not as a red slug on every card.`,
        []
      )
    );
  }

  if (source === 'manifest' && !discoveryRoute) {
    out.push(
      finding(
        'discovery-route-null',
        'info',
        'discoveryRoute is null — an agent has no runtime way to find this surface',
        'The file must be handed to the agent. Null in 2 of 2 real manifests.',
        []
      )
    );
  }

  out.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  return out;
}

// The ONE sentence template (§6.1 band 8). Zero-count classes omitted; handle-gate-held is
// always its own term, never folded into gate-held.
export function verifyDecompositionSentence(verify) {
  const total = Object.values(verify).reduce((a, b) => a + b, 0);
  // Nothing ran, nothing was gated, nothing errored: the surface was never probed at all
  // (an MCP tools/list payload carries no verify data). "N probed — N unverified" would be
  // a contradiction printed in the honesty band. Say it plainly instead.
  if (total > 0 && verify.unverified === total) {
    return `Not verified — no verify run on this surface (${total} tool${total === 1 ? '' : 's'}).`;
  }
  const terms = [
    [verify.ran, 'ran'],
    [verify.gateHeld, 'gate-held'],
    [verify.handleGateHeld, 'handle-gate-held'],
    [verify.open, 'open'],
    [verify.error, 'error'],
    [verify.unverified, 'unverified'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`);
  if (terms.length === 0) return `${total} probed.`;
  return `${total} probed — ${terms.join(', ')}.`;
}

function buildCounts(tools) {
  const verify = { ran: 0, gateHeld: 0, handleGateHeld: 0, open: 0, error: 0, unverified: 0 };
  const key = {
    ran: 'ran',
    'gate-held': 'gateHeld',
    'handle-gate-held': 'handleGateHeld',
    open: 'open',
    error: 'error',
    unverified: 'unverified',
  };
  const byKind = {};
  const byAuth = {};
  const byTier = {};
  const destructive = { declared: 0, derived: 0, unclaimed: 0 };
  let templated = 0;
  let undocumented = 0;
  let withInputSchema = 0;
  let withDeclaredInputSchema = 0;
  let withMinedInputSchema = 0;
  let withOutputSchema = 0;
  let withDeclaredAnnotation = 0;
  let openSurface = 0;
  let mechanismUnstated = 0;
  let streaming = 0;

  for (const t of tools) {
    verify[key[t.verification.class]] += 1;
    if (t.kind) byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
    if (t.consent.mode) byAuth[t.consent.mode] = (byAuth[t.consent.mode] ?? 0) + 1;
    if (t.tier) byTier[t.tier] = (byTier[t.tier] ?? 0) + 1;
    if (t.purposeTemplated) templated += 1;
    if (isUndocumented(t)) undocumented += 1;
    if (t.inputSchema) {
      withInputSchema += 1;
      if (minedFrom(t.inputSchema)) withMinedInputSchema += 1;
      else withDeclaredInputSchema += 1;
    }
    if (t.outputSchema) withOutputSchema += 1;
    if (Object.values(t.annotations).some((a) => a.provenance === 'declared')) withDeclaredAnnotation += 1;
    if (t.consent.mode === 'none') openSurface += 1;
    if (!t.consent.mechanismStated) mechanismUnstated += 1;
    if (t.streaming.value) streaming += 1;
    const p = t.destructive.provenance;
    if (p === 'declared') destructive.declared += 1;
    else if (p === 'unclaimed') destructive.unclaimed += 1;
    else destructive.derived += 1;
  }

  return {
    total: tools.length,
    byKind,
    byAuth,
    byTier,
    verify,
    templated,
    undocumented,
    withInputSchema,
    withDeclaredInputSchema,
    withMinedInputSchema,
    withOutputSchema,
    withDeclaredAnnotation,
    openSurface,
    mechanismUnstated,
    streaming,
    destructive,
  };
}

function buildSchemaGaps(source, tools, counts, discoveryRoute) {
  if (source !== 'manifest') return [];
  const gaps = [];
  const n = tools.length;
  if (counts.withDeclaredInputSchema === 0 && counts.withOutputSchema === 0) {
    gaps.push(
      counts.withMinedInputSchema > 0
        ? `nothing DECLARES a schema — 0 of ${n} affordances declare an input shape (${counts.withMinedInputSchema} carry one mined from handler source) and output is null in ${n} of ${n}.`
        : `input and output are null in ${n} of ${n} affordances — the manifest cannot say what to send or what comes back.`
    );
  }
  if (tools.every((t) => t.transport.declared === 'http')) {
    gaps.push('transport.type has one member ("http") — it cannot express gRPC, stdio, or a named pipe, so it labels them all http.');
  }
  if (counts.destructive.declared === 0) {
    gaps.push('No destructive, streaming, or idempotent field exists — every such fact on this page is derived from prose or unclaimed (§8.3).');
  }
  if (tools.some((t) => !t.consent.mechanismStated)) {
    gaps.push(`No authDetail field — ${counts.mechanismUnstated} gated affordances state a mode and no mechanism (§8.2).`);
  }
  if (!discoveryRoute) {
    gaps.push('discoveryRoute is unused — nothing in the running app advertises this surface.');
  }
  return gaps;
}

function buildLede(surface) {
  const { counts, tools, findings, source } = surface;
  const files = new Set(
    tools.map((t) => t.provenance.sourceRef).filter(Boolean).map((r) => r.replace(/:\d+$/, ''))
  ).size;
  const transport = tools[0]?.transport.real ?? 'unknown';
  const spread = files > 0 ? ` across ${files} source file${files === 1 ? '' : 's'}` : '';
  const s1 = `${counts.total} ${transport} affordance${counts.total === 1 ? '' : 's'}${spread}.`;
  // "Every affordance declares a gate" is true only where a gate COULD be declared. A
  // tools/list payload has no auth field at all — reading its silence as a gate is the exact
  // fail-open this plugin exists to catch, printed in the lede.
  const s2 =
    counts.openSurface > 0
      ? `${counts.openSurface} answer an unauthenticated caller.`
      : source === 'mcp'
        ? 'A tools/list payload carries no auth model — consent is not declared for any of them.'
        : 'Every affordance declares a gate.';
  const worst = findings.find((f) => f.severity !== 'info' && f.severity !== 'validation');
  const s3 = worst ? `${worst.title}.` : 'No breach, no unclaimed destruction, no tier contradiction.';
  const s4 = verifyDecompositionSentence(counts.verify);
  return `${s1} ${s2} ${s3} ${s4}`;
}

// ---------------------------------------------------------------- normalize

export function normalize(json, opts = {}) {
  const renderedAt = opts.renderedAt ?? new Date().toISOString();
  const noSource = opts.noSource === true;
  const shape = sniffShape(json);
  if (!shape) {
    throw new Error(
      'unrecognized input shape — expected a vibe-access manifest (schemaVersion 1) or an MCP tools/list payload'
    );
  }

  const source = shape === 'manifest' ? 'manifest' : 'mcp';
  let tools;
  let app = null;
  let adapter = null;
  let generatedAt = null;
  let discoveryRoute = null;
  let validationErrors = [];
  // §4.1 — shapes 2-4 may carry a {tools, resources, prompts, serverInfo} sidecar bundle. When
  // the arrays are there, the Resources/Prompts axis COUNTS them (§7.2 axis 4). When they are
  // not, the axis says the instrument is missing — and now that sentence is a fact the code
  // actually checked.
  let sidecar = null;

  if (source === 'manifest') {
    validationErrors = validateManifest(json).errors;
    app = json.app ?? null;
    adapter = json.adapter ?? null;
    generatedAt = json.generatedAt ?? null;
    discoveryRoute = json.discoveryRoute ?? null;
    const baseUrl = json.baseUrls?.dev ?? json.baseUrls?.prod ?? null;
    const real = realTransport({ declared: json.affordances[0]?.transport?.type ?? null, baseUrl });
    tools = json.affordances.map((aff) => {
      const t = toolViewFromAffordance(aff);
      t.transport.baseUrl = baseUrl;
      t.transport.real = real;
      t.transport.corrected = t.transport.declared !== null && t.transport.declared !== real;
      return t;
    });
  } else {
    const raw =
      shape === 'mcp-array' ? json : shape === 'mcp-envelope' ? json.tools : json.result.tools;
    const bundle = Array.isArray(json) ? {} : json;
    app = bundle.serverInfo?.name ?? null;
    if (Array.isArray(bundle.resources) || Array.isArray(bundle.prompts)) {
      sidecar = {
        resources: Array.isArray(bundle.resources) ? bundle.resources.length : 0,
        prompts: Array.isArray(bundle.prompts) ? bundle.prompts.length : 0,
      };
    }
    adapter = 'mcp';
    const real = realTransport({ declared: null, baseUrl: null, serverInfo: bundle.serverInfo });
    tools = raw.map((t) => {
      const v = toolViewFromMcp(t);
      v.transport.real = real;
      return v;
    });
  }

  if (noSource) {
    for (const t of tools) {
      t.provenance.sourceRef = null;
      t.provenance.line = null;
    }
  }

  assignGroups(tools, { noSource });

  // Shared prefix is a group-level fact, factored out once per group.
  const byGroup = new Map();
  for (const t of tools) {
    if (!byGroup.has(t.group)) byGroup.set(t.group, []);
    byGroup.get(t.group).push(t);
  }
  for (const group of byGroup.values()) {
    const prefix = sharedPrefixOf(group.map((t) => t.transport.path));
    for (const t of group) t.transport.sharedPrefix = prefix;
  }

  // Prereq chain: a bootstrap call that says it must come first gates every gated affordance.
  const bootstrap = tools.find((t) => /must be the first rpc|first call on|bootstrap call/i.test(t.purpose));
  if (bootstrap) {
    for (const t of tools) {
      if (t.name === bootstrap.name) continue;
      const negated = new RegExp(`no ${bootstrap.name}`, 'i').test(t.purpose);
      const gated = t.consent.mode === 'session' || t.consent.mode === 'token';
      if (gated && !negated) t.prereqs = [bootstrap.name];
    }
  }

  const counts = buildCounts(tools);
  const findings = buildFindings(tools, {
    source,
    discoveryRoute,
    validationErrors,
    counts,
    total: tools.length,
  });

  const stamps = tools.map((t) => t.verification).filter((v) => v.at);
  const latest = stamps.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
  const verifyRun = latest
    ? { runId: latest.runId, at: latest.at, ageAtRender: ageInDays(latest.at, renderedAt) }
    : null;

  const surface = {
    app,
    adapter,
    source,
    noSource,
    generatedAt,
    renderedAt,
    verifyRun,
    discoveryRoute,
    sidecar,
    counts,
    tools,
    findings,
    schemaGaps: buildSchemaGaps(source, tools, counts, discoveryRoute),
    axes: [], // §7.2 — the --grade layer fills these
    lede: '',
  };
  surface.lede = buildLede(surface);
  return surface;
}

// ================================================================ the renderer (§5, §6, §9)
// ONE self-contained HTML document: inline CSS, inline JS, inline SVG-free glyphs, zero
// network. Bare mode is the reference sheet — tools, calls, explanations. The --grade layer
// (§7) rides on top of this and never replaces it.

const PLUGIN_VERSION = '0.2.0';

// Text nodes: &, <, > are the only characters that can escape a text context.
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Attribute values additionally escape both quote characters.
const escAttr = (s) => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// §6.2 — <wbr> at token-internal boundaries. `overflow-wrap: anywhere` alone breaks
// mid-token; SubscribeMutexStateChanged must wrap where a reader expects it to.
const wbr = (s) =>
  esc(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1<wbr>$2')
    .replace(/([/._-])/g, '$1<wbr>');

const slug = (s) => String(s ?? '').replace(/[^a-zA-Z0-9._-]/g, '-');

// §6.2 block 4 — a `*` segment is not a glob and never renders as one. The glyph is styled and
// footnoted, not danger-inked: an unknown parameter is a gap, not a fire (D11 keeps the oxblood
// for DESTRUCTIVE and the failed/open verify classes).
const QMARK =
  '<span class="qmark" title="unnamed path parameter — nothing in the surface says what goes here; see HOW TO READ THIS">{?}</span>';

const routeLine = (path) =>
  String(path ?? '')
    .split('/')
    .map((seg) => (seg === '*' ? QMARK : wbr(seg)))
    .join('/<wbr>');

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;
const NEG_CUE = /\b(do not|don't|never|only (use|call|when)|not for|avoid|outside|casually|unreachable|404s)\b/i;
const CTX_CUE = /\b(for|so that|when|during|while|used? (to|for|when|by))\b/i;
const PRIVILEGE_RE = /\b(admin|role|permission|approve|reject|invite)\b/i;

const sentencesOf = (text) =>
  String(text ?? '').split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean);

const provenanceWord = (p) =>
  p === 'declared' ? 'declared' : p === 'unclaimed' ? 'unclaimed' : 'derived';

const derivedWhy = (p) => (p && typeof p === 'object' && p.derived ? p.derived : null);

// ---------------------------------------------------------------- the call blocks (§6.2.8)

const tokenPlaceholder = (t, adapter) => {
  if (t.consent.mode === 'token') {
    return adapter === 'firebase-functions' ? '<FIREBASE_ID_TOKEN>' : '<TOKEN>';
  }
  return '<SESSION_TOKEN>';
};

// A mined property knows which slot it was read from (`x-in`). A DECLARED schema
// (MCP inputSchema) has no slot and is a body schema by definition — hence the
// `?? 'body'` default. Query parameters belong in the URL; putting them in a JSON
// body would hand the reader a call that silently drops them.
function propsIn(schema, slot) {
  const props = schema && typeof schema === 'object' ? schema.properties : null;
  if (!props) return [];
  return Object.entries(props).filter(([, def]) => (def?.['x-in'] ?? 'body') === slot);
}

// An unknown type renders as a NAMED placeholder — `<listId>`, never a fabricated type.
// A nested object/array with a DECLARED shape recurses: a call a reader can paste names
// every parameter, including the ones that live one level down. An empty `{}` where the
// schema declared five nested fields is a call that does not run (§10.2.5).
const MAX_NEST = 4;
const placeholderFor = (name, def, depth = 0) => {
  const type = def?.type ?? 'unknown';
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return false;
  if (type === 'array') {
    const items = def?.items;
    if (items && typeof items === 'object' && depth < MAX_NEST) {
      return [placeholderFor(`${name}Item`, items, depth + 1)];
    }
    return [];
  }
  if (type === 'object') {
    const props = def?.properties;
    if (props && typeof props === 'object' && Object.keys(props).length > 0 && depth < MAX_NEST) {
      const out = {};
      for (const [k, d] of Object.entries(props)) out[k] = placeholderFor(k, d, depth + 1);
      return out;
    }
    return {};
  }
  return `<${name}>`;
};

function bodyPlaceholders(schema) {
  const entries = propsIn(schema, 'body');
  if (entries.length === 0) return null;
  const body = {};
  for (const [name, def] of entries) body[name] = placeholderFor(name, def);
  return body;
}

// Path names only get used when the source named exactly as many as the path has wildcards.
// A partial match is a guess about which slot is which, and this page does not guess — it
// says UNNAMED and means it.
function pathFill(t) {
  const rawSegments = String(t.transport.path ?? '').split('/');
  const wildcards = rawSegments.filter((s) => s === '*').length;
  const pathNames = propsIn(t.inputSchema, 'path').map(([name]) => name);
  const named = wildcards > 0 && pathNames.length === wildcards;
  let n = 0;
  const filledPath = rawSegments
    .map((seg) => (seg === '*' ? (named ? `<${pathNames[n++]}>` : `<UNNAMED_PARAM_${(n += 1)}>`) : seg))
    .join('/');
  return { filledPath, wildcards, named };
}

// The prose that qualifies the call is NOT part of the call. It used to sit inside the <pre>,
// which meant the copy button handed the reader a curl with two lines of English glued to the
// end — a block that cannot be pasted is not "the call". Same words, same place on the card,
// one line under the block, and on paper it sets small.
function callNotes(t) {
  const notes = [];
  if (t.transport.real === 'grpc-npipe') {
    notes.push('gRPC over a Windows named pipe. Drive it with a gRPC client, not an HTTP one.');
    return notes;
  }
  if (t.transport.real !== 'http') return notes;
  const mined = minedFrom(t.inputSchema);
  if (mined) notes.push(`Parameters mined from ${mined} — read out of the handler, not declared.`);
  const { wildcards, named } = pathFill(t);
  if (wildcards > 0 && !named) {
    notes.push(
      `${wildcards} unnamed path parameter${wildcards === 1 ? '' : 's'} — a caller cannot know what goes here.`
    );
  }
  return notes;
}

function nativeCall(t, surface) {
  const real = t.transport.real;
  if (real === 'grpc-npipe') {
    // Never a fake URL: a named pipe is not an endpoint you can curl.
    const lines = [
      `pipe      ${t.transport.baseUrl}`,
      `method    ${t.transport.path}`,
      `metadata  x-plugin-id: <PLUGIN_ID>`,
    ];
    if (t.prereqs.length > 0) {
      lines.push(`prereq    ${t.prereqs.join(', ')} must be the first rpc on this connection`);
    }
    if (t.consent.capability) lines.push(`consent   capability ${t.consent.capability}`);
    return lines.join('\n');
  }
  if (real === 'http') {
    const { filledPath } = pathFill(t);
    const query = propsIn(t.inputSchema, 'query')
      .map(([name, def]) => `${name}=${encodeURIComponent(String(placeholderFor(name, def)))}`)
      .join('&');
    const url = `${t.transport.baseUrl ?? ''}${filledPath}${query ? `?${query}` : ''}`;

    const lines = [`curl -X ${t.transport.method ?? 'GET'} '${url}'`];
    if (t.consent.mode && t.consent.mode !== 'none') {
      lines[0] += ' \\';
      lines.push(`  -H 'Authorization: Bearer ${tokenPlaceholder(t, surface.adapter)}'`);
    }
    const body = bodyPlaceholders(t.inputSchema);
    if (body) {
      lines[lines.length - 1] += ' \\';
      lines.push(`  -H 'Content-Type: application/json' \\`);
      lines.push(`  -d '${JSON.stringify(body)}'`);
    }
    return lines.join('\n');
  }
  return [
    'transport: unknown — a tools/list payload carries no transport field.',
    'Call it through your MCP client; the projection below is the wire shape.',
  ].join('\n');
}

function mcpProjection(t) {
  // The MCP wire shape has one bag of arguments — there is no body/query split there,
  // so every mined property lands in it regardless of which slot the handler read it from.
  const props = t.inputSchema && typeof t.inputSchema === 'object' ? (t.inputSchema.properties ?? null) : null;
  const body =
    props && Object.keys(props).length > 0
      ? Object.fromEntries(Object.entries(props).map(([name, def]) => [name, placeholderFor(name, def)]))
      : null;
  // Three input states, never two: a DECLARED-empty schema is a statement (this tool takes
  // nothing), and rendering it as an absence puts a false claim on the card.
  const emptyComment =
    inputState(t.inputSchema) === 'declared-empty'
      ? '{} /* declared empty — the surface says this tool takes no arguments */'
      : '{} /* unknown — no input schema declared or minable */';
  const args = body ? JSON.stringify(body, null, 6).replace(/\n/g, '\n    ') : emptyComment;
  return [
    '{',
    '  "jsonrpc": "2.0",',
    '  "id": 1,',
    '  "method": "tools/call",',
    '  "params": {',
    `    "name": "${t.name}",`,
    `    "arguments": ${args}`,
    '  }',
    '}',
  ].join('\n');
}

// ---------------------------------------------------------------- blocks

// D7 — the duplicate-slug wall dies here. A block with nothing in it is ONE compact labeled
// line (`.block.empty`, rendered inline), muted, never a full-height red frame repeated 170
// times. The rate itself is stated ONCE at surface level (the absence note in the index band),
// and the hole is kept in full only where it is actionable: inside THE CALL.
const filled = (html) => ({ html, empty: false });
const absent = (words) => ({ html: `<span class="none">${esc(words)}</span>`, empty: true });

// The absent-description slug is surface-specific. There is no scan and no template on an
// MCP surface — telling an MCP reader they are looking at "the scan template" is a claim
// about an artifact that does not exist.
const TEMPLATE_SLUG =
  '<p class="tmpl-note">No authored description — this is the scan template.</p>';
const MCP_NO_DESC_SLUG =
  '<p class="tmpl-note">No description — the server ships none for this tool.</p>';
const noDescSlug = (t) => (t.purposeSource === 'mcp' ? MCP_NO_DESC_SLUG : TEMPLATE_SLUG);

function purposeBlock(t, opts) {
  if (!t.purpose) {
    return filled(`<span class="chip">UNDOCUMENTED</span>${noDescSlug(t)}`);
  }
  if (t.purposeTemplated) {
    const body = opts.terse ? '' : `<p class="tmpl">${esc(t.purpose)}</p>`;
    return filled(`<span class="chip">UNDOCUMENTED</span>${TEMPLATE_SLUG}${body}`);
  }
  if (isUndocumented(t)) {
    // Thin: the prose is real, so it prints — but a 15-character label is not a purpose, and
    // the card grades it the same as a template rather than letting length hide behind ink.
    const n = norm(t.purpose).length;
    return filled(
      `<span class="chip">UNDOCUMENTED</span><p class="tmpl-note">${n} characters — a label, not a purpose. An agent cannot decide from this.</p><p>${esc(t.purpose)}</p>`
    );
  }
  const from = t.purposeSource === 'overrides' ? '<span class="tag">from overrides</span>' : '';
  return filled(`${from}<p>${esc(t.purpose)}</p>`);
}

function whenBlock(t, negative) {
  if (t.purposeTemplated || !t.purpose) return absent('not stated');
  const hits = sentencesOf(t.purpose).filter((s) => (negative ? NEG_CUE.test(s) : CTX_CUE.test(s) && !NEG_CUE.test(s)));
  if (hits.length === 0) return absent('not stated');
  return filled(`<p>${hits.map((s) => esc(s)).join(' ')}</p>`);
}

// §13.1.5 — mined is not declared, and the card says which. A shape mined from bare
// handler reads states no requiredness at all, so its `required` column reads
// "unstated" — never the lie "optional", which would be a claim the source never made.
const minedFrom = (schema) => (schema && typeof schema === 'object' ? (schema['x-mined-from'] ?? null) : null);
const IN_LABEL = { body: 'body', query: 'query', path: 'path' };

// Three input states, never two (§13.1.5 extends to shape, not just provenance):
//   declared        — a schema with properties
//   declared-empty  — the surface DECLARES the tool takes nothing. A statement, not a hole.
//   absent          — no schema at all. The only real hole.
function inputState(schema) {
  if (!schema || typeof schema !== 'object') return 'absent';
  const props = schema.properties;
  if (props && typeof props === 'object' && Object.keys(props).length > 0) return 'declared';
  return 'declared-empty';
}

// A nested object is not an empty one. Children flatten into the table with dotted names
// (`data.title`) so the parameter list matches the call the reader is about to paste.
function schemaRows(props, { prefix, required, requirednessStated, depth }) {
  return Object.entries(props).flatMap(([name, def]) => {
    const full = `${prefix}${name}`;
    const type = def?.enum ? `enum(${def.enum.map((v) => esc(v)).join(' | ')})` : esc(def?.type ?? 'unknown');
    const req = requirednessStated ? (required.has(name) ? 'required' : 'optional') : 'unstated';
    const dflt = def?.default === undefined ? '—' : esc(JSON.stringify(def.default));
    const where = def?.['x-in'] ? `in ${IN_LABEL[def['x-in']] ?? esc(def['x-in'])}` : esc(def?.description ?? '');
    const row = `<tr><td><code>${wbr(full)}</code></td><td>${type}</td><td>${req}</td><td>${dflt}</td><td>${where}</td></tr>`;

    const nested =
      def?.type === 'object' ? def : def?.type === 'array' && def?.items?.type === 'object' ? def.items : null;
    const childProps = nested?.properties;
    if (!childProps || Object.keys(childProps).length === 0 || depth >= MAX_NEST) return [row];
    const kids = schemaRows(childProps, {
      prefix: `${full}${def.type === 'array' ? '[].' : '.'}`,
      required: new Set(Array.isArray(nested.required) ? nested.required : []),
      requirednessStated: Array.isArray(nested.required),
      depth: depth + 1,
    });
    return [row, ...kids];
  });
}

function schemaTable(schema) {
  const props = schema?.properties ?? null;
  if (inputState(schema) !== 'declared') return null;
  const mined = minedFrom(schema);
  const requirednessStated = Array.isArray(schema.required) || (mined && schema['x-mined-by'] !== 'reads');
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const rows = schemaRows(props, { prefix: '', required, requirednessStated, depth: 0 }).join('');
  // mined != declared, and the card never lets a reader guess which one they are holding.
  const tag = mined
    ? `<span class="tag dotted" title="read out of the handler source by scan — not a declared schema">mined from ${esc(mined)}</span>`
    : `<span class="tag" title="the surface declares this schema as a real field — nothing here was inferred">declared by the server</span>`;
  return `${tag}<table class="params"><thead><tr><th>name</th><th>type</th><th>required</th><th>default</th><th>description</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function inputBlock(t) {
  const table = schemaTable(t.inputSchema);
  if (table) return filled(table);
  if (t.transport.pathParams.length > 0) {
    // The mined path-param rows ARE information — they survive the slug cull.
    const rows = t.transport.pathParams
      .map(
        (p) =>
          `<tr><td>${QMARK}</td><td>unknown</td><td>required</td><td>—</td><td>unnamed path parameter (position ${p.position}) — a caller cannot know what goes here.</td></tr>`
      )
      .join('');
    return filled(
      `<table class="params"><thead><tr><th>name</th><th>type</th><th>required</th><th>default</th><th>description</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  }
  if (inputState(t.inputSchema) === 'declared-empty') {
    // Declared-and-empty is a fact the surface stated. It is counted as a declaration in the
    // index band, and the card says the same thing the count does.
    const who = t.purposeSource === 'mcp' ? 'the server' : 'the surface';
    return filled(
      `<span class="tag" title="the surface declares an input schema with no properties">declared by the server</span><p>Declares no arguments — ${who} says this tool takes nothing.</p>`
    );
  }
  return absent('no schema declared');
}

function outputBlock(t) {
  const table = schemaTable(t.outputSchema);
  if (table) return filled(table);
  const returns = sentencesOf(t.purpose).find((s) => /\breturns?\b/i.test(s));
  if (returns && !t.purposeTemplated) {
    return filled(
      `<p>${esc(returns)} <span class="tag dotted" title="derived from the description prose; no schema field carries it">derived</span></p>`
    );
  }
  return absent('no schema declared');
}

function annotationCell(label, a) {
  const word = provenanceWord(a.provenance);
  const why = derivedWhy(a.provenance);
  const value = a.value === null ? '—' : String(a.value);
  const text =
    word === 'declared'
      ? `declared: ${value}`
      : word === 'derived'
        ? `derived: ${value}`
        : 'unclaimed';
  const why2 = why ? `<span class="why">${esc(why)}</span>` : '';
  return `<div class="ann ${word}"><span class="ann-k">${label}</span><span class="ann-v">${text}</span>${why2}</div>`;
}

function annotationsBlock(t) {
  const a = t.annotations;
  return filled(
    `<div class="anns">${annotationCell('readOnly', a.readOnly)}${annotationCell('destructive', a.destructive)}${annotationCell('idempotent', a.idempotent)}${annotationCell('openWorld', a.openWorld)}</div>`
  );
}

function consentBlock(t) {
  const mode = t.consent.mode ?? 'not declared';
  const cap = t.consent.capability
    ? ` <code class="cap">${wbr(t.consent.capability)}</code>`
    : '';
  const detail = t.consent.detail ? `<p>${esc(t.consent.detail)}</p>` : '';
  if (!t.consent.mechanismStated) {
    // The auth mode is per-card ("can I call this" is in-ask). The epigram behind it —
    // "capability not stated" is not "no capability required" — is stated ONCE, in HOW TO READ
    // THIS. Printing it on 70 of 85 cards is the duplicate-slug wall wearing a different color.
    return filled(
      `<p><b>auth: ${esc(mode)}</b></p><span class="none">mechanism not stated in the surface.</span>`
    );
  }
  const words =
    mode === 'none'
      ? 'Open — any caller reaches this, authenticated or not.'
      : mode === 'session'
        ? 'Session — handshake first, then the per-call identity header, then per-capability consent.'
        : mode === 'token'
          ? 'Token — a bearer credential on every call.'
          : 'Consent mode is not declared on this surface.';
  return filled(`<p><b>auth: ${esc(mode)}</b>${cap}</p><p>${esc(words)}</p>${detail}`);
}

function callBlock(t, surface) {
  // The MCP projection is a <details>. On a surface whose native call is real (http / npipe),
  // it stays SHUT in print — it is the single biggest block on the card and the native call
  // above it is the one a reader pastes (§10.2.6, the page budget is a shipping criterion).
  // On an MCP-sourced surface there IS no native call, so the projection is the payload and
  // it prints open like every other <details> (§9).
  const real = t.transport.real;
  const collapsible = real === 'http' || real === 'grpc-npipe' ? ' pc' : '';
  const notes = callNotes(t)
    .map((n) => `<p class="callnote">${esc(n)}</p>`)
    .join('');
  return filled([
    '<div class="call">',
    '<div class="call-h">Native<button class="copy no-print" type="button">copy</button></div>',
    `<pre class="code">${esc(nativeCall(t, surface))}</pre>`,
    notes,
    `<details class="mcp${collapsible}"${collapsible ? '' : ' open'}>`,
    '<summary class="call-h">MCP projection<button class="copy no-print" type="button">copy</button></summary>',
    `<pre class="code">${esc(mcpProjection(t))}</pre>`,
    '<p class="quiet">Projection — not a running server.</p>',
    '</details>',
    '</div>',
  ].join(''));
}

// ---------------------------------------------------------------- chips + card

function chipsOf(t, opts = {}) {
  const chips = [];
  const shouts = /\bDESTRUCTIVE\b/i.test(t.purpose);
  if (t.destructive.value === true) {
    const filled = t.destructive.provenance === 'declared' || shouts;
    const why = derivedWhy(t.destructive.provenance);
    chips.push(
      `<span class="chip ${filled ? 'filled' : 'dotted'}"${why ? ` title="${escAttr(why)}"` : ''}>⚠ DESTRUCTIVE</span>`
    );
  }
  if (t.consent.mode === 'none') chips.push('<span class="chip">○ OPEN</span>');
  if (PRIVILEGE_RE.test(`${t.name} ${t.transport.path ?? ''}`)) chips.push('<span class="chip">◆ PRIVILEGE</span>');
  if (t.tier === 'dev') chips.push('<span class="chip">◇ DEV-ONLY</span>');
  if (t.streaming.value) chips.push('<span class="chip dotted">≋ STREAMING</span>');
  if (t.verification.class === 'error') chips.push('<span class="chip risk">✕ FAILED</span>');
  if (t.verification.class === 'open') chips.push('<span class="chip risk">✕ GATE OPEN</span>');
  // The audit chips ride with --grade only (§7, D25). The underlying facts — auth mode, verify
  // class, tier, the destructive provenance — are already on the bare card; the letter and the
  // contradiction names are the judgment, and the judgment is opt-in.
  if (opts.grade) {
    if (t.verification.class === 'open') chips.push('<span class="chip risk">✕ BREACH</span>');
    if (t.tier === 'prod-safe' && t.destructive.value === true) {
      chips.push('<span class="chip risk">✕ TIER-CONFLICT</span>');
    }
    if (t.grades) chips.push(`<span class="chip grade g-${t.grades.letter}">GRADE ${t.grades.letter}</span>`);
  }
  return chips.join('');
}

// §4.3.5 / §6.2 — a derived chip owes the reader its reason in BOTH channels: "hover AND print
// show the derivedFrom string". A `title=` attribute is a screen affordance and nothing else —
// it renders in no PDF, and the printed sheet said ⚠ DESTRUCTIVE with the heuristic behind it
// nowhere on the page. The page's honesty about its own inference IS the argument for the
// schema field (§8.3), so the reason prints as text, beside the chip it explains.
function chipProvenance(t) {
  const why = t.destructive.value === true ? derivedWhy(t.destructive.provenance) : null;
  if (!why) return '';
  return `<p class="chip-why"><b>⚠ DESTRUCTIVE</b> is derived, not declared — ${esc(why)}</p>`;
}

// §7.1 — the grade is a smoke alarm, not a judge. The drawer is how a reader overrules it in
// one glance: every check, its verdict, and the predicate it ran.
const D_LABEL = {
  D1: 'purpose beyond restatement',
  D2: 'when-to-use context',
  D3: 'when-NOT-to-use',
  D4: 'inputs named in prose',
  D5: 'result shape named',
  D6: 'side effects stated',
  D7: 'consent stated',
};

const VERDICT_WORD = { pass: '✓ pass', fail: '✕ fail', na: '— N/A (out of the denominator)' };

function gradeDrawer(t) {
  if (!t.grades) return '';
  const rows = Object.entries(t.grades.checks)
    .map(
      ([k, v]) =>
        `<li class="d-${v}"><b>${k}</b> ${esc(D_LABEL[k])} — ${esc(VERDICT_WORD[v])}</li>`
    )
    .join('');
  const applicable = Object.values(t.grades.checks).filter((v) => v !== 'na');
  const passed = applicable.filter((v) => v === 'pass').length;
  const badges = t.badges.length > 0 ? t.badges.join(', ') : 'none of the five';
  return [
    '<details class="grade-why">',
    `<summary>why this grade — ${esc(t.grades.letter)} (${passed} of ${applicable.length} applicable checks)</summary>`,
    `<ul class="dchecks">${rows}</ul>`,
    `<p class="quiet">Badges passed: ${esc(badges)}.</p>`,
    '</details>',
  ].join('');
}

const CLASS_WORD = {
  ran: 'RAN',
  'gate-held': 'GATE-HELD',
  'handle-gate-held': 'HANDLE-GATE-HELD',
  open: 'OPEN',
  error: 'ERROR',
  unverified: 'UNVERIFIED',
};

function cardFooter(t, surface, opts) {
  const bits = [];
  if (!opts.noSource && t.provenance.sourceRef) {
    bits.push(`<code>${wbr(String(t.provenance.sourceRef).replace(/\\/g, '/'))}</code>`);
  }
  if (t.provenance.origin) bits.push(esc(t.provenance.origin));
  const cls = CLASS_WORD[t.verification.class];
  const detail = t.verification.detail ? ` — ${esc(t.verification.detail)}` : '';
  bits.push(`<b class="vclass v-${t.verification.class}">${cls}</b>${detail}`);
  const micro = [surface.app, opts.noSource ? null : t.provenance.sourceRef, surface.verifyRun?.runId ? `run ${surface.verifyRun.runId}` : null]
    .filter(Boolean)
    .map((s) => esc(String(s).replace(/\\/g, '/')))
    .join(' · ');
  return `<footer class="card-f">${bits.join(' · ')}<span class="micro">${micro}</span></footer>`;
}

const BLOCK_LABELS = [
  ['purpose', 'PURPOSE'],
  ['when-to-use', 'WHEN TO USE'],
  ['when-not-to-use', 'WHEN NOT TO USE'],
  ['input', 'INPUT'],
  ['output', 'OUTPUT'],
  ['annotations', 'ANNOTATIONS'],
  ['consent', 'CONSENT'],
  ['call', 'THE CALL'],
];

// The text filter's index, and the ONLY thing it reads (§6.1: name+purpose+path).
// Searching the rendered card instead swept in the curl block, the tools/call envelope, the
// annotations table and the footer sourceRef — `unknown` matched 85/85 cards, `token` 70/85.
// A filter that matches everything is not a filter, and it poisons the print scope (D12).
function searchIndex(t) {
  return [t.name, t.purpose, t.transport.method, t.transport.path]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function renderCard(t, surface, opts) {
  const bodies = {
    purpose: purposeBlock(t, opts),
    'when-to-use': whenBlock(t, false),
    'when-not-to-use': whenBlock(t, true),
    input: inputBlock(t),
    output: outputBlock(t),
    annotations: annotationsBlock(t),
    consent: consentBlock(t),
    call: callBlock(t, surface),
  };
  const blocks = BLOCK_LABELS.map(
    ([key, label]) =>
      `<section class="block${bodies[key].empty ? ' empty' : ''}" data-block="${key}"><h4>${label}</h4>${bodies[key].html}</section>`
  ).join('');
  const route =
    t.transport.method && t.transport.path
      ? `<div class="route"><span class="verb">${esc(t.transport.method)}</span> <code>${routeLine(t.transport.path)}</code></div>`
      : '';
  const prereq =
    t.prereqs.length > 0
      ? `<div class="prereq">requires <a href="#tool-${escAttr(slug(t.prereqs[0]))}">${esc(t.prereqs[0])}</a> first</div>`
      : '';
  const id = slug(t.name);
  return [
    `<article class="card" id="tool-${escAttr(id)}" data-kind="${escAttr(t.kind ?? '')}" data-tier="${escAttr(t.tier ?? '')}" data-auth="${escAttr(t.consent.mode ?? '')}" data-vclass="${escAttr(t.verification.class)}" data-search="${escAttr(searchIndex(t))}">`,
    `<header class="card-h"><code class="tname">${wbr(t.name)}</code><a class="anchor no-print" href="#tool-${escAttr(id)}" title="link to this tool">#</a><span class="rail">${chipsOf(t, opts)}</span></header>`,
    chipProvenance(t),
    route,
    prereq,
    blocks,
    opts.grade ? gradeDrawer(t) : '',
    cardFooter(t, surface, opts),
    '</article>',
  ].join('');
}

// ---------------------------------------------------------------- bands

function masthead(surface, opts) {
  const corrected = surface.tools.some((t) => t.transport.corrected);
  const real = surface.tools[0]?.transport.real ?? 'unknown';
  const banner = corrected
    ? `<p class="banner">Real transport is <b>${esc(real)}</b>. You cannot curl this. The <code>type: "http"</code> in the manifest is a schema artifact — see HOW TO READ THIS.</p>`
    : surface.source === 'mcp'
      ? '<p class="banner quiet">transport: unknown — a tools/list payload carries no transport field.</p>'
      : '';
  const gen = surface.generatedAt
    ? `manifest ${esc(surface.generatedAt)} (${ageInDays(surface.generatedAt, surface.renderedAt)}d)`
    : 'manifest date not stated';
  const run = surface.verifyRun
    ? `verify run ${esc(surface.verifyRun.runId ?? '?')} (${surface.verifyRun.ageAtRender}d)`
    : 'no verify run stamped';
  const stale =
    surface.verifyRun && surface.generatedAt && Date.parse(surface.verifyRun.at) < Date.parse(surface.generatedAt)
      ? '<p class="banner risk">The verify run predates the manifest — these proofs are older than the surface they claim to prove.</p>'
      : '';
  return [
    '<header class="band" data-band="masthead" id="masthead">',
    `<h1>${esc(surface.app ?? 'agent surface')}</h1>`,
    `<p class="sub">${esc(surface.adapter ?? 'unknown adapter')} · ${esc(surface.source)} · ${esc(real)}</p>`,
    banner,
    stale,
    `<p class="freshness">${gen} · ${run} · rendered ${esc(surface.renderedAt)}</p>`,
    '<div class="controls no-print">',
    '<button type="button" id="theme">screen / ink preview</button>',
    '<button type="button" id="pdf">Save as PDF</button>',
    '<button type="button" id="md">Copy as Markdown</button>',
    '</div>',
    '</header>',
  ].join('');
}

const ledeBand = (surface) =>
  `<section class="band lede" data-band="lede"><p>${esc(surface.lede)}</p></section>`;

function indexBand(surface, opts = {}) {
  const rows = surface.tools
    .map((t) => {
      // §6.1 band 3 — the A-F letter chip REPLACES the UNDOCUMENTED marker under --grade.
      // The bare index keeps the marker and carries no letters.
      const doc =
        opts.grade && t.grades
          ? `<span class="mini grade g-${t.grades.letter}">${t.grades.letter}</span>`
          : isUndocumented(t)
            ? '<span class="mini">UNDOCUMENTED</span>'
            : '';
      return [
        `<a class="row" href="#tool-${escAttr(slug(t.name))}">`,
        `<code>${wbr(t.name)}</code>`,
        `<span class="mini">${esc(t.kind ?? '—')}</span>`,
        `<span class="mini">${esc(t.consent.mode ?? '—')}</span>`,
        doc,
        `<span class="mini v-${t.verification.class}">${esc(t.verification.class)}</span>`,
        '</a>',
      ].join('');
    })
    .join('');
  // D7 — the absence rate is stated ONCE, here, and the cards mark it in one muted line each.
  // The to-do sentence rides with the statement, not with 84 copies of it.
  const n = surface.tools.length;
  const { templated, undocumented, withDeclaredInputSchema, withMinedInputSchema } = surface.counts;
  const todo =
    templated > 0
      ? ' Run <code>/vibe-access:describe</code> to author the missing explanations.'
      : '';
  // An MCP surface has no scan templates to count — its hole is absent or too-thin prose,
  // and :describe does not run against a server someone else owns.
  if (surface.source === 'mcp') {
    return [
      '<section class="band" data-band="index" id="index">',
      '<h2>TOOL INDEX</h2>',
      `<p class="quiet absence-note">${undocumented} of ${n} descriptions are absent or under ${MIN_DESCRIPTION_CHARS} characters — a label, not a purpose · ` +
        `${withDeclaredInputSchema} of ${n} declare an input schema. Stated once here — each card marks its own hole in one line, not a wall.</p>`,
      filterControls(surface),
      '<p class="print-filter">FILTERED VIEW</p>',
      `<nav class="index">${rows}</nav>`,
      '</section>',
    ].join('');
  }
  // mined != declared, and the sheet's one input-coverage statement says which (§13.1.5).
  const minedClause =
    withMinedInputSchema > 0
      ? ` · ${withMinedInputSchema} carry a shape mined from handler source`
      : '';
  const note =
    `<p class="quiet absence-note">${templated} of ${n} descriptions are scan templates · ` +
    `${withDeclaredInputSchema} of ${n} declare an input schema${minedClause}. Stated once here — each card marks its ` +
    `own hole in one line, not a wall.${todo}</p>`;
  return [
    '<section class="band" data-band="index" id="index">',
    '<h2>TOOL INDEX</h2>',
    note,
    filterControls(surface),
    '<p class="print-filter">FILTERED VIEW</p>',
    `<nav class="index">${rows}</nav>`,
    '</section>',
  ].join('');
}

function filterControls(surface) {
  return [
    '<div class="filters no-print">',
    '<input type="search" id="q" placeholder="filter (press /)">',
    '<button type="button" class="f" data-filter="open">Open</button>',
    '<button type="button" class="f" data-filter="destructive">Destructive</button>',
    '<button type="button" class="f" data-filter="failed">Failed</button>',
    '<button type="button" class="f" data-filter="undocumented">Undocumented</button>',
    '<button type="button" class="f" data-filter="dev">Dev-only</button>',
    '<button type="button" class="f" data-filter="act">Act</button>',
    '<button type="button" class="f" data-filter="read">Read</button>',
    // The verify-class axis, one chip per class the surface ACTUALLY contains. Selecting
    // several ORs them. handle-gate-held gets its own chip and is never folded into
    // gate-held — the honesty rule holds in the filter bar too, not just the math.
    ...[...new Set(surface.tools.map((t) => t.verification.class))].map(
      (c) => `<button type="button" class="f" data-filter="v:${escAttr(c)}">${esc(c)}</button>`
    ),
    '<button type="button" id="density">density: cards / rows</button>',
    '</div>',
  ].join('');
}

function prereqBand(surface) {
  const gated = surface.tools.filter((t) => t.prereqs.length > 0);
  if (gated.length === 0) return '';
  const first = gated[0].prereqs[0];
  return [
    '<section class="band" data-band="prereqs">',
    '<h2>PREREQUISITE CHAIN</h2>',
    '<ol>',
    `<li><code>${wbr(first)}</code> must be the first call on the connection.</li>`,
    '<li>Every gated call afterwards carries the session identity header (<code>x-plugin-id</code>).</li>',
    `<li>${gated.length} of ${surface.tools.length} affordances depend on it. A call made without it does not fail loudly — it is simply refused.</li>`,
    '</ol>',
    '</section>',
  ].join('');
}

function cardsBand(surface, opts) {
  const groups = new Map();
  for (const t of surface.tools) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }
  const sections = [...groups.entries()]
    .map(([name, tools]) => {
      const prefix = tools[0].transport.sharedPrefix;
      const factored = prefix ? ` · shared prefix <code>${wbr(prefix)}</code> factored out of every card below` : '';
      // Silence is not `none`. `auth: none` means OPEN in the legend — printing it for an
      // undeclared consent mode asserts an open surface the source never claimed, which is
      // fail-open rendered as a fact. Undeclared says "not declared"; a surface where NOTHING
      // declares a mode (a tools/list payload) drops the clause entirely — the lede already
      // said it once.
      const modes = tools.map((t) => t.consent.mode);
      const allUndeclared = modes.every((m) => !m);
      const auths = allUndeclared
        ? ''
        : ` · auth: ${esc([...new Set(modes.map((m) => m ?? 'not declared'))].join(', '))}`;
      const verify = verifyDecompositionSentence(
        tools.reduce(
          (acc, t) => {
            const map = {
              ran: 'ran',
              'gate-held': 'gateHeld',
              'handle-gate-held': 'handleGateHeld',
              open: 'open',
              error: 'error',
              unverified: 'unverified',
            };
            acc[map[t.verification.class]] += 1;
            return acc;
          },
          { ran: 0, gateHeld: 0, handleGateHeld: 0, open: 0, error: 0, unverified: 0 }
        )
      );
      return [
        `<div class="group-band"><h3>${esc(name)}</h3>`,
        `<p class="quiet">${tools.length} affordance${tools.length === 1 ? '' : 's'}${auths}${factored}</p>`,
        `<p class="quiet">${esc(verify)}</p></div>`,
        tools.map((t) => renderCard(t, surface, opts)).join(''),
      ].join('');
    })
    .join('');
  return `<section class="band" data-band="cards"><h2>TOOLS</h2>${sections}</section>`;
}

// ---------------------------------------------------------------- the --grade bands (§6.1 6-11)
// Everything below renders ONLY under --grade (D25). The builder asked for a reference sheet;
// the audit earns its ink when it is invited.

const findingCard = (f) =>
  [
    `<article class="finding sev-${escAttr(f.severity)}" id="${escAttr(f.id)}">`,
    `<h3>${esc(f.title)}</h3>`,
    `<p class="sev">${esc(f.severity)}</p>`,
    `<p>${esc(f.body)}</p>`,
    f.toolRefs.length > 0
      ? `<p class="quiet">${f.toolRefs
          .map((n) => `<a href="#tool-${escAttr(slug(n))}"><code>${wbr(n)}</code></a>`)
          .join(' · ')}</p>`
      : '',
    '</article>',
  ].join('');

// Band 6 — the single worst finding, picked by the severity enum order (the findings array is
// already sorted by it in the normalizer). WeSeeYou's headline is not a 500.
function headlineBand(surface) {
  const worst = surface.findings[0];
  if (!worst) return '';
  return [
    '<section class="band" data-band="headline">',
    '<h2>THE HEADLINE</h2>',
    `<div class="banner risk"><h3>${esc(worst.title)}</h3><p>${esc(worst.body)}</p>`,
    `<p class="quiet"><a href="${escAttr(worst.anchor)}">the evidence</a></p></div>`,
    '</section>',
  ].join('');
}

// Band 7 — five derived tiles, none of which is a count of tools.
function verdictBand(surface) {
  const { counts, tools } = surface;
  const n = counts.total;
  const prodGets = tools.filter(
    (t) => t.consent.mode === 'none' && t.tier === 'prod-safe' && t.transport.method === 'GET'
  ).length;
  const kinds = Object.entries(counts.byKind).map(([k, v]) => `${v} ${k}`).join(' · ') || 'kind not declared';
  const destructive = counts.destructive.declared + counts.destructive.derived;
  const ran = counts.verify.ran;
  const gate = counts.verify.gateHeld + counts.verify.handleGateHeld;
  const privilege = tools.filter((t) => PRIVILEGE_RE.test(`${t.name} ${t.transport.path ?? ''}`)).length;
  const conflicts = tools.filter((t) => t.tier === 'prod-safe' && t.destructive.value === true).length;

  const tile = (label, headline, sub, anchor) =>
    [
      `<a class="tile" href="${escAttr(anchor)}">`,
      `<span class="tile-k">${esc(label)}</span>`,
      `<span class="tile-v">${esc(headline)}</span>`,
      `<span class="tile-s">${esc(sub)}</span>`,
      '</a>',
    ].join('');

  return [
    '<section class="band" data-band="verdict">',
    '<h2>VERDICT</h2>',
    '<div class="tiles">',
    tile(
      'OPEN SURFACE',
      counts.openSurface > 0 ? `${counts.openSurface} of ${n} callable with no auth` : 'every affordance declares a gate',
      prodGets > 0 ? `${prodGets} prod GETs among them` : 'no unauthenticated prod GETs',
      '#security-hygiene'
    ),
    tile('REACH', kinds, `${destructive} destructive (declared or derived)`, '#index'),
    tile(
      'PROOF',
      verifyDecompositionSentence(counts.verify),
      `only ${ran} call${ran === 1 ? '' : 's'} returned data; ${gate} were refused at the gate`,
      '#report-card'
    ),
    tile(
      'DOCUMENTATION',
      `${counts.templated} of ${n} descriptions are scan templates`,
      counts.templated > 0 ? 'run /vibe-access:describe to author the missing explanations' : 'every description is authored',
      '#the-bar'
    ),
    tile(
      'RISK',
      `${destructive} destructive · ${privilege} privilege-shaped`,
      `${conflicts} tier contradiction${conflicts === 1 ? '' : 's'} · ${counts.verify.open} gate${counts.verify.open === 1 ? '' : 's'} answering cold`,
      '#findings'
    ),
    '</div>',
    '</section>',
  ].join('');
}

// Band 8 — six measured rows, then both invariant sentences. No composite letter: there is no
// formula that would earn one, and an invented weight is a lie with more digits.
function reportCardBand(surface) {
  const rows = surface.axes
    .map((a) => {
      const body =
        a.status === 'na'
          ? `<p class="none">${esc(a.naReason)}</p>`
          : `<ul class="measures">${a.measures
              .map((m) => `<li><span class="m-k">${esc(m.name)}</span><span class="m-v">${esc(String(m.value))}</span></li>`)
              .join('')}</ul>`;
      // An anchor into a band that did not render is a claim of evidence with no evidence
      // behind it. SCHEMA GAPS is the one conditional band — when it is absent, the axis
      // heading stays plain text rather than linking to air.
      const live = !(a.anchor === '#schema-gaps' && surface.schemaGaps.length === 0);
      const head = live
        ? `<a href="${escAttr(a.anchor)}">${esc(a.label)}</a>`
        : esc(a.label);
      return `<div class="axis" id="${escAttr(a.id)}"><h3>${head}</h3>${body}</div>`;
    })
    .join('');
  return [
    '<section class="band" data-band="report-card" id="report-card">',
    '<h2>SURFACE REPORT CARD</h2>',
    '<p class="quiet">These grade the SURFACE — the manifest as documentation for an agent reader — not the app. Six measured rows: the counts that would have driven a score, printed as-is. No 0-100 number, no composite letter; v0.2 has no formula that would earn one.</p>',
    `<div class="axes">${rows}</div>`,
    `<p class="invariant"><b>Tool count is not graded.</b> 17 is not a better number than 85 — "do not chase tool count" is the research's own conclusion. Count reported, explicitly not graded.</p>`,
    `<p class="invariant">${esc(verifyDecompositionSentence(surface.counts.verify))} Gate-held and handle-gate-held mean the gate worked and the call never ran; handle-gate-held is never folded into gate-held.</p>`,
    '</section>',
  ].join('');
}

// Band 9 — every surface-level finding as a card. Error clusters arrive pre-clustered from the
// normalizer: one dead subsystem is ONE card, not seven dots.
function findingsBand(surface) {
  if (surface.findings.length === 0) {
    return '<section class="band" data-band="findings" id="findings"><h2>FINDINGS</h2><p class="quiet">No breach, no unclaimed destruction, no tier contradiction on this surface.</p></section>';
  }
  return [
    '<section class="band" data-band="findings" id="findings">',
    '<h2>FINDINGS</h2>',
    surface.findings.map(findingCard).join(''),
    '</section>',
  ].join('');
}

// Band 10 — the calibration panel. A grade on someone's API is a social object; the reader sees
// a real A before meeting an F. The cards are COMPUTED by the §7.1 predicates, never hand-picked
// — when a predicate change demotes an exemplar, the panel quotes whatever actually grades A.
const LETTER_RANK = { A: 0, B: 1, C: 2, D: 3, F: 4 };

function barBand(surface) {
  const best = [...surface.tools]
    .filter((t) => t.grades)
    .sort((a, b) => LETTER_RANK[a.grades.letter] - LETTER_RANK[b.grades.letter])
    .filter((t, _i, arr) => t.grades.letter === arr[0].grades.letter)
    .slice(0, 2);
  const top = best[0]?.grades.letter ?? 'F';
  const note =
    top === 'A'
      ? 'Computed by the §7.1 predicates, not hand-picked. This is what a passing description looks like on this surface.'
      : `Nothing on this surface grades A. The best description here computes ${top} — printed with its own checks, so the bar is a real one and not a borrowed one.`;
  const cards = best
    .map((t) => {
      const checks = Object.entries(t.grades.checks)
        .map(([k, v]) => `<li class="d-${v}"><b>${k}</b> ${esc(VERDICT_WORD[v])}</li>`)
        .join('');
      return [
        '<article class="bar-card">',
        `<h3><a href="#tool-${escAttr(slug(t.name))}"><code>${wbr(t.name)}</code></a> <span class="chip grade g-${t.grades.letter}">GRADE ${t.grades.letter}</span></h3>`,
        `<blockquote>${esc(t.purpose)}</blockquote>`,
        `<ul class="dchecks">${checks}</ul>`,
        '</article>',
      ].join('');
    })
    .join('');
  return [
    '<section class="band" data-band="the-bar" id="the-bar">',
    '<h2>THE BAR</h2>',
    `<p class="quiet">${esc(note)} The literature says ~97% of tools carry at least one description defect and 56% have unclear purpose (arXiv 2602.14878, 856 tools / 103 servers).</p>`,
    `<div class="bar">${cards}</div>`,
    '</section>',
  ].join('');
}

// Band 11 — what this surface cannot express, stated once.
function schemaGapsBand(surface) {
  if (surface.schemaGaps.length === 0) return '';
  return [
    '<section class="band" data-band="schema-gaps" id="schema-gaps">',
    '<h2>SCHEMA GAPS</h2>',
    `<ul class="gaps">${surface.schemaGaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>`,
    '<p class="quiet">Each gap is a fact about the surface, not about the app. The §8 schema deltas — overrides.kind, authDetail, destructive — close the ones a field can close.</p>',
    '</section>',
  ].join('');
}

function howToReadBand(surface) {
  const groupNote = `Grouping: the section bands are the app's own shape, derived from the surface — not an axis anyone typed.`;
  return [
    '<section class="band" data-band="how-to-read" id="how-to-read">',
    '<h2>HOW TO READ THIS</h2>',
    '<dl>',
    '<dt>"Pass" means two different things.</dt>',
    '<dd>GATE-HELD and HANDLE-GATE-HELD mean the gate worked and the call never ran. RAN means data came back. A bare pass count folds those together, so this page never prints one: the verify math is always the full decomposition — ran / gate-held / handle-gate-held / open / error / unverified. <b>Tool count is not graded.</b> 17 is not a better number than 85.</dd>',
    '<dt>tier: prod-safe is an ASSERTION, not a safety proof.</dt>',
    '<dd>Nothing verified it. It is what the manifest claims, printed as a claim.</dd>',
    '<dt>"mechanism not stated" is not "no capability required."</dt>',
    '<dd>A card whose CONSENT block says the mechanism is unstated is telling you the surface never wrote down HOW the gate is satisfied — not that there is no gate. You find out by calling it.</dd>',
    '<dt>{?} is an unnamed path parameter.</dt>',
    '<dd>The route takes a value there and nothing in the surface says what it is. The call block renders it as <code>&lt;UNNAMED_PARAM_1&gt;</code> so a genuine gap is impossible to paste past.</dd>',
    '<dt>declared / derived / mined / unclaimed.</dt>',
    '<dd><b>declared</b> — a real field in the data says so. <b>derived</b> — inferred, with the reason printed. <b>mined</b> — pulled out of prose. <b>unclaimed</b> — nothing says either way, which is not the same as "false."</dd>',
    '<dt>Transport correction.</dt>',
    '<dd>The manifest schema has one transport member ("http"). When the real transport is something else, the masthead says so and the call block renders the real thing.</dd>',
    '<dt>The MCP projection is a projection.</dt>',
    '<dd>The <code>tools/call</code> envelopes on these cards are a projection, not a running server — vibe-access does not emit an MCP server today.</dd>',
    `<dt>Grouping.</dt><dd>${esc(groupNote)}</dd>`,
    '</dl>',
    '</section>',
  ].join('');
}

function provenanceBand(surface, opts, bytes) {
  const src = opts.noSource ? 'source refs suppressed (--no-source)' : `${surface.tools.length} affordances`;
  const run = surface.verifyRun ? `run ${esc(surface.verifyRun.runId ?? '?')}` : 'no verify run';
  return [
    '<footer class="band" data-band="provenance">',
    `<p class="quiet">${esc(surface.app ?? 'agent surface')} · ${esc(src)} · ${bytes} bytes of surface data · ${run} · generated ${esc(surface.generatedAt ?? 'unstated')} · rendered ${esc(surface.renderedAt)} · vibe-access ${PLUGIN_VERSION}</p>`,
    '</footer>',
  ].join('');
}

// ---------------------------------------------------------------- CSS + JS

// Fonts: the 626 faces (Space Grotesk, JetBrains Mono) are NOT available offline and are not
// embedded — a self-contained file that survives email cannot carry megabytes of woff2.
// local() resolution picks the brand faces up where installed; everywhere else the named
// system stack renders correctly.
// §9 — the ink palette. ONE token block, two triggers: the on-screen ink preview and paper.
// Every rule in the sheet reads tokens, so nothing needs a per-selector print override — the
// class of bug where one hard-referenced `var(--ink)` renders near-white on white paper.
const INK_TOKENS = `
  --navy:#FBFAF7; --navy-2:#ffffff; --line:#ddd8d0;
  --ink:#111; --ink-2:#6B6660; --ink-3:#6B6660;
  --cyan:#0F6B6B; --magenta:#7A1F2B;
  --code-bg:#F3F1EC; --hatch:rgba(107,102,96,.16);
  color-scheme: light;
`;

// The two ink rules that are not a token swap: the chip word goes full ink for readability,
// and the DESTRUCTIVE fill keeps its knocked-out white on oxblood.
const INK_RULES = (sel) => `
${sel} .chip{color:var(--ink)}
${sel} .chip.filled{color:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact}
`;

const CSS = `
:root{
  --font-ui:'Space Grotesk','Segoe UI',system-ui,-apple-system,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,'Cascadia Code',Consolas,monospace;
  --navy:#0b1526; --navy-2:#101e33; --line:#1d3050;
  --ink:#e9eff8; --ink-2:#a9b8ce; --ink-3:#71849f;
  --cyan:#17d4fa; --magenta:#f22f89;
  --code-bg:#08111f; --hatch:rgba(113,132,159,.12);
  color-scheme: dark;
}
*{box-sizing:border-box}
body{margin:0;background:var(--navy);color:var(--ink);font-family:var(--font-ui);line-height:1.55;overflow-wrap: anywhere}
main{max-width:900px;margin:0 auto;padding:24px 16px 96px}
h1{font-size:1.7rem;margin:0 0 4px}
h2{font-size:.85rem;letter-spacing:.14em;color:var(--cyan);border-bottom:1px solid var(--line);padding-bottom:6px;margin:40px 0 16px}
h3{font-size:1rem;margin:24px 0 2px}
h4{font-size:.68rem;letter-spacing:.12em;color:var(--ink-3);margin:0 0 4px}
code,pre{font-family:var(--font-mono);overflow-wrap: anywhere}
.sub,.freshness,.quiet,.mini{color:var(--ink-2)}
.freshness,.quiet{font-size:.8rem}
.band{margin-bottom:8px}
.lede p{font-size:1.05rem;border-left:2px solid var(--cyan);padding-left:14px;margin:24px 0}
.banner{border:1px solid var(--cyan);border-left-width:4px;padding:10px 12px;border-radius:3px}
.banner.risk{border-color:var(--magenta)}
.controls,.filters{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
button{font-family:var(--font-ui);font-size:.75rem;background:transparent;color:var(--ink-2);border:1px solid var(--line);border-radius:3px;padding:5px 10px;cursor:pointer}
button:hover{color:var(--cyan);border-color:var(--cyan)}
button.on{color:var(--navy);background:var(--cyan);border-color:var(--cyan)}
input[type=search]{font-family:var(--font-mono);font-size:.75rem;background:var(--navy-2);color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:5px 10px;flex:1 1 220px}
.index{display:flex;flex-direction:column}
.row{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;padding:4px 6px;border-bottom:1px solid var(--line);text-decoration:none;color:var(--ink)}
.row:hover{background:var(--navy-2)}
.row code{font-size:.82rem}
.mini{font-size:.68rem;letter-spacing:.06em}
.group-band{margin-top:32px;border-top:1px solid var(--line);padding-top:12px}
.card{border:1px solid var(--line);border-radius:4px;padding:14px 16px;margin:14px 0;background:var(--navy-2);break-inside:avoid}
.card-h{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.tname{font-size:1rem;font-weight:600;color:var(--ink)}
.anchor{color:var(--ink-3);text-decoration:none;font-size:.8rem}
.anchor:hover{color:var(--cyan)}
.rail{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.chip{font-size:.62rem;letter-spacing:.1em;border:1px solid var(--ink-3);color:var(--ink-2);border-radius:2px;padding:2px 6px}
.chip.filled{background:var(--magenta);border-color:var(--magenta);color:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.chip.risk{border-color:var(--magenta);color:var(--magenta)}
.chip.dotted{border-style:dashed}
/* The derived chip's reason. On screen the chip's dotted underline + title carry it (the rail
   stays a rail); on paper — and in the ink preview, which IS the paper preview — it is text.
   Hidden by the screen rule below, never by a print rule. */
.chip-why{margin:6px 0 0;font-size:.72rem;color:var(--ink-3)}
.chip-why b{font-weight:600;letter-spacing:.06em}
.route{margin:8px 0;font-size:.82rem;color:var(--ink-2)}
.verb{color:var(--cyan);font-family:var(--font-mono)}
/* The unknown parameter is a GAP, not a fire: styled + footnoted, never danger-inked (D11). */
.qmark{font-family:var(--font-mono);color:var(--ink);font-weight:600;text-decoration:underline dotted;cursor:help}
.prereq{font-size:.75rem;color:var(--ink-2)}
.prereq a{color:var(--cyan)}
.block{margin-top:12px}
.block p{margin:0 0 6px}
/* D7 — an empty block is one compact labeled line; four of them fold into a single run. */
.block.empty{display:inline-block;margin:8px 14px 0 0}
.block.empty h4{display:inline;margin-right:5px}
.none{color:var(--ink-3);font-size:.74rem}
.tmpl{color:var(--ink-3);font-style:italic}
.tmpl-note{color:var(--ink-3);font-size:.74rem}
.absence-note{border-left:2px solid var(--line);padding-left:10px}
.tag{font-size:.62rem;letter-spacing:.08em;color:var(--ink-3);border:1px solid var(--line);border-radius:2px;padding:1px 5px;margin-right:6px}
.tag.dotted{border-style:dashed}
.params{width:100%;border-collapse:collapse;font-size:.78rem;break-inside:avoid}
.params th{text-align:left;color:var(--ink-3);font-weight:400;border-bottom:1px solid var(--line);padding:3px 6px 3px 0}
.params td{border-bottom:1px solid var(--line);padding:3px 6px 3px 0;vertical-align:top}
.anns{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px}
.ann{border:1px solid var(--line);border-radius:2px;padding:6px 8px;font-size:.72rem}
.ann-k{display:block;color:var(--ink-3);letter-spacing:.08em}
.ann.derived{border-style:dashed;color:var(--ink-2)}
.ann.unclaimed{border-style:dashed;color:var(--ink-3);background:repeating-linear-gradient(45deg,transparent,transparent 5px,var(--hatch) 5px,var(--hatch) 6px)}
.why{display:block;color:var(--ink-3);font-size:.66rem;margin-top:2px}
.cap{color:var(--cyan)}
.call-h{display:flex;justify-content:space-between;align-items:center;font-size:.68rem;letter-spacing:.1em;color:var(--ink-3);margin-top:8px}
summary.call-h{cursor:pointer}
pre.code{background:var(--code-bg);border:1px solid var(--line);border-radius:3px;padding:10px;font-size:.76rem;overflow-x: auto;white-space:pre-wrap;overflow-wrap: anywhere;margin:4px 0}
/* The note that qualifies the call, outside the block the copy button copies. */
.callnote{margin:2px 0 0;font-size:.72rem;color:var(--ink-3)}
.card-f{margin-top:12px;padding-top:8px;border-top:1px solid var(--line);font-size:.72rem;color:var(--ink-2)}
.vclass{letter-spacing:.08em}
.v-open,.v-error{color:var(--magenta)}
.v-ran,.v-gate-held,.v-handle-gate-held{color:var(--cyan)}
.micro{display:block;font-size:8px;color:var(--ink-3);font-family:var(--font-mono);margin-top:6px}
dl dt{color:var(--cyan);margin-top:12px;font-size:.9rem}
dl dd{margin:2px 0 0;color:var(--ink-2);font-size:.88rem}
.print-filter{display:none}
.hidden{display:none}

/* §7 — the --grade layer. Letters are letters (never color alone), the tiles carry words and
   not counts of tools, and the danger ink stays scarce: a breach finding is danger, an axis
   row is not. */
.chip.grade{letter-spacing:.08em}
.mini.grade{border:1px solid var(--ink-3);border-radius:2px;padding:0 5px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.tile{display:block;border:1px solid var(--line);border-radius:3px;padding:10px;text-decoration:none;color:var(--ink);break-inside:avoid}
.tile:hover{border-color:var(--cyan)}
.tile-k{display:block;font-size:.62rem;letter-spacing:.12em;color:var(--ink-3)}
.tile-v{display:block;font-size:.9rem;margin-top:4px}
.tile-s{display:block;font-size:.72rem;color:var(--ink-2);margin-top:4px}
.axis{border-top:1px solid var(--line);padding-top:8px;margin-top:12px;break-inside:avoid}
.axis h3{margin:0 0 4px;font-size:.8rem;letter-spacing:.1em}
.axis h3 a{color:var(--cyan);text-decoration:none}
.measures{list-style:none;margin:0;padding:0;font-size:.8rem}
.measures li{display:flex;gap:12px;justify-content:space-between;border-bottom:1px solid var(--line);padding:2px 0}
.m-k{color:var(--ink-2)}
.m-v{font-family:var(--font-mono);text-align:right}
.invariant{border-left:2px solid var(--cyan);padding-left:12px;font-size:.9rem}
.finding{border:1px solid var(--line);border-radius:4px;padding:12px 14px;margin:12px 0;background:var(--navy-2);break-inside:avoid}
.finding.sev-breach{border-color:var(--magenta)}
.finding h3{margin:0 0 2px}
.finding .sev{font-size:.62rem;letter-spacing:.12em;color:var(--ink-3);margin:0 0 6px}
.finding a{color:var(--cyan)}
.bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.bar-card{border:1px solid var(--line);border-radius:4px;padding:12px 14px;background:var(--navy-2);break-inside:avoid}
.bar-card h3{margin:0 0 6px;font-size:.9rem}
.bar-card h3 a{color:var(--ink);text-decoration:none}
blockquote{margin:0 0 8px;padding-left:10px;border-left:2px solid var(--line);color:var(--ink-2);font-size:.86rem}
.dchecks{list-style:none;margin:0;padding:0;font-size:.74rem;color:var(--ink-2)}
.dchecks li{padding:1px 0}
.dchecks .d-na{color:var(--ink-3)}
.grade-why{margin-top:10px;font-size:.8rem}
.grade-why summary{cursor:pointer;color:var(--ink-3);font-size:.72rem;letter-spacing:.06em}
.gaps{margin:0;padding-left:18px;font-size:.86rem;color:var(--ink-2)}
.gaps li{margin-bottom:4px}

/* Density is a SCREEN affordance only. On paper every card prints whole — the route line, the
   footer (sourceRef · origin · verify class) and the 8px micro-footer are the per-card honesty
   channel, and a page torn out of the PDF still has to say what it is (§6.2). The ink preview
   is a print preview, so it opts out of density too. */
@media screen{
  :root[data-density=rows]:not([data-ink]) .card .block,
  :root[data-density=rows]:not([data-ink]) .card .route,
  :root[data-density=rows]:not([data-ink]) .card .card-f,
  :root[data-density=rows]:not([data-ink]) .card .prereq{display:none}
  :root[data-density=rows]:not([data-ink]) .card.open .block,
  :root[data-density=rows]:not([data-ink]) .card.open .route,
  :root[data-density=rows]:not([data-ink]) .card.open .card-f{display:block}
  /* The chip's reason is a hover on the live page and a printed line on paper (§6.2). The
     hiding happens HERE, on screen — never in @media print, where the whole point is that it
     shows. The ink preview is the paper preview, so it opts out and shows the line. */
  :root:not([data-ink]) .chip-why{display:none}
}

/* The ink preview: the same palette paper gets, on screen, before anyone hits print. */
:root[data-ink]{${INK_TOKENS}}
${INK_RULES(':root[data-ink]')}

@media print{
  :root{${INK_TOKENS}}
${INK_RULES(':root')}
  body{line-height:1.4}
  main{max-width:none;padding:0}
  .no-print{display:none!important}
  pre.code{white-space:pre-wrap;overflow-wrap: anywhere}
  .card,.params,.group-band{break-inside:avoid}
  /* §9 — "break-after: avoid on group headers (no orphaned band at a page foot)". h3 alone only
     bound the h3 to the two summary lines inside its own div; nothing stopped the whole band
     from landing at the foot of a page with its first card overleaf. Costs ~2 pages on the bare
     corpus and buys back a real print defect. */
  h3,.group-band{break-after:avoid}
  [data-band=index]{break-before:page}
  details:not(.pc)>*{display:block!important}
  details.pc>summary::marker,details.pc>summary::-webkit-details-marker{color:var(--ink-3)}
  body.filtered .print-filter{display:block;border:1px solid var(--magenta);color:var(--magenta);padding:6px 8px}
  a[href^="http"]::after{content:" (" attr(href) ")"}

  /* Page budget (§10.2.6). The cuts are DENSITY, never information — every block keeps its
     label and its words, every derived reason keeps its sentence, and THE CALL keeps every
     line a reader pastes. break-inside:avoid means a card taller than half a page costs a
     whole one, so the leading, the block runs and the table are where the pages come from. */
  body{line-height:1.25}
  h2{margin:22px 0 8px}
  .lede p{margin:12px 0}
  .band{margin-bottom:4px}
  /* .8rem is ~9.6pt of body text. That is the floor: the sheet is read, not skimmed, and a
     page budget bought with unreadable type is the dishonesty this plugin exists to prevent. */
  .card{padding:3px 6px;margin:2px 0;font-size:.8rem;line-height:1.2}
  .tname{font-size:.88rem}
  .route{margin:0;font-size:.74rem}
  .chip-why{margin:0;font-size:.66rem}
  .block{margin-top:1px}
  .block h4{display:inline;margin-right:6px;font-size:.6rem}
  .block p{display:inline;margin:0}
  .block p+p{margin-left:6px}
  /* The short blocks flow as one labeled run: every label and every word survives, the four
     blank lines between them do not. */
  .block[data-block=when-to-use],.block[data-block=when-not-to-use],
  .block[data-block=input],.block[data-block=output]{display:inline;margin:0 10px 0 0}
  .call-h{margin-top:1px;font-size:.58rem}
  .anns{display:block;font-size:.66rem}
  .ann{display:inline;border:0;padding:0;background:none}
  .ann+.ann::before{content:" · "}
  .ann-k{display:inline}
  .ann-k::after{content:" "}
  /* The derived reason PRINTS (F2). "derived: true" with the heuristic hidden is the sheet
     asking to be trusted — the same fail the plugin exists to catch. It runs in beside the
     cell it explains rather than costing a line of its own. */
  .ann .why{display:inline;margin:0;font-size:1em}
  .ann .why::before{content:" — "}
  .index .row{padding:0 4px}
  .group-band{margin-top:12px;padding-top:5px}
  /* The parameter table is a 5-column grid on screen. On paper the description column is
     squeezed to a ~40-char measure and every row wraps two or three deep — the same rows cost
     three times the ink for no gain. Print runs each row in as one full-measure line: same
     cells, same order, nothing dropped. The header's column names go with it, so the one cell
     whose value cannot name itself (the default) carries its label inline. */
  .params{font-size:.7rem}
  .params,.params tbody,.params tr{display:block}
  .params thead{display:none}
  .params tr{border-bottom:1px solid var(--line);padding:0}
  .params td{display:inline;border:0;padding:0;vertical-align:baseline}
  .params td+td::before{content:" · "}
  .params td:nth-child(4)::before{content:" · default "}
  /* 0.6rem mono is ~7pt on paper — the floor, not a target. Below this the call block stops
     being something a human reads and the page budget starts buying pages with legibility. */
  pre.code{padding:2px 4px;margin:1px 0;font-size:.6rem;line-height:1.2}
  .callnote{margin:0;font-size:.58rem}
  .card-f{margin-top:3px;padding-top:2px;font-size:.66rem}
  /* The micro-footer runs in with the footer rather than taking a line of its own. A page torn
     out of the PDF still says app · source · run — the identity channel is intact (§6.2 D6). */
  .micro{display:inline;margin:0 0 0 8px}
}
@page{size:letter portrait;margin:14mm 12mm}
`;

const JS = `
(function(){
  var root=document.documentElement;
  var b=document.getElementById('theme');
  if(b)b.addEventListener('click',function(){if(root.dataset.ink)root.removeAttribute('data-ink');else root.dataset.ink='1';});
  var p=document.getElementById('pdf');
  if(p)p.addEventListener('click',function(){window.print();});
  var cards=Array.prototype.slice.call(document.querySelectorAll('.card'));
  var rows=Array.prototype.slice.call(document.querySelectorAll('.index .row'));
  // The index is emitted in surface order; the cards are group-clustered. Pair them by
  // identity, never by position — a filter that hides the wrong index rows is a lie on the
  // one page built to stop lies.
  var rowFor={};
  rows.forEach(function(r){var h=r.getAttribute('href');if(h&&!Object.prototype.hasOwnProperty.call(rowFor,h))rowFor[h]=r;});
  var q=document.getElementById('q');
  var active={};
  var writing=false;
  function match(c){
    // The index is name+purpose+method+path (data-search). Never c.textContent — that reads the
    // curl block, the tools/call envelope and the footer, and matches nearly every card.
    var t=c.dataset.search||'';
    var term=q&&q.value?q.value.toLowerCase():'';
    if(term&&t.indexOf(term)<0)return false;
    if(active.open&&c.dataset.auth!=='none')return false;
    if(active.destructive&&c.innerHTML.indexOf('DESTRUCTIVE')<0)return false;
    if(active.failed&&c.dataset.vclass!=='error'&&c.dataset.vclass!=='open')return false;
    if(active.undocumented&&c.innerHTML.indexOf('UNDOCUMENTED')<0)return false;
    if(active.dev&&c.dataset.tier!=='dev')return false;
    if(active.act&&c.dataset.kind!=='act')return false;
    if(active.read&&c.dataset.kind!=='read')return false;
    var vc=Object.keys(active).filter(function(k){return active[k]&&k.indexOf('v:')===0;});
    if(vc.length&&vc.indexOf('v:'+c.dataset.vclass)<0)return false;
    return true;
  }
  // View state — filters, text query, density — lives in the URL hash, so "send me just the
  // 15 open routes" is a link. Tool anchors (#tool-<name>) share the hash and are never
  // clobbered: the state writer only fires on a real interaction.
  function writeHash(){
    var on=Object.keys(active).filter(function(k){return active[k];});
    var parts=[];
    if(on.length)parts.push('f='+on.join(','));
    if(root.dataset.density==='rows')parts.push('d=rows');
    if(q&&q.value)parts.push('q='+encodeURIComponent(q.value));
    writing=true;
    var next='#'+parts.join('&');
    if(next==='#')history.replaceState(null,'',location.pathname+location.search);
    else history.replaceState(null,'',next);
    setTimeout(function(){writing=false;},0);
  }
  function apply(write){
    var shown=0;
    cards.forEach(function(c){
      var ok=match(c);
      c.classList.toggle('hidden',!ok);
      var r=rowFor['#'+c.id];
      if(r)r.classList.toggle('hidden',!ok);
      if(ok)shown++;
    });
    var on=Object.keys(active).filter(function(k){return active[k];});
    var filtered=on.length>0||(q&&q.value);
    document.body.classList.toggle('filtered',!!filtered);
    var pf=document.querySelector('.print-filter');
    if(pf)pf.textContent='FILTERED VIEW — showing '+shown+' of '+cards.length+'. Filters: '+(on.join(', ')||'text');
    if(write!==false)writeHash();
  }
  if(q)q.addEventListener('input',function(){apply();});
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q&&q){e.preventDefault();q.focus();}});
  Array.prototype.forEach.call(document.querySelectorAll('.f'),function(btn){
    btn.addEventListener('click',function(){
      var k=btn.dataset.filter;active[k]=!active[k];btn.classList.toggle('on',!!active[k]);apply();
    });
  });
  // Compact rows are the DEFAULT above 40 tools, and the renderer already said so on <html>.
  // The button toggles; it does not own the default.
  var d=document.getElementById('density');
  function density(v){root.dataset.density=v;if(d)d.textContent='density: '+(v==='rows'?'rows (compact)':'cards');}
  density(root.dataset.density==='rows'?'rows':'cards');
  if(d)d.addEventListener('click',function(){
    density(root.dataset.density==='rows'?'cards':'rows');writeHash();
  });
  cards.forEach(function(c){c.querySelector('.card-h').addEventListener('click',function(e){
    if(e.target.classList.contains('anchor'))return;
    c.classList.toggle('open');
  });});
  Array.prototype.forEach.call(document.querySelectorAll('.copy'),function(btn){
    btn.addEventListener('click',function(e){
      e.preventDefault();e.stopPropagation();
      var pre=btn.closest('.call-h').nextElementSibling;
      if(pre&&navigator.clipboard)navigator.clipboard.writeText(pre.textContent);
    });
  });
  var md=document.getElementById('md');
  if(md)md.addEventListener('click',function(){
    var data=JSON.parse(document.getElementById('surface').textContent);
    var out=data.tools.map(function(t){
      return '- **'+t.name+'** ('+(t.kind||'?')+', auth: '+(t.consent.mode||'?')+') — '+(t.purpose||'no description');
    }).join('\\n');
    if(navigator.clipboard)navigator.clipboard.writeText(out);
  });
  // A deep link to one tool has to LAND on it — in compact density that means opening the card,
  // not dropping the reader on a collapsed row.
  function reveal(h){
    if(h.indexOf('#tool-')!==0)return false;
    var c=document.getElementById(h.slice(1));
    if(!c)return false;
    c.classList.remove('hidden');
    c.classList.add('open');
    c.scrollIntoView();
    return true;
  }
  function readHash(){
    var h=location.hash;
    if(reveal(h))return;
    active={};
    Array.prototype.forEach.call(document.querySelectorAll('.f'),function(b){b.classList.remove('on');});
    h.replace(/^#/,'').split('&').forEach(function(part){
      var eq=part.indexOf('=');
      if(eq<0)return;
      var k=part.slice(0,eq),v=part.slice(eq+1);
      if(k==='f'){v.split(',').forEach(function(f){
        var btn=document.querySelector('.f[data-filter="'+f+'"]');
        if(btn){active[f]=true;btn.classList.add('on');}
      });}
      else if(k==='d')density(v==='rows'?'rows':'cards');
      else if(k==='q'&&q)q.value=decodeURIComponent(v);
    });
    apply(false);
  }
  if(location.hash)readHash();
  window.addEventListener('hashchange',function(){if(!writing)readHash();});
  Array.prototype.forEach.call(document.querySelectorAll('.anchor'),function(a){
    a.addEventListener('click',function(){setTimeout(function(){reveal(a.getAttribute('href'));},0);});
  });
  // Every details opens for print EXCEPT .pc — the MCP projection on a surface that already
  // prints a real native call (see callBlock).
  window.addEventListener('beforeprint',function(){
    Array.prototype.forEach.call(document.querySelectorAll('details:not(.pc)'),function(x){x.open=true;});
  });
  if(window.matchMedia){var m=window.matchMedia('print');if(m.addListener)m.addListener(function(x){
    if(x.matches)Array.prototype.forEach.call(document.querySelectorAll('details:not(.pc)'),function(y){y.open=true;});
  });}
})();
`;

// The embedded JSON island: a self-describing artifact. Escape the sequences that can break
// out of a script element or out of a JS source text (§4.3.8).
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

const jsonIsland = (surface) =>
  JSON.stringify(surface)
    .replace(/</g, '\\u003c')
    .split(LINE_SEP)
    .join('\\u2028')
    .split(PARA_SEP)
    .join('\\u2029');

/**
 * render(surfaceView, opts) -> one self-contained HTML document.
 * opts: { terse?: boolean }
 * Pure and deterministic — every clock value arrives inside surfaceView (D24).
 *
 * §3.4 — --no-source is a leak flag, and a half-honored leak flag is worse than none, so it
 * has exactly ONE owner: normalize(). The scrub has to happen before findings are built (their
 * titles quote the clustered source file by name) and it has to reach the JSON island, which
 * the Copy-as-Markdown handler reads straight out of. Passing the flag here instead is a
 * caller bug, and it throws rather than shipping a file tree it promised not to.
 */
export function render(surfaceView, opts = {}) {
  if (opts.noSource === true && surfaceView.noSource !== true) {
    throw new Error(
      'render(): --no-source is applied at normalize(json, { noSource: true }), not at render. ' +
        'The findings and the JSON island are built in the normalizer; scrubbing here would ' +
        'leave source paths baked into finding titles.'
    );
  }
  // §7 / D25 — the audit layer is opt-in, and it is computed on a COPY. The bare sheet is the
  // ask; a render without the flag is the same document it was before grading existed.
  const surface = opts.grade === true ? gradeSurface(surfaceView) : surfaceView;
  const o = {
    terse: opts.terse === true,
    noSource: surfaceView.noSource === true,
    grade: opts.grade === true,
  };
  const island = jsonIsland(surface);
  const title = `${surface.app ?? 'agent surface'} — agent access`;
  // D5 — compact rows are the DEFAULT above 40 tools, and the default is RENDERED, not applied
  // by a script after paint: 85 uncollapsed cards flashing before the JS lands is the exact
  // scroll nobody finishes, and with scripting off it never collapses at all.
  const density = surface.tools.length > 40 ? ' data-density="rows"' : '';
  const audit = o.grade
    ? [
        headlineBand(surface),
        verdictBand(surface),
        reportCardBand(surface),
        findingsBand(surface),
        barBand(surface),
        schemaGapsBand(surface),
      ].join('')
    : '';
  return [
    '<!doctype html>',
    `<html lang="en"${density}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    '<main>',
    masthead(surface, o),
    ledeBand(surface),
    indexBand(surface, o),
    prereqBand(surface),
    cardsBand(surface, o),
    audit,
    howToReadBand(surface),
    provenanceBand(surface, o, island.length),
    '</main>',
    `<script type="application/json" id="surface">${island}</script>`,
    `<script>${JS}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
