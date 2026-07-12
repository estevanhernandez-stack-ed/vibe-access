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
4. Fill the three authored fields where they apply. Map never generates them; they
   survive re-map on both merge paths.
   - **`authDetail`** (string, optional) — the real consent unit, because
     `none|session|token` cannot express capability-based consent. The convention: EITHER
     the capability string the route requires, verbatim (`host.commands.stop-accounts`),
     OR one sentence naming the mechanism ("Firebase ID token via `Authorization:
     Bearer`"). Do not put it in the description — a re-map regenerates templated
     descriptions and the consent story goes with them.
   - **`destructive`** (boolean, optional) — true when calling it breaks things
     (kills sessions, wipes state, charges money). Absent means UNCLAIMED, not false;
     claim it explicitly. Orthogonal to tier: tier answers "may agents touch prod,"
     destructive answers "does it break things." A `destructive: true` affordance is
     never auto-probed by verify.
   - **`overrides.kind`** (optional) — when the derived kind is wrong (every gRPC call
     is a POST, so read-only rpcs derive `act`). Overriding to `seed`/`reset`/`capture`
     requires `overrides.tier: "dev"` alongside it — seed/reset/capture can never be
     prod-safe, and the schema refuses it mechanically, override or not.
5. Recommend `/vibe-access:scaffold` (if gaps) or `/vibe-access:verify` next. When there
   are neither gaps nor unverified rows, hand off to the v0.2 surfaces instead:
   `/vibe-access:describe` if any affordance still carries a machine-template description,
   otherwise `/vibe-access:visualize` — render the sheet, see what an agent sees.
