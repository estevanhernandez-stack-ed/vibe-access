# Proposed changes — evolve-access intake

> Written by hand while `/vibe-access:evolve-access` is a v0.1 placeholder. Sources: the
> ROROROblox agnostic-path run (2026-07-09/10, adapter-notes `dotnet-wpf-desktop.md` +
> `.vibe-access/` artifacts in that repo) and direct builder feedback (2026-07-10).
> Second intake 2026-07-10 (run complete): the agent-ops arc and streamer-mode build on
> that repo. Third intake 2026-07-19: PriceScout (Python/Streamlit + remote MCP over
> OAuth) — the first evidence from an adapter class other than .NET/WPF, and the first
> from a surface that ran long enough in front of real agents to show usage-shaped
> failures rather than build-shaped ones.
> Scoring: count × confidence weight {high: 3, medium: 2, low: 1}.

## Third intake — PriceScout, 5 affordances to 17 in front of live agents (2026-07-19)

Different adapter (Python/Streamlit), different transport (streamable-HTTP MCP behind
OAuth 2.1 + DCR, admin-only gate), and — the part that makes it worth a separate intake —
a surface that stayed up long enough for a Claude Desktop agent to use it badly. RoRoRo
taught the plugin about *building* a surface. PriceScout taught it about what a surface
does wrong once agents are actually routing against it.

The arc: `:scaffold` produced five compliance affordances (state/seed/reset/capture/
manifest), which graduated to a stdio MCP server, then to a remote one. The builder then
grew it to **17 affordances, of which 11 are reads he conceived himself** — every one
added after watching an agent fail to answer a question the surface technically had the
data for.

**Refinements this drives into the existing items:**

- **P0 interview — the read/write ratio is the interview's missing question.** Scaffold's
  six-need checklist yielded five affordances, one of them read-ish. The surface settled
  at 11 reads of 17. The checklist is dev-loop shaped (can I seed, reset, inspect state);
  product surfaces are *question* shaped (what will people ask this app). Add to the
  capability-intent conversation: "What questions will an agent be asked about this app?"
  — and treat the answers as read affordances, first-class, not leftovers after the write
  path. Cross-adapter confirmation that the checklist is a floor.
- **P1 `destructive` flag — confirmed by a second adapter, independently.** PriceScout's
  MCP server hand-wrote `destructiveHint` onto `agent-reset` for exactly the reason the
  RoRoRo `stop-accounts` entry needed prose. Two unrelated stacks reaching for the same
  missing schema field is about as strong as this doc's evidence gets. Promote from
  proposal to next-version commitment.
- **P2 verify preflight — add probe ordering to it, with a reproduced bug.** Cold verify
  runs probes alphabetically, so the seed probe fires *after* reset and leaves one probe
  expectation behind in app data per verify run (cleaned by hand with an empty-payload
  `agent-reset`). Probes have dependency order; alphabetical isn't it. Preflight should
  order by kind (seed → capture → read → reset) or verify should own teardown for what it
  seeded.

## NEW P0 — Map answers "what is exposed," not "what can the agent do" (builder feedback, high, score 3)

**The gap.** The builder ran `:map` and `:visualize`, kept the output
(`docs/vibe-access/agent-access-2026-07-18.html`, 73 KB) — and the next day asked an agent
to hand-build the thing he actually wanted. Direct quote: *"I was expecting Vibe Access's
mapping to be able to show me a visualization of what calls that the MCP could make, what
the agent could do."*

The comparison is the finding. Skill output: 73 KB, organized by route and schema —
faithful, structural, and it answers "what does this surface consist of." Hand-built
replacement: **23 KB**, organized by *what an agent would want to accomplish* — six
functional zones, kind color-coding, and a set of plain-English asks mapped to the tool
chain each one triggers. A third of the size, and it's the one that answered the question.

