---
name: session-logger
description: Internal placeholder (v0.1) — reserved logging contract for vibe-access sessions. Command skills reference it at start and end; it documents the format so the data home is stable when implemented.
---

# session-logger (v0.1 placeholder)

Reserved path: `~/.claude/plugins/data/vibe-access/sessions.jsonl` (append-only).
Entry shape, two-phase per session:
start `{sessionUUID, timestamp, command, targetApp, outcome: "in_progress"}` /
end `{sessionUUID, timestamp, command, targetApp, outcome: completed|aborted|error,
durationMs, summary: {routes, affordances, gapsScaffolded, verifyPass, verifyFail}}`.
Never log source contents, URLs with credentials, or auth material. v0.1 writes
nothing — the contract exists so v0.2 doesn't break format.
