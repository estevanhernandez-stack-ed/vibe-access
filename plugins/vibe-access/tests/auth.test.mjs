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

  test('bulk-export handler declared as `async function name(...)` calling verifyAuthToken -> token', () => {
    // getProfile is never assigned via `exports.getProfile = ...` in profiles.js —
    // it's a plain function declaration exported only via the bottom-of-file
    // `module.exports = { ... }`. Before the fix, extractFunctionBody's exports.<name>
    // strategy never matched, the body extraction returned '', and detectAuth
    // silently reported 'none' even though the handler calls verifyAuthToken.
    const r = routes.find((x) => x.name === 'getProfile');
    expect(firebaseFunctionsAdapter.detectAuth(r, ctx)).toBe('token');
  });

  test('bulk-export handler using the auth.verifyIdToken() idiom directly -> token', () => {
    // updateProfile doesn't call the app's verifyAuthToken() helper at all — it rolls
    // its own check via auth.verifyIdToken(). TOKEN_CALL_RE has to recognize this
    // second idiom too, not just the helper-function name.
    const r = routes.find((x) => x.name === 'updateProfile');
    expect(firebaseFunctionsAdapter.detectAuth(r, ctx)).toBe('token');
  });

  test('bulk-export handler with no auth call -> none', () => {
    const r = routes.find((x) => x.name === 'publicFeed');
    expect(firebaseFunctionsAdapter.detectAuth(r, ctx)).toBe('none');
  });

  test('aliased bulk export follows the alias to the aliased function\'s body for auth detection', () => {
    // feedAlias maps to publicFeed in profiles.js's module.exports; detectAuth must
    // resolve that alias the same way route method-inference does, landing on
    // publicFeed's (auth-free) body rather than finding no declaration at all.
    const r = routes.find((x) => x.name === 'feedAlias');
    expect(firebaseFunctionsAdapter.detectAuth(r, ctx)).toBe('none');
  });

  test('wrapper-call declaration form (const x = onRequest(...)) calling verifyAuthToken -> token', () => {
    // bookScreening is the app's real idiom: e3d4609's declaration-form regex
    // only matched a bare function/arrow expression RHS and never matched a
    // wrapper-call RHS, so extraction silently returned '' and auth read
    // 'none' even though the handler calls verifyAuthToken. See
    // task-15-phase1d-report.md.
    const r = routes.find((x) => x.name === 'bookScreening');
    expect(firebaseFunctionsAdapter.detectAuth(r, ctx)).toBe('token');
  });

  test('wrapper-call declaration form with no auth call -> none', () => {
    const r = routes.find((x) => x.name === 'screeningsFeed');
    expect(firebaseFunctionsAdapter.detectAuth(r, ctx)).toBe('none');
  });

  test('index-level renamed export (exports.foo = mod.bar) -> token, not a false negative on the wrong name', () => {
    // renamedProfileCheck is index.js's export name; profiles.js declares the
    // handler as updateProfile and never as renamedProfileCheck. Before the
    // fix, detectAuth searched profiles.js for a `renamedProfileCheck`
    // declaration (route.name), found nothing, and silently degraded to
    // 'none' even though updateProfile calls auth.verifyIdToken(). Fixed by
    // preferring route.sourceExportName (the name the handler file actually
    // declares) over route.name (the index-level export name).
    const r = routes.find((x) => x.name === 'renamedProfileCheck');
    expect(r).toBeDefined();
    expect(r.sourceExportName).toBe('updateProfile');
    expect(firebaseFunctionsAdapter.detectAuth(r, ctx)).toBe('token');
  });

  test('nested barrel directory (dir/index.js re-exports from a sibling file) -> token, not a false negative', () => {
    // The generate-anagrams-batch false negative from task-15-phase1f-report.md:
    // functions/index.js requires the directory "./src/moderation", which
    // resolves to moderation/index.js — a pure pass-through barrel, not the
    // real declaration. The real handler (moderation/worker.js) gates on
    // verifyAuthToken + checkAdminRole in a standalone try/catch preceding
    // the main try, matching the real app's anagrams/pipeline.js verbatim.
    // Before the fix: sourceRef/handlerSourcePath landed on the empty barrel,
    // extraction returned '', and this read 'none' despite being admin-gated.
    const r = routes.find((x) => x.name === 'runBatchJob');
    expect(firebaseFunctionsAdapter.detectAuth(r, ctx)).toBe('token');
  });
});
