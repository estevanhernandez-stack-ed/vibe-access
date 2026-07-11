# Builder profile — vibe-access, cycle #1 (v0.2)

Pointer-stub. Canonical values live in `~/.claude/profiles/builder.json` (unified profile,
schema v1). Autonomous run 2026-07-11 — interview skipped per the returning-builder contract.

| Field | Value | Source |
|---|---|---|
| Builder | Estevan (626Labs) | unified profile |
| Persona | `architect` | `shared.preferences.persona` (locked, cross-plugin) |
| Mode | `builder` | `plugins.vibe-cartographer.mode` |
| Autonomy | `fully-autonomous` | standing; explicit "no clarifying questions" this session |
| Pacing | brisk | consistent with builder mode + Architect persona |
| Cycle type | **Spec-first (pattern mm)** | substantive design captured upstream in the canonical spec; `/scope`, `/prd`, `/spec` compress to pointer-stubs |
| Deepening rounds | zero | clean spec + fully-autonomous, the locked habit across 10+ Cart cycles |
| Project origin | extending an existing repo — vibe-access v0.1.0 shipped 2026-07-09 (both channels) | repo |
| Stack | Node ≥20 ESM (`.mjs`), Jest 29 native-ESM, Ajv draft-07. No TypeScript build step. | `plugins/vibe-access/package.json` |
| Design direction | 626Labs design system (dark UI tokens for screen; ink-on-paper for print) for the new visualizer surface | `626labs:design` |
| Deployment target | Claude Code plugin — canary (solo repo `main`) + stable (vibe-plugins marketplace ref pin) | family convention |
| Quality bar | Real-app validation before ship; structural-green ≠ works; verbatim-idiom probes on any parser fix | v0.1 dogfood lesson |

**Cycle goal (verbatim from the builder, 2026-07-11):** ship the MCP/agent-access
**visualizer** — "I want to be able to see the tools, the tool calls that I can use, and an
explanation for each one. Easy for the user to read. HTML or something like that. Maybe
exportable to PDF, which HTML would be because you just print." Plus the accumulated evolve
backlog from two real-app runs.

**Design seeds already in-repo (the substantive upstream thinking):**

- `docs/proposed-changes.md` — evolve intake from the WeSeeYou dogfood + the ROROROblox
  agnostic run + direct builder feedback. Scored P0/P1/P2.
- `docs/mcp-evolve-research-2026-07-11.md` — multi-agent, adversarially-verified research on
  MCP tool-surface cost and the tool-design rubric. Load-bearing finding: Claude Code does
  **not** defer remote HTTP MCP tools (issue #40314), so a remote server's whole surface taxes
  every session — and ~97% of surveyed tools have description-quality defects. This is what
  gives the visualizer its grading teeth.
