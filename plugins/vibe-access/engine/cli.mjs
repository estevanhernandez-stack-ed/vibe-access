#!/usr/bin/env node
import { resolve, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { detect } from './detect.mjs';
import { scan, writeScanArtifacts } from './scan.mjs';
import { buildManifest, writeManifest } from './map.mjs';

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(rest[i]);
    }
  }
  return { cmd, flags, positional };
}

const { cmd, flags, positional } = parseArgs(process.argv.slice(2));
const appRoot = resolve(flags.app ?? process.cwd());

const COMMANDS = {
  detect() {
    console.log(JSON.stringify(detect(appRoot), null, 2));
  },
  scan() {
    const { inventory, adapterStatus } = scan(appRoot);
    const { invPath, reportPath } = writeScanArtifacts(appRoot, inventory);
    console.log(
      JSON.stringify(
        { adapterStatus, routes: inventory.routes.length, unmapped: inventory.unmapped.length, invPath, reportPath },
        null,
        2
      )
    );
  },
  map() {
    const invPath = join(appRoot, '.vibe-access', 'state', 'inventory.json');
    if (!existsSync(invPath)) throw new Error('no inventory — run scan first');
    const inventory = JSON.parse(readFileSync(invPath, 'utf8'));
    const manifestPath = join(appRoot, 'agent-access.json');
    const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
    const configPath = join(appRoot, '.vibe-access', 'config.json');
    const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : null;
    const baseUrls = config?.baseUrls ?? { dev: flags['base-url'] ?? 'http://localhost:5000' };
    const manifest = buildManifest(inventory, { previous, baseUrls });
    const path = writeManifest(appRoot, manifest);
    console.log(JSON.stringify({ affordances: manifest.affordances.length, path }, null, 2));
  },
  // gaps (Task 9), verify + stamp (Task 11) extend this table.
};

const handler = COMMANDS[cmd];
if (!handler) {
  console.error(`Unknown command: ${cmd ?? '(none)'}. Commands: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(2);
}
try {
  handler();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
