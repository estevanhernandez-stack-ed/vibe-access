// §13.1 — input-shape mining.
//
// The honesty rule governs every line below: NOTHING IS INVENTED. A handler that
// reads no input yields no shape. A property whose type the source never states
// stays `unknown` — it never gets guessed from its name. Requiredness is only ever
// claimed when a validator schema states it; a shape mined from bare reads carries
// no `required` array at all, and the renderer prints "unstated" for those rows
// rather than the lie "optional".
//
// Regex + brace-counting, same discipline as route detection. No new runtime deps.

import { readFileSync } from 'node:fs';
import { extractFunctionBody } from './routes.mjs';

const REQ = '(?:req|request)';

// `const { a, b: c, d = 1, ...rest } = req.body`
const DESTRUCTURE_RE = new RegExp(
  `(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*${REQ}\\s*\\??\\.\\s*(body|query|params)\\b`,
  'g'
);
// `req.body.userId`, `req.body?.words`
const DOT_READ_RE = new RegExp(
  `\\b${REQ}\\s*\\??\\.\\s*(body|query|params)\\s*(?:\\?\\.|\\.)\\s*([A-Za-z_$][\\w$]*)`,
  'g'
);
// `req.body['movieId']`
const BRACKET_READ_RE = new RegExp(
  `\\b${REQ}\\s*\\??\\.\\s*(body|query|params)\\s*\\??\\[\\s*['"]([^'"]+)['"]\\s*\\]`,
  'g'
);

// `<Ident>.parse(req.body)` / `.safeParse(...)` / `.validate(...)` / `.validateAsync(...)`
const NAMED_VALIDATE_RE = new RegExp(
  `([A-Za-z_$][\\w$]*)\\s*\\.\\s*(?:parse|safeParse|parseAsync|validate|validateAsync)\\s*\\(\\s*${REQ}\\s*\\??\\.\\s*(body|query|params)\\b`,
  'g'
);

const SOURCE_TO_IN = { body: 'body', query: 'query', params: 'path' };

// Which request slot an inline validator object validates. The `.parse(req.X)` /
// `.validate(req.X)` call that consumes it says so; absent that, body is the
// firebase-functions norm and the tag says `body`.
function validatorTarget(source, start) {
  const tail = source.slice(start);
  const m = new RegExp(
    `\\.\\s*(?:parse|safeParse|parseAsync|validate|validateAsync)\\s*\\(\\s*${REQ}\\s*\\??\\.\\s*(body|query|params)\\b`
  ).exec(tail);
  return m ? SOURCE_TO_IN[m[1]] : 'body';
}

