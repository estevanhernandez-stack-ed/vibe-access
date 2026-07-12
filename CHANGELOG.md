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
- **`describe`** — the documentation pass. Reads the handler source behind every
  affordance whose description is still a machine template, authors a real description
  against the D1–D7 axes (purpose beyond the route, when to use, when NOT to use, inputs
  in prose, result shape, side effects, consent in words), and writes it into
  `overrides.description` — the re-map-safe home. Batch cadence: propose per group,
  builder approves, write, re-render. Nothing lands unreviewed; these strings are the
  consent surface an agent reader trusts.
- **`inputShape`** (inventory, optional) — scan now mines the input shape out of the
  handler: `req.body` destructuring, direct and bracket reads, `req.query` / `req.params`,
  and — highest confidence — zod/joi schema objects. `map` writes it into the affordance's
  existing `input` field, and THE CALL fills from it: query params in the URL, body params
  in `-d`, every property named. Nothing is invented — a handler that reads no input yields
  no shape, types stay `unknown` unless the source states them, requiredness is only claimed
  when a validator states it, and every mined table is tagged `mined from <sourceRef>`.
  Mined is not declared, and a declared schema always beats a mined one. Additive and
  optional: a shape-free inventory still validates.

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
- **Print carries the derived reasons.** A derived `⚠ DESTRUCTIVE` chip used to hold its
  reason in a `title=` attribute and the annotation cells' `derived: <why>` was
  `display:none` in print — so the PDF asserted "derived" and printed the heuristic
  behind it nowhere. Both now render as real text on paper (screen keeps the compact
  hover), per §4.3.5: "rendered as derived, always, both channels." The page's honesty
  about its own inference is the argument for the `destructive` schema field, and it was
  going missing at exactly the moment the sheet became a document.
- **THE CALL is pasteable.** The prose that qualifies a call ("Parameters mined from …",
  "N unnamed path parameters …") moved out of the `<pre>` and onto its own line below it.
  The copy button copies the `<pre>` — it was handing back a curl with two lines of
  English glued to the end.
- **Print density, and an honest page budget.** Run-in parameter rows on paper (same
  cells, same order; the header's column names move into the cells), tighter leading and
  card margins, a 0.6rem/~7pt floor on code blocks, the micro-footer run in with the
  footer, and `break-after: avoid` finally applied to the group bands so a band cannot
  strand at the foot of a page (§9 — worth ~2 pages, and paid for). Measured through
  headless Chrome (`emulateMedia({media:'print'})` + `page.pdf`, Letter, 14mm/12mm):
  the 85-affordance sheet prints **34 → 31 pages pre-`:describe`** and **50 → 44
  post-`:describe`**; RoRoRo's 17 print **13 → 12**. Spec §10.2.6's single ≤ 40 budget was
  set against the EMPTY corpus and is retired for two numbers — **≤ 32 bare, ≤ 46
  post-`:describe`**. The filled sheet is bigger because it carries the authored
  explanations the empty one didn't, which is the entire point of the release. Nothing was
  cut to hit a number: the pass ADDED text to every card and still landed 6 pages lighter.

## [0.1.0] — 2026-07-09

The 15th vibe-* plugin. Initial release: `scan` (route + auth inventory,
firebase-functions adapter), `map` (agent-access.json manifest, dev/prod-safe tiers,
mechanical seed/reset/capture refusal), `scaffold` (gap affordances behind hard dev
gates, backup/rollback), `verify` (cold-agent pass, local-only, manifest stamping).
Adapter seam with honest stubs; the agnostic path writes adapter-notes. Validated
against WeSeeYouAtTheMovies.
