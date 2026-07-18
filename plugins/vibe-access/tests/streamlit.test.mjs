import { describe, test, expect } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detect } from '../engine/detect.mjs';
import { resolveAdapter } from '../engine/adapters/index.mjs';
import { streamlitAdapter } from '../engine/adapters/streamlit/index.mjs';
import { scan } from '../engine/scan.mjs';
import { buildManifest } from '../engine/map.mjs';
import { applyPlan } from '../engine/scaffold.mjs';

const fix = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('detect — python probe', () => {
  test('recognizes a streamlit app from requirements.txt + entry script', () => {
    const d = detect(fix('app-streamlit'));
    expect(d.framework).toBe('streamlit');
    expect(d.requirementsPath).toMatch(/requirements\.txt$/);
    expect(d.streamlitEntry).toMatch(/app\.py$/);
  });

  test('dormant frontend/package.json does not outrank streamlit (the PriceScout case)', () => {
    const d = detect(fix('app-streamlit'));
    expect(d.packageJsons.length).toBeGreaterThan(0); // the dormant react experiment IS seen
    expect(d.framework).toBe('streamlit'); // and still loses
  });

  test('firebase + streamlit coexisting resolves firebase-functions', () => {
    const d = detect(fix('app-firebase-streamlit'));
    expect(d.framework).toBe('firebase-functions');
  });

  test('multipage fixture resolves streamlit with the root entry', () => {
    const d = detect(fix('app-streamlit-pages'));
    expect(d.framework).toBe('streamlit');
    expect(d.streamlitEntry).toMatch(/streamlit_app\.py$/);
  });

  test('JS-only apps are untouched by the probe', () => {
    expect(detect(fix('app-nextjs')).framework).toBe('nextjs');
    expect(detect(fix('app-unknown')).framework).toBe('unknown');
  });
});

describe('streamlit adapter — resolution + routes', () => {
  test('streamlit detection resolves ready', () => {
    const r = resolveAdapter({ framework: 'streamlit' });
    expect(r.status).toBe('ready');
    expect(r.adapter.id).toBe('streamlit');
  });

  test('modes land in unmapped as first-class findings, never in routes', () => {
    const appRoot = fix('app-streamlit');
    const found = streamlitAdapter.detectRoutes({ appRoot, detection: detect(appRoot), config: null });
    expect(found.routes).toEqual([]); // pre-scaffold: nothing is HTTP-callable
    const reasons = found.unmapped.map((u) => u.reason);
    expect(reasons.some((r) => r.includes('"Alpha Mode"') && r.includes('render_alpha_mode'))).toBe(true);
    expect(reasons.some((r) => r.includes('"Beta Mode"'))).toBe(true);
    // Ghost Mode is configured but has no dispatch arm — drift, not a UI finding
    expect(reasons.some((r) => r.includes('"Ghost Mode"') && r.includes('drift'))).toBe(true);
  });

  test('native pages/ land in unmapped', () => {
    const appRoot = fix('app-streamlit-pages');
    const found = streamlitAdapter.detectRoutes({ appRoot, detection: detect(appRoot), config: null });
    expect(found.routes).toEqual([]);
    const reasons = found.unmapped.map((u) => u.reason);
    expect(reasons.some((r) => r.includes('"01_dashboard"'))).toBe(true);
    expect(reasons.some((r) => r.includes('"02_admin"'))).toBe(true);
  });

  test('scan end-to-end produces a schema-valid inventory on both fixtures', () => {
    for (const name of ['app-streamlit', 'app-streamlit-pages']) {
      const { inventory, adapterStatus } = scan(fix(name)); // scan throws on invalid
      expect(adapterStatus).toBe('ready');
      expect(inventory.adapter).toBe('streamlit');
      expect(inventory.routes).toEqual([]);
      expect(inventory.unmapped.length).toBeGreaterThan(0);
    }
  });

  test('an empty-routes inventory maps to a valid empty manifest', () => {
    const { inventory } = scan(fix('app-streamlit'));
    const manifest = buildManifest(inventory, { baseUrls: { dev: 'http://127.0.0.1:8765' } });
    expect(manifest.affordances).toEqual([]);
  });

  test('detectAuth is none — the dev gate is the protection, not an auth class', () => {
    expect(streamlitAdapter.detectAuth({}, {})).toBe('none');
  });
});

describe('streamlit adapter — scaffold', () => {
  const seedSpec = { id: 'agent-seed', kind: 'seed', description: 'Seed representative data.' };

  test('every planned file carries the dev-gate marker; patches are empty', () => {
    const plan = streamlitAdapter.scaffoldAffordance(seedSpec, { config: null });
    expect(plan.files.length).toBeGreaterThanOrEqual(4);
    for (const f of plan.files) {
      expect(f.contents).toContain('vibe-access:dev-gate');
    }
    expect(plan.patches).toEqual([]);
  });

  test('kinds map to transports: seed POST, read-state GET, discovery GET manifest', () => {
    const seed = streamlitAdapter.scaffoldAffordance(seedSpec, { config: null });
    expect(seed.notes.join('\n')).toContain('POST /access/seed');
    const read = streamlitAdapter.scaffoldAffordance(
      { id: 'agent-state', kind: 'read-state', description: 'Read state.' }, { config: null });
    expect(read.notes.join('\n')).toContain('GET /access/state');
    const disc = streamlitAdapter.scaffoldAffordance(
      { id: 'agent-manifest', kind: 'discovery', description: 'Serve the manifest.' }, { config: null });
    expect(disc.notes.join('\n')).toContain('GET /access/manifest');
    expect(disc.files.some((f) => f.path.endsWith('agent_manifest.py'))).toBe(true);
  });

  test('sidecarPort from config lands in the run note and the api template', () => {
    const plan = streamlitAdapter.scaffoldAffordance(seedSpec, { config: { sidecarPort: 9001, appName: 'Fixture' } });
    expect(plan.notes.join('\n')).toContain('--port 9001');
    const api = plan.files.find((f) => f.path.endsWith('access_api.py'));
    expect(api.contents).toContain('--port 9001');
    expect(api.contents).toContain('Fixture');
  });

  test('applied plan round-trips: detectRoutes finds the sidecar endpoint', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'va-streamlit-'));
    const plan = streamlitAdapter.scaffoldAffordance(seedSpec, { config: null });
    applyPlan(tmp, plan, { batchId: 'test' });
    expect(existsSync(join(tmp, 'access_sidecar', 'affordances', 'agent_seed.py'))).toBe(true);
    const found = streamlitAdapter.detectRoutes({ appRoot: tmp, detection: { streamlitEntry: null }, config: null });
    const route = found.routes.find((r) => r.path === '/access/seed');
    expect(route).toBeDefined();
    expect(route.method).toBe('POST');
    expect(route.sourceRef).toMatch(/agent_seed\.py$/);
  });
});
