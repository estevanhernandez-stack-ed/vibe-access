import { describe, test, expect } from '@jest/globals';
import { evaluateGaps } from '../engine/gaps.mjs';

const base = {
  schemaVersion: 1,
  app: 'fixture',
  adapter: 'firebase-functions',
  generatedAt: '2026-07-09T12:00:00.000Z',
  baseUrls: { dev: 'http://localhost:5000' },
  discoveryRoute: null,
  affordances: [],
};

const aff = (kind, id = kind) => ({
  id, description: 'x', tier: 'dev', kind,
  transport: { type: 'http', method: 'POST', path: `/api/agent/${id}` },
  input: null, output: null, auth: 'none', sourceRef: 'f.js', origin: 'scaffolded',
  verified: { status: 'unverified' },
});

describe('evaluateGaps', () => {
  test('empty manifest gaps on all six needs', () => {
    const { gaps } = evaluateGaps(base);
    expect(gaps.map((g) => g.need).sort()).toEqual(
      ['act-as-user', 'capture', 'discovery', 'read-state', 'reset', 'seed']
    );
  });

  test('read + act affordances satisfy read-state and act-as-user', () => {
    const m = { ...base, affordances: [aff('read'), { ...aff('act'), tier: 'prod-safe' }] };
    const { gaps, met } = evaluateGaps(m);
    expect(met).toContain('read-state');
    expect(met).toContain('act-as-user');
    expect(gaps.map((g) => g.need)).toEqual(['seed', 'reset', 'capture', 'discovery']);
  });

  test('a discoveryRoute satisfies discovery', () => {
    const m = { ...base, discoveryRoute: '/api/agent/manifest' };
    expect(evaluateGaps(m).met).toContain('discovery');
  });

  test('gap specs carry scaffoldable ids and kinds', () => {
    const { gaps } = evaluateGaps(base);
    const seed = gaps.find((g) => g.need === 'seed');
    expect(seed.id).toBe('agent-seed');
    expect(seed.kind).toBe('seed');
  });
});
