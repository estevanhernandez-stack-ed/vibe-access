import { describe, test, expect } from '@jest/globals';
import { isLocalUrl, runVerify, stampManifest } from '../engine/verify.mjs';
import { validateVerifyRun } from '../engine/schema.mjs';

const NOW = '2026-07-09T12:00:00.000Z';
const aff = (over) => ({
  id: 'a', description: 'x', tier: 'prod-safe', kind: 'read',
  transport: { type: 'http', method: 'GET', path: '/api/a' },
  input: null, output: null, auth: 'none', sourceRef: 'f.js', origin: 'existing',
  verified: { status: 'unverified' }, ...over,
});
const manifest = {
  schemaVersion: 1, app: 'fixture', adapter: 'firebase-functions', generatedAt: NOW,
  baseUrls: { dev: 'http://localhost:5000' }, discoveryRoute: null,
  affordances: [
    aff({ id: 'ok-read' }),
    aff({ id: 'gated-act', kind: 'act', auth: 'token', transport: { type: 'http', method: 'POST', path: '/api/act' } }),
    aff({ id: 'shot', kind: 'capture', tier: 'dev', transport: { type: 'http', method: 'POST', path: '/api/agent/shot' } }),
    aff({ id: 'broken', transport: { type: 'http', method: 'GET', path: '/api/broken' } }),
    aff({ id: 'gated-open-200', kind: 'act', auth: 'token', transport: { type: 'http', method: 'POST', path: '/api/gated-open-200' } }),
    aff({ id: 'gated-open-404', kind: 'act', auth: 'token', transport: { type: 'http', method: 'POST', path: '/api/gated-open-404' } }),
    aff({ id: 'unreachable', transport: { type: 'http', method: 'GET', path: '/api/unreachable' } }),
  ],
};

const fakeFetch = async (url, opts = {}) => {
  if (url.endsWith('/api/a')) return { status: 200 };
  if (url.endsWith('/api/act')) return { status: 401 };
  if (url.endsWith('/api/broken')) return { status: 500 };
  if (url.endsWith('/api/gated-open-200')) return { status: 200 };
  if (url.endsWith('/api/gated-open-404')) return { status: 404 };
  if (url.endsWith('/api/unreachable')) throw new Error('connect ECONNREFUSED');
  return { status: 404 };
};

describe('isLocalUrl', () => {
  test('localhost family is local; anything else is not', () => {
    expect(isLocalUrl('http://localhost:5000')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:5001')).toBe(true);
    expect(isLocalUrl('https://weseeyouatthemovies.web.app')).toBe(false);
  });
});

describe('runVerify', () => {
  test('refuses a non-local base URL without force', async () => {
    await expect(
      runVerify(manifest, { baseUrl: 'https://prod.example.com', fetchImpl: fakeFetch, runId: 'r1', now: NOW })
    ).rejects.toThrow(/not local/i);
  });

  test('produces a schema-valid run with the right statuses', async () => {
    const run = await runVerify(manifest, {
      baseUrl: 'http://localhost:5000', fetchImpl: fakeFetch, runId: 'r1', now: NOW,
    });
    expect(validateVerifyRun(run).errors).toEqual([]);
    const by = Object.fromEntries(run.results.map((r) => [r.affordanceId, r]));
    expect(by['ok-read'].status).toBe('pass');
    expect(by['gated-act'].status).toBe('pass');
    expect(by['gated-act'].detail).toBe('auth-gate-held');
    expect(by['shot'].status).toBe('pending-agent');
    expect(by['broken'].status).toBe('fail');
  });

  test('gated affordance answering 200 to an unauthenticated probe fails as auth-gate-open', async () => {
    const run = await runVerify(manifest, {
      baseUrl: 'http://localhost:5000', fetchImpl: fakeFetch, runId: 'r1', now: NOW,
    });
    const by = Object.fromEntries(run.results.map((r) => [r.affordanceId, r]));
    expect(by['gated-open-200'].status).toBe('fail');
    expect(by['gated-open-200'].detail).toMatch(/auth-gate-open/);
  });

  test('gated affordance answering 404 to an unauthenticated probe fails', async () => {
    const run = await runVerify(manifest, {
      baseUrl: 'http://localhost:5000', fetchImpl: fakeFetch, runId: 'r1', now: NOW,
    });
    const by = Object.fromEntries(run.results.map((r) => [r.affordanceId, r]));
    expect(by['gated-open-404'].status).toBe('fail');
  });

  test('unreachable affordance fails with an unreachable detail', async () => {
    const run = await runVerify(manifest, {
      baseUrl: 'http://localhost:5000', fetchImpl: fakeFetch, runId: 'r1', now: NOW,
    });
    const by = Object.fromEntries(run.results.map((r) => [r.affordanceId, r]));
    expect(by['unreachable'].status).toBe('fail');
    expect(by['unreachable'].detail).toMatch(/unreachable/);
  });

  test('stampManifest writes results back, fail-closed for untouched affordances', async () => {
    const run = await runVerify(manifest, {
      baseUrl: 'http://localhost:5000', fetchImpl: fakeFetch, runId: 'r1', now: NOW,
    });
    const stamped = stampManifest(manifest, run);
    expect(stamped.affordances.find((a) => a.id === 'ok-read').verified.status).toBe('pass');
    expect(stamped.affordances.find((a) => a.id === 'shot').verified.status).toBe('pending-agent');
    expect(manifest.affordances.find((a) => a.id === 'ok-read').verified.status).toBe('unverified');
  });
});
