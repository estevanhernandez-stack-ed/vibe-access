# Proposed changes — evolve-access intake

> Written by hand while `/vibe-access:evolve-access` is a v0.1 placeholder. Sources: the
> ROROROblox agnostic-path run (2026-07-09/10, adapter-notes `dotnet-wpf-desktop.md` +
> `.vibe-access/` artifacts in that repo) and direct builder feedback (2026-07-10).
> Scoring: count × confidence weight {high: 3, medium: 2, low: 1}.

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
