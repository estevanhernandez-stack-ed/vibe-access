import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import {
  sniffShape,
  normalize,
  effectiveDescription,
  effectiveKind,
  isTemplatedDescription,
  realTransport,
  classifyVerification,
  mineCapability,
  verifyDecompositionSentence,
  TOOLVIEW_KEYS,
  SURFACEVIEW_KEYS,
} from '../engine/visualize.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const WSY = fixture('manifest-weseeyou.json');
const RORO = fixture('manifest-rororo.json');
const MCP = fixture('mcp-tools-list.json');

const RENDERED_AT = '2026-07-11T12:00:00.000Z';
const opts = { renderedAt: RENDERED_AT };
const byId = (view, id) => view.tools.find((t) => t.name === id);

describe('sniffShape', () => {
  test('recognizes both real manifests', () => {
    expect(sniffShape(WSY)).toBe('manifest');
    expect(sniffShape(RORO)).toBe('manifest');
  });

  test('recognizes the three MCP shapes', () => {
    expect(sniffShape(MCP)).toBe('mcp-envelope');
    expect(sniffShape(MCP.tools)).toBe('mcp-array');
    expect(sniffShape({ jsonrpc: '2.0', id: 1, result: { tools: MCP.tools } })).toBe('mcp-jsonrpc');
  });

  test('returns null for an unrecognized shape', () => {
    expect(sniffShape({ hello: 'world' })).toBeNull();
    expect(sniffShape([{ noName: true }])).toBeNull();
    expect(sniffShape(null)).toBeNull();
  });

  test('normalize throws on an unrecognized shape', () => {
    expect(() => normalize({ hello: 'world' }, opts)).toThrow(/unrecognized input shape/);
  });
});

describe('pure rules', () => {
  test('effective description prefers overrides, never concatenates', () => {
    const stop = RORO.affordances.find((a) => a.id === 'stop-accounts');
    expect(stop.overrides.description).not.toBe(stop.description);
    expect(effectiveDescription(stop)).toBe(stop.overrides.description);
    expect(effectiveDescription({ description: 'base' })).toBe('base');
  });

  test('effective kind prefers overrides.kind (the §8.1 delta)', () => {
    expect(effectiveKind({ kind: 'act', overrides: { kind: 'read' } })).toBe('read');
    expect(effectiveKind({ kind: 'act' })).toBe('act');
  });

  test('template detection convicts the scan templates and spares real prose', () => {
    expect(isTemplatedDescription('Act: POST /api/generate-quiz')).toBe(true);
    expect(isTemplatedDescription('Read: GET /api/challenges')).toBe(true);
    expect(isTemplatedDescription('Launches a real Roblox client — do not call casually')).toBe(false);
  });

  test('template detection also catches a reconstructible <kind>: <method> <path>', () => {
    const aff = {
      description: 'seed: POST /api/agent/seed',
      kind: 'seed',
      transport: { type: 'http', method: 'POST', path: '/api/agent/seed' },
    };
    expect(isTemplatedDescription(aff.description, aff)).toBe(true);
  });

  test('real transport is derived from the base URL, not copied from transport.type', () => {
    expect(realTransport({ declared: 'http', baseUrl: 'npipe://./pipe/rororo-plugin-host' })).toBe('grpc-npipe');
    expect(realTransport({ declared: 'http', baseUrl: 'http://localhost:5000' })).toBe('http');
    expect(realTransport({ declared: null, baseUrl: null })).toBe('unknown');
  });

  test('verify classification separates handle-gate-held from gate-held', () => {
    expect(classifyVerification({ status: 'pass', detail: 'auth-gate-held' })).toBe('gate-held');
    expect(classifyVerification({ status: 'pass', detail: 'handle-gate-held (PermissionDenied: UI handle)' })).toBe('handle-gate-held');
    expect(classifyVerification({ status: 'fail', detail: 'auth-gate-open: expected 401/403, got 200' })).toBe('open');
    expect(classifyVerification({ status: 'fail', detail: 'unexpected 500' })).toBe('error');
    expect(classifyVerification({ status: 'pass', detail: 'host 1.9.0, multi-instance On' })).toBe('ran');
    expect(classifyVerification({ status: 'pass' })).toBe('ran');
    expect(classifyVerification({ status: 'pending-agent', detail: null })).toBe('unverified');
    expect(classifyVerification(null)).toBe('unverified');
  });

  test('capability mining requires a dotted token and never swallows the sentence period', () => {
    expect(mineCapability('Requires capability host.commands.stop-accounts.')).toBe('host.commands.stop-accounts');
    expect(mineCapability('The capability entry is created for you')).toBeNull();
    expect(mineCapability('Nothing here')).toBeNull();
  });
});

