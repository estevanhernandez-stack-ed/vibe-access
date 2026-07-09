import { describe, test, expect } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import { detect } from '../engine/detect.mjs';
import { firebaseFunctionsAdapter } from '../engine/adapters/firebase-functions/index.mjs';

const appRoot = fileURLToPath(new URL('./fixtures/app-firebase', import.meta.url));

describe('firebase-functions detectAuth', () => {
  const ctx = { appRoot, detection: detect(appRoot), config: null };
  const { routes } = firebaseFunctionsAdapter.detectRoutes(ctx);

  test('handler calling verifyAuthToken -> token', () => {
    const r = routes.find((x) => x.name === 'submitScore');
    expect(firebaseFunctionsAdapter.detectAuth(r, ctx)).toBe('token');
  });

  test('handler with no auth call -> none', () => {
    const r = routes.find((x) => x.name === 'leaderboard');
    expect(firebaseFunctionsAdapter.detectAuth(r, ctx)).toBe('none');
  });

  test('missing handler source degrades to none, never throws', () => {
    expect(
      firebaseFunctionsAdapter.detectAuth({ name: 'x', handlerSourcePath: null }, ctx)
    ).toBe('none');
  });
});
