// Regression pins for v0.1 posture, written BEFORE the §8 schema deltas exist.
// v0.1.0 is shipped and installed by a real user; two real manifests exist in the wild.
// Everything asserted here must survive every future change. If a delta turns one of
// these red, the delta is wrong — not the pin.
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildManifest, assertTierLegal } from '../engine/map.mjs';
import { applyPlan } from '../engine/scaffold.mjs';
import { runVerify, stampManifest } from '../engine/verify.mjs';
import { validateManifest } from '../engine/schema.mjs';

const NOW = '2026-07-11T00:00:00.000Z';
const NEVER_PROD_SAFE = ['seed', 'reset', 'capture'];

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const reference = load('reference-626-manifest.json');

// An inventory reconstructed from a manifest: what a scan of the same app re-emits.
const inventoryFrom = (m) => ({
  schemaVersion: 1,
  app: m.app,
  adapter: m.adapter,
  generatedAt: m.generatedAt,
  routes: m.affordances
    .filter((a) => a.origin === 'existing')
    .map((a) => ({
      name: a.id,
      method: a.transport.method,
      path: a.transport.path,
      sourceRef: a.sourceRef,
      auth: a.auth,
    })),
  unmapped: [],
});

describe('layer 1 — the schema refuses seed/reset/capture at prod-safe', () => {
  for (const kind of NEVER_PROD_SAFE) {
    test(`rejects kind "${kind}" tagged prod-safe`, () => {
      const bad = structuredClone(reference);
      bad.affordances[0].kind = kind;
      bad.affordances[0].tier = 'prod-safe';
      expect(validateManifest(bad).valid).toBe(false);
    });

    test(`accepts kind "${kind}" at tier dev`, () => {
      const ok = structuredClone(reference);
      ok.affordances[0].kind = kind;
      ok.affordances[0].tier = 'dev';
      expect(validateManifest(ok).errors).toEqual([]);
    });
  }
});

describe('layer 2 — assertTierLegal throws, mechanically', () => {
  for (const kind of NEVER_PROD_SAFE) {
    test(`${kind} + prod-safe throws`, () => {
      expect(() => assertTierLegal(kind, 'prod-safe')).toThrow(/never/i);
    });
    test(`${kind} + dev does not throw`, () => {
      expect(() => assertTierLegal(kind, 'dev')).not.toThrow();
    });
  }

  test('read/act at prod-safe are legal', () => {
    expect(() => assertTierLegal('read', 'prod-safe')).not.toThrow();
    expect(() => assertTierLegal('act', 'prod-safe')).not.toThrow();
  });

  test('map aborts a re-map when a carried row resolves to an illegal effective tier', () => {
    const previous = {
      schemaVersion: 1,
      app: 'fixture',
      adapter: 'firebase-functions',
      generatedAt: NOW,
      baseUrls: { dev: 'http://localhost:5000' },
      discoveryRoute: null,
      affordances: [
        {
          id: 'agent-seed',
          description: 'Seed: POST /api/agent/seed',
          tier: 'dev',
          kind: 'seed',
          transport: { type: 'http', method: 'POST', path: '/api/agent/seed' },
          input: null,
          output: null,
          auth: 'token',
          sourceRef: 'functions/src/seed.js',
          origin: 'scaffolded',
          verified: { status: 'unverified' },
          overrides: { tier: 'prod-safe' },
        },
      ],
    };
    const inventory = { schemaVersion: 1, app: 'fixture', adapter: 'firebase-functions', generatedAt: NOW, routes: [], unmapped: [] };
    expect(() =>
      buildManifest(inventory, { previous, baseUrls: { dev: 'http://localhost:5000' }, now: NOW })
    ).toThrow(/never/i);
  });
});

describe('layer 3 — scaffold refuses an ungated dev-tier file', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vibe-access-pin-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('applyPlan throws when a planned file lacks the dev-gate marker, and writes nothing', () => {
    const plan = {
      files: [{ path: 'functions/src/agent-seed.js', contents: 'module.exports = {};\n' }],
      patches: [],
    };
    expect(() => applyPlan(root, plan, { batchId: 'b1' })).toThrow(/vibe-access:dev-gate/);
    expect(existsSync(join(root, 'functions/src/agent-seed.js'))).toBe(false);
  });

  test('applyPlan writes the file when the gate marker is present', () => {
    const plan = {
      files: [{ path: 'functions/src/agent-seed.js', contents: '// vibe-access:dev-gate\nmodule.exports = {};\n' }],
      patches: [],
    };
    const { written } = applyPlan(root, plan, { batchId: 'b1' });
    expect(written).toHaveLength(1);
    expect(existsSync(join(root, 'functions/src/agent-seed.js'))).toBe(true);
  });
});