describe('normalize — WeSeeYou (85 affordances, firebase-functions)', () => {
  const view = normalize(WSY, opts);

  test('surface facts', () => {
    expect(Object.keys(view).sort()).toEqual([...SURFACEVIEW_KEYS].sort());
    expect(view.source).toBe('manifest');
    expect(view.app).toBe('WeSeeYouAtTheMovies');
    expect(view.adapter).toBe('firebase-functions');
    expect(view.discoveryRoute).toBeNull();
    expect(view.renderedAt).toBe(RENDERED_AT);
    expect(view.tools).toHaveLength(85);
    expect(view.counts.total).toBe(85);
  });

  test('every ToolView carries the exact key set', () => {
    for (const t of view.tools) expect(Object.keys(t).sort()).toEqual([...TOOLVIEW_KEYS].sort());
  });

  test('84 of 85 descriptions are machine templates — the documentation hole', () => {
    expect(view.counts.templated).toBe(84);
    expect(byId(view, 'generate-quiz').purposeTemplated).toBe(true);
    expect(byId(view, 'generate-quiz').purpose).toBe('Act: POST /api/generate-quiz');
    const seed = byId(view, 'agent-seed');
    expect(seed.purposeTemplated).toBe(false);
    expect(seed.purposeSource).toBe('overrides');
  });

  test('verify decomposition — never a bare pass count', () => {
    expect(view.counts.verify).toEqual({
      ran: 14,
      gateHeld: 62,
      handleGateHeld: 0,
      open: 1,
      error: 8,
      unverified: 0,
    });
    expect(verifyDecompositionSentence(view.counts.verify)).toBe(
      '85 probed — 14 ran, 62 gate-held, 1 open, 8 error.'
    );
  });

  test('the auth-gate-open breach surfaces as the headline finding', () => {
    const breaches = view.findings.filter((f) => f.severity === 'breach');
    expect(breaches).toHaveLength(1);
    expect(breaches[0].toolRefs).toEqual(['get-challenges']);
    expect(view.findings[0].severity).toBe('breach');
    const gc = byId(view, 'get-challenges');
    expect(gc.consent.mode).toBe('token');
    expect(gc.verification.class).toBe('open');
    expect(gc.verification.detail).toBe('auth-gate-open: expected 401/403, got 200');
  });

  test('errors cluster by source file, not per dot', () => {
    const clusters = view.findings.filter((f) => f.severity === 'error-cluster');
    expect(clusters).toHaveLength(2);
    const fantasy = clusters.find((f) => f.toolRefs.length === 7);
    expect(fantasy).toBeDefined();
    expect(fantasy.body).toMatch(/fantasy\.js/);
  });

  test('transport is honest http, uncorrected; no schemas anywhere', () => {
    const t = byId(view, 'generate-quiz');
    expect(t.transport.real).toBe('http');
    expect(t.transport.declared).toBe('http');
    expect(t.transport.corrected).toBe(false);
    expect(t.transport.baseUrl).toBe('http://localhost:5000');
    expect(view.counts.withInputSchema).toBe(0);
    expect(view.counts.withOutputSchema).toBe(0);
    expect(view.counts.withDeclaredAnnotation).toBe(0);
  });

  test('token auth with no mined capability is "mechanism not stated", not "no auth"', () => {
    const t = byId(view, 'generate-quiz');
    expect(t.consent.mode).toBe('token');
    expect(t.consent.capability).toBeNull();
    expect(t.consent.mechanismStated).toBe(false);
    expect(view.counts.openSurface).toBe(15);
  });

  test('unnamed path params are mined by position', () => {
    const starred = view.tools.filter((t) => t.transport.pathParams.length > 0);
    expect(starred).toHaveLength(6);
    for (const t of starred) {
      expect(t.transport.pathParams[0]).toEqual({ position: 1 });
    }
  });

  test('destructive is unclaimed across the surface — nothing declares it', () => {
    expect(view.counts.destructive).toEqual({ declared: 0, derived: 0, unclaimed: 85 });
    expect(byId(view, 'generate-quiz').destructive).toEqual({ value: null, provenance: 'unclaimed' });
  });

  test('grouping falls back to source file (13 files) and to path prefix under --no-source', () => {
    expect(new Set(view.tools.map((t) => t.group)).size).toBe(13);
    expect(byId(view, 'generate-quiz').group).toBe('quiz');
    const bare = normalize(WSY, { ...opts, noSource: true });
    expect(byId(bare, 'generate-quiz').group).not.toBe('quiz');
    expect(byId(bare, 'generate-quiz').provenance.sourceRef).toBeNull();
  });

  test('schema gaps and the discoveryRoute absence are stated once', () => {
    expect(view.schemaGaps.length).toBeGreaterThan(0);
    expect(view.findings.filter((f) => f.id === 'discovery-route-null')).toHaveLength(1);
    expect(view.findings.filter((f) => f.id === 'schema-coverage')).toHaveLength(1);
  });
});

