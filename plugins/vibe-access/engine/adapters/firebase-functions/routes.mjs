import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Single-statement re-export form: exports.foo = require('./path').foo;
const INLINE_EXPORT_RE = /exports\.(\w+)\s*=\s*require\((['"])(.+?)\2\)(?:\.(\w+))?/g;
// Two-statement re-export form, module bindings: const mod = require('./path');
const REQUIRE_BINDING_RE = /(?:const|let|var)\s+(\w+)\s*=\s*require\((['"])(.+?)\2\)/g;
// Two-statement re-export form, the export line: exports.foo = mod.foo (semicolon optional, ASI).
const BINDING_EXPORT_RE = /exports\.(\w+)\s*=\s*(\w+)\.(\w+)\s*;?/g;
const READ_NAME_RE = /^(get|list|my|fetch)|Data$/;
// Bulk export block: module.exports = { a, b: c, ... }; — matched non-greedily
// up to the first closing brace, which holds for the flat (non-nested) object
// literal shape every handler file in practice uses.
const MODULE_EXPORTS_BLOCK_RE = /module\.exports\s*=\s*\{([\s\S]*?)\}/;

function parseIndexExports(functionsDir) {
  const indexPath = join(functionsDir, 'index.js');
  if (!existsSync(indexPath)) return { exportsMap: new Map(), indexPath: null };
  const text = readFileSync(indexPath, 'utf8');
  const exportsMap = new Map();

  const resolveRequirePath = (requirePath) => {
    let resolved = join(functionsDir, requirePath);

    // If the bare path doesn't exist, try .js suffix
    if (!existsSync(resolved) && existsSync(`${resolved}.js`)) {
      resolved = `${resolved}.js`;
    }

    if (!existsSync(resolved)) {
      return null;
    }

    // If resolved is a directory, Node's module resolution would look for <dir>/index.js
    try {
      if (statSync(resolved).isDirectory()) {
        const indexPath = join(resolved, 'index.js');
        // Only accept the directory if index.js exists; otherwise degrade gracefully
        if (existsSync(indexPath)) {
          resolved = indexPath;
        } else {
          // Directory exists but no index.js — degrade to null instead of throwing
          return null;
        }
      }
    } catch {
      // If stat fails (permissions, etc.), degrade gracefully
      return null;
    }

    return resolved;
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

// Bulk-export files (module.exports = { getProfile, feedAlias: publicFeed })
// let the export name the caller asks for point at a differently-named local
// declaration. Resolve that alias before hunting for the definition so the
// brace-counting scan below runs against the function that actually owns the
// body, not a name that never appears as a declaration.
function resolveExportAlias(exportName, source) {
  const block = MODULE_EXPORTS_BLOCK_RE.exec(source);
  if (!block) return exportName;

  for (const rawEntry of block[1].split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const aliasMatch = entry.match(/^(\w+)\s*:\s*(\w+)$/);
    if (aliasMatch && aliasMatch[1] === exportName) {
      return aliasMatch[2];
    }
  }

  return exportName; // shorthand entry, or no entry found — name is unchanged
}

// Match starts tried in priority order for a given (already alias-resolved)
// name. Handler files don't only use `exports.foo = ...` (that's the shape
// functions/index.js re-exports in) — they also declare plain functions and
// export them in bulk at the bottom of the file, so the definition site can
// be a function declaration or a const/let/var function expression instead.
function buildNameCandidates(name) {
  return [
    new RegExp(`exports\\.${name}\\b`),
    new RegExp(`(?:async\\s+)?function\\s+${name}\\b\\s*\\(`),
    new RegExp(`(?:const|let|var)\\s+${name}\\b\\s*=\\s*(?:async\\s*)?(?:\\(|function\\b)`),
  ];
}

export function extractFunctionBody(exportName, source) {
  const resolvedName = resolveExportAlias(exportName, source);
  const lines = source.split('\n');

  for (const exportRe of buildNameCandidates(resolvedName)) {
    let inFunction = false;
    let functionCode = '';
    let braceCount = 0;
    let matched = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!inFunction && exportRe.test(line)) {
        matched = true;
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

    if (matched) return functionCode;
  }

  return '';
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
    // Defensive: handlerSourcePath should never be a directory after the fix, but handle it gracefully
    let fileSource = null;
    if (handlerSourcePath) {
      try {
        // Guard against EISDIR: skip if path is actually a directory (shouldn't happen, but be safe)
        if (!statSync(handlerSourcePath).isDirectory()) {
          fileSource = readFileSync(handlerSourcePath, 'utf8');
        }
      } catch {
        // If we can't read it (permissions, deleted file, etc.), treat as unresolvable
        fileSource = null;
      }
    }
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
