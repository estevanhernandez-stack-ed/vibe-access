import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// Single-statement re-export form: exports.foo = require('./path').foo;
const INLINE_EXPORT_RE = /exports\.(\w+)\s*=\s*require\((['"])(.+?)\2\)(?:\.(\w+))?/g;
// Two-statement re-export form, module bindings: const mod = require('./path');
const REQUIRE_BINDING_RE = /(?:const|let|var)\s+(\w+)\s*=\s*require\((['"])(.+?)\2\)/g;
// Two-statement re-export form, the export line: exports.foo = mod.foo (semicolon optional, ASI).
const BINDING_EXPORT_RE = /exports\.(\w+)\s*=\s*(\w+)\.(\w+)\s*;?/g;
const READ_NAME_RE = /^(get|list|my|fetch)|Data$/;

function parseIndexExports(functionsDir) {
  const indexPath = join(functionsDir, 'index.js');
  if (!existsSync(indexPath)) return { exportsMap: new Map(), indexPath: null };
  const text = readFileSync(indexPath, 'utf8');
  const exportsMap = new Map();

  const resolveRequirePath = (requirePath) => {
    let resolved = join(functionsDir, requirePath);
    if (!existsSync(resolved) && existsSync(`${resolved}.js`)) resolved = `${resolved}.js`;
    return existsSync(resolved) ? resolved : null;
  };

  // Pass 1: single-statement form — exports.foo = require('./path').foo;
  for (const m of text.matchAll(INLINE_EXPORT_RE)) {
    const [, indexExportName, , requirePath, sourceExportName] = m;
    exportsMap.set(indexExportName, {
      filePath: resolveRequirePath(requirePath),
      exportName: sourceExportName || indexExportName,
    });
  }

  // Pass 2: two-statement form — const mod = require('./path'); exports.foo = mod.foo;
  const bindings = new Map();
  for (const m of text.matchAll(REQUIRE_BINDING_RE)) {
    const [, ident, , requirePath] = m;
    bindings.set(ident, resolveRequirePath(requirePath));
  }
  for (const m of text.matchAll(BINDING_EXPORT_RE)) {
    const [, indexExportName, ident, sourceExportName] = m;
    if (exportsMap.has(indexExportName)) continue; // already resolved via the inline form
    if (!bindings.has(ident)) continue; // `ident` isn't a require() binding — not this pattern
    exportsMap.set(indexExportName, {
      filePath: bindings.get(ident),
      exportName: sourceExportName,
    });
  }

  return { exportsMap, indexPath };
}

export function extractFunctionBody(exportName, source) {
  const lines = source.split('\n');
  const exportRe = new RegExp(`exports\\.${exportName}\\b`);
  let inFunction = false;
  let functionCode = '';
  let braceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inFunction && exportRe.test(line)) {
      inFunction = true;
      functionCode = line;
      braceCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

      // One-liner export (net-zero braces on the match line itself): the
      // statement is fully contained here. Without this check, a one-liner
      // that isn't the last export in the file bleeds into whatever export
      // follows it, inheriting its method guards.
      const trimmed = line.trim();
      const isArrowExpressionBody = /=>/.test(trimmed) && !trimmed.endsWith('{');
      if (braceCount === 0 && (trimmed.endsWith(';') || isArrowExpressionBody)) {
        break;
      }
    } else if (inFunction) {
      functionCode += '\n' + line;
      braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

      if (braceCount === 0 && line.includes('}')) {
        break;
      }
    }
  }

  return functionCode;
}

function inferMethod(name, handlerSource) {
  if (handlerSource && /req\.method\s*===?\s*['"]GET['"]/.test(handlerSource)) return 'GET';
  if (READ_NAME_RE.test(name)) return 'GET';
  return 'POST';
}

export function detectRoutes(ctx) {
  const { detection, appRoot } = ctx;
  const routes = [];
  const unmapped = [];
  const { exportsMap, indexPath } = parseIndexExports(detection.functionsDir);
  const indexRef = indexPath ? relative(appRoot, indexPath) : 'functions/index.js';
  const seenExports = new Set();

  for (const rw of detection.rewrites) {
    if (!rw.function) continue; // SPA fallback / destination rewrites are not API surface
    if (!exportsMap.has(rw.function)) {
      unmapped.push({
        sourceRef: indexRef,
        reason: `rewrite ${rw.source} points at ${rw.function}, which has no export in index.js`,
      });
      continue;
    }
    seenExports.add(rw.function);
    const mapEntry = exportsMap.get(rw.function);
    const handlerSourcePath = mapEntry?.filePath;
    const sourceExportName = mapEntry?.exportName;
    const fileSource = handlerSourcePath ? readFileSync(handlerSourcePath, 'utf8') : null;
    const handlerSource = fileSource && sourceExportName ? extractFunctionBody(sourceExportName, fileSource) : null;
    routes.push({
      name: rw.function,
      method: inferMethod(rw.function, handlerSource),
      path: rw.source,
      sourceRef: handlerSourcePath ? relative(appRoot, handlerSourcePath) : indexRef,
      handlerSourcePath,
    });
  }

  for (const [exportName] of exportsMap) {
    if (!seenExports.has(exportName)) {
      unmapped.push({
        sourceRef: indexRef,
        reason: `export ${exportName} has no hosting rewrite — callable only via direct function URL`,
      });
    }
  }
  return { routes, unmapped };
}