describe('normalize — ROROROblox (17 affordances, gRPC wearing an http label)', () => {
  const view = normalize(RORO, opts);

  test('transport truth: the manifest says http, the surface is gRPC over a named pipe', () => {
    for (const t of view.tools) {
      expect(t.transport.declared).toBe('http');
      expect(t.transport.real).toBe('grpc-npipe');
      expect(t.transport.corrected).toBe(true);
      expect(t.transport.baseUrl).toBe('npipe://./pipe/rororo-plugin-host');
    }
  });

  test('verify decomposition — 3 ran, 12 gate-held, 2 handle-gate-held (never 17/17)', () => {
    expect(view.counts.verify).toEqual({
      ran: 3,
      gateHeld: 12,
      handleGateHeld: 2,
      open: 0,
      error: 0,
      unverified: 0,
    });
    expect(verifyDecompositionSentence(view.counts.verify)).toBe(
      '17 probed — 3 ran, 12 gate-held, 2 handle-gate-held.'
    );
    expect(byId(view, 'update-ui').verification.class).toBe('handle-gate-held');
    expect(byId(view, 'request-launch').verification.class).toBe('gate-held');
  });

  test('the one override that differs carries the destructive truth', () => {
    const stop = byId(view, 'stop-accounts');
    expect(stop.purposeSource).toBe('overrides');
    expect(stop.purpose).toMatch(/DESTRUCTIVE/);
    expect(stop.destructive.value).toBe(true);
    expect(stop.destructive.provenance).toHaveProperty('derived');
    expect(stop.destructive.provenance.derived).toMatch(/no schema field carries it/);
  });

  test('the headline is the loudest destructive claim, not the noisiest word match', () => {
    expect(view.findings[0].severity).toBe('destructive-unclaimed');
    expect(view.findings[0].toolRefs).toEqual(['stop-accounts']);
    // The prose regex is noisy by design: "stop idle warnings from misfiring" convicts
    // mark-account-active. It renders as DERIVED, with the matched word shown — which is
    // the page's own argument for the destructive schema field (§8.3).
    const mark = byId(view, 'mark-account-active');
    expect(mark.destructive.value).toBe(true);
    expect(mark.destructive.provenance.derived).toMatch(/the word "stop"/);
  });

  test('the lede states the shape in words, decomposition included', () => {
    expect(view.lede).toBe(
      '17 grpc-npipe affordances across 1 source file. 3 answer an unauthenticated caller. stop-accounts looks destructive and nothing declares it. 17 probed — 3 ran, 12 gate-held, 2 handle-gate-held.'
    );
  });

  test('tier-conflict: prod-safe asserted on a destructive act', () => {
    const conflicts = view.findings.filter((f) => f.severity === 'tier-conflict');
    expect(conflicts.map((f) => f.toolRefs[0])).toContain('stop-accounts');
    expect(byId(view, 'stop-accounts').tier).toBe('prod-safe');
  });

  test('capability mining lands on 12 of 17 — update-ui/remove-ui are handle gates, not capabilities', () => {
    const mined = view.tools.filter((t) => t.consent.capability !== null);
    expect(mined).toHaveLength(12);
    expect(byId(view, 'stop-accounts').consent.capability).toBe('host.commands.stop-accounts');
    expect(byId(view, 'update-ui').consent.capability).toBeNull();
    expect(byId(view, 'update-ui').consent.mode).toBe('session');
    expect(byId(view, 'update-ui').consent.mechanismStated).toBe(true);
  });

  test('nothing is templated here; streaming is derived from the prose', () => {
    expect(view.counts.templated).toBe(0);
    const streams = view.tools.filter((t) => t.streaming.value);
    expect(streams.map((t) => t.name)).toEqual([
      'subscribe-account-launched',
      'subscribe-account-exited',
      'subscribe-mutex-state-changed',
    ]);
    expect(streams[0].streaming.provenance).toHaveProperty('derived');
  });

  test('prereqs mine the handshake chain; the shared gRPC prefix is factored out', () => {
    expect(byId(view, 'handshake').prereqs).toEqual([]);
    // "Free read — no handshake or consent required" is a NEGATIVE mention: no prereq.
    expect(byId(view, 'get-host-info').prereqs).toEqual([]);
    expect(byId(view, 'request-launch').prereqs).toEqual(['handshake']);
    expect(view.tools.filter((t) => t.prereqs.includes('handshake'))).toHaveLength(14);
    for (const t of view.tools) {
      expect(t.transport.sharedPrefix).toBe('/rororo.plugin.v1.RoRoRoHost/');
    }
  });

  test('grouping is by capability family, the consent screen', () => {
    const g = {};
    for (const t of view.tools) g[t.group] = (g[t.group] ?? 0) + 1;
    expect(g.events).toBe(3);
    expect(g.commands).toBe(4);
    expect(g.queries).toBe(2);
    expect(g.ui).toBe(5);
    expect(Object.values(g).reduce((a, b) => a + b, 0)).toBe(17);
  });

  test('kind=read projects to a DERIVED readOnly annotation, never a declared one', () => {
    const r = byId(view, 'get-host-info');
    expect(r.kind).toBe('read');
    expect(r.annotations.readOnly.value).toBe(true);
    expect(r.annotations.readOnly.provenance).toHaveProperty('derived');
    expect(r.annotations.idempotent.provenance).toBe('unclaimed');
    expect(view.counts.withDeclaredAnnotation).toBe(0);
  });

  test('two failures in one file, different line refs, cluster into ONE card', () => {
    const wounded = JSON.parse(JSON.stringify(RORO));
    for (const a of wounded.affordances) {
      if (a.id === 'handshake')
        a.verified = { status: 'fail', at: RENDERED_AT, runId: 'x', detail: 'connect ECONNREFUSED' };
      if (a.id === 'get-host-info')
        a.verified = { status: 'fail', at: RENDERED_AT, runId: 'x', detail: 'unexpected 500' };
    }
    // Same proto file, different :NN suffixes — the line number is not a subsystem.
    const refs = wounded.affordances
      .filter((a) => a.id === 'handshake' || a.id === 'get-host-info')
      .map((a) => a.sourceRef);
    expect(refs[0]).not.toBe(refs[1]);

    const hurt = normalize(wounded, opts);
    const clusters = hurt.findings.filter((f) => f.severity === 'error-cluster');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].toolRefs.sort()).toEqual(['get-host-info', 'handshake']);
    expect(clusters[0].id).toBe('error-cluster:plugin_contract');
    expect(clusters[0].anchor).toBe('#error-cluster:plugin_contract');
    expect(clusters[0].body).not.toMatch(/plugin_contract\.proto:\d+/);
    expect(new Set(hurt.findings.map((f) => f.id)).size).toBe(hurt.findings.length);
  });
});

