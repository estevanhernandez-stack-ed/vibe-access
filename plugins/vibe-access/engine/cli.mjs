#!/usr/bin/env node
import { resolve } from 'node:path';
import { detect } from './detect.mjs';
import { scan, writeScanArtifacts } from './scan.mjs';

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
  // map (Task 8), gaps (Task 9), verify + stamp (Task 11) extend this table.
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
