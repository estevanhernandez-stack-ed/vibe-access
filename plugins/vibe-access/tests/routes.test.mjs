import { describe, test, expect } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import { detect } from '../engine/detect.mjs';
import { firebaseFunctionsAdapter } from '../engine/adapters/firebase-functions/index.mjs';

const appRoot = fileURLToPath(new URL('./fixtures/app-firebase', import.meta.url));

describe('firebase-functions detectRoutes', () => {
  const ctx = { appRoot, detection: detect(appRoot), config: null };
  const { routes, unmapped } = firebaseFunctionsAdapter.detectRoutes(ctx);

  test('maps rewrites with matching exports to routes', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/api/leaderboard');
    expect(paths).toContain('/api/submit-score');
  });

  test('resolves sourceRef through the require path', () => {
    const lb = routes.find((r) => r.name === 'leaderboard');
    expect(lb.sourceRef).toMatch(/src[\\/]social[\\/]leaderboards\.js/);
  });

  test('infers GET for handlers guarding req.method === GET', () => {
    expect(routes.find((r) => r.name === 'leaderboard').method).toBe('GET');
    expect(routes.find((r) => r.name === 'submitScore').method).toBe('POST');
  });

  test('a rewrite with no export lands in unmapped, not dropped', () => {
    expect(unmapped.some((u) => u.reason.includes('ghostFunction'))).toBe(true);
  });

  test('an export with no rewrite lands in unmapped', () => {
    expect(unmapped.some((u) => u.reason.includes('orphanFunction'))).toBe(true);
  });

  test('the ** catch-all is ignored silently (SPA fallback, not an API)', () => {
    expect(routes.some((r) => r.path === '**')).toBe(false);
  });
});
