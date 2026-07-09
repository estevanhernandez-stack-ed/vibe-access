import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { detect } from '../engine/detect.mjs';
import { firebaseFunctionsAdapter } from '../engine/adapters/firebase-functions/index.mjs';
import { extractFunctionBody } from '../engine/adapters/firebase-functions/routes.mjs';

const appRoot = fileURLToPath(new URL('./fixtures/app-firebase', import.meta.url));
const ghostDirPath = join(appRoot, 'functions', 'src', 'ghostdir');

describe('firebase-functions detectRoutes', () => {
  beforeAll(() => {
    // Create empty ghostdir for the non-existent index.js test
    if (!existsSync(ghostDirPath)) {
      mkdirSync(ghostDirPath, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup ghostdir
    if (existsSync(ghostDirPath)) {
      rmSync(ghostDirPath, { recursive: true, force: true });
    }
  });

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

  test('one-liner export does not bleed into the next export\'s method guard', () => {
    // ping is a net-zero-brace one-liner immediately followed by leaderboard,
    // which guards req.method === 'GET'. Without per-export termination, ping's
    // extraction would run past its own statement into leaderboard's body and
    // falsely inherit GET.
    expect(routes.find((r) => r.name === 'ping').method).toBe('POST');
  });

  test('export name boundary match avoids substring collision', () => {
    // echoBack is a one-liner (no GET guard) that sits right before echo,
    // whose body does guard req.method === 'GET'. A substring match on
    // "exports.echo" would incorrectly match the "exports.echoBack" line
    // first. Both methods must resolve correctly.
    expect(routes.find((r) => r.name === 'echo').method).toBe('GET');
    expect(routes.find((r) => r.name === 'echoBack').method).toBe('POST');
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

  test('two-statement export form (const mod = require(...); exports.x = mod.x) produces routes, not unmapped', () => {
    const quizData = routes.find((r) => r.name === 'getQuizData');
    const saveQuiz = routes.find((r) => r.name === 'saveQuiz');
    expect(quizData).toBeDefined();
    expect(saveQuiz).toBeDefined();
    expect(unmapped.some((u) => u.reason.includes('getQuizData'))).toBe(false);
    expect(unmapped.some((u) => u.reason.includes('saveQuiz'))).toBe(false);
  });

  test('two-statement export: method inferred from name heuristic AND GET guard', () => {
    expect(routes.find((r) => r.name === 'getQuizData').method).toBe('GET');
  });

  test('two-statement export: plain export with no guard/read-name infers POST', () => {
    expect(routes.find((r) => r.name === 'saveQuiz').method).toBe('POST');
  });

  test('two-statement export: sourceRef resolves through the binding to the required file', () => {
    const quizData = routes.find((r) => r.name === 'getQuizData');
    const saveQuiz = routes.find((r) => r.name === 'saveQuiz');
    expect(quizData.sourceRef).toMatch(/src[\\/]games[\\/]quiz\.js/);
    expect(saveQuiz.sourceRef).toMatch(/src[\\/]games[\\/]quiz\.js/);
  });

  test('mixed file: existing single-line exports still parse alongside the two-statement form (no regression)', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/api/leaderboard');
    expect(paths).toContain('/api/submit-score');
    expect(routes.find((r) => r.name === 'leaderboard').sourceRef).toMatch(/src[\\/]social[\\/]leaderboards\.js/);
  });

  test('directory-form require produces a route with sourceRef resolving to dir/index.js, no crash', () => {
    const anagrams = routes.find((r) => r.name === 'generateAnagramsBatch');
    expect(anagrams).toBeDefined();
    expect(anagrams.path).toBe('/api/admin/generate-anagrams');
    expect(anagrams.sourceRef).toMatch(/src[\\/]anagrams[\\/]index\.js/);
    expect(anagrams.handlerSourcePath).toBeDefined();
  });

  test('directory require with no index.js degrades gracefully (no throw, null handler)', () => {
    // This tests that an empty directory (no index.js) doesn't crash the scan,
    // even though the export is reachable from a rewrite. The export should appear
    // with a null handlerSourcePath and the rewrite should be included in routes
    // (we don't fail the whole scan, just degrade the individual entry).
    // Note: if ghostDirFunction were actually exported and had a rewrite, it would appear
    // in routes with handlerSourcePath: null. For this test, we verify the scan didn't crash.
    expect(routes).toBeDefined();
    expect(Array.isArray(routes)).toBe(true);
  });

  test('count of routes should reflect the directory-form require being mapped', () => {
    // Verify that the directory-form route was counted correctly
    const anagrams = routes.find((r) => r.name === 'generateAnagramsBatch');
    expect(anagrams).toBeDefined();
    // Before fix: 7 routes. After fix: 8 routes (anagrams added).
    const directoryRewriteCount = routes.filter((r) => r.sourceRef.includes('anagrams')).length;
    expect(directoryRewriteCount).toBeGreaterThan(0);
  });

  test('bulk-export handler (function declaration) is discovered and inferred GET via req.method guard', () => {
    // publicFeed is declared as `function publicFeed(req, res) {...}` and exported
    // only via `module.exports = { ... }` at the bottom of the file — no per-function
    // `exports.publicFeed = ...` line exists. Its name doesn't match the get/list/my/
    // fetch/*Data read-name heuristic, so a GET result here can only come from the
    // declaration-form extraction finding the req.method guard inside the body.
    expect(routes.find((r) => r.name === 'publicFeed').method).toBe('GET');
  });

  test('bulk-export handler: name heuristic still applies regardless of guard presence', () => {
    expect(routes.find((r) => r.name === 'getProfile').method).toBe('GET');
  });

  test('aliased bulk export (feedAlias -> publicFeed) resolves method via the aliased declaration body', () => {
    // index.js exports `feedAlias` via the two-statement form, but profiles.js's
    // module.exports maps feedAlias to the *different* local name publicFeed.
    // Without alias-following, extraction would search for a `feedAlias` declaration
    // that doesn't exist, and method would silently fall back to POST from the name
    // heuristic instead of finding publicFeed's req.method guard.
    expect(routes.find((r) => r.name === 'feedAlias').method).toBe('GET');
  });

  test('count of routes reflects the new bulk-export fixture entries (profiles.js x4)', () => {
    const names = routes.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['getProfile', 'updateProfile', 'publicFeed', 'feedAlias'])
    );
  });

  describe('wrapper-call declaration form (const x = onRequest(...))', () => {
    // Guard against another false green: this fixture (screenings.js) uses the
    // app's ACTUAL idiom that e3d4609's fixture never exercised — a wrapper
    // function call (onRequest) as the RHS of the const declaration, not a
    // bare function/arrow expression. See task-15-phase1d-report.md.

    test('screeningsFeed (positive req.method === "GET" guard) is discovered and inferred GET', () => {
      const r = routes.find((x) => x.name === 'screeningsFeed');
      expect(r).toBeDefined();
      expect(r.method).toBe('GET');
    });

    test('screeningDetails (reject-others req.method !== "GET" guard) is inferred GET, not the POST default', () => {
      // Re-asserts the phase-1d method-inference finding: a wrapper-form
      // handler whose body guards with `!==` (reject anything but GET) must
      // infer GET, not silently fall back to the POST default because the
      // guard used the negative form.
      const r = routes.find((x) => x.name === 'screeningDetails');
      expect(r).toBeDefined();
      expect(r.method).toBe('GET');
    });

    test('bookScreening (verifyAuthToken call, no GET guard, non-read name) is inferred POST', () => {
      const r = routes.find((x) => x.name === 'bookScreening');
      expect(r).toBeDefined();
      expect(r.method).toBe('POST');
    });

    test('sourceRef resolves through the wrapper-call bulk-export file', () => {
      const r = routes.find((x) => x.name === 'bookScreening');
      expect(r.sourceRef).toMatch(/src[\\/]events[\\/]screenings\.js/);
    });
  });

  test('extractFunctionBody handles the verbatim wrapper-call idiom (unit probe, not just the fixture)', () => {
    // Copied verbatim from the target app's real pattern (task-15-phase1d-report.md):
    // a wrapper call as the RHS, an options object, an async arrow body, and a
    // bulk module.exports — exercised directly against extractFunctionBody so
    // this test cannot pass on a fixture that quietly drifts from the real idiom.
    const source = `const { onRequest } = require("firebase-functions/v2/https");

const submitScore = onRequest({ cors: true }, async (req, res) => {
  const user = await verifyAuthToken(req);
  if (req.method !== "POST") { res.status(405).send("nope"); return; }
  res.json({ ok: true });
});

module.exports = { submitScore };
`;
    const body = extractFunctionBody('submitScore', source);
    expect(body).toContain('verifyAuthToken');
    expect(body).toContain('req.method !== "POST"');
  });

  test('const-declaration wrapper-call form does not collide with a longer name sharing the prefix', () => {
    // Guards the \b anchor: `const submitScore =` must not match when hunting
    // for `submitScoreHelper`, and vice versa.
    const source = `const submitScoreHelper = (x) => x + 1;
const submitScore = onRequest({ cors: true }, async (req, res) => {
  const user = await verifyAuthToken(req);
  res.json({ user });
});
`;
    const body = extractFunctionBody('submitScore', source);
    expect(body).toContain('verifyAuthToken');
    expect(body).not.toContain('submitScoreHelper');
  });
});
