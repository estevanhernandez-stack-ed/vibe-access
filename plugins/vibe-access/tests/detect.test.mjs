import { describe, test, expect } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import { detect } from '../engine/detect.mjs';

const fix = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('detect', () => {
  test('recognizes a firebase-functions app from firebase.json + functions dir', () => {
    const d = detect(fix('app-firebase'));
    expect(d.framework).toBe('firebase-functions');
    expect(d.functionsDir).toMatch(/functions$/);
    expect(d.rewrites).toHaveLength(7);
  });

  test('recognizes a next.js app from package.json deps', () => {
    const d = detect(fix('app-nextjs'));
    expect(d.framework).toBe('nextjs');
    expect(d.firebaseJsonPath).toBeNull();
  });

  test('degrades to unknown, never throws', () => {
    const d = detect(fix('app-unknown'));
    expect(d.framework).toBe('unknown');
    expect(d.rewrites).toEqual([]);
  });
});