**The change.** `:visualize` needs a capability view alongside the structural one. Group
by what the affordances *do together*, not by endpoint; carry each affordance's cost and
destructiveness visually (the reader's real question is "which of these is safe/slow");
and render an ask-to-chain section — a handful of representative questions with the tool
sequence that serves each. Prose + template change, no engine work.

**Why P0.** It is the only item in this doc sourced from a builder abandoning the plugin's
output and rebuilding it by hand, with both artifacts on disk to diff. Everything else here
is inference from a failure; this is a preference stated out loud with receipts.

## NEW P1 — Read questions route to the write sledgehammer (scan + scaffold, high, score 3)

**The gap.** A Claude Desktop agent was asked for a showtime *count*. It selected
`agent-price-gather` — the heaviest write affordance on the surface, a full scrape-and-
persist pipeline — and ran **18 minutes** to answer a question that a read tool now serves
in 0.5 seconds. The agent wasn't malfunctioning. It picked the nearest affordance capable
of producing the answer, because no cheaper one existed.

The fix was two-part, and both parts generalize:

1. **A read sibling.** `agent-showtimes` was built specifically to absorb count questions.
   Rule: **a capture affordance over some entity owes a read affordance over the same
   entity**, or agents will use the capture path as a read path. This is mechanically
   lintable — scan already knows each affordance's kind and can diff entity coverage
   between kinds, emitting "capture affordance `X` has no read sibling; agents will route
   read questions to it."
2. **The description is a routing signal.** Part of the fix was prose: `agent-price-gather`
   now opens with "SLOW… for COUNTS use agent-showtimes." Affordance descriptions are not
   documentation for humans, they are the selection surface the model reads. Scaffold
   should say so, and should prompt for cost/alternative language on anything expensive.

## NEW P1 — Every UI download button is an affordance the agent cannot reach (scan, high, score 3)

**The gap.** The app had CSV and Markdown export working fine — as browser download
buttons. An MCP agent cannot click one. The capability existed, was fully implemented, and
was invisible to every agent on the surface. `agent-export` was built to return the file
content as text so the agent can save it itself.

**The change.** This is the most mechanically detectable finding in the whole doc. Scan
knows how to find export/download handlers (content-disposition headers, blob downloads,
Streamlit `download_button`, `send_file`, CSV writers behind a route). Every one is a
capability with no agent-reachable path. Emit as a finding class: **"user-only capability —
reachable by a human in the UI, unreachable by an agent."** Generalizes past downloads to
anything gated behind a browser-only interaction: clipboard, print, file picker, drag-drop.

## NEW P2 — Slow affordances need a three-piece pattern, and the schema has no word for "slow" (schema + scaffold, medium, score 2)

**The gap.** `agent-price-gather` can run six minutes on a large market. Three affordance
features got co-designed under pressure to make that usable: an `estimate_only` mode
(scrape the cheap half, return an ETA, write nothing), a `background: true` mode (return a
job id in 0.2s, work in a daemon thread), and a separate `agent-job-status` poller. The
estimate self-improves off recorded run metrics.

Any affordance over roughly 30 seconds wants all three, and vibe-access has no vocabulary
for the situation. Proposal: `slow: true` (or a `costHint`) per affordance in the manifest
schema; scaffold generates the estimate/background/status triad when set; verify treats a
slow affordance's estimate path as the probe target rather than the full run. Related to
the `destructive` flag — both are cost/consequence metadata the MCP layer already models
and the manifest doesn't.

## Second intake — what the completed RoRoRo run added (2026-07-10)

The full arc on ROROROblox, end to end: verify run f7ebdbd1 caught update-ui/remove-ui
fail-open (14/16) → fixed same day (16/16, run 34cf3714) → an **agent-ops surface spec**
(`ROROROblox/docs/superpowers/specs/2026-07-10-agent-ops-surface-design.md`) designed the
capability adds the builder actually wanted → Gap 1 landed (`stop-accounts` rpc + a
**fail-closed capability map with startup `AssertExhaustive()`**) → manifest 16→17,
re-verified 17/17 (run b9972f14), with Gaps 2-3 queued to take it to 20 on a stated
"re-run scan → map → verify after each gap lands" cadence.

**Refinements this drives into the existing items:**

- **P0 interview — the output artifact now has a proven shape.** Not a pick-list: a
  capability-add design in the agent-ops-spec mold — enumerated gaps, per-gap affordance
  spec (id/kind/tier/auth/capability/description written for an agent reader,
  destructive semantics spelled out), and the rescan-remap-reverify cadence per landed
  gap. `:scaffold` on a product surface should culminate in that doc; the six-need
  checklist stays the floor for dev-loop surfaces.
- **Fail-open lint (was P2) → P1, evidence attached.** "An rpc added to the proto but
  forgotten in the map ships wide open. That is exactly how UpdateUI and RemoveUI
  shipped." The recommended fix shape is now known: unknown → deny, plus a startup
  exhaustiveness assert — "the assert is the deliverable." Scan should emit this finding
  class with that suggested shape on any capability-map stack.
- **NEW P1 — `destructive` flag on affordances (schema, high, score 3).** The
  stop-accounts entry had to carry "DESTRUCTIVE — closes real Roblox clients…" in prose,
  plus an operational note (poll get-running-accounts before relaunch). MCP tool
  annotations already have `destructiveHint`/`readOnlyHint`; the manifest is the MCP
  embryo, so formalize `destructive: boolean` (and consider `idempotent`) per affordance.
  Verify treats destructive affordances like seed/reset: local-only probing posture.
- **NEW P2 — post-add cadence in the router prose.** After any capability lands, the
  router recommends the rescan → remap → reverify loop by name (the RoRoRo spec wrote
  this cadence by hand; the router should own it). Related note for verify semantics on
  assert-backed surfaces: "the verify run's ability to connect is itself part of the
  proof" — connection success is evidence when the host refuses to start on an
  incomplete capability map.

## P0 — The capability-intent interview (builder feedback, high confidence, score 3)

**The gap.** The scaffold flow derives candidates from the fixed six-need checklist
(seed/reset/capture/discovery/read/act). On WeSeeYou that worked because the checklist IS
the dev-loop shape for a web app. On ROROROblox it produced nothing usable — the app's
access surface is a product plugin contract, the generic needs don't apply, and scaffold
stood down. The builder then scaffolded manually with the agent, outside the plugin.
Direct quote of the requirement: *"there needs to be a deeper conversation during the
process for the user's expected capability add."*

**The change.** `:scaffold` (and the router when it recommends scaffold) opens with a
capability-intent conversation BEFORE the gap diff: "What do you want an agent — or your
users' agents — to be able to DO in this app that they can't today?" Answers become
custom affordance specs (id, kind, tier, description, acceptance probe) that join the
six-need candidates in the pick list. The checklist becomes the floor, not the ceiling.
This is a **prose-only change to skills/scaffold + skills/router** — no engine work —
and can ship as v0.1.1.

**Also:** when the adapter is agnostic/not-yet-implemented, scaffold must NOT stand down
silently. It runs the same interview and hand-carries the specs with the agent (gate
mechanism from adapter-notes), exactly like scan/map's agnostic path already does.

## P1 — `overrides.kind` (engine, high confidence, score 3)

On gRPC every rpc is POST, so all 16 ROROROblox affordances defaulted to kind `act`;
7 are honestly `read`. Kind was edited in place and gets clobbered on re-map because
`overrides` only carries tier + description. Add `kind` to the overrides schema +
`buildManifest` merge (still through `assertTierLegal`). Small, schema + map + tests.

## P1 — Auth vocabulary: optional `capability`/`authDetail` field (schema, high, score 3)

`none|session|token` can't express capability-based consent (ROROROblox: pipe ACL +
per-capability DPAPI grants; the required capability string per route had nowhere to live
except the dated report). Add an optional free-text `authDetail` per affordance. The
verify contract extends naturally: a held gate is PermissionDenied/Unauthenticated/
FailedPrecondition, not just 401/403 (the RORORO driver proved the mapping).

