import { readFileSync } from 'node:fs';

const load = (name) =>
  readFileSync(new URL(`./templates/${name}.template`, import.meta.url), 'utf8');

const snake = (kebabId) => kebabId.replace(/-/g, '_');

const GATE_MARKER = 'vibe-access:dev-gate';

// The plan is additive-only: the sidecar is new files next to the app, never
// an edit inside it — hence patches is always empty (decision recorded in
// docs/streamlit-adapter-scope.md: requirements changes are note-only).
export function scaffoldAffordance(spec, ctx) {
  const isDiscovery = spec.kind === 'discovery';
  const port = ctx?.config?.sidecarPort ?? 8765;
  const appName = ctx?.config?.appName ?? 'app';
  const shortId = spec.id.replace(/^agent-/, '');
  const routePath = isDiscovery ? '/access/manifest' : `/access/${shortId}`;
  const method = isDiscovery || spec.kind === 'read-state' || spec.kind === 'read' ? 'GET' : 'POST';

  const template = isDiscovery ? load('discovery.py') : load('affordance.py');
  const contents = template
    .replaceAll('__DESCRIPTION__', spec.description)
    .replaceAll('__KIND__', spec.kind)
    .replaceAll('__ID__', spec.id)
    .replaceAll('__METHOD__', method)
    .replaceAll('__PATH__', routePath)
    .replaceAll('__FUNC_NAME__', snake(shortId));

  const api = load('access_api.py')
    .replaceAll('__APP_NAME__', appName)
    .replaceAll('__PORT__', String(port));

  return {
    files: [
      {
        path: 'access_sidecar/__init__.py',
        contents: `# ${GATE_MARKER} — vibe-access sidecar package; access_api refuses to boot without VIBE_ACCESS_DEV=1\n`,
      },
      { path: 'access_sidecar/access_api.py', contents: api },
      {
        path: 'access_sidecar/affordances/__init__.py',
        contents: `# ${GATE_MARKER} — affordance modules; served only by the dev sidecar\n`,
      },
      { path: `access_sidecar/affordances/${snake(spec.id)}.py`, contents },
    ],
    patches: [],
    notes: [
      'dev-gated: sidecar refuses to boot unless VIBE_ACCESS_DEV=1; bind 127.0.0.1 only',
      `run: VIBE_ACCESS_DEV=1 uvicorn access_sidecar.access_api:app --host 127.0.0.1 --port ${port}`,
      "deps (add to the app's requirements yourself — never patched): fastapi, uvicorn",
      `manifest baseUrls.dev must point at the sidecar origin: http://127.0.0.1:${port}`,
      `route: ${method} ${routePath}`,
      'prod deployment of the sidecar is out of scope',
    ],
  };
}
