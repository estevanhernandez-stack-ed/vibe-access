# Spec — vibe-access v0.2

**Spec-first cycle (pattern mm).** This file is a pointer-stub. The canonical technical design is
[`docs/superpowers/specs/2026-07-11-vibe-access-v0.2-design.md`](superpowers/specs/2026-07-11-vibe-access-v0.2-design.md)
— 544 lines, build-ready after a three-way adversarial review (executability / builder-ask /
regression). No new technical thinking lives here.

## Section index

| § | What's there |
|---|---|
| 1 | What v0.2 is — the five things, one release |
| 2 | The three facts that shaped the visualizer (computed over both real manifests) |
| 3 | `:visualize` CLI surface — command, input resolution, output, flags, exit codes, read-only contract |
| 4 | The input adapter — shape sniffing, the ToolView model, the honest-render normalization rules |
| 5 | The HTML — one file, two render targets |
| 6 | Page structure — the bands, the fixed eight-block card skeleton |
| 7 | Grades and badges — the five per-tool badges with exact pass conditions; surface axes measured, not scored |
| 8 | Schema deltas — `overrides.kind`, `authDetail`, `destructive` (the blast-radius section) |
| 9 | Print |
| 10 | Testing — unit + the real-app validation bar |
| 11 | Out of scope for v0.2, with rationale |
| 12 | Decisions log (D1-D28) |
| 13 | Closing the documentation hole — input mining + `:describe` |
| 14 | The capability-intent interview (P0) |
| 15 | Router: the post-add cadence |
| 16 | Build order |

## What deliberately does NOT change

The v0.1 contracts stay put: the `AccessAdapter` seam and its four functions · the manifest's
required affordance fields and the `tier`/`kind`/`auth` enums (v0.2 only ADDS optional fields) ·
the three enforcement layers of the seed/reset/capture-never-prod-safe rule · verify's cold rule
and its local-only guard · the CLI dispatch shape. Two real manifests are in the wild and a real
user has v0.1.0 installed — §8 is the only section with blast radius, and it carries
regression-tests-first as a gate, not a suggestion.

**Banner-correct rule:** when build reality diverges from the canonical spec, banner-correct the
canonical inline. Don't rewrite it top-to-bottom.
