// §8 — the three schema deltas. Every field is OPTIONAL: a v0.1 manifest still validates,
// and the v0.1 posture pins (v01-posture-regression.test.mjs) stay green beside these.
import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { buildManifest, assertTierLegal, effectiveKind } from '../engine/map.mjs';
import { validateManifest } from '../engine/schema.mjs';
import { runVerify } from '../engine/verify.mjs';
import { evaluateGaps } from '../engine/gaps.mjs';

const NOW = '2026-07-11T00:00:00.000Z';
const baseUrls = { dev: 'http://localhost:5000' };

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const reference = load('reference-626-manifest.json');

const withFirst = (patch) => {
  const m = structuredClone(reference);
  m.affordances[0] = { ...m.affordances[0], ...patch };
  return m;
};

const inventory = {
  schemaVersion: 1,
  app: 'fixture',
  adapter: 'firebase-functions',
  generatedAt: NOW,
  routes: [
    { name: 'listThings', method: 'POST', path: '/rpc/ListThings', sourceRef: 'src/rpc.js', auth: 'token' },
    { name: 'stopThings', method: 'POST', path: '/rpc/StopThings', sourceRef: 'src/rpc.js', auth: 'token' },
  ],
  unmapped: [],
};
const remap = (previous) => buildManifest(inventory, { previous, baseUrls, now: NOW });
const firstMap = () => buildManifest(inventory, { baseUrls, now: NOW });

describe('schema: the fields are optional and typed', () => {
  test('a field-free v0.1 manifest still validates', () => {
    expect(validateManifest(reference).errors).toEqual([]);
    for (const a of reference.affordances) {
      expect(a.authDetail).toBeUndefined();
      expect(a.destructive).toBeUndefined();
    }
  });

  test('accepts destructive true/false, authDetail, and overrides.kind', () => {
    expect(validateManifest(withFirst({ destructive: true })).errors).toEqual([]);
    expect(validateManifest(withFirst({ destructive: false })).errors).toEqual([]);
    expect(validateManifest(withFirst({ authDetail: 'host.commands.stop-accounts' })).errors).toEqual([]);
    expect(validateManifest(withFirst({ overrides: { kind: 'read' } })).errors).toEqual([]);
  });

  test('rejects wrong types', () => {
    expect(validateManifest(withFirst({ destructive: 'yes' })).valid).toBe(false);
    expect(validateManifest(withFirst({ authDetail: 3 })).valid).toBe(false);
    expect(validateManifest(withFirst({ authDetail: '' })).valid).toBe(false);
    expect(validateManifest(withFirst({ overrides: { kind: 'banana' } })).valid).toBe(false);
  });
});

describe('schema: the twin refusal branch sees the override', () => {
  for (const kind of ['seed', 'reset', 'capture']) {
    test(`rejects overrides.kind "${kind}" on a prod-safe row`, () => {
      const bad = withFirst({ kind: 'act', tier: 'prod-safe', overrides: { kind } });
      expect(validateManifest(bad).valid).toBe(false);
    });

    test(`rejects overrides.kind "${kind}" when overrides.tier is prod-safe`, () => {
      const bad = withFirst({ kind: 'act', tier: 'dev', overrides: { kind, tier: 'prod-safe' } });
      expect(validateManifest(bad).valid).toBe(false);
    });

    test(`accepts overrides.kind "${kind}" at effective tier dev`, () => {
      const ok = withFirst({ kind: 'act', tier: 'dev', overrides: { kind, tier: 'dev' } });
      expect(validateManifest(ok).errors).toEqual([]);
    });
  }

  test('overrides.kind read/act on a prod-safe row is fine', () => {
    expect(validateManifest(withFirst({ kind: 'act', tier: 'prod-safe', overrides: { kind: 'read' } })).errors).toEqual([]);
  });
});

describe('effectiveKind', () => {
  test('the override wins; absent it, the top-level kind', () => {
    expect(effectiveKind({ kind: 'act', overrides: { kind: 'read' } })).toBe('read');
    expect(effectiveKind({ kind: 'act' })).toBe('act');
    expect(effectiveKind({ kind: 'act', overrides: { tier: 'dev' } })).toBe('act');
  });
});

