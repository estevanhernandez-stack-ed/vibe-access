import { describe, test, expect } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import { scan } from '../engine/scan.mjs';
import { validateInventory } from '../engine/schema.mjs';
import { renderScanReport } from '../engine/report.mjs';

const appRoot = fileURLToPath(new URL('./fixtures/app-firebase', import.meta.url));
const NOW = '2026-07-09T12:00:00.000Z';

describe('scan', () => {
  test('produces a schema-valid inventory for a firebase app', () => {
    const { inventory, adapterStatus } = scan(appRoot, { now: NOW });
    expect(adapterStatus).toBe('ready');
    expect(validateInventory(inventory).errors).toEqual([]);
    expect(inventory.routes.length).toBeGreaterThanOrEqual(2);
    expect(inventory.unmapped.length).toBeGreaterThanOrEqual(2);
  });

  test('unknown stack yields empty routes, not-yet-implemented, no throw', () => {
    const unknownRoot = fileURLToPath(new URL('./fixtures/app-unknown', import.meta.url));
    const { inventory, adapterStatus } = scan(unknownRoot, { now: NOW });
    expect(adapterStatus).toBe('not-yet-implemented');
    expect(inventory.routes).toEqual([]);
  });

  test('scan report names every unmapped entry', () => {
    const { inventory } = scan(appRoot, { now: NOW });
    const md = renderScanReport(inventory);
    expect(md).toContain('ghostFunction');
    expect(md).toContain('orphanFunction');
    expect(md).toContain('## Unmapped');
  });
});
