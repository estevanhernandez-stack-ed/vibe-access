# Changelog

All notable changes to vibe-access are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The plugin ships from `plugins/vibe-access/` and carries a copy of this file.

## [0.2.0] — 2026-07-11

**Compatibility is one-way. Read this before you update.** Every manifest written by
v0.1 stays valid under v0.2 — the new fields are all optional, and `schemaVersion`
stays `1`. The reverse is NOT true: a manifest carrying `destructive`, `authDetail`,
or `overrides.kind` requires engine **>= 0.2.0**. On v0.1, `map` re-emits `overrides`
wholesale and both `affordance` and `overrides` are `additionalProperties: false`, so
its `validateManifest` throws `map produced invalid manifest` on the new keys. Once you
add a v0.2 field to `agent-access.json`, that app is on v0.2 for good.

### Added

- **`overrides.kind`** — kind is now overridable and survives re-map. On transports
  where every call is a POST (gRPC), the derived `act` is wrong for routes that only
  read; the override carries the correction. `map` bakes the effective kind into the
  top-level `kind` field and keeps `overrides.kind` as the re-map memory. New exported
  helper `effectiveKind(affordance)` is the single read path for engine code that can
  receive a pre-map (hand-edited) affordance.
- **`authDetail`** (string) — free text naming the real consent unit: a capability
  string (`host.commands.stop-accounts`) or one sentence naming the mechanism
  ("Firebase ID token via `Authorization: Bearer`"). `none|session|token` cannot
  express capability-based consent; description prose is not a home for it.
- **`destructive`** (boolean) — declares that an affordance breaks things. Absent means
  **unclaimed**, not `false`, and the visualizer says so. Orthogonal to `tier`: tier
  answers "may agents touch prod," destructive answers "does it break things."
- **`visualize`** — renders the surface an agent actually sees as a single
  self-contained HTML page, from a manifest or a live MCP `tools/list` payload. Verify
  math renders the full class decomposition (ran / gate-held / handle-gate-held / open /
  error / unverified); tool count is never graded.
- **`describe`** — grades the descriptions an agent has to choose from.

### Changed

- **The mechanical refusal now sees overrides on both axes.** `seed`/`reset`/`capture`
  can never be `prod-safe` — schema-enforced whether the kind arrives via `kind` or
  `overrides.kind`, and whether the tier arrives via `tier` or `overrides.tier`.
  `assertTierLegal`'s throw names the offending affordance id.
- **Verify never auto-probes `destructive: true`** — `skipped`, locally and non-locally,
  with no `--force` escape. `skipped` is never stamped, so a prior agent- or hand-driven
  `pass` survives an auto-verify run. Executing a destructive path is driver territory
  by design.
- **`map` carries `destructive` and `authDetail` forward on BOTH merge paths.** Before,
  the `origin: existing` rebuild would have erased hand-authored fields on the first
  re-map while the scaffolded-survivor path preserved them.
- Generated descriptions name the effective kind (`Seed:` / `Reset:` / `Capture:`),
  not a blanket `Act:`.

## [0.1.0] — 2026-07-09

The 15th vibe-* plugin. Initial release: `scan` (route + auth inventory,
firebase-functions adapter), `map` (agent-access.json manifest, dev/prod-safe tiers,
mechanical seed/reset/capture refusal), `scaffold` (gap affordances behind hard dev
gates, backup/rollback), `verify` (cold-agent pass, local-only, manifest stamping).
Adapter seam with honest stubs; the agnostic path writes adapter-notes. Validated
against WeSeeYouAtTheMovies.
