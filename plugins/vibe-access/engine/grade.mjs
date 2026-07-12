// grade.mjs — the --grade layer (spec §7). Opt-in. The bare sheet never touches this file.
//
// Two levels, both mechanical, both showing their work:
//   §7.1 five per-tool badges with exact pass conditions, plus the D1-D7 description letter
//        (N/A removes a check from the denominator — grading what the instrument cannot see
//        is the same lie the manifest already tells).
//   §7.2 six surface axes, MEASURED — no 0-100 numbers, no composite letter. There is no
//        formula that would earn one.
//
// BINDING: tool count is NEVER graded. "Do not chase tool count" is the research's own
// conclusion — 17 is not a better number than 85. Nothing in this file turns a count into
// a letter, and the report card says so out loud.

// ---------------------------------------------------------------- §7.1 the five badges

export const BADGES = [
  'has-description',
  'describes-when-not-to-use',
  'has-input-schema',
  'has-annotation',
  'destructive-declared',
];

// The negative-guidance cue set, verbatim from §7.1. Shared by the badge and by D3 — the
// spec says "the describes-when-not-to-use badge condition, verbatim", so it is one regex.
const NEG_GUIDANCE =
  /\b(do not|don't|never|only (use|call|when)|not for|avoid|outside|casually|unreachable|404s outside)\b/i;

const CONTEXT_CUE = /\b(for|so that|when|during|while|used? (to|for|when|by))\b/i;
const IDENT_TOKEN = /(`[^`]+`|\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b)/;
const RESULT_SHAPE = /\breturns?\b/i;
const SIDE_EFFECT = /\b(creat|seed|writ|delet|updat|stop|kill|clos|reset|wip|launch|send|remov|insert|revok)\w*/i;
const CONSENT_WORD =
  /\b(auth|token|capability|session|consent|permission|gate|gated|dev-only|emulator|unauthenticated|public)\b/i;

const propCount = (schema) => {
  if (!schema || typeof schema !== 'object') return 0;
  const props = schema.properties;
  if (!props || typeof props !== 'object') return 0;
  return Object.keys(props).length;
};

const hasDeclaredAnnotation = (t) =>
  Object.values(t.annotations ?? {}).some((a) => a?.provenance === 'declared');

/** The five badges, pass conditions exactly as §7.1 states them. Returns the PASSING names. */
export function badgesOf(t) {
  const d = String(t.purpose ?? '');
  const out = [];
  // A machine template never passes, regardless of length.
  if (t.purposeTemplated === false && d.length >= 40) out.push('has-description');
  if (NEG_GUIDANCE.test(d)) out.push('describes-when-not-to-use');
  if (propCount(t.inputSchema) >= 1) out.push('has-input-schema');
  // Derived does NOT pass — half credit lives in the truth table's rendering, not the badge.
  if (hasDeclaredAnnotation(t)) out.push('has-annotation');
  // Declaring `destructive: false` passes: the declaration is the point.
  if (t.destructive?.provenance === 'declared') out.push('destructive-declared');
  return out;
}

// ---------------------------------------------------------------- §7.1 the D1-D7 letter

const LIFECYCLE = new Set(['seed', 'reset', 'capture']);
const WRITES = new Set(['act', 'seed', 'reset']);

/** D1-D7 as mechanical predicates over the effective description. 'na' is a first-class result. */
export function describeChecks(t) {
  const d = String(t.purpose ?? '');
  const templated = t.purposeTemplated === true || d === '';
  const kind = t.kind;
  const takesNothing = propCount(t.inputSchema) === 0 && (t.transport?.pathParams?.length ?? 0) === 0;

  const check = (applicable, passed) => (applicable ? (passed ? 'pass' : 'fail') : 'na');

  return {
    // D1 purpose beyond restatement — never N/A.
    D1: check(true, !templated),
    // D2 when-to-use context — a template restates the route; it never states context.
    D2: check(true, !templated && CONTEXT_CUE.test(d)),
    // D3 when-NOT-to-use — the badge condition, verbatim. Never N/A.
    D3: check(true, NEG_GUIDANCE.test(d)),
    // D4 inputs named in prose — N/A when the tool takes nothing at all.
    D4: check(!takesNothing, !templated && IDENT_TOKEN.test(d)),
    // D5 result shape named — N/A for lifecycle kinds; their result is the state change (D6).
    D5: check(!LIFECYCLE.has(kind), !templated && RESULT_SHAPE.test(d)),
    // D6 side effects stated — applies to writes only.
    D6: check(WRITES.has(kind), !templated && SIDE_EFFECT.test(d)),
    // D7 consent stated — never N/A. An auth:none tool passes by SAYING it is open.
    D7: check(true, !templated && CONSENT_WORD.test(d)),
  };
}

/** The letter reads the fraction of APPLICABLE checks passed. N/A shrinks the denominator. */
export function letterOf(checks) {
  const vals = Object.values(checks).filter((v) => v !== 'na');
  if (vals.length === 0) return 'F';
  const frac = vals.filter((v) => v === 'pass').length / vals.length;
  if (frac >= 0.85) return 'A';
  if (frac >= 0.7) return 'B';
  if (frac >= 0.55) return 'C';
  if (frac >= 0.4) return 'D';
  return 'F';
}

export function gradeTool(t) {
  const checks = describeChecks(t);
  return { ...t, grades: { letter: letterOf(checks), checks }, badges: badgesOf(t) };
}

// ---------------------------------------------------------------- §7.2 the six axes

const axis = (id, label, anchor, measures, naReason = null) => ({
  id,
  label,
  measures,
  status: naReason ? 'na' : 'measured',
  naReason,
  anchor,
});

const INSTRUMENT_MISSING = (why) => `N/A — the instrument is missing: ${why}`;

// A bearer token, a JWT, or a key=value pair with a credential-shaped name. An error string
// that leaks one of these is a finding, not a detail.
const SECRET_SHAPED =
  /(bearer\s+[A-Za-z0-9._~+/-]{12,}|\beyJ[A-Za-z0-9._-]{10,}|\b(api[_-]?key|apikey|secret|password|token)\b\s*[:=]\s*\S{8,})/i;

const DISCRIMINATED = /^(action|operation|mode)$/i;

// Context cost: the definitions as an MCP client would receive them, ~chars/4 (§7.2 axis 1).
const contextTokens = (tools) => {
  const chars = tools.reduce((n, t) => {
    const schema = t.inputSchema ? JSON.stringify(t.inputSchema) : '';
    return n + String(t.name).length + String(t.purpose ?? '').length + schema.length;
  }, 0);
  return Math.round(chars / 4);
};

const deferralVerdict = (real) =>
  real === 'stdio'
    ? 'stdio — deferred by Claude Code; the definitions are not resident in every window.'
    : 'remote HTTP / Streamable-HTTP is NOT deferred (Claude Code issue #40314, closed "not planned") — one HTTP-MCP gateway of ~120K tokens is 60% of a 200K window, every session, every client.';

export function buildAxes(surface) {
  const { tools, counts, source, generatedAt, renderedAt, verifyRun, sidecar } = surface;
  const n = tools.length;
  const real = tools[0]?.transport.real ?? 'unknown';

  // 1 — SHAPE. Reported, explicitly not graded.
  const discriminated = tools.filter((t) =>
    Object.keys(t.inputSchema?.properties ?? {}).some((k) => DISCRIMINATED.test(k))
  ).length;
  const shape = axis('shape', 'SHAPE', '#index', [
    { name: 'tools exposing a discriminated action/operation/mode enum', value: discriminated },
    { name: 'real transport', value: real },
    { name: 'context cost if shipped as MCP today (≈ tokens, chars/4)', value: contextTokens(tools) },
    { name: 'deferral verdict', value: deferralVerdict(real) },
  ]);

  // 2 — DESCRIPTION QUALITY. A histogram, never a mean: a mean hides "84 of 85 sit at F".
  const hist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const t of tools) hist[t.grades.letter] += 1;
  const exemplars = tools.filter((t) => t.grades.letter === 'A').map((t) => t.name);
  const description = axis('description-quality', 'DESCRIPTION QUALITY', '#the-bar', [
    ...Object.entries(hist).map(([letter, value]) => ({ name: letter, value })),
    { name: 'machine-templated descriptions', value: counts.templated },
    { name: 'A-graded exemplars', value: exemplars.length > 0 ? exemplars.join(', ') : 'none on this surface' },
  ]);

  // 3 — SCHEMAS + ANNOTATIONS. Mined is not declared, and the row says which (§13.1.5).
  const schemas = axis('schemas-annotations', 'SCHEMAS + ANNOTATIONS', '#schema-gaps', [
    { name: 'declared input schema', value: `${counts.withDeclaredInputSchema} of ${n}` },
    { name: 'mined input shape (read out of handler source — not declared)', value: `${counts.withMinedInputSchema} of ${n}` },
    { name: 'declared output schema', value: `${counts.withOutputSchema} of ${n}` },
    { name: 'any DECLARED annotation', value: `${counts.withDeclaredAnnotation} of ${n}` },
  ]);

  // 4 — RESOURCES / PROMPTS. Counted from the §4.1 sidecar when the input carries one; from
  // the manifest's own read-only affordances when the input is a manifest. Otherwise N/A —
  // and the N/A now reports a check the code actually ran. Zero would be a lie.
  let resources;
  if (source === 'manifest') {
    resources = axis('resources-prompts', 'RESOURCES / PROMPTS', '#findings', [
      {
        name: 'candidate resources (kind: read + auth: none — read-only addressable state forced through a tool call)',
        value: tools.filter((t) => t.kind === 'read' && t.consent.mode === 'none').length,
      },
    ]);
  } else if (sidecar) {
    resources = axis('resources-prompts', 'RESOURCES / PROMPTS', '#index', [
      { name: 'resources declared', value: sidecar.resources },
      { name: 'prompts declared', value: sidecar.prompts },
    ]);
  } else {
    resources = axis(
      'resources-prompts',
      'RESOURCES / PROMPTS',
      '#how-to-read',
      [],
      INSTRUMENT_MISSING('the input carries no resources/prompts sidecar, so nothing here can be counted')
    );
  }

  // 5 — FRESHNESS. A field that isn't bumped on real activity is worse than no field.
  const probed = n - counts.verify.unverified;
  const stale =
    verifyRun && generatedAt && Date.parse(verifyRun.at) < Date.parse(generatedAt)
      ? 'the verify run predates the manifest — these proofs are older than the surface they claim to prove'
      : 'no';
  const freshness = axis('freshness', 'FRESHNESS', '#masthead', [
    { name: 'manifest age at render', value: generatedAt ? `${ageDays(generatedAt, renderedAt)}d` : 'not stated' },
    { name: 'verify-run age at render', value: verifyRun ? `${verifyRun.ageAtRender}d` : 'no verify run stamped' },
    { name: 'verify coverage', value: `${probed} of ${n} affordances carry a verify stamp` },
    { name: 'stale', value: stale },
  ]);

  // 6 — SECURITY / HYGIENE.
  const unauthedAct = tools.filter((t) => t.kind === 'act' && t.consent.mode === 'none').length;
  const undeclaredDestructive = tools.filter(
    (t) => t.destructive.value === true && t.destructive.provenance !== 'declared'
  ).length;
  const tierConflicts = tools.filter((t) => t.tier === 'prod-safe' && t.destructive.value === true).length;
  const leaks = tools.filter((t) => SECRET_SHAPED.test(String(t.verification.detail ?? ''))).length;
  const security = axis('security-hygiene', 'SECURITY / HYGIENE', '#findings', [
    { name: 'open (auth: none)', value: counts.openSurface },
    { name: 'auth-gate-open (declared a gate, answered a cold agent)', value: counts.verify.open },
    { name: 'unauthenticated act tools', value: unauthedAct },
    { name: 'destructive without a declaration', value: undeclaredDestructive },
    { name: 'tier / destructive contradictions', value: tierConflicts },
    { name: 'secret-shaped strings in verify details', value: leaks },
  ]);

  return [shape, description, schemas, resources, freshness, security];
}

const DAY_MS = 86400000;
const ageDays = (fromIso, toIso) => {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / DAY_MS));
};

/**
 * gradeSurface(surface) -> a NEW graded surface. Pure: the input is never mutated, so a bare
 * render of the same SurfaceView is byte-for-byte the sheet it was before the flag existed.
 */
export function gradeSurface(surface) {
  const tools = surface.tools.map(gradeTool);
  const graded = { ...surface, tools };
  graded.axes = buildAxes(graded);
  return graded;
}