describe('map: overrides.kind bakes through', () => {
  test('the effective kind lands in the top-level field and overrides.kind survives for re-map', () => {
    const first = firstMap();
    expect(first.affordances[0].kind).toBe('act'); // POST derives act
    first.affordances[0].overrides = { kind: 'read' };

    const second = remap(first);
    expect(second.affordances[0].kind).toBe('read');
    expect(second.affordances[0].overrides.kind).toBe('read');

    const third = remap(second);
    expect(third.affordances[0].kind).toBe('read');
    expect(third.affordances[0].overrides.kind).toBe('read');
    expect(validateManifest(third).errors).toEqual([]);
  });

  test('assertTierLegal runs on the EFFECTIVE kind, and the throw names the affordance', () => {
    const first = firstMap();
    first.affordances[0].overrides = { kind: 'seed' }; // tier stays prod-safe
    expect(() => remap(first)).toThrow(/never/i);
    expect(() => remap(first)).toThrow(/list-things/);
  });

  test('overrides.kind seed + overrides.tier dev is legal and re-maps', () => {
    const first = firstMap();
    first.affordances[0].overrides = { kind: 'seed', tier: 'dev' };
    const second = remap(first);
    expect(second.affordances[0].kind).toBe('seed');
    expect(second.affordances[0].tier).toBe('dev');
    expect(validateManifest(second).errors).toEqual([]);
  });

  test('assertTierLegal without an id still throws the mechanical refusal', () => {
    expect(() => assertTierLegal('seed', 'prod-safe')).toThrow(/never/i);
  });
});

describe('map: authDetail and destructive survive BOTH merge paths', () => {
  test('origin: existing — hand-authored on the row, re-mapped twice, both survive', () => {
    const first = firstMap();
    expect(first.affordances[1].origin).toBe('existing');
    first.affordances[1].authDetail = 'host.commands.stop-accounts';
    first.affordances[1].destructive = true;

    const second = remap(first);
    expect(second.affordances[1].authDetail).toBe('host.commands.stop-accounts');
    expect(second.affordances[1].destructive).toBe(true);

    const third = remap(second);
    expect(third.affordances[1].authDetail).toBe('host.commands.stop-accounts');
    expect(third.affordances[1].destructive).toBe(true);
    expect(validateManifest(third).errors).toEqual([]);
  });

  test('origin: scaffolded (carried, not in inventory) — both survive', () => {
    const previous = {
      schemaVersion: 1,
      app: 'fixture',
      adapter: 'firebase-functions',
      generatedAt: NOW,
      baseUrls,
      discoveryRoute: null,
      affordances: [
        {
          id: 'agent-reset',
          description: 'Reset: POST /api/agent/reset',
          tier: 'dev',
          kind: 'reset',
          transport: { type: 'http', method: 'POST', path: '/api/agent/reset' },
          input: null,
          output: null,
          auth: 'token',
          authDetail: 'Firebase ID token via Authorization: Bearer',
          destructive: true,
          sourceRef: 'functions/src/reset.js',
          origin: 'scaffolded',
          verified: { status: 'unverified' },
        },
      ],
    };
    const second = remap(previous);
    const reset = second.affordances.find((a) => a.id === 'agent-reset');
    expect(reset.authDetail).toBe('Firebase ID token via Authorization: Bearer');
    expect(reset.destructive).toBe(true);
    expect(remap(second).affordances.find((a) => a.id === 'agent-reset').destructive).toBe(true);
  });

  test('destructive: false is carried, not dropped as falsy', () => {
    const first = firstMap();
    first.affordances[0].destructive = false;
    expect(remap(first).affordances[0].destructive).toBe(false);
  });
});

