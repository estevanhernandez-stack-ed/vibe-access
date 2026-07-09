---
name: verify
description: This skill should be used when the user says "/vibe-access:verify", "prove the layer", "test the agent access", "drive the app through the manifest", or after scaffold completes. Exercises every affordance cold — manifest only, no source reading. Never runs against a non-local URL without explicit user say-so (--force).
---

# vibe-access verify

Load skills/guide/SKILL.md. Requires agent-access.json.

The cold rule: from this point you work from the manifest ALONE. Do not read the app's
source to figure out how to call an affordance — if you have to, that is a verify
FAILURE of the manifest's description quality. Fix the description, then retry.

1. Confirm the dev server is running (config.devRunCommand tells you how to start it;
   ask the user or start it yourself in background).
2. Run `node engine/cli.mjs verify --app <target>` (add `--base-url` if config's dev
   URL is stale; NEVER pass --force without the user explicitly choosing it).
3. For each `pending-agent` result (capture-kind): drive the affordance via the
   Playwright MCP tools — call the affordance's transport to stage the view, navigate,
   screenshot, judge the result — then stamp:
   `node engine/cli.mjs stamp <id> <pass|fail> --run <runId> --app <target>`.
4. Report per-affordance results from the dated report. Failures get a one-line
   diagnosis each. The layer is done when every affordance is pass — say so plainly
   when it is, and say what is NOT verified when it is not.
