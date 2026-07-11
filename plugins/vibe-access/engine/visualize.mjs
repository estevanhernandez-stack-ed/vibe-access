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
  'app', 'adapter', 'source', 'generatedAt', 'renderedAt', 'verifyRun',
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
    const key = t.provenance.sourceRef ?? '(no source)';
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