describe('verify posture — pinned before any new clause is written', () => {
  const manifestWith = (affordances) => ({
    schemaVersion: 1,
    app: 'fixture',
    adapter: 'firebase-functions',
    generatedAt: NOW,
    baseUrls: { dev: 'http://localhost:5000' },
    discoveryRoute: null,
    affordances,
  });
  const aff = (id, kind, extra = {}) => ({
    id,
    description: `${kind}: POST /api/${id}`,
    tier: kind === 'read' || kind === 'act' ? 'prod-safe' : 'dev',
    kind,
    transport: { type: 'http', method: 'POST', path: `/api/${id}` },
    input: null,
    output: null,
    auth: 'token',
    sourceRef: 'functions/src/x.js',
    origin: 'scaffolded',
    verified: { status: 'unverified' },
    ...extra,
  });
  const okFetch = async () => ({ status: 401 });

  test('capture is never probed — local or not', async () => {
    const m = manifestWith([aff('agent-capture', 'capture')]);
    const calls = [];
    const spy = async (...args) => { calls.push(args); return { status: 200 }; };

    const local = await runVerify(m, { baseUrl: 'http://localhost:5000', fetchImpl: spy, runId: 'r1', now: NOW });
    expect(local.results[0].status).toBe('pending-agent');

    const remote = await runVerify(m, { baseUrl: 'https://prod.example.com', force: true, fetchImpl: spy, runId: 'r2', now: NOW });
    expect(remote.results[0].status).toBe('pending-agent');

    expect(calls).toHaveLength(0);
  });

  for (const kind of ['seed', 'reset']) {
    test(`${kind} is probed locally and skipped non-locally — --force does not open that door`, async () => {
      const m = manifestWith([aff(`agent-${kind}`, kind)]);
      const local = await runVerify(m, { baseUrl: 'http://localhost:5000', fetchImpl: okFetch, runId: 'r1', now: NOW });
      expect(local.results[0].status).toBe('pass');

      const calls = [];
      const spy = async (...args) => { calls.push(args); return { status: 200 }; };
      const forced = await runVerify(m, { baseUrl: 'https://prod.example.com', force: true, fetchImpl: spy, runId: 'r2', now: NOW });
      expect(forced.results[0].status).toBe('skipped');
      expect(calls).toHaveLength(0);
    });
  }

  test('verify refuses a non-local base URL without --force', async () => {
    const m = manifestWith([aff('leaderboard', 'read')]);
    await expect(
      runVerify(m, { baseUrl: 'https://prod.example.com', fetchImpl: okFetch, runId: 'r1', now: NOW })
    ).rejects.toThrow(/not local/i);
  });

  test('stampManifest skips "skipped" results and WRITES "pending-agent"', () => {
    const m = manifestWith([aff('a-skip', 'seed'), aff('a-pending', 'capture')]);
    const run = {
      schemaVersion: 1,
      runId: 'r1',
      startedAt: NOW,
      baseUrl: 'https://prod.example.com',
      forced: true,
      results: [
        { affordanceId: 'a-skip', status: 'skipped', httpStatus: null, detail: 'seed/reset never exercised non-locally' },
        { affordanceId: 'a-pending', status: 'pending-agent', httpStatus: null, detail: 'capture-kind' },
      ],
    };
    const stamped = stampManifest(m, run);
    expect(stamped.affordances[0].verified).toEqual({ status: 'unverified' });
    expect(stamped.affordances[1].verified.status).toBe('pending-agent');
  });
});

describe('the two real manifests round-trip scan -> map', () => {
  for (const name of ['manifest-weseeyou.json', 'manifest-rororo.json']) {
    test(`${name}: validates today`, () => {
      expect(validateManifest(load(name)).errors).toEqual([]);
    });

    test(`${name}: re-map preserves every affordance and every field map is not entitled to touch`, () => {
      const m = load(name);
      const out = buildManifest(inventoryFrom(m), { previous: m, baseUrls: m.baseUrls, now: m.generatedAt });
      expect(validateManifest(out).errors).toEqual([]);
      expect(out.affordances.map((a) => a.id)).toEqual(m.affordances.map((a) => a.id));

      for (const before of m.affordances) {
        const after = out.affordances.find((a) => a.id === before.id);
        // `kind` and `description` are map's documented bake-through fields (effective value
        // lands in the top-level field); everything else must come out identical.
        for (const field of ['tier', 'transport', 'input', 'output', 'auth', 'sourceRef', 'origin', 'verified', 'overrides']) {
          expect({ id: before.id, field, value: after[field] }).toEqual({
            id: before.id,
            field,
            value: before[field],
          });
        }
        // description bake-through: the override wins, the template loses, nothing is invented
        expect(after.description).toBe(before.overrides?.description ?? before.description);
      }
    });
  }

  test('WeSeeYou round-trips byte-identical — all 85, no field moves at all', () => {
    const m = load('manifest-weseeyou.json');
    const out = buildManifest(inventoryFrom(m), { previous: m, baseUrls: m.baseUrls, now: m.generatedAt });
    expect(out).toEqual(m);
  });
});
