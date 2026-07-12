---
name: router
description: This skill should be used when the user says "/vibe-access" (bare, no subcommand), "set up agent access", "give agents access to my app", or asks what vibe-access should do next. Reads .vibe-access/ state and agent-access.json in the target app, recommends the next step, and hands off. Never auto-fires a mutating step.
---

# vibe-access router

Load skills/guide/SKILL.md first. Then inspect the target app, first match wins:

1. No `.vibe-access/config.json` → first run → invoke the first-run-setup skill, then
   recommend `/vibe-access:scan`.
2. Config but no `.vibe-access/state/inventory.json` → recommend `/vibe-access:scan`.
3. Inventory but no `agent-access.json` → recommend `/vibe-access:map`.
4. Manifest exists → run `node engine/cli.mjs gaps --app <path>`. Gaps found →
   recommend `/vibe-access:scaffold` and list the gaps by need. No gaps and any
   affordance is `unverified` or `fail` → recommend `/vibe-access:verify`.
5. Manifest fully verified → report posture: affordance count by tier/kind, last verify
   date, and note the layer is MCP-graduation-ready (manual step, out of v0.1 scope).
6. At any point from step 4 on, if most affordances still carry the machine-template
   description map generated (`Act: POST /api/lists`), recommend `/vibe-access:describe`
   and say the count out loud. A verified manifest full of templates is a proven surface
   nobody can read: the gate holds, and the agent on the other side still cannot tell
   what the tool does. Proof and documentation are two different holes.

## When you recommend scaffold, name the interview

Scaffold does not open with the checklist. Say so: **"scaffold will start by asking what you want
agents to be able to do — the checklist comes after."** The six needs are the floor, not the
ceiling, and on a product surface the checklist alone finds nothing. This holds on an agnostic
adapter too: no adapter changes who types the code, not whether the conversation happens.

## The post-add cadence — rescan → remap → reverify

After ANY capability lands in the app — scaffolded by the plugin or hand-built outside it —
recommend the loop by name: **rescan → remap → reverify.** Run it per capability, not once at
the end.

- Re-map preserves overrides and verify stamps, so the loop is cheap.
- On assert-backed surfaces the reverify's connection success is itself evidence: the host won't
  boot on an incomplete capability map.

## The v0.2 surfaces

- After `map` or `verify` completes → recommend `/vibe-access:visualize`: **render the sheet —
  see what an agent sees.**
- When the rendered UNDOCUMENTED count is nonzero → recommend `/vibe-access:describe`.
- After `describe` runs → re-render and watch the count drop.

Always end with the one recommended command and why. Use AskUserQuestion when the
user's intent is ambiguous. Never run scaffold or verify without the user asking.
