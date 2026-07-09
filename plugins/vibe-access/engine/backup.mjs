import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const backupRoot = (appRoot) => join(appRoot, '.vibe-access', 'scaffold', 'backup');

export function backupFiles(appRoot, relPaths, batchId) {
  const dir = join(backupRoot(appRoot), batchId);
  mkdirSync(dir, { recursive: true });
  const entries = [];
  for (const rel of relPaths) {
    const src = join(appRoot, rel);
    if (!existsSync(src)) continue;
    const dest = join(dir, rel.replaceAll('\\', '/').replaceAll('/', '__'));
    copyFileSync(src, dest);
    entries.push({ rel, stored: dest });
  }
  writeFileSync(join(dir, 'backup-manifest.json'), JSON.stringify({ batchId, entries }, null, 2));
  return dir;
}

export function rollback(appRoot, batchId) {
  const manifestPath = join(backupRoot(appRoot), batchId, 'backup-manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`no backup for batch "${batchId}"`);
  const { entries } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const { rel, stored } of entries) {
    const target = join(appRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(stored, target);
  }
  return entries.map((e) => e.rel);
}
