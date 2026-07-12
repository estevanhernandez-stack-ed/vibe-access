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

## The agnostic path — you are the enforcement

On an app with no adapter, the engine cannot probe: you drive the affordances with a
hand-written driver and stamp results yourself
(`node engine/cli.mjs stamp <id> <pass|fail> --run <runId> --app <target>`). The probe
matrix `runVerify` enforces on the adapter path is, on this path, YOUR instruction set.
It is a convention here, not a guarantee — nothing in the engine catches you breaking it.

| Kind / field | Local base URL | Non-local base URL |
|---|---|---|
| `capture` | never probed — `pending-agent`, driven by an agent | `pending-agent` |
| `seed` / `reset` | probe it | **never probe.** No `--force` escape, today or ever |
| `destructive: true` | **never probe — not even locally.** "Local" is not "consequence-free": a destructive route on the dev host still kills real things | **never probe.** No escape |

Do not stamp a row you did not actually drive. A destructive affordance stays at its
last honest stamp (or `unverified`) until a human or an agent deliberately executes it.

A held gate is not only HTTP 401/403 — on non-HTTP transports it arrives as
`PermissionDenied`, `Unauthenticated`, or `FailedPrecondition`. A held gate is a PASS
of the access layer: the affordance is reachable and the gate works. Count it as
gate-held, never as an error, and never fold a handle-level gate-hold into the same
bucket as a transport-level one.

## Next step

End the run with one recommendation. If any affordance still carries a machine-template
description, recommend `/vibe-access:describe` and say the count. Otherwise recommend
`/vibe-access:visualize`: **render the sheet — see what an agent sees.**
