import { describe, test, expect } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
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

  test('discovery template resolves the manifest path to the app root, not functions/src', () => {
    const plan = firebaseFunctionsAdapter.scaffoldAffordance(
      { id: 'agent-manifest', kind: 'discovery', description: 'Discovery route.' },
      ctx
    );
    const filePath = plan.files[0].path;
    expect(filePath).toMatch(/functions[\\/]src[\\/]agent-access[\\/]agent-manifest\.js$/);

    // Pull the exact join(__dirname, ...) call the template runs at load time,
    // rather than just asserting the string 'agent-access.json' appears somewhere.
    const joinCall = plan.files[0].contents.match(/join\(__dirname,\s*([^)]+)\)/);
    expect(joinCall).not.toBeNull();
    const args = joinCall[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    const manifestFileName = args[args.length - 1];
    const upSegments = args.slice(0, -1);

    // The generated file lives at <appRoot>/functions/src/agent-access/agent-manifest.js —
    // its __dirname at runtime is <appRoot>/functions/src/agent-access.
    const generatedFileDir = join(ctx.appRoot, dirname(filePath));
    const resolvedManifestPath = join(generatedFileDir, ...upSegments, manifestFileName);

    expect(resolvedManifestPath).toBe(join(ctx.appRoot, 'agent-access.json'));
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
