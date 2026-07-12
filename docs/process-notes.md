# vibe-access — process notes

## /onboard — autonomous run (2026-07-11, cycle #1 → v0.2)

First Cart cycle on this repo. v0.1.0 shipped 2026-07-09 (both channels, installed, dogfooded
on WeSeeYouAtTheMovies; a second real-app run on ROROROblox followed the same week via the
agnostic path). This cycle evolves the plugin from the evidence those two runs produced, plus a
new feature the builder asked for by name.

**Values applied (interview skipped — returning builder, fully-autonomous, explicit "no
clarifying questions"):** Architect persona · builder mode · brisk · deepening-rounds zero ·
spec-first (pattern mm). Full table in `docs/builder-profile.md`.

**Cycle goal (builder's words):** the MCP/agent-access **visualizer** — "see the tools, the tool
calls that I can use, and an explanation for each one. Easy for the user to read. HTML... maybe
exportable to PDF, which HTML would be because you just print." Plus the accumulated evolve
backlog.

**Scope call made autonomously (the one judgment the builder left open).** He named the
visualizer and said "I think that's it," and separately said "we're ready to evolve." Read as:
the visualizer is the headline, and the banked backlog rides with it — but only the parts that
*serve* the visualizer or are prose-cheap. So v0.2 = `:visualize` + the capability-intent
interview (P0, prose-only) + the three schema enrichments that give the visualizer its badges
(`overrides.kind`, `authDetail`, `destructive`) + the fail-open lint + the post-add cadence.
Deferred to v0.3 with rationale in the spec: the verify transport seam, the dotnet adapter
promotion (waits on Sanduhr), the full MCP-evolve *grader*, verify preflight. The research doc
grounds the visualizer's grade badges; it does not need to become a grading platform this cycle.

**Design method:** the substantive design ran as a Workflow — three grounding agents (engine
contract, intake docs, the two real manifests as the actual data to render), then a 3-lens
proposal panel on the visualizer (information-design / MCP-spec-fidelity / print-artifact), two
judges (one against the builder's literal ask, one role-playing the builder), a synthesis into
the canonical spec, then three adversarial reviewers on that spec (executability from paper,
does-it-answer-the-ask-without-scope-creep, regression against shipped v0.1 — the real WeSeeYou
and RoRoRo manifests must still validate).

**Canonical spec:** `docs/superpowers/specs/2026-07-11-vibe-access-v0.2-design.md`.

**Design seeds (upstream thinking, already in-repo):** `docs/proposed-changes.md` (scored evolve
intake from both real-app runs + direct builder feedback) · `docs/mcp-evolve-research-2026-07-11.md`
(adversarially-verified MCP research; the load-bearing finding — Claude Code does not defer
remote HTTP MCP tools, and ~97% of surveyed tool descriptions have defects — is what gives the
visualizer's grade badges their teeth).

**Session/friction loggers:** vibe-access's own loggers are v0.1 documentation-only placeholders
(`~/.claude/plugins/data/vibe-access/` exists but holds only `adapter-notes/`). Same class of gap
Cart's own notes have flagged for six cycles. Not this cycle's scope; noted for `:evolve-access`.

**Handoff:** `/scope`, `/prd`, `/spec` compress to pointer-stubs against the canonical spec
(pattern mm), then `/checklist`, then build.

## /build + /ship — autonomous run (2026-07-11, cycle #1 → v0.2.0 SHIPPED)

All 11 checklist items complete. Final: **371 tests** (was 84 at cycle start; +287), 22 suites,
pristine. Tag `v0.2.0` + GitHub release + marketplace promotion (`c0e7409`, gate PASS 0-drift,
validator PASS 15/15) + real-install proven from stable.

**Method:** the build ran as one Workflow — 29 agents, an implementer + an adversarial verifier +
a fixer per item. **23 findings caught and fixed mid-build**, before the final review ever saw them.

**What the adversaries bought (this is the whole story of the cycle):**

- **Pre-code (3 spec refuters, 19 blocking findings).** The catch that saved the release: `input` is
  null in 102/102 real affordances and 84 of 85 WeSeeYou descriptions are machine templates. A
  visualizer alone would have rendered *labeled absences* — "a conviction for each tool, not an
  explanation for each tool." That forced §13 (input-shape mining + `:describe`) into scope. It
  delivered: UNDOCUMENTED **84/85 → 0/85**, and 66/85 routes yielded mined input shapes.
- **Mid-build.** The schema verifier proved the mechanical refusal was still blind to
  `overrides.tier` on the kind axis, and that `map`'s fixed-field rebuild would have silently
  dropped `destructive`/`authDetail` on the first re-map. Both were fixed with red-first tests.
- **Final review.** The page budget was a lie: ≤40 pages was measured against the EMPTY corpus, and
  post-`:describe` — the state the router now drives users toward — WeSeeYou printed at 50.
  Re-baselined to ≤32 bare / ≤46 filled, with density tightened and **nothing cut to make the
  number**. Also: the `derivedFrom` reason lived in a `title=` attribute, so it never printed —
  0 occurrences in the PDF text layer against 3 in the HTML. Print is half the ask; both fixed.

**Deferred, deliberately (spec §11):** verify transport seam for non-HTTP · dotnet-wpf-desktop
adapter promotion (waits on Sanduhr) · the full MCP-evolve grader · scan's fail-open lint · verify
preflight. The `--grade` layer and the MCP branch were sequenced last precisely because they were
the two allowed to slip; both landed anyway.

**Handoff:** run `/vibe-access:visualize` on an app and print it — that is the deliverable. `/reflect`
is owed to close the Cart cycle.
