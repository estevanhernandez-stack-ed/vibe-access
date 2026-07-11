# PRD — vibe-access v0.2

Compressed PRD (pattern mm). Stories distilled from the canonical spec
[`2026-07-11-vibe-access-v0.2-design.md`](superpowers/specs/2026-07-11-vibe-access-v0.2-design.md)
§3-§15. Acceptance criteria distilled from §10 (testing) and the spec's decisions log.

## Epic 1 — See the surface (the ask)

**1.1 Render the sheet.** As a builder, I want one HTML file that shows every tool an agent can
call in my app, so I can read my own agent surface without opening JSON.
*AC:* `node engine/cli.mjs visualize --app <path>` writes a self-contained HTML file (zero network,
inline CSS, system font stack) · renders both real manifests (WeSeeYou 85, RoRoRo 17) without
horizontal scroll · every tool is one card with the fixed eight-block skeleton · exit 1 with a
named message when there's no input.

**1.2 Show me the call I can make.** As a builder, I want each card to show the literal call an
agent would make, so "the tool calls that I can use" is a thing I can copy.
*AC:* THE CALL block renders a copyable invocation · parameters come from the mined input shape
where one exists · genuinely unminable params render as `<value>` placeholders, never invented types
· mined rows are tagged `mined from <sourceRef>` — mined ≠ declared.

**1.3 Explain each one.** As a builder, I want a real explanation per tool, not the route restated.
*AC:* the card renders the effective description · a templated description is visibly flagged
UNDOCUMENTED, not silently rendered · after `:describe` runs on WeSeeYou the UNDOCUMENTED count moves
from 84 toward zero · the §10.2.5 acceptance test passes on the post-describe render.

**1.4 Print it.** As a builder, I want Ctrl-P to yield a PDF I'd hand to a teammate.
*AC:* `@media print` flips to ink-on-paper · no tool card splits across a page
(`page-break-inside: avoid`) · no dark fills burning toner · page budget respected on the 85-tool
render.

**1.5 Tell the truth about verification.** As a builder, I want the sheet to never claim a call
"passed" when what really happened is "the auth gate rejected me."
*AC:* verify math always renders the full class decomposition (ran / gate-held / handle-gate-held /
open / error / unverified) from one sentence template · `handle-gate-held` is NEVER folded into
`gate-held` · no bare pass count anywhere · tool count is never graded.

**1.6 Read an MCP server too.** As a builder, I want to point this at a real MCP server's tool list.
*AC:* input shape is sniffed, not flag-gated · a captured `tools/list` payload from the 626Labs
connector renders · no MCP client ships inside the plugin (the skill fetches; the engine renders).

## Epic 2 — Say what you want (the interview)

**2.1 Ask before diffing.** As a builder on a product surface, I want scaffold to ask what I want
agents to be able to DO before it diffs me against a generic checklist.
*AC:* scaffold opens with the verbatim question · each intent is drilled to a complete affordance
spec (trigger, kind, tier, auth+capability, destructive, acceptance probe) · the six-need checklist
runs after, as the floor not the ceiling · interview items sort first in the pick list.

**2.2 Don't stand down on an unknown stack.** *AC:* on an agnostic/not-yet-implemented adapter,
scaffold runs the same interview and hand-carries the specs with the agent. "No adapter" changes who
types the code, not whether the conversation happens.

**2.3 Name the loop.** *AC:* after any capability lands, the router recommends rescan → remap →
reverify by name, and names `:visualize` after map/verify, `:describe` when UNDOCUMENTED is nonzero.

## Epic 3 — Say it precisely (the schema)

**3.1 Kind that survives.** *AC:* `overrides.kind` exists; effective kind bakes into the top-level
`kind` on map; RoRoRo's 7 misclassified reads migrate.
**3.2 Auth beyond three words.** *AC:* optional `authDetail` free-text carries the capability string
`none|session|token` cannot express.
**3.3 Destructive, declared.** *AC:* optional `destructive` boolean; the visualizer badges it; verify
treats it with seed/reset posture.
**3.4 Break nothing.** *AC (the gate on this whole epic):* regression tests are written FIRST, pinning
today's posture · both real manifests still validate and still round-trip scan → map → verify
unchanged · the seed/reset/capture-never-prod-safe rule keeps all three enforcement layers · every
new field is OPTIONAL.

## Prioritization

The renderer is the ask; it ships first and nothing the builder didn't ask for gates it. If the cycle
runs long, what slips is the `--grade` audit layer and the MCP branch — never the sheet. §8 (schema)
carries the only real blast radius and is independently taggable.

## Not in this PRD

Telemetry (the family ships none) · performance AC (rendering 85 cards is not a latency problem) ·
decision-log AC (decisions log to the dashboard as they emerge, not as story acceptance).
