import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { validateManifest } from './schema.mjs';

const NEVER_PROD_SAFE = new Set(['seed', 'reset', 'capture']);

export function assertTierLegal(kind, tier, id) {
  if (tier === 'prod-safe' && NEVER_PROD_SAFE.has(kind)) {
    throw new Error(
      `refusal:${id ? ` affordance "${id}":` : ''} kind "${kind}" can never be tier "prod-safe". This is mechanical, not advisory.`
    );
  }
}

// §8.1 — the single read path for any code that can receive a PRE-map affordance
// (a hand-edited manifest never went through map). On a map-emitted manifest it is
// the identity: map bakes the effective kind into the top-level field.
export const effectiveKind = (affordance) => affordance?.overrides?.kind ?? affordance?.kind;

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

// carried forward verbatim from `previous` on BOTH merge paths — authored fields the
// map has no business regenerating (§8.2, §8.3)
const carryAuthored = (prev) => ({
  ...(prev?.authDetail !== undefined ? { authDetail: prev.authDetail } : {}),
  ...(prev?.destructive !== undefined ? { destructive: prev.destructive } : {}),
});

export function buildManifest(inventory, { previous = null, baseUrls, now } = {}) {
  const prevById = new Map((previous?.affordances ?? []).map((a) => [a.id, a]));

  const affordances = inventory.routes.map((route) => {
    const id = kebab(route.name);
    const prev = prevById.get(id);
    const isScaffolded = prev?.origin === 'scaffolded';
    const overrides = prev?.overrides;
    const derivedKind = isScaffolded ? prev.kind : (route.method === 'GET' ? 'read' : 'act');
    // effective kind resolves BEFORE tier, so the refusal guards the OVERRIDDEN value
    const kind = overrides?.kind ?? derivedKind;
    const tier = overrides?.tier ?? (isScaffolded ? prev.tier : 'prod-safe');
    assertTierLegal(kind, tier, id);
    return {
      id,
      description: overrides?.description ?? `${kind === 'read' ? 'Read' : 'Act'}: ${route.method} ${route.path}`,
      tier,
      kind, // bake-through: the effective value lands here; overrides.kind stays as re-map memory
      transport: { type: 'http', method: route.method, path: route.path },
      input: prev?.input ?? null,
      output: prev?.output ?? null,
      auth: route.auth,
      ...carryAuthored(prev),
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
      const kind = effectiveKind(prev);
      assertTierLegal(kind, effectiveTier, prev.id);
      affordances.push({ ...prev, kind, tier: effectiveTier });
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
