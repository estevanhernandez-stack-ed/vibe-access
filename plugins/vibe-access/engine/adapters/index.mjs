import { nextjsStub } from './_stubs/nextjs.mjs';
import { expressStub } from './_stubs/express.mjs';
import { firebaseFunctionsAdapter } from './firebase-functions/index.mjs';

export const IMPLEMENTED_ADAPTERS = [firebaseFunctionsAdapter];
const STUB_ADAPTERS = [nextjsStub, expressStub];

export const REGISTERED_ADAPTERS = [...IMPLEMENTED_ADAPTERS, ...STUB_ADAPTERS];

function claims(adapter, detection) {
  try {
    return adapter.matches(detection) === true;
  } catch {
    return false;
  }
}

export function resolveAdapter(detection) {
  for (const adapter of IMPLEMENTED_ADAPTERS) {
    if (claims(adapter, detection)) {
      return { adapter, status: 'ready', framework: adapter.id };
    }
  }
  for (const stub of STUB_ADAPTERS) {
    if (claims(stub, detection)) {
      return { adapter: null, status: 'not-yet-implemented', framework: stub.id };
    }
  }
  return { adapter: null, status: 'not-yet-implemented', framework: detection?.framework ?? 'unknown' };
}
