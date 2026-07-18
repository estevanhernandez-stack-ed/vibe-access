# Streamlit adapter — scope

*2026-07-17 · fixture app: PriceScout (Streamlit/Python, 9-mode sidebar, SQLite, bcrypt session auth) · status: scoped, awaiting plan*

Implement `adapters/streamlit/` so vibe-access can map, scaffold, and verify agent affordances for Streamlit apps. Streamlit inverts the plugin's core assumption — there are no routes, so the callable surface must be *created*, not discovered. The adapter's center of gravity is `scaffoldAffordance`, not `detectRoutes`.

## The shape of the problem

A Streamlit app is one URL, one websocket, and session state. "Routes" are sidebar modes dispatched in Python; auth is a login gate wrapping the dispatch; nothing is HTTP-callable by an agent. The manifest schema and cold-verify are http-only (`transport.type` enum: `["http"]`; `verify.mjs` does raw fetch) — so the adapter's scaffold output is a **dev-gated FastAPI sidecar** that imports the app's own logic and exposes it as endpoints. That keeps every downstream stage (manifest → verify → eventual MCP graduation) working unmodified.

## Contract fulfillment

### 1. `matches(detection)`
`detection.framework === 'streamlit'`. Requires the engine change below — `detect()` is JS-only today (firebase.json + package.json walk); a Python-shaped app currently lands `unknown`.

### 2. `detectRoutes(ctx)`
Honest inventory of the mode registry, not fake URLs:

- Primary source: `ui_config.json` `sidebar_modes` + the `if mode ==` dispatch table in the entry script → one `RouteEntry` per mode: `{ name: <mode>, method: "UI", path: null, sourceRef: <entry>:<dispatch line>, handlerSourcePath: app/modes/<file>.py, sourceExportName: render_* }`.
- Native multipage apps (`pages/` directory) → one `RouteEntry` per page file. PriceScout doesn't use this; the fixture set must cover both shapes.
- Modes in config without a dispatch arm, or dispatching to a missing file → `UnmappedEntry` with reason. KTD-3: never silently drop.

### 3. `detectAuth(route, ctx)`
Coarse and honest: if a login gate wraps the dispatch (bcrypt/session-token patterns, `st.session_state` auth flags), every mode is `'session'`; bare apps are `'none'`. Per-mode role gating (PriceScout's `role_permissions.json`) lands in route metadata as a note, not a fake auth class. `'token'` unused in v1.

### 4. `scaffoldAffordance(spec, ctx)` — the payoff
Pure plan (no writes — `scaffold.mjs` applies) generating a sidecar:

- `access_sidecar/access_api.py` — FastAPI app factory. Boot-refuses unless `VIBE_ACCESS_DEV=1`; binds `127.0.0.1` only; every file carries the `vibe-access:dev-gate` marker (engine refuses dev-tier plans without it).
- `access_sidecar/affordances/<id>.py` — one module per spec, importing app logic directly (`from app.compliance.posting_check import run_check`), exposed as `POST /access/<id>` (`GET` for reads).
- Plan `notes`: run command (`VIBE_ACCESS_DEV=1 uvicorn access_sidecar.access_api:app --port <port>`), dependency line for the app's requirements (fastapi + uvicorn), and the explicit statement that prod deployment of the sidecar is out of scope.
- Manifest transport: `http` on `baseUrls.dev` sidecar origin — port from `.vibe-access/config.json` (new optional field `sidecarPort`, default 8765).

### 5. `gateMechanism()`
`{ kind: "env-flag+loopback", description: "sidecar refuses boot without VIBE_ACCESS_DEV=1 and binds 127.0.0.1 only; marker vibe-access:dev-gate in every scaffolded file" }`.

## Engine change — detection grows a Python probe

`detect.mjs` additions (cross-adapter blast radius, keep surgical):

- Scan `requirements.txt` / `pyproject.toml` for `streamlit`; locate the entry script (a `.py` importing streamlit, preferring one calling `st.set_page_config`).
- New detection fields: `requirementsPath`, `streamlitEntry` (null when absent).
- Precedence: `firebase.json` + functions dir still wins (unchanged, first return). Then **streamlit before the JS-deps walk** — a Python app with a dormant `frontend/package.json` must resolve `streamlit`, not `unknown`/`nextjs`. PriceScout is literally this case and is the regression fixture for the ordering.

## PriceScout affordance set (proves every kind)

| kind | affordance | backing call |
|---|---|---|
| seed | add-posting-expectation | `posting_check.create_expectation(...)` |
| reset | deactivate-expectations | `posting_check.deactivate_expectation(...)` (destructive → dev tier, gated) |
| read | run-posting-check | `posting_check.run_check(from, to)` — skip-scrape path, fast |
| capture | sweep-market | one-market showtime scrape + upsert (`get_all_showings_for_theaters`) |
| act | discovery | list affordances from the manifest (`GET /access/`) |

Full circle: the B-308 handoff specified four HTTP endpoints we deliberately didn't port into Streamlit — this sidecar re-materializes them as the agent-access layer, and the original `posting_check_demo.py` works against it with a base-URL change.

## Fixtures + tests

- `tests/fixtures/streamlit-minimal/` — synthetic app mirroring PriceScout's shape (requirements.txt, entry with dispatch table, `ui_config.json`, one mode module) checked into the repo; a second micro-fixture for the `pages/` multipage shape.
- PriceScout = live dogfood fixture (docs/dogfood convention): scan → map → scaffold → verify end-to-end; seeds `adapter-notes/streamlit.md`.
- `tests/adapters.test.mjs` extensions: matches truth table (firebase+streamlit coexisting → firebase; streamlit + dormant frontend package.json → streamlit), detectRoutes on both fixtures incl. unmapped reasons, scaffold plan contains the gate marker in every file, resolveAdapter returns ready.
- Registration: add to `IMPLEMENTED_ADAPTERS` in `adapters/index.mjs` (no stub to remove — streamlit never had one).

## Out of scope (v1)

- Driving the Streamlit UI itself (websocket puppeteering) — never.
- CLI transport — would break the http-only manifest schema and cold-verify; not worth the schema bump.
- Prod-safe tier affordances — everything ships dev-gated; promoting reads to prod-safe is a later, deliberate call.
- Sidecar auth beyond the dev gate (no user/role passthrough).
- Auto-wiring the sidecar into systemd next to the app — documented in plan notes, never scaffolded.
- MCP graduation (per the family rule: always manual).

## Open questions

1. `sidecarPort` in config vs fixed 8765 — proposal: config field, default 8765.
2. Scaffold patches the app's `requirements.txt` directly, or note-only? Proposal: note-only (the engine's patch machinery targets anchors; requirements ordering is app-owned).
3. Does the streamlit-minimal fixture need a fake DB layer for verify to pass cold, or do fixture affordances return static payloads? Proposal: static — verify proves transport + gate, not app logic.

## Estimate

One focused session: detect probe + adapter (~250 lines) + sidecar templates + two fixtures + test extensions. The sidecar template is the largest single chunk.
