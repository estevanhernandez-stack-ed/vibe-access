import { readFileSync } from 'node:fs';
import { extractFunctionBody } from './routes.mjs';

const TOKEN_CALL_RE = /\bverifyAuthToken\s*\(/;

export function detectAuth(route) {
  if (!route?.handlerSourcePath || !route?.name) return 'none';
  let source;
  try {
    source = readFileSync(route.handlerSourcePath, 'utf8');
  } catch {
    return 'none';
  }
  const handlerBody = extractFunctionBody(route.name, source);
  return TOKEN_CALL_RE.test(handlerBody) ? 'token' : 'none';
}
