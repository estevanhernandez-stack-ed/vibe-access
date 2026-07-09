import { describe, test, expect } from '@jest/globals';
import { resolveAdapter, REGISTERED_ADAPTERS } from '../engine/adapters/index.mjs';

describe('resolveAdapter', () => {
  test('unknown framework resolves to not-yet-implemented with null adapter', () => {
    const r = resolveAdapter({ framework: 'unknown', rewrites: [] });
    expect(r.status).toBe('not-yet-implemented');
    expect(r.adapter).toBeNull();
  });

  test('nextjs detection returns the nextjs stub label, no adapter', () => {
    const r = resolveAdapter({ framework: 'nextjs', rewrites: [] });
    expect(r.status).toBe('not-yet-implemented');
    expect(r.framework).toBe('nextjs');
  });

  test('malformed detection degrades, never throws', () => {
    expect(() => resolveAdapter(null)).not.toThrow();
    expect(resolveAdapter(null).status).toBe('not-yet-implemented');
  });

  test('every registered adapter satisfies the contract surface', () => {
    for (const a of REGISTERED_ADAPTERS) {
      expect(typeof a.id).toBe('string');
      expect(typeof a.matches).toBe('function');
      // IMPLEMENTED adapters (non-stubs) must have detectRoutes, detectAuth, scaffoldAffordance, gateMechanism
      if (a.id === 'firebase-functions') {
        expect(typeof a.detectRoutes).toBe('function');
        expect(typeof a.detectAuth).toBe('function');
        expect(typeof a.scaffoldAffordance).toBe('function');
        expect(typeof a.gateMechanism).toBe('function');
      }
    }
  });

  test('firebase-functions detection resolves ready', () => {
    const r = resolveAdapter({ framework: 'firebase-functions', rewrites: [] });
    expect(r.status).toBe('ready');
    expect(r.adapter.id).toBe('firebase-functions');
  });
});
