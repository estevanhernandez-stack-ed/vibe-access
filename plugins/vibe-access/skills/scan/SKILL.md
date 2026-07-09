---
name: scan
description: This skill should be used when the user says "/vibe-access:scan", "scan my routes", "inventory my API surface", "what can an agent call in this app", or wants the route/auth inventory. Runs the engine scan; writes .vibe-access/state/inventory.json plus a dated report in docs/vibe-access/. Read-only — no source mutation.
---

# vibe-access scan

Load skills/guide/SKILL.md. Ensure config exists (else run first-run-setup).

1. Run `node engine/cli.mjs scan --app <target>`.
2. If adapterStatus is `not-yet-implemented`: tell the user which stack was detected,
   offer the agnostic path (guide has the contract), and — if they accept — build the
   inventory by hand to the same schema, then write adapter-notes.
3. Summarize: route count, auth split (none/token/session), and EVERY unmapped entry
   with its reason. Unmapped is a first-class finding, not noise.
4. Point at the dated report. Recommend `/vibe-access:map` next.
