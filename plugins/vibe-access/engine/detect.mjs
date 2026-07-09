import { existsSync, readFileSync } from 'node:fs';
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

export function detect(appRoot) {
  const detection = {
    framework: 'unknown',
    appRoot,
    firebaseJsonPath: null,
    functionsDir: null,
    rewrites: [],
    packageJsons: collectPackageJsons(appRoot),
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
