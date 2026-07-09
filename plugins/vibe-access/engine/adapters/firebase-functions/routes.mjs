import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

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

// Node-style require resolution (bare path -> .js suffix -> dir/index.js),
// relative to an arbitrary base directory. Shared by the top-level index.js
// resolution and by chaseReexportBarrel's recursive hop into a barrel file's
// own requires (which are relative to *that file's* directory, not
// functionsDir).
function resolveRequireFrom(baseDir, requirePath) {
  let resolved = join(baseDir, requirePath);

  if (!existsSync(resolved) && existsSync(`${resolved}.js`)) {
    resolved = `${resolved}.js`;
  }

  if (!existsSync(resolved)) {
    return null;
  }

  try {
    if (statSync(resolved).isDirectory()) {
      const indexPath = join(resolved, 'index.js');
      if (existsSync(indexPath)) {
        resolved = indexPath;
      } else {
        return null;
      }
    }
  } catch {
    return null;
  }

  return resolved;
}

// A directory require (`require('./foo')`) resolves to `foo/index.js`, but
// that index.js is sometimes itself a pure pass-through barrel — it doesn't
// define the export, it destructure-imports it from a sibling file and
// re-exports it unchanged (e.g. `const {x} = require('./impl'); module.exports
// = {x};`). Left alone, extraction reads the barrel file, finds no
// declaration, and returns '' — silently degrading auth detection to 'none'
// even though the real handler (in `impl`) has an auth check. Chase through
// up to 5 hops of this shape until we land on a file that actually declares
// the export, or run out of chain to follow.
function isDirectlyDefined(name, source) {
  return buildNameCandidates(name).some((re) => re.test(source));
}

function chaseReexportBarrel(filePath, exportName, depth = 0) {
  if (!filePath || !exportName || depth > 5) return filePath;
  let source;
  try {
    source = readFileSync(filePath, 'utf8');
  } catch {
    return filePath;
  }
  if (isDirectlyDefined(exportName, source)) return filePath;

  // Destructured re-export of this specific name: `const {exportName} =
  // require('./impl')` (possibly alongside other destructured names).
  const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const destructureRe = new RegExp(
    `\\{[^}]*\\b${escaped}\\b[^}]*\\}\\s*=\\s*require\\((['"])(.+?)\\1\\)`
  );
  const match = destructureRe.exec(source);
  if (!match) return filePath; // not the barrel shape — degrade to original, unchanged behavior

  const nextPath = resolveRequireFrom(dirname(filePath), match[2]);
  if (!nextPath || nextPath === filePath) return filePath; // no further file, or self-loop

  return chaseReexportBarrel(nextPath, exportName, depth + 1);
}

function parseIndexExports(functionsDir) {
  const indexPath = join(functionsDir, 'index.js');
  if (!existsSync(indexPath)) return { exportsMap: new Map(), indexPath: null };
  const text = readFileSync(indexPath, 'utf8');
  const exportsMap = new Map();

  const resolveRequirePath = (requirePath) => resolveRequireFrom(functionsDir, requirePath);

  // Pass 1: single-statement form — exports.foo = require('./path').foo;
  for (const m of text.matchAll(INLINE_EXPORT_RE)) {
    const [, indexExportName, , requirePath, sourceExportName] = m;
    const exportName = sourceExportName || indexExportName;
    exportsMap.set(indexExportName, {
      filePath: chaseReexportBarrel(resolveRequirePath(requirePath), exportName),
      exportName,
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
      filePath: chaseReexportBarrel(bindings.get(ident), sourceExportName),
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
    // Any const/let/var declaration of this name, regardless of RHS shape.
    // Covers bare function/arrow expressions AND wrapper-call forms like
    // `const submitScore = onRequest({ cors: true }, async (req, res) => {`
    // (Cloud Functions v2's onRequest/onCall wrap the real handler as an
    // argument rather than assigning it directly) — the brace-counting scan
    // below consumes the whole statement regardless of which shape it is.
    new RegExp(`(?:const|let|var)\\s+${name}\\b\\s*=`),
  ];
}

// Advances the running (parens + braces) depth by one character at a time
// and latches `seenOpen` once depth has gone positive at least once. Counting
// per character (rather than net-per-line) is what lets a line like
// `{cors: ALLOWED_ORIGINS},` — which nets to zero braces on its own but sits
// between an unclosed wrapper-call paren and the callback body — carry the
// outstanding depth through instead of falsely reading as "back to zero."
function advanceDepth(line, state) {
  for (const ch of line) {
    if (ch === '(' || ch === '{') state.depth++;
    else if (ch === ')' || ch === '}') state.depth--;
    if (state.depth > 0) state.seenOpen = true;
  }
}

export function extractFunctionBody(exportName, source) {
  const resolvedName = resolveExportAlias(exportName, source);
  const lines = source.split('\n');

  for (const exportRe of buildNameCandidates(resolvedName)) {
    let inFunction = false;
    let functionCode = '';
    let matched = false;
    const state = { depth: 0, seenOpen: false };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!inFunction && exportRe.test(line)) {
        matched = true;
        inFunction = true;
        functionCode = line;
        state.depth = 0;
        state.seenOpen = false;
        advanceDepth(line, state);

        const trimmed = line.trim();
        // The match line never opened a paren or brace at all (e.g. a plain
        // re-export like `exports.a = b.c;`) — there's nothing for the
        // depth-based rule below to ever close, so terminate here directly.
        // Preserves the pre-existing single-line re-export behavior.
        if (!state.seenOpen && trimmed.endsWith(';')) {
          break;
        }

        // Everything the match line opened (call parens, arrow params,
        // object-literal braces, an arrow's own `{ ... }` body) closed again
        // by the end of the same line — a true one-liner. Without this, a
        // one-liner that isn't the last export in the file would bleed into
        // whatever export follows it, inheriting its method guards.
        if (state.seenOpen && state.depth === 0) {
          break;
        }
      } else if (inFunction) {
        functionCode += '\n' + line;
        advanceDepth(line, state);

        // Depth returned to zero after having gone positive at some point
        // since the match line: every paren/brace opened from the match
        // line onward (wrapper-call args, options-object lines, the
        // callback body) is now closed. Terminate inclusive of this line.
        if (state.seenOpen && state.depth === 0) {
          break;
        }
      }
    }

    if (matched) return functionCode;
  }

  return '';
}

// Matches both the positive guard (`req.method === "<M>"`) and the
// reject-others guard (`req.method !== "<M>"` early-returning/405-ing on
// anything but <M>) for any of the transport methods the manifest schema
// accepts — both shapes are body evidence the route is <M>-only. Quote style
// is app-dependent (single or double), so both are accepted. Capture group 1
// carries the method so callers can read it off directly instead of guessing
// from which literal regex matched.
const METHOD_GUARD_RE = /req\.method\s*(?:===?|!==)\s*["'](GET|POST|PUT|PATCH|DELETE)["']/;

// Body evidence always beats the NAME heuristic: a handler's own req.method
// guard is ground truth about what it actually accepts, whereas the name
// heuristic (READ_NAME_RE) is a guess that false-positives on names like
// ingestBoxOfficeData / calculateResultsWithRealData — POST-only handlers
// whose name happens to end in "Data" (task-15-phase2-report.md, the
// WeSeeYouAtTheMovies dogfood finding). Only fall back to the name heuristic
// when the body yields no method evidence at all (or there's no body to read).
function inferMethod(name, handlerSource) {
  if (handlerSource) {
    const match = METHOD_GUARD_RE.exec(handlerSource);
    if (match) return match[1];
  }
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