// Consume a balanced `{ ... }` starting at `open` (index of the `{`). Returns the
// inner text, or null when the braces never close (truncated / unparseable source).
function balancedObject(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

// Split an object literal's body on top-level commas only — so `z.enum(['a','b'])`
// and nested objects survive intact.
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// Type is only ever read OFF the source. An expression the mapping doesn't
// recognize stays `unknown` — the miner does not guess from the key name.
const TYPE_WORDS = {
  string: 'string', uuid: 'string', email: 'string', url: 'string', enum: 'string',
  number: 'number', int: 'number', integer: 'number',
  boolean: 'boolean', bool: 'boolean',
  array: 'array', object: 'object',
};

// The OUTERMOST type call wins — the first one in the expression. `z.array(z.string())`
// is an array whose items happen to be strings, not a string; scanning for `.string(`
// anywhere in the expression would call it one.
function validatorType(expr) {
  const first = /\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(expr);
  if (!first) return 'unknown';
  return TYPE_WORDS[first[1]] ?? 'unknown';
}

const ZOD_OPTIONAL_RE = /\.\s*(?:optional|nullish)\s*\(\s*\)|\.\s*default\s*\(/;
const JOI_REQUIRED_RE = /\.\s*required\s*\(\s*\)/;

function parseValidatorObject(inner, lib, slot) {
  const properties = {};
  const required = [];
  for (const entry of splitTopLevel(inner)) {
    const m = /^(?:['"]?)([A-Za-z_$][\w$-]*)(?:['"]?)\s*:\s*([\s\S]+)$/.exec(entry);
    if (!m) continue;
    const [, key, expr] = m;
    properties[key] = { type: validatorType(expr), 'x-in': slot };
    const isRequired = lib === 'zod' ? !ZOD_OPTIONAL_RE.test(expr) : JOI_REQUIRED_RE.test(expr);
    if (isRequired) required.push(key);
  }
  if (Object.keys(properties).length === 0) return null;
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
}

// The highest-confidence path: a validator schema handed the request. Two shapes —
// inline (`z.object({...}).parse(req.body)`) and named (`const S = z.object({...})`
// declared at module scope, `S.parse(req.body)` inside the handler).
function mineValidator(handlerSource, fileSource) {
  const inline = /\b(z|Joi|joi)\s*\.\s*object\s*\(\s*\{/.exec(handlerSource);
  if (inline) {
    const open = handlerSource.indexOf('{', inline.index + inline[0].length - 1);
    const inner = balancedObject(handlerSource, open);
    if (inner !== null) {
      const lib = inline[1] === 'z' ? 'zod' : 'joi';
      const parsed = parseValidatorObject(inner, lib, validatorTarget(handlerSource, inline.index));
      if (parsed) return { ...parsed, 'x-mined-by': lib };
    }
  }

  NAMED_VALIDATE_RE.lastIndex = 0;
  for (const m of handlerSource.matchAll(NAMED_VALIDATE_RE)) {
    const [, ident, slot] = m;
    const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declRe = new RegExp(
      `(?:const|let|var)\\s+${escaped}\\s*=\\s*(z|Joi|joi)\\s*\\.\\s*object\\s*\\(\\s*\\{`
    );
    const decl = declRe.exec(fileSource ?? '');
    if (!decl) continue;
    const open = fileSource.indexOf('{', decl.index + decl[0].length - 1);
    const inner = balancedObject(fileSource, open);
    if (inner === null) continue;
    const lib = decl[1] === 'z' ? 'zod' : 'joi';
    const parsed = parseValidatorObject(inner, lib, SOURCE_TO_IN[slot]);
    if (parsed) return { ...parsed, 'x-mined-by': lib };
  }
  return null;
}

// The fallback: what the handler actually reaches for. Names only — types stay
// unknown, requiredness is never claimed.
function mineReads(handlerSource) {
  const properties = {};
  const add = (name, slot) => {
    if (!name || properties[name]) return;
    properties[name] = { type: 'unknown', 'x-in': SOURCE_TO_IN[slot] };
  };

  for (const m of handlerSource.matchAll(DESTRUCTURE_RE)) {
    const [, names, slot] = m;
    for (const raw of splitTopLevel(names)) {
      if (raw.startsWith('...')) continue; // a rest element names nothing
      const key = raw.split('=')[0].split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(key)) add(key, slot);
    }
  }
  for (const m of handlerSource.matchAll(DOT_READ_RE)) add(m[2], m[1]);
  for (const m of handlerSource.matchAll(BRACKET_READ_RE)) add(m[2], m[1]);

  if (Object.keys(properties).length === 0) return null;
  return { type: 'object', properties, 'x-mined-by': 'reads' };
}

// Firebase Hosting rewrites do not populate `req.params` — a wildcard segment arrives
// inside `req.path`, and the handler slices it out by hand:
//
//     const pathParts = req.path.split("/");
//     const targetUid = pathParts[pathParts.length - 2];
//
// That is mechanical, not a guess: an offset from the end of the path resolves to exactly
// one segment of the ROUTE path, and if that segment is a `*` the local's name is the
// name of that wildcard. This is the only way those parameters can ever be named — nothing
// else in the app states them — and an unnamed path parameter is a call a reader cannot
// paste. A resolved offset that does NOT land on a `*` is discarded: it named a literal
// segment, which is not a parameter.
const PATH_SPLIT_RE = new RegExp(
  `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${REQ}\\s*\\??\\.\\s*(?:path|url|originalUrl)\\s*\\.\\s*split\\(\\s*['"]/['"]\\s*\\)`
);

function minePathParams(handlerSource, routePath) {
  if (!routePath || !routePath.includes('*')) return [];
  const bind = PATH_SPLIT_RE.exec(handlerSource);
  if (!bind) return [];
  const parts = bind[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const segments = routePath.split('/');

  const found = [];
  const fromEnd = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${parts}\\s*\\[\\s*${parts}\\s*\\.\\s*length\\s*-\\s*(\\d+)\\s*\\]`,
    'g'
  );
  for (const m of handlerSource.matchAll(fromEnd)) {
    found.push({ name: m[1], index: segments.length - Number(m[2]) });
  }
  const absolute = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${parts}\\s*\\[\\s*(\\d+)\\s*\\]`, 'g');
  for (const m of handlerSource.matchAll(absolute)) {
    found.push({ name: m[1], index: Number(m[2]) });
  }

  const seen = new Set();
  return found
    .filter(({ index }) => segments[index] === '*' && !seen.has(index) && seen.add(index) !== false)
    .sort((a, b) => a.index - b.index);
}

/**
 * Mine the input shape of one handler.
 *
 * @param {string|null} handlerSource - the extracted handler body
 * @param {string|null} fileSource - the whole file (module-scope validator schemas live here)
 * @param {string} sourceRef - what the shape gets stamped with; mined is not declared
 * @param {string|null} routePath - the route path, so `*` wildcards can be named from the handler's own slicing
 * @returns {object|null} a JSON-Schema-shaped object, or null when the handler reads nothing
 */
export function mineInputShape(handlerSource, fileSource, sourceRef, routePath = null) {
  if (!handlerSource) return null;
  const body = mineValidator(handlerSource, fileSource ?? handlerSource) ?? mineReads(handlerSource);
  const pathParams = minePathParams(handlerSource, routePath);
  if (!body && pathParams.length === 0) return null;

  // Path parameters lead: they come first in the URL, so they come first in the table.
  const properties = {};
  for (const { name } of pathParams) properties[name] = { type: 'unknown', 'x-in': 'path' };
  Object.assign(properties, body?.properties ?? {});

  return {
    type: 'object',
    properties,
    ...(body?.required ? { required: body.required } : {}),
    'x-mined-by': body?.['x-mined-by'] ?? 'reads',
    'x-mined-from': sourceRef,
  };
}

/** Adapter entry point — same read-the-file discipline as detectAuth. */
export function detectInputShape(route) {
  if (!route?.handlerSourcePath || !route?.name) return null;
  let fileSource;
  try {
    fileSource = readFileSync(route.handlerSourcePath, 'utf8');
  } catch {
    return null;
  }
  const handlerSource = extractFunctionBody(route.sourceExportName ?? route.name, fileSource);
  return mineInputShape(handlerSource, fileSource, route.sourceRef, route.path);
}
