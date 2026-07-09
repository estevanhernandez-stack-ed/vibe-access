import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { validateManifest, validateConfig } from '../engine/schema.mjs';

const referenceManifest = JSON.parse(
  readFileSync(new URL('./fixtures/reference-626-manifest.json', import.meta.url), 'utf8')
);

describe('manifest schema', () => {
  test('accepts the 626-dashboard reference manifest', () => {
    const r = validateManifest(referenceManifest);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  test('rejects a seed affordance tagged prod-safe', () => {
    const bad = structuredClone(referenceManifest);
    bad.affordances[0].kind = 'seed';
    bad.affordances[0].tier = 'prod-safe';
    expect(validateManifest(bad).valid).toBe(false);
  });

  test('rejects unknown top-level fields', () => {
    const bad = { ...structuredClone(referenceManifest), surprise: 1 };
    expect(validateManifest(bad).valid).toBe(false);
  });

  test('rejects a missing schemaVersion', () => {
    const bad = structuredClone(referenceManifest);
    delete bad.schemaVersion;
    expect(validateManifest(bad).valid).toBe(false);
  });
});

describe('config schema', () => {
  test('accepts a minimal config', () => {
    const r = validateConfig({
      schemaVersion: 1,
      adapter: 'firebase-functions',
      appName: 'weseeyouatthemovies',
      baseUrls: { dev: 'http://localhost:5000' },
      devRunCommand: 'firebase emulators:start',
      capturedAt: '2026-07-09T00:00:00.000Z',
    });
    expect(r.errors).toEqual([]);
  });
});
