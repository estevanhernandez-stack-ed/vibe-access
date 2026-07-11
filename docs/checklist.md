# Checklist — vibe-access v0.2

Build sequence translated from the canonical spec's §16 build order. **Build mode:**
autonomous-with-verification (subagent per item, adversarial verify after each). **TDD:** strict on
the engine items (2, 3, 6, 7). **Git cadence:** commit per item. **Checkpoints:** C1 after item 5
(the sheet renders both real manifests — the ask is met in its bare form), C2 after item 7 (the
documentation holes are closed — the ask is met *honestly*).

Ordering principle, binding: **the renderer is the ask; it ships first, and nothing the builder
didn't ask for gates it.** If the cycle runs long, the audit layer (item 8) and the MCP branch
(item 9) slip. The sheet never slips.

| # | Item | Spec | Why here |
|---|---|---|---|
| 1 | Fixtures: scrub the two real manifests into `tests/fixtures/`; capture one real `tools/list` payload from the 626Labs connector | §10.1, §16.1 | Everything downstream tests against real data, not invented data. Capturing the MCP payload now is the 2-minute move that keeps item 9 from being designed from paper. |
| 2 | Normalizer + ToolView | §4 | The one model both input shapes collapse into. Nothing renders until this is right. TDD. |
| 3 | Renderer, bare mode: bands → card → THE CALL | §5, §6 | The ask itself. Bare before grafts. TDD on the emit (determinism, no network refs, no horizontal overflow). |
| 4 | Grafts, in the judges' order: density/compact-default + chips-when-true → print inks + DESTRUCTIVE-scarcity + `<wbr>` + `{?}` → collapse duplicate slugs → `--no-source` / `--terse` / URL-hash / Save-as-PDF / print-filter | §6, D-log | The judge panel's grafts are what make an 85-tool page readable rather than merely complete. |
| 5 | CLI wiring + `skills/visualize/SKILL.md` + `commands/visualize.md`. **C1:** render both real manifests, print both, page budget, arm's-length read; run the §10.2.5 acceptance test and RECORD the expected pre-§13 failure | §3, §10.2 | First runnable. The recorded failure is the honest gate: the sheet is beautiful and the data is thin — item 7 is what fixes it. Recorded, not waived. |
| 6 | Schema deltas (`overrides.kind`, `authDetail`, `destructive`): **regression tests FIRST** (pin today's seed/reset/capture posture before the destructive clause exists), then schema + map write-through/preservation, then the posture matrix. Prove both real manifests still round-trip scan → map → verify unchanged. Migrate RoRoRo's 7 misclassified reads into `overrides.kind` | §8, §10.2 | The only item with blast radius on shipped v0.1. Independently taggable. Regression-first is not optional. |
| 7 | Input-shape mining (+ the inventory `inputShape` delta) and `:describe`. Run both on WeSeeYou; re-render. **C2:** §10.2.5 now PASSES or the release is not done | §13 | Closes the documentation hole. Without this the sheet renders labeled absences on 84 of 85 cards — a conviction for each tool, not an explanation for each tool. |
| 8 | `--grade` layer: badges, D-predicates, measured axes, audit bands | §7 | Opt-in by design. First to slip if the schedule bites. |
| 9 | MCP input branch (shapes 2-4), built against item 1's captured fixture; the 626Labs render validates it | §4.1, §10.2.3 | The "MCP visualizer" half of the name. Second to slip. |
| 10 | Interview + router prose (capability-intent, post-add cadence, the v0.2 surface recommendations) | §14, §15 | Prose-only, zero engine. Independent of everything above — can land any time. |
| 11 | Release: CHANGELOG, README, `plugin.json` 0.1.0 → 0.2.0 + description, tag `v0.2.0`, canary; stable via marketplace ref bump after a real install proves it | §16.11 | The universal final item. |

## Risk callouts for the build

- **Item 6 is the regression item.** Two real manifests (85 + 17 affordances) are in the wild and a
  real user has v0.1.0 installed. Every new field is OPTIONAL; the three enforcement layers of the
  seed/reset/capture rule survive; `buildManifest` rebuilds affordances from a fixed field list, so
  the two new top-level fields must be explicitly threaded or they are silently dropped on re-map
  (the regression reviewer caught exactly this).
- **Item 3's honesty rules may never be dropped:** verify math renders the full class decomposition
  (never a bare pass count; `handle-gate-held` never folded into `gate-held`), and tool count is
  never graded. These are the two rules the whole page exists to enforce.
- **Item 7 is the item that makes item 3 true.** A gorgeous renderer over null inputs and template
  descriptions is a failure dressed as a success. C2 is where the cycle is actually won.
- **No new runtime deps.** The plugin ships Ajv and nothing else; the HTML must be self-contained
  (inline CSS, system font stack — the 626 faces are not available offline).
