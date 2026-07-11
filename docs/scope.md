# Scope — vibe-access v0.2

**Spec-first cycle (pattern mm).** Pointer-stub. The substantive design lives in
[`docs/superpowers/specs/2026-07-11-vibe-access-v0.2-design.md`](superpowers/specs/2026-07-11-vibe-access-v0.2-design.md)
(544 lines, §1-§16, build-ready after a 3-way adversarial review). Cycle history: this is
cycle #1 on this repo; v0.1.0 shipped 2026-07-09.

## In scope

1. **`:visualize`** — the headline. A tool surface (vibe-access manifest OR an MCP `tools/list`
   payload) rendered into one self-contained, human-readable, print-to-PDF HTML file. The bare
   command is the reference sheet the builder asked for; the grading layer is opt-in (`--grade`).
2. **The documentation-hole closers** — input-shape mining in scan, and `:describe` to author
   real explanations. Not decoration: without them the sheet renders the builder's two payloads
   ("the tool calls that I can use" / "an explanation for each one") as labeled absences on 84 of
   85 WeSeeYou cards. The renderer alone would have shipped a beautiful empty page.
3. **The capability-intent interview (P0)** — scaffold and the router ask what the builder wants
   agents to be able to DO before diffing the six-need checklist. Prose-only.
4. **Three schema enrichments** — `overrides.kind`, `authDetail`, `destructive`. The only part of
   the release with blast radius on v0.1; ships as its own step, regression tests first.
5. **Router: the post-add cadence** — rescan → remap → reverify, named after any capability lands.

## Out of scope (v0.3, rationale in spec §11)

Verify transport seam for non-HTTP (the RoRoRo hand-driver recipe works today and is documented) ·
dotnet-wpf-desktop adapter promotion (waits on a second .NET target to confirm the shape) · the
full MCP-evolve **grader** (v0.2 ships the visualizer with grade badges, not a grading platform) ·
scan's fail-open lint · verify preflight checks.

## The three facts that shaped the cycle

Computed over both real manifests, not eyeballed — and they are why the design is what it is:

1. `transport.type` is the literal string `"http"` for all 102 affordances, including RoRoRo's 17
   gRPC-over-named-pipe methods. The schema flattens a distinction the reader needs.
2. `input` and `output` are `null` in **102 of 102** entries. Any naive input column renders 204
   empty cells.
3. "Pass" means two different things. Of 93 verify passes, **76** mean "the auth gate correctly
   rejected me — the call never ran" and only 17 mean "the call returned data." A green-check
   column that collapses those is the exact lie the page exists to prevent.
