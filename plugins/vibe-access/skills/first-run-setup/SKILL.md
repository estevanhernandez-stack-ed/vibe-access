---
name: first-run-setup
description: Internal skill invoked on first vibe-access use in an app lacking .vibe-access/config.json, or directly on "set up vibe-access", "init vibe-access". Captures app name, adapter, base URLs, dev-run command. Writes exactly one file — .vibe-access/config.json. Idempotent; read-only on source.
---

# vibe-access first-run-setup

1. Run `node engine/cli.mjs detect --app <target>`. Report the detected framework.
2. Gather (AskUserQuestion where not derivable): app name (default: directory name),
   dev base URL (for firebase-functions: the hosting emulator origin, usually
   http://localhost:5000 — check firebase.json emulators block), prod base URL
   (optional), dev-run command (e.g. `firebase emulators:start`), one-line auth-model
   note.
3. Write .vibe-access/config.json matching schemas/config.schema.json (validate before
   reporting success). Re-running refreshes stale values; never touches anything else.
