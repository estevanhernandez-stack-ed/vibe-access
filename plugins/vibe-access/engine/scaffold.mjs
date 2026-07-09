import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { backupFiles } from './backup.mjs';

const GATE_MARKER = 'vibe-access:dev-gate';

export function applyPlan(appRoot, plan, { batchId }) {
  for (const f of plan.files) {
    if (!f.contents.includes(GATE_MARKER)) {
      throw new Error(
        `refusing to apply: planned file ${f.path} lacks the ${GATE_MARKER} marker — dev-tier scaffolds must be gated`
      );
    }
  }
  const backupDir = backupFiles(appRoot, plan.patches.map((p) => p.path), batchId);
  const written = [];
  for (const f of plan.files) {
    const abs = join(appRoot, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.contents);
    written.push(abs);
  }
  return { written, pendingPatches: plan.patches, backupDir };
}
