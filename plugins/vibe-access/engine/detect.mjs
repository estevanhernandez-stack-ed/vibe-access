import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function collectPackageJsons(appRoot) {
  const candidates = ['', 'frontend', 'functions', 'Backend', 'backend', 'web', 'app'];
  const seen = new Set();
  const result = [];
  for (const d of candidates) {
    const p = join(appRoot, d, 'package.json');
    if (!existsSync(p)) continue;
    // On case-insensitive filesystems (Windows/macOS default), 'Backend' and
    // 'backend' can resolve to the same file — dedupe by lowercased path so
    // callers never see the same package.json twice.
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(p);
  }
  return result;
}

function depsOf(pkgPath) {
  const pkg = readJsonSafe(pkgPath) ?? {};
  return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
}

function readTextSafe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

// Python probe: a streamlit dependency plus an entry script that imports it.
// Scans appRoot, app/, src/ one level deep only — detect stays fast. The entry
// calling st.set_page_config wins over a bare import (multi-file apps import
// streamlit everywhere; only the entry configures the page).
function detectStreamlit(appRoot) {
  const reqPath = join(appRoot, 'requirements.txt');
  const pyprojectPath = join(appRoot, 'pyproject.toml');
  const reqText = existsSync(reqPath) ? readTextSafe(reqPath) : null;
  const pyprojectText = existsSync(pyprojectPath) ? readTextSafe(pyprojectPath) : null;
  const hasReq = reqText !== null && /^\s*streamlit\b/im.test(reqText);
  const hasPyproject = pyprojectText !== null && /\bstreamlit\b/.test(pyprojectText);
  if (!hasReq && !hasPyproject) return null;

  let entry = null;
  let fallback = null;
  for (const d of ['', 'app', 'src']) {
    const dir = join(appRoot, d);
    if (!existsSync(dir)) continue;
    let names;
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.py'));
    } catch {
      continue;
    }
    for (const n of names) {
      const p = join(dir, n);
      try {
        if (statSync(p).isDirectory()) continue;
      } catch {
        continue;
      }
      const src = readTextSafe(p);
      if (!src || !/^\s*(import streamlit\b|from streamlit\b)/m.test(src)) continue;
      if (/set_page_config\s*\(/.test(src)) {
        if (!entry) entry = p;
      } else if (!fallback) {
        fallback = p;
      }
    }
    if (entry) break;
  }
  return {
    requirementsPath: hasReq ? reqPath : null,
    pyprojectPath: hasPyproject ? pyprojectPath : null,
    streamlitEntry: entry ?? fallback,
  };
}

export function detect(appRoot) {
  const detection = {
    framework: 'unknown',
    appRoot,
    firebaseJsonPath: null,
    functionsDir: null,
    rewrites: [],
    packageJsons: collectPackageJsons(appRoot),
    requirementsPath: null,
    pyprojectPath: null,
    streamlitEntry: null,
  };

  const fbPath = join(appRoot, 'firebase.json');
  const fb = existsSync(fbPath) ? readJsonSafe(fbPath) : null;
  if (fb) {
    detection.firebaseJsonPath = fbPath;
    const hosting = Array.isArray(fb.hosting) ? fb.hosting[0] : fb.hosting;
    detection.rewrites = hosting?.rewrites ?? [];
    const fnSource = Array.isArray(fb.functions) ? fb.functions[0]?.source : fb.functions?.source;
    const fnDir = join(appRoot, fnSource ?? 'functions');
    if (existsSync(fnDir)) {
      detection.functionsDir = fnDir;
      detection.framework = 'firebase-functions';
      return detection;
    }
  }

  // Streamlit outranks the JS-deps walk: a Python app with a dormant
  // frontend/package.json (react experiment, abandoned scaffold) must resolve
  // 'streamlit', not fall through to a JS framework or 'unknown'. Firebase's
  // early return above still wins when both coexist.
  const py = detectStreamlit(appRoot);
  if (py) {
    detection.requirementsPath = py.requirementsPath;
    detection.pyprojectPath = py.pyprojectPath;
    detection.streamlitEntry = py.streamlitEntry;
    detection.framework = 'streamlit';
    return detection;
  }

  for (const pkgPath of detection.packageJsons) {
    const deps = depsOf(pkgPath);
    if (deps.next) {
      detection.framework = 'nextjs';
      return detection;
    }
    if (deps.express) {
      detection.framework = 'express';
      return detection;
    }
  }
  return detection;
}
