import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';

// Streamlit inverts the plugin's core assumption: there are no HTTP routes.
// One URL, one websocket, session state. So `routes` carries ONLY the
// scaffolded sidecar's endpoints (the app's real callable surface, present
// after scaffold+apply), and every UI surface — sidebar modes, native
// pages/ — lands in `unmapped` as a first-class finding with a reason that
// says what to do about it. That keeps the inventory schema (http verbs,
// string paths) and buildManifest (every route becomes an http affordance)
// untouched: a UI mode in `routes` would become a manifest affordance an
// agent cannot call, which is a lie. Deviation from the original scope's
// RouteEntry-per-mode sketch — recorded in docs/streamlit-adapter-scope.md.

// Scaffolded sidecar modules self-describe their transport on one line:
//   # vibe-access:route method=POST path=/access/foo
const SIDECAR_ROUTE_RE = /#\s*vibe-access:route\s+method=(GET|POST|PUT|PATCH|DELETE)\s+path=(\S+)/;

// Dispatch arms: `if mode == "Market Mode":` / `elif mode == "Poster Board":`
// The lhs identifier is app-specific; we take the identifier with the most
// string-equality arms (>= 2) as the dispatch variable — a real dispatch
// table compares the same variable repeatedly, stray comparisons don't.
const DISPATCH_ARM_RE = /^\s*(?:el)?if\s+([\w.]+)\s*==\s*["']([^"']+)["']\s*:/;

function readSafe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function parseDispatchArms(entrySource) {
  const byLhs = new Map();
  const lines = entrySource.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = DISPATCH_ARM_RE.exec(lines[i]);
    if (!m) continue;
    const [, lhs, mode] = m;
    if (!byLhs.has(lhs)) byLhs.set(lhs, new Map());
    // First arm wins per mode; a handler is the first call on the arm's
    // following non-empty line (render_x(...) in every observed app).
    if (!byLhs.get(lhs).has(mode)) {
      let handler = null;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const call = /^\s*(?:return\s+)?([\w.]+)\s*\(/.exec(lines[j]);
        if (call) {
          handler = call[1];
          break;
        }
        if (lines[j].trim()) break;
      }
      byLhs.get(lhs).set(mode, { line: i + 1, handler });
    }
  }
  let best = new Map();
  for (const arms of byLhs.values()) {
    if (arms.size > best.size) best = arms;
  }
  return best.size >= 2 ? best : new Map();
}

function findUiConfig(appRoot, entryPath) {
  const candidates = [
    join(dirname(entryPath), 'ui_config.json'),
    join(appRoot, 'ui_config.json'),
    join(appRoot, 'app', 'ui_config.json'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      return { path: p, config: JSON.parse(readFileSync(p, 'utf8')) };
    } catch {
      return { path: p, config: null };
    }
  }
  return null;
}

function sidecarRoutes(appRoot, routes, unmapped) {
  const affDir = join(appRoot, 'access_sidecar', 'affordances');
  if (!existsSync(affDir)) return;
  let names;
  try {
    // Underscore-prefixed modules are helpers by Python convention (_app.py
    // bootstrap, __init__.py) — not affordances, not worth an unmapped flag.
    names = readdirSync(affDir).filter((n) => n.endsWith('.py') && !n.startsWith('_'));
  } catch {
    return;
  }
  for (const n of names.sort()) {
    const p = join(affDir, n);
    const src = readSafe(p);
    const m = src ? SIDECAR_ROUTE_RE.exec(src) : null;
    const ref = relative(appRoot, p);
    if (m) {
      routes.push({
        // Python module names are snake_case; manifest ids allow [a-z0-9.-]
        // only, and map derives id from name — kebab-ize here so agent_seed.py
        // becomes the agent-seed affordance, matching the gaps candidates.
        name: basename(n, '.py').replace(/_/g, '-'),
        method: m[1],
        path: m[2],
        sourceRef: ref,
        handlerSourcePath: p,
        sourceExportName: 'run',
      });
    } else {
      unmapped.push({ sourceRef: ref, reason: 'sidecar module lacks the vibe-access:route marker — not registered as a callable surface' });
    }
  }
}

function uiModes(appRoot, entryPath, unmapped) {
  const entrySrc = readSafe(entryPath);
  const entryRef = relative(appRoot, entryPath);
  if (!entrySrc) {
    unmapped.push({ sourceRef: entryRef, reason: 'entry script unreadable' });
    return;
  }
  const dispatch = parseDispatchArms(entrySrc);
  const ui = findUiConfig(appRoot, entryPath);
  const configModes = Array.isArray(ui?.config?.sidebar_modes)
    ? ui.config.sidebar_modes.map((m) => m?.name).filter(Boolean)
    : [];
  const uiRef = ui ? relative(appRoot, ui.path) : null;

  for (const mode of configModes) {
    const arm = dispatch.get(mode);
    if (arm) {
      unmapped.push({
        sourceRef: `${entryRef}:${arm.line}`,
        reason: `Streamlit UI mode "${mode}" — not HTTP-callable; scaffold a sidecar affordance to expose its logic${arm.handler ? ` (handler: ${arm.handler})` : ''}`,
      });
    } else {
      unmapped.push({
        sourceRef: uiRef ?? entryRef,
        reason: `mode "${mode}" is configured but has no dispatch arm in ${basename(entryPath)} — config/dispatch drift`,
      });
    }
  }
  for (const [mode, arm] of dispatch) {
    if (!configModes.includes(mode)) {
      unmapped.push({
        sourceRef: `${entryRef}:${arm.line}`,
        reason: configModes.length
          ? `dispatch arm for "${mode}" has no ui_config.json entry — config/dispatch drift`
          : `Streamlit UI mode "${mode}" — not HTTP-callable; scaffold a sidecar affordance to expose its logic${arm.handler ? ` (handler: ${arm.handler})` : ''}`,
      });
    }
  }
}

function nativePages(appRoot, entryPath, unmapped) {
  const dirs = [join(appRoot, 'pages')];
  if (entryPath) dirs.push(join(dirname(entryPath), 'pages'));
  const seen = new Set();
  for (const dir of dirs) {
    if (seen.has(dir.toLowerCase()) || !existsSync(dir)) continue;
    seen.add(dir.toLowerCase());
    let names;
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.py'));
    } catch {
      continue;
    }
    for (const n of names.sort()) {
      unmapped.push({
        sourceRef: relative(appRoot, join(dir, n)),
        reason: `Streamlit page "${basename(n, '.py')}" — not HTTP-callable; scaffold a sidecar affordance to expose its logic`,
      });
    }
  }
}

export function detectRoutes(ctx) {
  const { appRoot, detection } = ctx;
  const routes = [];
  const unmapped = [];

  sidecarRoutes(appRoot, routes, unmapped);

  const entry = detection?.streamlitEntry ?? null;
  if (entry && existsSync(entry)) {
    uiModes(appRoot, entry, unmapped);
  } else {
    unmapped.push({
      sourceRef: detection?.requirementsPath ? relative(appRoot, detection.requirementsPath) : 'requirements.txt',
      reason: 'streamlit dependency declared but no entry script importing streamlit was found',
    });
  }
  nativePages(appRoot, entry, unmapped);

  return { routes, unmapped };
}
