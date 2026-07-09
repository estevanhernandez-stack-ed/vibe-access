#!/usr/bin/env node
import { resolve, join } from 'node:path';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { detect } from './detect.mjs';
import { scan, writeScanArtifacts } from './scan.mjs';
import { buildManifest, writeManifest } from './map.mjs';
import { evaluateGaps } from './gaps.mjs';
import { runVerify, stampManifest } from './verify.mjs';
import { renderVerifyReport } from './report.mjs';

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
  gaps() {
    const manifestPath = join(appRoot, 'agent-access.json');
    if (!existsSync(manifestPath)) throw new Error('no manifest — run map first');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    console.log(JSON.stringify(evaluateGaps(manifest), null, 2));
  },
  async verify() {
    const manifestPath = join(appRoot, 'agent-access.json');
    if (!existsSync(manifestPath)) throw new Error('no manifest — run map first');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const baseUrl = flags['base-url'] ?? manifest.baseUrls.dev;
    const run = await runVerify(manifest, { baseUrl, force: flags.force === true, runId: randomUUID().slice(0, 8) });
    const runDir = join(appRoot, '.vibe-access', 'verify');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, `run-${run.runId}.json`), JSON.stringify(run, null, 2));
    const stamped = stampManifest(manifest, run);
    writeFileSync(manifestPath, JSON.stringify(stamped, null, 2));
    const docsDir = join(appRoot, 'docs', 'vibe-access');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, `verify-${run.startedAt.slice(0, 10)}.md`), renderVerifyReport(run, stamped));
    console.log(JSON.stringify({ runId: run.runId, results: run.results }, null, 2));
  },
  stamp() {
    const [affordanceId, status] = positional;
    if (!affordanceId || !['pass', 'fail'].includes(status)) {
      throw new Error('usage: vibe-access stamp <affordanceId> <pass|fail> --run <runId> --app <path>');
    }
    const manifestPath = join(appRoot, 'agent-access.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const a = manifest.affordances.find((x) => x.id === affordanceId);
    if (!a) throw new Error(`no affordance "${affordanceId}" in manifest`);
    a.verified = { status, at: new Date().toISOString(), runId: String(flags.run ?? 'manual') };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ stamped: affordanceId, status }, null, 2));
  },
};

const handler = COMMANDS[cmd];
if (!handler) {
  console.error(`Unknown command: ${cmd ?? '(none)'}. Commands: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(2);
}
try {
  await handler();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
