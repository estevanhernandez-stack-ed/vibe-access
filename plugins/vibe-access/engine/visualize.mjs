// visualize.mjs — the normalizer half (spec §4). Turns a vibe-access manifest or an
// MCP tools/list payload into one SurfaceView: a ToolView per tool plus surface-level facts.
// Read-only, pure, no I/O. The renderer (§5-6) and the --grade layer (§7) consume this.
//
// Two honesty rules that live here and may never be dropped:
//   (a) verify math is the full class decomposition — ran / gate-held / handle-gate-held /
//       open / error / unverified. handle-gate-held is NEVER folded into gate-held.
//   (b) tool count is never graded.

import { validateManifest } from './schema.mjs';

export const TOOLVIEW_KEYS = [
  'name', 'purpose', 'purposeSource', 'purposeTemplated', 'kind', 'tier',
  'destructive', 'streaming', 'inputSchema', 'outputSchema', 'annotations',
  'consent', 'transport', 'prereqs', 'provenance', 'verification', 'group',
  'grades', 'badges',
];

export const SURFACEVIEW_KEYS = [
  'app', 'adapter', 'source', 'noSource', 'generatedAt', 'renderedAt', 'verifyRun',
  'discoveryRoute', 'counts', 'tools', 'findings', 'schemaGaps', 'axes', 'lede',
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

  if (source === 'manifest' && counts.withInputSchema === 0 && counts.withOutputSchema === 0) {
    out.push(
      finding(
        'schema-coverage',
        'info',
        `0 of ${total} affordances declare an input or output schema`,
        'The manifest cannot tell you what to send or what comes back. Stated once here, not as a red slug on every card.',
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
  let withInputSchema = 0;
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
    if (t.inputSchema) withInputSchema += 1;
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
    withInputSchema,
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
  if (counts.withInputSchema === 0 && counts.withOutputSchema === 0) {
    gaps.push(`input and output are null in ${n} of ${n} affordances — the manifest cannot say what to send or what comes back.`);
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
  const { counts, tools, findings } = surface;
  const files = new Set(
    tools.map((t) => t.provenance.sourceRef).filter(Boolean).map((r) => r.replace(/:\d+$/, ''))
  ).size;
  const transport = tools[0]?.transport.real ?? 'unknown';
  const spread = files > 0 ? ` across ${files} source file${files === 1 ? '' : 's'}` : '';
  const s1 = `${counts.total} ${transport} affordance${counts.total === 1 ? '' : 's'}${spread}.`;
  const s2 =
    counts.openSurface > 0
      ? `${counts.openSurface} answer an unauthenticated caller.`
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

// §6.2 block 4 — a `*` segment is not a glob and never renders as one.
const routeLine = (path) =>
  String(path ?? '')
    .split('/')
    .map((seg) => (seg === '*' ? '<span class="qmark">{?}</span>' : wbr(seg)))
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

function bodyPlaceholders(schema) {
  const props = schema && typeof schema === 'object' ? schema.properties : null;
  if (!props || Object.keys(props).length === 0) return null;
  const body = {};
  for (const [name, def] of Object.entries(props)) {
    const type = def?.type ?? 'unknown';
    body[name] =
      type === 'number' || type === 'integer'
        ? 0
        : type === 'boolean'
          ? false
          : type === 'array'
            ? []
            : type === 'object'
              ? {}
              : `<${name}>`;
  }
  return body;
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
    lines.push('', 'gRPC over a Windows named pipe. Drive it with a gRPC client, not an HTTP one.');
    return lines.join('\n');
  }
  if (real === 'http') {
    let n = 0;
    const filled = String(t.transport.path ?? '')
      .split('/')
      .map((seg) => (seg === '*' ? `<UNNAMED_PARAM_${(n += 1)}>` : seg))
      .join('/');
    const url = `${t.transport.baseUrl ?? ''}${filled}`;
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
    if (n > 0) {
      lines.push('', `${n} unnamed path parameter${n === 1 ? '' : 's'} — a caller cannot know what goes here.`);
    }
    return lines.join('\n');
  }
  return [
    'transport: unknown — a tools/list payload carries no transport field.',
    'Call it through your MCP client; the projection below is the wire shape.',
  ].join('\n');
}

function mcpProjection(t) {
  const body = bodyPlaceholders(t.inputSchema);
  const args = body
    ? JSON.stringify(body, null, 6).replace(/\n/g, '\n    ')
    : '{} /* unknown — no input schema declared or minable */';
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

const notStated = '<p class="slug">Not stated.</p>';

function purposeBlock(t, opts) {
  if (!t.purpose) {
    return `<span class="chip">UNDOCUMENTED</span><p class="slug">No authored description — this is the scan template. Run /vibe-access:describe to author one.</p>`;
  }
  if (t.purposeTemplated) {
    const body = opts.terse
      ? ''
      : `<p class="tmpl">${esc(t.purpose)}</p>`;
    return `<span class="chip">UNDOCUMENTED</span><p class="slug">No authored description — this is the scan template. Run /vibe-access:describe to author one.</p>${body}`;
  }
  const from = t.purposeSource === 'overrides' ? '<span class="tag">from overrides</span>' : '';
  return `${from}<p>${esc(t.purpose)}</p>`;
}

function whenBlock(t, negative) {
  if (t.purposeTemplated || !t.purpose) return notStated;
  const hits = sentencesOf(t.purpose).filter((s) => (negative ? NEG_CUE.test(s) : CTX_CUE.test(s) && !NEG_CUE.test(s)));
  if (hits.length === 0) return notStated;
  return `<p>${hits.map((s) => esc(s)).join(' ')}</p>`;
}

function schemaTable(schema, mined) {
  const props = schema?.properties ?? null;
  if (!props || Object.keys(props).length === 0) return null;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const rows = Object.entries(props)
    .map(([name, def]) => {
      const type = def?.enum ? `enum(${def.enum.map((v) => esc(v)).join(' | ')})` : esc(def?.type ?? 'unknown');
      const req = required.has(name) ? 'required' : 'optional';
      const dflt = def?.default === undefined ? '—' : esc(JSON.stringify(def.default));
      return `<tr><td><code>${wbr(name)}</code></td><td>${type}</td><td>${req}</td><td>${dflt}</td><td>${esc(def?.description ?? '')}</td></tr>`;
    })
    .join('');
  const tag = mined ? '<span class="tag">mined from source</span>' : '';
  return `${tag}<table class="params"><thead><tr><th>name</th><th>type</th><th>required</th><th>default</th><th>description</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function inputBlock(t) {
  const table = schemaTable(t.inputSchema, false);
  if (table) return table;
  if (t.transport.pathParams.length > 0) {
    const rows = t.transport.pathParams
      .map(
        (p) =>
          `<tr><td><code>{?}</code></td><td>unknown</td><td>required</td><td>—</td><td>unnamed path parameter (position ${p.position}) — a caller cannot know what goes here.</td></tr>`
      )
      .join('');
    return `<table class="params"><thead><tr><th>name</th><th>type</th><th>required</th><th>default</th><th>description</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  return '<p class="quiet">No input schema declared.</p>';
}

function outputBlock(t) {
  const table = schemaTable(t.outputSchema, false);
  if (table) return table;
  const returns = sentencesOf(t.purpose).find((s) => /\breturns?\b/i.test(s));
  if (returns && !t.purposeTemplated) {
    return `<p>${esc(returns)} <span class="tag dotted" title="derived from the description prose; no schema field carries it">derived</span></p>`;
  }
  return '<p class="quiet">No output schema declared.</p>';
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
  return `<div class="anns">${annotationCell('readOnly', a.readOnly)}${annotationCell('destructive', a.destructive)}${annotationCell('idempotent', a.idempotent)}${annotationCell('openWorld', a.openWorld)}</div>`;
}

function consentBlock(t) {
  const mode = t.consent.mode ?? 'not declared';
  const cap = t.consent.capability
    ? ` <code class="cap">${wbr(t.consent.capability)}</code>`
    : '';
  const detail = t.consent.detail ? `<p>${esc(t.consent.detail)}</p>` : '';
  if (!t.consent.mechanismStated) {
    return `<p><b>auth: ${esc(mode)}</b></p><p class="slug">auth: ${esc(mode)} — mechanism not stated in the surface. "Capability not stated" is not "no capability required."</p>`;
  }
  const words =
    mode === 'none'
      ? 'Open — any caller reaches this, authenticated or not.'
      : mode === 'session'
        ? 'Session — handshake first, then the per-call identity header, then per-capability consent.'
        : mode === 'token'
          ? 'Token — a bearer credential on every call.'
          : 'Consent mode is not declared on this surface.';
  return `<p><b>auth: ${esc(mode)}</b>${cap}</p><p>${esc(words)}</p>${detail}`;
}

function callBlock(t, surface) {
  // The MCP projection is a <details>. On a surface whose native call is real (http / npipe),
  // it stays SHUT in print — it is the single biggest block on the card and the native call
  // above it is the one a reader pastes (§10.2.6, the page budget is a shipping criterion).
  // On an MCP-sourced surface there IS no native call, so the projection is the payload and
  // it prints open like every other <details> (§9).
  const real = t.transport.real;
  const collapsible = real === 'http' || real === 'grpc-npipe' ? ' pc' : '';
  return [
    '<div class="call">',
    '<div class="call-h">Native<button class="copy no-print" type="button">copy</button></div>',
    `<pre class="code">${esc(nativeCall(t, surface))}</pre>`,
    `<details class="mcp${collapsible}"${collapsible ? '' : ' open'}>`,
    '<summary class="call-h">MCP projection<button class="copy no-print" type="button">copy</button></summary>',
    `<pre class="code">${esc(mcpProjection(t))}</pre>`,
    '<p class="quiet">Projection — not a running server.</p>',
    '</details>',
    '</div>',
  ].join('');
}

// ---------------------------------------------------------------- chips + card

function chipsOf(t) {
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
  return chips.join('');
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
      `<section class="block" data-block="${key}"><h4>${label}</h4>${bodies[key]}</section>`
  ).join('');
  const route =
    t.transport.method && t.transport.path
      ? `<div class="route"><span class="verb">${esc(t.transport.method)}</span> <code>${routeLine(t.transport.path)}</code></div>`
      : '';
  const prereq =
    t.prereqs.length > 0
      ? `<div class="prereq">requires <a href="#tool-${escAttr(slug(t.prereqs[0]))}">${esc(t.prereqs[0])}</a> first</div>`
      : '';
  return [
    `<article class="card" id="tool-${escAttr(slug(t.name))}" data-kind="${escAttr(t.kind ?? '')}" data-auth="${escAttr(t.consent.mode ?? '')}" data-vclass="${escAttr(t.verification.class)}">`,
    `<header class="card-h"><code class="tname">${wbr(t.name)}</code><span class="rail">${chipsOf(t)}</span></header>`,
    route,
    prereq,
    blocks,
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
    '<header class="band" data-band="masthead">',
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

function indexBand(surface) {
  const rows = surface.tools
    .map((t) => {
      const doc = t.purposeTemplated || !t.purpose ? '<span class="mini">UNDOCUMENTED</span>' : '';
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
  return [
    '<section class="band" data-band="index">',
    '<h2>TOOL INDEX</h2>',
    '<div class="filters no-print">',
    '<input type="search" id="q" placeholder="filter (press /)">',
    '<button type="button" class="f" data-filter="open">Open</button>',
    '<button type="button" class="f" data-filter="destructive">Destructive</button>',
    '<button type="button" class="f" data-filter="failed">Failed</button>',
    '<button type="button" class="f" data-filter="undocumented">Undocumented</button>',
    '<button type="button" id="density">density: cards / rows</button>',
    '</div>',
    '<p class="print-filter">FILTERED VIEW</p>',
    `<nav class="index">${rows}</nav>`,
    '</section>',
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
      const auths = [...new Set(tools.map((t) => t.consent.mode ?? 'none'))].join(', ');
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
        `<p class="quiet">${tools.length} affordance${tools.length === 1 ? '' : 's'} · auth: ${esc(auths)}${factored}</p>`,
        `<p class="quiet">${esc(verify)}</p></div>`,
        tools.map((t) => renderCard(t, surface, opts)).join(''),
      ].join('');
    })
    .join('');
  return `<section class="band" data-band="cards"><h2>TOOLS</h2>${sections}</section>`;
}

function howToReadBand(surface) {
  const groupNote = `Grouping: the section bands are the app's own shape, derived from the surface — not an axis anyone typed.`;
  return [
    '<section class="band" data-band="how-to-read">',
    '<h2>HOW TO READ THIS</h2>',
    '<dl>',
    '<dt>"Pass" means two different things.</dt>',
    '<dd>GATE-HELD and HANDLE-GATE-HELD mean the gate worked and the call never ran. RAN means data came back. A bare pass count folds those together, so this page never prints one: the verify math is always the full decomposition — ran / gate-held / handle-gate-held / open / error / unverified. <b>Tool count is not graded.</b> 17 is not a better number than 85.</dd>',
    '<dt>tier: prod-safe is an ASSERTION, not a safety proof.</dt>',
    '<dd>Nothing verified it. It is what the manifest claims, printed as a claim.</dd>',
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
.card-h{display:flex;gap:10px;align-items:baseline;justify-content:space-between;flex-wrap:wrap}
.tname{font-size:1rem;font-weight:600;color:var(--ink)}
.rail{display:flex;gap:6px;flex-wrap:wrap}
.chip{font-size:.62rem;letter-spacing:.1em;border:1px solid var(--ink-3);color:var(--ink-2);border-radius:2px;padding:2px 6px}
.chip.filled{background:var(--magenta);border-color:var(--magenta);color:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.chip.risk{border-color:var(--magenta);color:var(--magenta)}
.chip.dotted{border-style:dashed}
.route{margin:8px 0;font-size:.82rem;color:var(--ink-2)}
.verb{color:var(--cyan);font-family:var(--font-mono)}
.qmark{color:var(--magenta);font-family:var(--font-mono)}
.prereq{font-size:.75rem;color:var(--ink-2)}
.prereq a{color:var(--cyan)}
.block{margin-top:12px}
.block p{margin:0 0 6px}
.slug{color:var(--magenta);font-size:.82rem}
.tmpl{color:var(--ink-3);font-style:italic}
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
.card-f{margin-top:12px;padding-top:8px;border-top:1px solid var(--line);font-size:.72rem;color:var(--ink-2)}
.vclass{letter-spacing:.08em}
.v-open,.v-error{color:var(--magenta)}
.v-ran,.v-gate-held,.v-handle-gate-held{color:var(--cyan)}
.micro{display:block;font-size:8px;color:var(--ink-3);font-family:var(--font-mono);margin-top:6px}
dl dt{color:var(--cyan);margin-top:12px;font-size:.9rem}
dl dd{margin:2px 0 0;color:var(--ink-2);font-size:.88rem}
.print-filter{display:none}
.hidden{display:none}

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
  h3{break-after:avoid}
  [data-band=index]{break-before:page}
  details:not(.pc)>*{display:block!important}
  details.pc>summary::marker,details.pc>summary::-webkit-details-marker{color:var(--ink-3)}
  body.filtered .print-filter{display:block;border:1px solid var(--magenta);color:var(--magenta);padding:6px 8px}
  a[href^="http"]::after{content:" (" attr(href) ")"}

  /* Page budget (§10.2.6): 85 affordances land under 40 letter pages, and break-inside:avoid
     means a card taller than half a page costs a whole one. The cuts are density, never
     information — every block keeps its label and its words, and THE CALL keeps every line
     a reader pastes. */
  body{line-height:1.3}
  .card{padding:5px 8px;margin:4px 0;font-size:.84rem;line-height:1.25}
  .route{margin:1px 0;font-size:.76rem}
  .block{margin-top:2px}
  .block h4{display:inline;margin-right:6px;font-size:.62rem}
  .block p{display:inline;margin:0}
  .block p+p{margin-left:6px}
  /* The short blocks flow as one labeled run: every label and every word survives, the four
     blank lines between them do not. */
  .block[data-block=when-to-use],.block[data-block=when-not-to-use],
  .block[data-block=input],.block[data-block=output]{display:inline;margin:0 10px 0 0}
  .call-h{margin-top:2px;font-size:.6rem}
  .anns{display:block;font-size:.7rem}
  .ann{display:inline;border:0;padding:0;background:none}
  .ann+.ann::before{content:" · "}
  .ann-k{display:inline}
  .ann-k::after{content:" "}
  .ann .why{display:none}
  .index .row{padding:1px 4px}
  .group-band{margin-top:14px;padding-top:6px}
  .params th,.params td{padding:1px 6px 1px 0}
  pre.code{padding:4px;margin:2px 0;font-size:.66rem;line-height:1.3}
  .card-f{margin-top:4px;padding-top:3px;font-size:.68rem}
  .micro{margin-top:1px}
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
  function match(c){
    var t=c.textContent.toLowerCase();
    var term=q&&q.value?q.value.toLowerCase():'';
    if(term&&t.indexOf(term)<0)return false;
    if(active.open&&c.dataset.auth!=='none')return false;
    if(active.destructive&&c.innerHTML.indexOf('DESTRUCTIVE')<0)return false;
    if(active.failed&&c.dataset.vclass!=='error'&&c.dataset.vclass!=='open')return false;
    if(active.undocumented&&c.innerHTML.indexOf('UNDOCUMENTED')<0)return false;
    return true;
  }
  function apply(){
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
    location.hash=on.length?('#f='+on.join(',')):'';
  }
  if(q)q.addEventListener('input',apply);
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q&&q){e.preventDefault();q.focus();}});
  Array.prototype.forEach.call(document.querySelectorAll('.f'),function(btn){
    btn.addEventListener('click',function(){
      var k=btn.dataset.filter;active[k]=!active[k];btn.classList.toggle('on',!!active[k]);apply();
    });
  });
  var d=document.getElementById('density');
  if(d)d.addEventListener('click',function(){
    root.dataset.density=root.dataset.density==='rows'?'':'rows';
  });
  if(cards.length>40)root.dataset.density='rows';
  cards.forEach(function(c){c.querySelector('.card-h').addEventListener('click',function(){c.classList.toggle('open');});});
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
  var hash=location.hash.match(/#f=(.*)/);
  if(hash){hash[1].split(',').forEach(function(k){
    var btn=document.querySelector('.f[data-filter="'+k+'"]');
    if(btn){active[k]=true;btn.classList.add('on');}
  });apply();}
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
  const o = { terse: opts.terse === true, noSource: surfaceView.noSource === true };
  const island = jsonIsland(surfaceView);
  const title = `${surfaceView.app ?? 'agent surface'} — agent access`;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    '<main>',
    masthead(surfaceView, o),
    ledeBand(surfaceView),
    indexBand(surfaceView),
    prereqBand(surfaceView),
    cardsBand(surfaceView, o),
    howToReadBand(surfaceView),
    provenanceBand(surfaceView, o, island.length),
    '</main>',
    `<script type="application/json" id="surface">${island}</script>`,
    `<script>${JS}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
