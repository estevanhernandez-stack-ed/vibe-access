---
name: scaffold
description: This skill should be used when the user says "/vibe-access:scaffold", "fill the gaps", "add the missing affordances", "add seed/reset endpoints", or wants purpose-built agent endpoints generated. MUTATING — writes new gated files under the app's source tree, backup-wrapped; patches to existing files are reviewed and applied via Edit, never blind.
---

# vibe-access scaffold

Load skills/guide/SKILL.md. Requires agent-access.json (else recommend map).

1. Run `node engine/cli.mjs gaps --app <target>`. Present the gaps and let the user
   pick which to scaffold (AskUserQuestion, multiSelect). Never scaffold unpicked gaps.
2. For each picked gap, get the plan from the adapter (the engine applies new files;
   you apply patches):
   - New files: written by `applyPlan` with the dev-gate marker check and a backup
     batch. The template body is a stub — YOU write the app-specific implementation
     into it now (seed: create representative docs via the app's own patterns; reset:
     delete/restore the seeded set; read-state: return the collections a verifier
     needs; capture: put the app into the named visual state). Match the app's code
     style. Keep the gate function untouched.
   - Patches (index.js export line, firebase.json rewrite): show the user each
     insert, then apply via Edit. The rewrite entry goes BEFORE the `**` catch-all.
3. After applying: re-run scan + map so the new routes join the inventory, then update
   the scaffolded affordances' origin/tier in the manifest (they arrive as
   origin: scaffolded, tier: dev — the engine enforces the refusal rule).
4. State the rollback path: `.vibe-access/scaffold/backup/<batchId>/` restores patch
   targets; new files are listed in the apply output — delete them to undo.
5. Recommend `/vibe-access:verify` next.
