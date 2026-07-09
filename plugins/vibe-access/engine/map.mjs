import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { validateManifest } from './schema.mjs';

const NEVER_PROD_SAFE = new Set(['seed', 'reset', 'capture']);

export function assertTierLegal(kind, tier) {
  if (tier === 'prod-safe' && NEVER_PROD_SAFE.has(kind)) {
    throw new Error(
      `refusal: kind "${kind}" can never be tier "prod-safe". This is mechanical, not advisory.`
    );
  }
}

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export function buildManifest(inventory, { previous = null, baseUrls, now } = {}) {
  const prevById = new Map((previous?.affordances ?? []).map((a) => [a.id, a]));

  const affordances = inventory.routes.map((route) => {
    const id = kebab(route.name);
    const prev = prevById.get(id);
    const isScaffolded = prev?.origin === 'scaffolded';
    const kind = isScaffolded ? prev.kind : (route.method === 'GET' ? 'read' : 'act');
    const overrides = prev?.overrides;
    const tier = overrides?.tier ?? (isScaffolded ? prev.tier : 'prod-safe');
    assertTierLegal(kind, tier);
    return {
      id,
      description: overrides?.description ?? `${kind === 'read' ? 'Read' : 'Act'}: ${route.method} ${route.path}`,
      tier,
      kind,
      transport: { type: 'http', method: route.method, path: route.path },
      input: prev?.input ?? null,
      output: prev?.output ?? null,
      auth: route.auth,
      sourceRef: route.sourceRef,
      origin: prev?.origin ?? 'existing',
      verified: prev?.verified ?? { status: 'unverified' },
      ...(overrides ? { overrides } : {}),
    };
  });

  // scaffolded affordances from the previous manifest survive re-map (their routes
  // may not appear in a rewrites-only inventory until applied + rescanned)
  for (const prev of previous?.affordances ?? []) {
    if (prev.origin === 'scaffolded' && !affordances.some((a) => a.id === prev.id)) {
      const effectiveTier = prev.overrides?.tier ?? prev.tier;
      assertTierLegal(prev.kind, effectiveTier);
      affordances.push({ ...prev, tier: effectiveTier });
    }
  }

  const manifest = {
    schemaVersion: 1,
    app: inventory.app,
    adapter: inventory.adapter,
    generatedAt: now ?? new Date().toISOString(),
    baseUrls,
    discoveryRoute: previous?.discoveryRoute ?? null,
    affordances,
  };
  const check = validateManifest(manifest);
  if (!check.valid) throw new Error(`map produced invalid manifest: ${check.errors.join('; ')}`);
  return manifest;
}

export function writeManifest(appRoot, manifest) {
  const path = join(appRoot, 'agent-access.json');
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  return path;
}
