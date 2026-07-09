import { readFileSync } from 'node:fs';

const TOKEN_CALL_RE = /\bverifyAuthToken\s*\(/;

function extractFunctionBody(exportName, source) {
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
