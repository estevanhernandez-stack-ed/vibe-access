---
name: friction-logger
description: Internal placeholder (v0.1) — reserved friction-event contract. Command skills name their trigger codes; v0.2 implements the writes.
---

# friction-logger (v0.1 placeholder)

Reserved path: `~/.claude/plugins/data/vibe-access/friction.jsonl` (append-only).
Entry `{timestamp, sessionUUID, command, trigger, confidence, context}`.
Trigger catalog (confidence fixed per code): `no-recognized-stack` (high),
`inventory-schema-violation` (high), `manifest-refusal-tripped` (high),
`unmapped-majority` (medium — more unmapped than mapped), `verify-nonlocal-forced`
(high), `cold-read-failed` (high — verifier had to read source; P0, the manifest
failed its purpose), `scaffold-rolled-back` (medium), `adapter-notes-written` (low).
