---
name: scaffold
description: This skill should be used when the user says "/vibe-access:scaffold", "fill the gaps", "add the missing affordances", "add seed/reset endpoints", or wants purpose-built agent endpoints generated. Opens with the capability-intent interview, then diffs against the six-need checklist. MUTATING — writes new gated files under the app's source tree, backup-wrapped; patches to existing files are reviewed and applied via Edit, never blind.
---

# vibe-access scaffold

Load skills/guide/SKILL.md. Requires agent-access.json (else recommend map).

## 0. The capability-intent interview — FIRST, before the gap diff

The six-need checklist (seed / reset / capture / discovery / read / act) is the right shape
for a web dev-loop. It is the wrong shape for a product surface, and on a product surface a
checklist-only scaffold finds nothing, stands down, and the builder ends up scaffolding by
hand outside the plugin. So the conversation comes first, always. Never run `gaps` before it.

**Open with this question, verbatim:**

> Before I diff this app against the standard checklist — what do you want an agent, or your
> users' agents, to be able to DO in this app that they can't today?

Then drill each answer until every intent yields a **complete affordance spec**. An intent is
not done until all six are answered:

- **Trigger** — agent-initiated, event-driven, or a user ask?
- **Kind** — read, act, or lifecycle (seed / reset / capture)?
- **Tier** — dev-only or prod-facing? Tier is mechanical (`assertTierLegal`): seed / reset /
  capture can NEVER be prod-safe. If the builder asks for a prod-safe seed, say so out loud
  and reshape the intent. Do not route around the engine.
- **Auth + capability** — who may call it: auth mode plus the capability string (→ `authDetail`).
- **Destructive** — does it destroy anything (→ `destructive`)? If yes, the destructive semantics
  get spelled out in the description, in words, for the agent reading it cold.
- **Acceptance probe** — how does an agent prove it works?

Take the intents one at a time. A half-specified intent is not a gap, it is a guess.

### The agnostic rider — BINDING

When the adapter is agnostic or not-yet-implemented, scaffold **does not stand down silently.**
It runs the same interview and hand-carries the resulting specs with the agent: you write the
code by hand against the same contracts and the same gate mechanism, exactly as scan and map's
agnostic path already do, and record what you learned in the adapter-notes file (see guide).
"No adapter" changes who types the code, not whether the conversation happens. Standing down
here is the bug, not the safe default.

## 1. Then the gap diff — the checklist is the floor, not the ceiling

Run `node engine/cli.mjs gaps --app <target>`. Merge the interview-derived specs with the
six-need candidates into ONE pick list, **interview items first**. Present it and let the user
pick (AskUserQuestion, multiSelect). Never scaffold unpicked gaps.

**Output artifact — product surfaces.** When the interview surfaces intents the checklist has no
name for, the output is not a pick list, it is a **capability-add design doc** in the agent-ops-spec
mold, written to `docs/vibe-access/capability-add-<YYYY-MM-DD>.md`:

- Enumerated gaps.
- Per gap, the full affordance spec: `id`, `kind`, `tier`, auth + capability, `description`
  written for an agent reader with destructive semantics spelled out, and the acceptance probe.
- The per-gap cadence: after each gap lands — **rescan → remap → reverify.**

For dev-loop surfaces where the six-need list covered everything and the interview added nothing
new, the existing pick-list flow stands. Don't manufacture a design doc for a seed endpoint.

## 2. Apply

For each picked gap, get the plan from the adapter (the engine applies new files; you apply patches):

- **New files:** written by `applyPlan` with the dev-gate marker check and a backup batch. The
  template body is a stub — YOU write the app-specific implementation into it now (seed: create
  representative docs via the app's own patterns; reset: delete/restore the seeded set; read-state:
  return the collections a verifier needs; capture: put the app into the named visual state). Match
  the app's code style. Keep the gate function untouched.
- **Patches** (index.js export line, firebase.json rewrite): show the user each insert, then apply
  via Edit. The rewrite entry goes BEFORE the `**` catch-all.

## 3. Close the loop

1. After applying: **rescan → remap** so the new routes join the inventory, then update the
   scaffolded affordances' origin/tier in the manifest (they arrive as `origin: scaffolded`,
   `tier: dev` — the engine enforces the refusal rule). Re-map preserves overrides and verify
   stamps, so the loop is cheap.
2. State the rollback path: `.vibe-access/scaffold/backup/<batchId>/` restores patch targets; new
   files are listed in the apply output — delete them to undo.
3. Recommend `/vibe-access:verify` next — **reverify** is the third beat of the cadence, and on
   assert-backed surfaces a clean connection is itself evidence.
