import { readFileSync } from 'node:fs';

const load = (name) =>
  readFileSync(new URL(`./templates/${name}.template`, import.meta.url), 'utf8');

const camel = (kebabId) => kebabId.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

export function scaffoldAffordance(spec, ctx) {
  const isDiscovery = spec.kind === 'discovery';
  const exportName = isDiscovery ? 'agentManifest' : camel(spec.id);
  const routePath = isDiscovery ? '/api/agent/manifest' : `/api/agent/${spec.id.replace(/^agent-/, '')}`;
  const template = isDiscovery ? load('discovery.cjs') : load('affordance.cjs');
  const contents = template
    .replaceAll('__DESCRIPTION__', spec.description)
    .replaceAll('__EXPORT_NAME__', exportName)
    .replaceAll('__KIND__', spec.kind)
    .replaceAll('__ID__', spec.id);

  return {
    files: [{ path: `functions/src/agent-access/${spec.id}.js`, contents }],
    patches: [
      {
        path: 'functions/index.js',
        anchor: 'end-of-file',
        insert: `exports.${exportName} = require('./src/agent-access/${spec.id}').${exportName};\n`,
        note: 'append the export line',
      },
      {
        path: 'firebase.json',
        anchor: 'hosting.rewrites before the ** catch-all',
        insert: JSON.stringify({ source: routePath, function: exportName }),
        note: 'insert the rewrite entry before the SPA fallback',
      },
    ],
    notes: [
      `dev-gated: 404s unless FUNCTIONS_EMULATOR/AGENT_ACCESS says dev`,
      `route: POST ${routePath}`,
    ],
  };
}
