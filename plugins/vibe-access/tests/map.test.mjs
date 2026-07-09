import { describe, test, expect } from '@jest/globals';
import { buildManifest, assertTierLegal } from '../engine/map.mjs';
import { validateManifest } from '../engine/schema.mjs';

const NOW = '2026-07-09T12:00:00.000Z';
const inventory = {
  schemaVersion: 1,
  app: 'fixture',
  adapter: 'firebase-functions',
  generatedAt: NOW,
  routes: [
    { name: 'leaderboard', method: 'GET', path: '/api/leaderboard', sourceRef: 'functions/src/l.js', auth: 'none' },
    { name: 'submitScore', method: 'POST', path: '/api/submit-score', sourceRef: 'functions/src/l.js', auth: 'token' },
  ],
  unmapped: [],
};
const baseUrls = { dev: 'http://localhost:5000' };

describe('buildManifest', () => {
  test('produces a schema-valid manifest with kind/tier defaults', () => {
    const m = buildManifest(inventory, { baseUrls, now: NOW });
    expect(validateManifest(m).errors).toEqual([]);
    const lb = m.affordances.find((a) => a.id === 'leaderboard');
    expect(lb.kind).toBe('read');
    expect(lb.tier).toBe('prod-safe');
    const ss = m.affordances.find((a) => a.id === 'submit-score');
    expect(ss.kind).toBe('act');
    expect(ss.auth).toBe('token');
    expect(ss.verified.status).toBe('unverified');
  });

  test('preserves verified stamps and overrides across re-map', () => {
    const first = buildManifest(inventory, { baseUrls, now: NOW });
    first.affordances[0].verified = { status: 'pass', at: NOW, runId: 'r1' };
    first.affordances[0].overrides = { tier: 'dev' };
    const second = buildManifest(inventory, { previous: first, baseUrls, now: NOW });
    expect(second.affordances[0].verified.status).toBe('pass');
    expect(second.affordances[0].tier).toBe('dev');
  });

  test('refusal rule throws, mechanically', () => {
    expect(() => assertTierLegal('seed', 'prod-safe')).toThrow(/never/i);
    expect(() => assertTierLegal('reset', 'prod-safe')).toThrow();
    expect(() => assertTierLegal('capture', 'prod-safe')).toThrow();
    expect(() => assertTierLegal('read', 'prod-safe')).not.toThrow();
    expect(() => assertTierLegal('seed', 'dev')).not.toThrow();
  });

  test('carried-forward scaffolded row with illegal override throws (effective tier, not raw tier)', () => {
    const previous = {
      schemaVersion: 1,
      app: 'fixture',
      adapter: 'firebase-functions',
      generatedAt: NOW,
      baseUrls,
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
    expect(() => buildManifest(inventory, { previous, baseUrls, now: NOW })).toThrow(/never/i);
  });

  test('carried-forward scaffolded row without overrides survives re-map unchanged', () => {
    const previous = {
      schemaVersion: 1,
      app: 'fixture',
      adapter: 'firebase-functions',
      generatedAt: NOW,
      baseUrls,
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
        },
      ],
    };
    const m = buildManifest(inventory, { previous, baseUrls, now: NOW });
    const seed = m.affordances.find((a) => a.id === 'agent-seed');
    expect(seed).toBeDefined();
    expect(seed.kind).toBe('seed');
    expect(seed.tier).toBe('dev');
    expect(seed.origin).toBe('scaffolded');
  });

  test('scaffolded stickiness: route reappearing in inventory keeps kind/tier/origin/verified', () => {
    const previous = {
      schemaVersion: 1,
      app: 'fixture',
      adapter: 'firebase-functions',
      generatedAt: NOW,
      baseUrls,
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
          verified: { status: 'pass', at: NOW, runId: 'r1' },
        },
      ],
    };
    const inventoryWithScaffoldedRoute = {
      ...inventory,
      routes: [
        ...inventory.routes,
        { name: 'agentSeed', method: 'POST', path: '/api/agent/seed', sourceRef: 'functions/src/seed.js', auth: 'token' },
      ],
    };
    const m = buildManifest(inventoryWithScaffoldedRoute, { previous, baseUrls, now: NOW });
    const seed = m.affordances.find((a) => a.id === 'agent-seed');
    expect(seed).toBeDefined();
    expect(seed.kind).toBe('seed');
    expect(seed.tier).toBe('dev');
    expect(seed.origin).toBe('scaffolded');
    expect(seed.verified).toEqual({ status: 'pass', at: NOW, runId: 'r1' });
  });

  test('illegal override on an in-inventory scaffolded row also throws', () => {
    const previous = {
      schemaVersion: 1,
      app: 'fixture',
      adapter: 'firebase-functions',
      generatedAt: NOW,
      baseUrls,
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
          verified: { status: 'pass', at: NOW, runId: 'r1' },
          overrides: { tier: 'prod-safe' },
        },
      ],
    };
    const inventoryWithScaffoldedRoute = {
      ...inventory,
      routes: [
        ...inventory.routes,
        { name: 'agentSeed', method: 'POST', path: '/api/agent/seed', sourceRef: 'functions/src/seed.js', auth: 'token' },
      ],
    };
    expect(() => buildManifest(inventoryWithScaffoldedRoute, { previous, baseUrls, now: NOW })).toThrow(/never/i);
  });
});
