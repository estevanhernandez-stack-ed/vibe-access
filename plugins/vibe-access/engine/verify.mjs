import { validateVerifyRun } from './schema.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

export function isLocalUrl(url) {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function callOne(affordance, baseUrl, fetchImpl) {
  const url = `${baseUrl.replace(/\/$/, '')}${affordance.transport.path}`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: affordance.transport.method,
      headers: { 'content-type': 'application/json' },
      ...(affordance.transport.method === 'GET' ? {} : { body: '{}' }),
    });
  } catch (err) {
    return { affordanceId: affordance.id, status: 'fail', httpStatus: null, detail: `unreachable: ${err.message}` };
  }
  const s = res.status;
  if (affordance.auth !== 'none') {
    if (s === 401 || s === 403) {
      return { affordanceId: affordance.id, status: 'pass', httpStatus: s, detail: 'auth-gate-held' };
    }
    if (s >= 200 && s < 300) {
      return { affordanceId: affordance.id, status: 'fail', httpStatus: s, detail: `auth-gate-open: expected 401/403, got ${s}` };
    }
    return { affordanceId: affordance.id, status: 'fail', httpStatus: s, detail: `unexpected ${s}` };
  }
  if (s >= 500 || s === 404) {
    return { affordanceId: affordance.id, status: 'fail', httpStatus: s, detail: `unexpected ${s}` };
  }
  return { affordanceId: affordance.id, status: 'pass', httpStatus: s, detail: '' };
}

export async function runVerify(manifest, { baseUrl, force = false, fetchImpl = fetch, runId, now } = {}) {
  if (!isLocalUrl(baseUrl) && !force) {
    throw new Error(`refusing to verify against ${baseUrl} — not local. Pass --force to override deliberately.`);
  }
  const results = [];
  for (const a of manifest.affordances) {
    if (a.kind === 'capture') {
      results.push({ affordanceId: a.id, status: 'pending-agent', httpStatus: null, detail: 'capture-kind: agent drives Playwright, then stamps' });
      continue;
    }
    if ((a.kind === 'seed' || a.kind === 'reset') && !isLocalUrl(baseUrl)) {
      results.push({ affordanceId: a.id, status: 'skipped', httpStatus: null, detail: 'seed/reset never exercised non-locally' });
      continue;
    }
    results.push(await callOne(a, baseUrl, fetchImpl));
  }
  const run = {
    schemaVersion: 1,
    runId,
    startedAt: now ?? new Date().toISOString(),
    baseUrl,
    forced: !!force,
    results,
  };
  const check = validateVerifyRun(run);
  if (!check.valid) throw new Error(`verify produced invalid run: ${check.errors.join('; ')}`);
  return run;
}

export function stampManifest(manifest, run) {
  const byId = new Map(run.results.map((r) => [r.affordanceId, r]));
  return {
    ...manifest,
    affordances: manifest.affordances.map((a) => {
      const r = byId.get(a.id);
      if (!r || r.status === 'skipped') return a;
      return {
        ...a,
        verified: { status: r.status, at: run.startedAt, runId: run.runId, ...(r.detail ? { detail: r.detail } : {}) },
      };
    }),
  };
}
