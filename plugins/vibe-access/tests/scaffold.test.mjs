import { describe, test, expect } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cpSync } from 'node:fs';
import { detect } from '../engine/detect.mjs';
import { firebaseFunctionsAdapter } from '../engine/adapters/firebase-functions/index.mjs';
import { applyPlan } from '../engine/scaffold.mjs';

const fixture = fileURLToPath(new URL('./fixtures/app-firebase', import.meta.url));

describe('firebase-functions scaffoldAffordance', () => {
  const ctx = { appRoot: fixture, detection: detect(fixture), config: null };

  test('seed spec plans a gated function file + index export patch + rewrite patch', () => {
    const plan = firebaseFunctionsAdapter.scaffoldAffordance(
      { id: 'agent-seed', kind: 'seed', description: 'Seed data.' },
      ctx
    );
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].path).toMatch(/functions[\\/]src[\\/]agent-access[\\/]agent-seed\.js$/);
    expect(plan.files[0].contents).toContain('vibe-access:dev-gate');
    expect(plan.patches.some((p) => p.path.endsWith('index.js'))).toBe(true);
    expect(plan.patches.some((p) => p.path.endsWith('firebase.json'))).toBe(true);
  });

  test('discovery spec uses the discovery template', () => {
    const plan = firebaseFunctionsAdapter.scaffoldAffordance(
      { id: 'agent-manifest', kind: 'discovery', description: 'Discovery route.' },
      ctx
    );
    expect(plan.files[0].contents).toContain('agent-access.json');
  });
});

describe('applyPlan', () => {
  test('writes new files, defers patches, refuses gateless dev files', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'va-'));
    cpSync(fixture, tmp, { recursive: true });
    try {
      const ctx = { appRoot: tmp, detection: detect(tmp), config: null };
      const plan = firebaseFunctionsAdapter.scaffoldAffordance(
        { id: 'agent-seed', kind: 'seed', description: 'Seed data.' },
        ctx
      );
      const result = applyPlan(tmp, plan, { batchId: 'b1' });
      expect(existsSync(result.written[0])).toBe(true);
      expect(result.pendingPatches.length).toBe(2);

      const gateless = { files: [{ path: 'functions/src/agent-access/bad.js', contents: 'nope' }], patches: [], notes: [] };
      expect(() => applyPlan(tmp, gateless, { batchId: 'b2' })).toThrow(/dev-gate/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