describe('verify + gaps read the effective kind; destructive is never auto-probed', () => {
  const manifestWith = (affordances) => ({
    schemaVersion: 1,
    app: 'fixture',
    adapter: 'firebase-functions',
    generatedAt: NOW,
    baseUrls,
    discoveryRoute: null,
    affordances,
  });
  const row = (id, patch) => ({
    id,
    description: `Act: POST /api/${id}`,
    tier: 'prod-safe',
    kind: 'act',
    transport: { type: 'http', method: 'POST', path: `/api/${id}` },
    input: null,
    output: null,
    auth: 'token',
    sourceRef: 'src/x.js',
    origin: 'existing',
    verified: { status: 'unverified' },
    ...patch,
  });

  test('destructive: true is skipped LOCALLY — no probe, no stamp-eating pending-agent', async () => {
    const calls = [];
    const spy = async (...args) => { calls.push(args); return { status: 401 }; };
    const m = manifestWith([row('stop-accounts', { destructive: true })]);
    const run = await runVerify(m, { baseUrl: 'http://localhost:5000', fetchImpl: spy, runId: 'r1', now: NOW });
    expect(run.results[0].status).toBe('skipped');
    expect(run.results[0].detail).toMatch(/destructive/);
    expect(calls).toHaveLength(0);
  });

  test('destructive: true is skipped non-locally too, --force and all', async () => {
    const calls = [];
    const spy = async (...args) => { calls.push(args); return { status: 401 }; };
    const m = manifestWith([row('stop-accounts', { destructive: true })]);
    const run = await runVerify(m, { baseUrl: 'https://prod.example.com', force: true, fetchImpl: spy, runId: 'r1', now: NOW });
    expect(run.results[0].status).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  test('destructive: false is probed as normal', async () => {
    const m = manifestWith([row('safe-act', { destructive: false })]);
    const run = await runVerify(m, { baseUrl: 'http://localhost:5000', fetchImpl: async () => ({ status: 401 }), runId: 'r1', now: NOW });
    expect(run.results[0].status).toBe('pass');
  });

  test("a hand-authored {kind: 'act', overrides: {kind: 'reset', tier: 'dev'}} is skipped non-locally and satisfies the reset need", async () => {
    const handEdited = row('nightly-reset', { tier: 'dev', overrides: { kind: 'reset', tier: 'dev' } });
    const m = manifestWith([handEdited]);
    expect(validateManifest(m).errors).toEqual([]);

    const calls = [];
    const spy = async (...args) => { calls.push(args); return { status: 200 }; };
    const run = await runVerify(m, { baseUrl: 'https://prod.example.com', force: true, fetchImpl: spy, runId: 'r1', now: NOW });
    expect(run.results[0].status).toBe('skipped');
    expect(calls).toHaveLength(0);

    expect(evaluateGaps(m).met).toContain('reset');
    expect(evaluateGaps(m).gaps.map((g) => g.need)).not.toContain('reset');
  });
});

describe('the RoRoRo migration — 7 honest reads survive the gRPC all-POST re-map', () => {
  const READS = [
    'get-host-info',
    'get-running-accounts',
    'subscribe-account-launched',
    'subscribe-account-exited',
    'subscribe-mutex-state-changed',
    'get-current-server',
    'get-account-activity',
  ];

  test('the fixture carries overrides.kind: read on exactly those 7', () => {
    const m = load('manifest-rororo.json');
    const overridden = m.affordances.filter((a) => a.overrides?.kind === 'read').map((a) => a.id);
    expect(overridden.sort()).toEqual([...READS].sort());
    expect(validateManifest(m).errors).toEqual([]);
  });

  test('re-map: all 7 reads survive; no other kind moves', () => {
    const m = load('manifest-rororo.json');
    const inv = {
      schemaVersion: 1,
      app: m.app,
      adapter: m.adapter,
      generatedAt: m.generatedAt,
      routes: m.affordances.map((a) => ({
        name: a.id,
        method: a.transport.method,
        path: a.transport.path,
        sourceRef: a.sourceRef,
        auth: a.auth,
      })),
      unmapped: [],
    };
    const out = buildManifest(inv, { previous: m, baseUrls: m.baseUrls, now: m.generatedAt });
    expect(out.affordances.filter((a) => a.kind === 'read').map((a) => a.id).sort()).toEqual([...READS].sort());
    for (const before of m.affordances) {
      const after = out.affordances.find((a) => a.id === before.id);
      expect(after.kind).toBe(before.kind); // every POST-derived act stays act; the 7 stay read
    }
    // and it holds through a second re-map — overrides.kind is the durable memory
    const again = buildManifest(inv, { previous: out, baseUrls: m.baseUrls, now: m.generatedAt });
    expect(again.affordances.filter((a) => a.kind === 'read')).toHaveLength(7);
  });
});