describe('normalize — MCP tools/list', () => {
  const view = normalize(MCP, opts);

  test('MCP surface facts', () => {
    expect(view.source).toBe('mcp');
    expect(view.tools.length).toBe(MCP.tools.length);
    expect(Object.keys(view).sort()).toEqual([...SURFACEVIEW_KEYS].sort());
    for (const t of view.tools) expect(Object.keys(t).sort()).toEqual([...TOOLVIEW_KEYS].sort());
  });

  test('a tools/list payload carries no transport and no tier', () => {
    const t = view.tools[0];
    expect(t.transport.declared).toBeNull();
    expect(t.transport.corrected).toBe(false);
    expect(t.transport.real).toBe('unknown');
    expect(t.tier).toBeNull();
    expect(t.purposeSource).toBe('mcp');
    expect(t.verification.class).toBe('unverified');
  });

  test('declared inputSchemas are counted as declared', () => {
    expect(view.counts.withInputSchema).toBe(MCP.tools.filter((t) => t.inputSchema).length);
    expect(view.counts.withInputSchema).toBeGreaterThan(0);
  });

  test('the jsonrpc frame normalizes identically', () => {
    const frame = normalize({ jsonrpc: '2.0', id: 1, result: { tools: MCP.tools } }, opts);
    expect(frame.tools.map((t) => t.name)).toEqual(view.tools.map((t) => t.name));
  });
});

describe('validation is a finding, not a refusal', () => {
  test('a schema-invalid manifest still normalizes, with a validation finding', () => {
    const broken = JSON.parse(JSON.stringify(RORO));
    broken.affordances[0].kind = 'not-a-kind';
    const view = normalize(broken, opts);
    expect(view.tools).toHaveLength(17);
    const v = view.findings.filter((f) => f.severity === 'validation');
    expect(v).toHaveLength(1);
    expect(v[0].body).toMatch(/kind/);
  });

  test('a future manifest with unknown fields renders anyway', () => {
    const future = JSON.parse(JSON.stringify(RORO));
    future.affordances[0].unknownFutureField = { nope: true };
    expect(normalize(future, opts).tools).toHaveLength(17);
  });
});
