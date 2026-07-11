# MCP Evolve — grounding research (2026-07-11)

Seed knowledge for a future **MCP-evolve** capability (scan an MCP server, grade it against current best practices, propose an evolution). Produced by a multi-agent, multi-source research pass with an adversarial verify on the load-bearing claim. Treat vendor-reported numbers as vendor-reported (flagged inline).

---

## Headline: does a large MCP tool surface still hurt agents at session start?

**Nuanced — leaning "still a real cost," and it bites *remote HTTP* MCPs specifically.** The "tool count no longer matters" story is real but partial.

**What genuinely improved** (verified against Anthropic docs/blog):
- **Tool Search / deferred loading** cuts session-start context by **~85%** for servers whose tool descriptions exceed ~10K tokens (Anthropic's tool-search docs; ~55K-token multi-server example). It's **on by default in Claude Code since 2026-01-14** for qualifying servers.
- **Selection accuracy** reportedly stays high "even across thousands" of tools *when search is used* — but this is **Anthropic's own internal eval**, not independently reproduced.
- **Prompt cache preserved**: deferred tools are excluded from the cached system-prompt prefix.
- Advanced tool use lifts (Anthropic engineering blog, vendor-reported): Opus 4 49%→74%, Opus 4.5 79.5%→88.1%; Programmatic Tool Calling cut one workload 43,588→27,297 tokens (37%) and removed 19+ inference passes.

**What did NOT improve — and the catch for us:**
1. **Claude Code does not defer remote HTTP / Streamable-HTTP MCP tools** (Claude Code issue **#40314**, closed "not planned"). One HTTP-MCP gateway loaded **~120K tokens (60% of a 200K window)** upfront every session. **Our 626Labs connector is a remote HTTP server** — so its entire tool surface loads into context on every session, in every client, with no deferral. This is the single most important finding for us.
2. **Retrieval ≠ selection.** Even at high retrieval recall, end-to-end task success lags — one study: 99% recall → ~50–60% task success ("99% Success Paradox," arXiv 2605.18857). Arcade's 4,027-tool test showed ~60% retrieval recall (n=25, vendor has a COI).
3. **Threshold gating.** Selection degrades past **~30–50 tools** (Anthropic's own number). Below ~10K tokens of definitions, or in any client that doesn't implement deferral, raw count still bites. On the **raw API, deferral is not automatic** — the developer must set `defer_loading` per tool/toolset.
4. **Transmission cost unchanged.** Every tool schema is still sent on every request; deferral controls context, not egress.
5. **New footguns**: deferred tools unavailable on the first turn (breaks scheduled/automated runs — #42148); an `InputValidationError` footgun requiring a `ToolSearch("select:<name>")` preflight (#60052).
6. **Description quality is orthogonal and bad**: ~97% of surveyed tools had ≥1 description quality issue; 56% unclear-purpose (arXiv 2602.14878, 856 tools / 103 servers). Pre-Tool-Search baseline degradation from tool bloat averaged ~9.5% ("Help or Hurdle?", arXiv 2508.12566).

**Design conclusion for 626Labs (and the MCP-evolve rubric): do not chase tool count.** Keep the surface tight, lean on the **discriminated-action pattern** (`manage_tasks` with an `action` field, not eight task tools — we already do this), and invest in **description quality + freshness**. "More useful" ≠ "more tools."

---

## MCP tool-design best practices (rubric material)

- **Discriminated-action tools** over many small tools (fewer names for the model to choose among; keeps count low).
- **Excellent descriptions**: state purpose, when to use, when NOT to, and per-action semantics. This is where ~97% of servers fail.
- **Structured output schemas** (latest MCP spec) so clients get typed results, not prose to re-parse.
- **Tool annotations** (readOnly / destructive hints) so clients can gate/telegraph risk.
- **Resources and prompts**, not just tools — read-only addressable data belongs in resources; server-authored prompts belong in prompt templates. (We already expose `projects://`, `tasks://active`, `session://current`, prompt templates.)
- **Keep the 3–5 most-used tools non-deferred**; let the rest be discoverable.
- **Clean error shapes** (RFC-style codes), never leak secrets in errors or logs.

## Freshness — the "last active April 16" class

Our connector greeted a mobile user with a project it called "last active April 16th" that was stale. Freshness patterns worth encoding:
- **Recency-ranked** default surfacing: on first contact, show what's *actually* current (updated/committed recently), not a `lastActiveAt` that never got bumped.
- **A "what changed since" / session-resume** affordance instead of a single stale "last active project."
- Prefer **resources** (addressable, refetchable) for state a client renders on connect, over a tool call that snapshots a stale field.
- Audit every `lastActiveAt`/`updatedAt` write path — a field that isn't bumped on real activity is worse than no field.

## Claude Desktop in-app browser + remote connectors

- Remote OAuth MCP connectors now work across Claude Desktop / web / mobile / Claude Code / VS Code / Cursor (all drive the OAuth browser flow themselves). One connector, every surface — confirmed by our own deployment.
- A Claude Desktop **in-app browser** + an MCP that can act on the dashboard is a strong pairing (agent reads/writes state *and* can drive web surfaces). Worth designing the tool surface with that combined capability in mind.

---

## Implications for the MCP-evolve capability

What an MCP-evolve pass should **scan for** and grade:
1. **Tool-surface shape** — count, discriminated-action usage, the non-deferred top-5, whether the server is remote-HTTP (no Claude-Code deferral → context tax is real).
2. **Description quality** — per-tool purpose/when-to-use/when-not, the ~97%-fail bar.
3. **Output schemas + annotations** — present? typed? risk-hinted?
4. **Resources/prompts** — is read-only state a resource, or forced through a tool?
5. **Freshness** — does first-contact surface current state; are recency fields actually bumped?
6. **Security/hygiene** — auth model (OAuth/agent-keys vs static bearer), no secrets in errors/logs, fail-closed.

**The research loop** (dogfood of the multi-agent pattern): fan out agents across sources (Anthropic docs/blog, MCP spec, Claude Code issue tracker, independent benchmarks) + adversarially verify the load-bearing claims before acting — because the vendor's "solved" story had real holes (transport-dependent deferral, retrieval≠selection) that only surfaced under refutation.

---

## Sources
- Anthropic — Tool Search / token-efficient tool use: `platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool`
- Anthropic engineering — Advanced tool use: `anthropic.com/engineering/advanced-tool-use`
- Claude Code issues: #40314 (HTTP MCP not deferred), #42148 (first-turn deferred unavailability), #60052 (InputValidationError footgun)
- "Help or Hurdle?" arXiv 2508.12566 · "99% Success Paradox" arXiv 2605.18857 · tool-description quality arXiv 2602.14878
- Arcade.dev 4,027-tool retrieval test (vendor COI, n=25, retrieval-recall only)
