# vibe-access

Give agents pipelines into your app. Vibe-access scans your routes and auth model,
maps every callable surface into a schema-versioned `agent-access.json` manifest with
dev and prod-safe tiers, then proves the layer with a cold-agent verify that exercises
every affordance before anything counts as done.

## Where this sits

The family's access work runs in three stages: **agent affordances → agent-facing API →
MCP server**. Vibe-access owns the middle: it maps what your app already exposes into an
agent-facing API, scaffolds the affordances it's missing, and writes them into a manifest
an agent can read cold. The manifest is the embryo of your eventual MCP server, not the server itself.
Graduating a verified manifest into a real MCP server stays a deliberate, manual step —
vibe-access won't do it for you.

## Install

Canary (tracks `main`, moves fast):

```
/plugin marketplace add estevanhernandez-stack-ed/vibe-access
```

Stable (tagged, promoted deliberately):

```
/plugin marketplace add estevanhernandez-stack-ed/vibe-plugins
```

## The six commands

| Command | What it does |
|---|---|
| `/vibe-access` | Router. Reads your `.vibe-access/` state and `agent-access.json`, tells you the one next command and why. Never runs a mutating step on its own. |
| `/vibe-access:scan` | Route + auth inventory. Read-only — walks your routes, classifies auth (none/session/token), flags every unmapped entry as a first-class finding. |
| `/vibe-access:map` | Builds `agent-access.json` from the scan. Read-only against your source; re-runnable — preserves overrides and verify stamps. |
| `/vibe-access:scaffold` | Fills the gaps you pick (seed, reset, read-state, capture, discovery). Mutating — backup-wrapped, dev-gated, patches shown and applied via Edit, never blind. |
| `/vibe-access:verify` | Cold-agent pass. Works from the manifest alone — no reading your source to figure out a call. Local-only unless you force it. Stamps each affordance pass/fail. |
| `/vibe-access:vitals` | Structural self-test of the plugin install itself, not your app. Eight checks, banner report. |

## The manifest

One affordance, trimmed from `tests/fixtures/reference-626-manifest.json`:

```json
{
  "schemaVersion": 1,
  "app": "626labs-dashboard",
  "adapter": "reference-hand-written",
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "baseUrls": { "dev": "http://localhost:3626" },
  "discoveryRoute": null,
  "affordances": [
    {
      "id": "manage-tasks",
      "description": "Create, update, or manage tasks in a project. Actions: create | update | updateStatus | addSubtask | bulkUpdate | bulkCreate.",
      "tier": "prod-safe",
      "kind": "act",
      "transport": { "type": "http", "method": "POST", "path": "/api/manage_tasks" },
      "input": { "type": "object", "properties": { "projectId": { "type": "string" }, "action": { "type": "string" }, "title": { "type": "string" } } },
      "output": null,
      "auth": "token",
      "sourceRef": "mcp-server/src/tools/tasks.ts:33",
      "origin": "existing",
      "verified": { "status": "unverified" }
    }
  ]
}
```

Four fields carry the weight: `tier` (dev or prod-safe — which environment this can
run in), `kind` (read/act/seed/reset/capture — what class of thing it does), `auth`
(none/session/token — what the caller needs, never a credential itself), and `verified`
(unverified/pass/fail/pending-agent — has anyone actually driven this call). An agent
reading this manifest cold should never need your source to know what's safe to call.

## Two tiers, one refusal

Affordances are `dev` (env-gated, never ships) or `prod-safe` (runs under the caller's
own auth, no elevated access). `seed`, `reset`, and `capture` kinds can never be tagged
`prod-safe` — that's not a warning, it's a refusal enforced at three layers: the schema
rejects it (`manifest.schema.json`'s `allOf` constraint), the engine throws if you try to
route around it, and the scaffolder refuses to apply any dev-tier file that doesn't
contain the adapter's gate marker (`vibe-access:dev-gate`). There's no flag that lets a
seed endpoint into production.

## Adapters

| Adapter | Status |
|---|---|
| `firebase-functions` | Ready. Hosting-rewrite route detection, ID-token auth mapping, seed/reset/read-state/capture/discovery scaffolds. |
| `nextjs` | Not yet implemented. |
| `express` | Not yet implemented. |

Unrecognized stack, or one of the two above before it lands: the adapter seam reports
`not-yet-implemented` honestly instead of guessing. Take the agnostic path — do the
adapter's four jobs by hand against the same contracts in
`engine/adapters/adapter.contract.md` — and vibe-access writes what you learned to
`~/.claude/plugins/data/vibe-access/adapter-notes/<stack>.md`. That file seeds the next
real adapter.

## Validated against

WeSeeYouAtTheMovies. 84 routes scanned, 85 affordances, verify 76/85 (all 9 fails classified: an app-side bug family plus two named v0.2 gaps). The run surfaced 7 plugin bugs, all fixed same session with regression tests. Full record: `docs/dogfood/M-weseeyou-2026-07-09.md`.

## License

MIT — 626Labs LLC.