## P1 — Transport seam for verify (engine, medium, score 2)

`runVerify` is fetch()-only and `npipe://` fails the locality check. The RORORO run
hand-built a C# gRPC driver and fed results through `stampManifest` + `renderVerifyReport`
for artifact parity — that recipe works but lives outside the engine. Minimum: a
documented `--results <file>` intake path (agent-driven verify feeding engine stamping);
maximum: a VerifyDriver seam per adapter. Also: treat `npipe://` and other local IPC
schemes as local in `isLocalUrl`.

## P2 — dotnet-wpf-desktop adapter promotion (adapter, medium, score 2)

The seed is complete in `~/.claude/plugins/data/vibe-access/adapter-notes/dotnet-wpf-desktop.md`:
detection signals (slnx/csproj/UseWPF + gRPC proto), route source (.proto rpc parse),
auth mapping (pipe ACL + capability map), direction predicate (host-implements vs
host-consumes — a desktop-only unmapped class), gate mechanism (#if DEBUG / appsettings
flag), and the headless-production-host verify recipe (reference the app, host the service
minus the GUI shell — don't fight the startup modal). Promote when a second .NET target
confirms the shape (Sanduhr is the obvious candidate).

## P2 — Verify preflight checks (engine/skill, medium, score 2)

Two RORORO stalls a preflight would have named plainly: (a) SDK pin — `dotnet --version`
vs global.json mismatch failed devRunCommand mid-run; (b) the GUI startup modal blocking
the pipe (environment-dependent). Verify skill should preflight the dev-run prerequisites
and report blockers before probing.

## P2 — Capability-map fail-open lint (scan, medium, score 2)

RORORO's interceptor treated unknown rpc names as ungated (map lookup → null → allow).
Scan on capability-map stacks should diff the service's rpc list against the map and flag
unmapped-but-gatable methods. Generalizes: "deny-by-default check" as a scan finding class.

## Standing v0.2 items (carried from WeSeeYou dogfood)

Parameterized-path probing (input schemas), optional-auth modeling, remaining scaffold
kinds dogfood, 405-fails-public-routes, CLI `--strict` + bare-flag guard, re-scaffold
backup of plan.files, multi-site firebase.json.

## Wins worth keeping (do not regress)

- Foreign-handle probing of "downstream-gated" affordances found a real fail-open in the
  target app (UpdateUI/RemoveUI), fixed same day. Verify-as-security-check is the
  plugin's sharpest edge — the transport seam must preserve it.
- Handshake-rejection-is-a-pass semantics (an rpc answering per contract with a refusal
  is a healthy gate, not a failure).
- The agnostic path's artifact parity discipline (hand-built results through the engine's
  own stamp/render) kept the manifest honest with zero adapter code.
- **(PriceScout)** The manifest graduating to a real MCP server — scaffold output →
  stdio server → remote streamable-HTTP behind OAuth — worked without rewriting the
  affordance definitions. The manifest really is the MCP embryo; input/output schemas and
  `destructiveHint` carried straight through. That path should stay explicit in the docs.
- **(PriceScout)** Generating surface documentation *from the manifest* rather than from
  the source means the docs cannot drift from what is deployed. Both artifacts in that
  repo's `docs/vibe-access/` are manifest-derived and dated for exactly this reason. Worth
  making the default posture of `:describe` / `:visualize` output.
