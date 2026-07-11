import { basename, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { detect } from './detect.mjs';
import { resolveAdapter } from './adapters/index.mjs';
import { validateInventory } from './schema.mjs';
import { renderScanReport } from './report.mjs';

export function scan(appRoot, { now } = {}) {
  const detection = detect(appRoot);
  const resolved = resolveAdapter(detection);
  const ctx = { appRoot, detection, config: null };

  let routes = [];
  let unmapped = [];
  if (resolved.status === 'ready') {
    const found = resolved.adapter.detectRoutes(ctx);
    routes = found.routes.map((r) => {
      // §13.1 — optional and additive. An adapter without a miner, or a handler that
      // reads no input, simply carries no inputShape; a shape-free inventory validates.
      const inputShape = resolved.adapter.detectInputShape?.(r, ctx) ?? null;
      return {
        name: r.name,
        method: r.method,
        path: r.path,
        sourceRef: r.sourceRef,
        auth: resolved.adapter.detectAuth(r, ctx),
        ...(inputShape ? { inputShape } : {}),
      };
    });
    unmapped = found.unmapped;
  }

  const inventory = {
    schemaVersion: 1,
    app: basename(appRoot),
    adapter: resolved.framework,
    generatedAt: now ?? new Date().toISOString(),
    routes,
    unmapped,
  };
  const check = validateInventory(inventory);
  if (!check.valid) throw new Error(`scan produced invalid inventory: ${check.errors.join('; ')}`);
  return { inventory, adapterStatus: resolved.status };
}

export function writeScanArtifacts(appRoot, inventory) {
  const stateDir = join(appRoot, '.vibe-access', 'state');
  const docsDir = join(appRoot, 'docs', 'vibe-access');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
  const invPath = join(stateDir, 'inventory.json');
  writeFileSync(invPath, JSON.stringify(inventory, null, 2));
  const day = inventory.generatedAt.slice(0, 10);
  const reportPath = join(docsDir, `scan-${day}.md`);
  writeFileSync(reportPath, renderScanReport(inventory));
  return { invPath, reportPath };
}
