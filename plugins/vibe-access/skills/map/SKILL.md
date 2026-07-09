---
name: map
description: This skill should be used when the user says "/vibe-access:map", "build the manifest", "generate agent-access.json", or wants the agent-access manifest from a completed scan. Reads the inventory, writes agent-access.json at the app root. Read-only against app source; re-runnable — preserves overrides and verify stamps.
---

# vibe-access map

Load skills/guide/SKILL.md. Requires .vibe-access/state/inventory.json (else recommend scan).

1. Run `node engine/cli.mjs map --app <target>`.
2. Walk the generated manifest WITH the user at a glance: affordances by tier and kind,
   anything surprising (an unauthenticated act-kind route is worth a flag — suggest a
   tier override to dev, or a vibe-sec look).
3. Improve descriptions where the generated ones are thin — the manifest is written for
   an agent reader who has never seen the source. Edit agent-access.json descriptions
   directly; they survive re-map via overrides only if moved there, so prefer
   overrides.description for anything hand-tuned.
4. Recommend `/vibe-access:scaffold` (if gaps) or `/vibe-access:verify` next.
