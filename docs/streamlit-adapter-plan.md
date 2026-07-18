# Implementation plan: streamlit adapter

*2026-07-17 · companion to `streamlit-adapter-scope.md` (scope + resolved proposals) · fixture: PriceScout*

Decisions carried in from scope sign-off: `sidecarPort` as a config field (default 8765) · requirements changes are note-only, never patched · fixture affordances return static payloads (verify proves transport + gate, not app logic).

Work happens on branch `streamlit-adapter` in this repo; the marketplace canary tracks `main`, so nothing lands there until the dogfood pass is green.

## Ordered steps

### 1. Detection grows a Python probe — `engine/detect.mjs`

- New detection fields, null when absent: `requirementsPath`, `pyprojectPath`, `streamlitEntry`.
- Probe: `requirements.txt` line-matching `/^streamlit\b/i`, or `pyproject.toml` containing a streamlit dependency. Entry script: scan `appRoot` root, `app/`, `src/` (one level, no deep recursion — detect stays fast) for `.py` importing streamlit; prefer the one calling `st.set_page_config`.
- Precedence: firebase.json + functions dir keeps its early return, untouched. The streamlit check runs **after firebase, before the JS-deps loop** — a Python app with a dormant `frontend/package.json` resolves `streamlit`, not `unknown`. PriceScout is the regression fixture for exactly this ordering.

### 2. Adapter module — `engine/adapters/streamlit/index.mjs`

- `id: 'streamlit'`, `matches: (d) => d?.framework === 'streamlit'`.
- `detectRoutes(ctx)`:
  - Sidebar-mode shape: locate `ui_config.json` near the entry (`sidebar_modes`), regex the entry's dispatch arms (`mode == "X"` → handler call), resolve handler imports to `app/modes/*.py` paths and `render_*` export names. One `RouteEntry` per mode, `method: "UI"`, `path: null`.
  - Native multipage shape: enumerate `pages/*.py` → one entry per page.
  - `UnmappedEntry` with reason for: config modes without dispatch arms, dispatch arms without files, dynamic dispatch the regex can't resolve. Never silently drop.
- `detectAuth(route, ctx)`: session-gate heuristic over the entry + its imports (bcrypt / session-token / login-form signals) → `'session'` for all modes when found, else `'none'`. Role-gating recorded as route metadata note.
- `gateMechanism()`: `env-flag+loopback` as specced.

### 3. Sidecar scaffold — `engine/adapters/streamlit/templates.mjs`

- `scaffoldAffordance(spec, ctx)` returns a pure plan:
  - `access_sidecar/access_api.py` — FastAPI factory; hard boot-refusal without `VIBE_ACCESS_DEV=1`; docstring pins `--host 127.0.0.1`; `GET /access/` discovery route listing registered affordances.
  - `access_sidecar/affordances/<id>.py` — per-spec module with an import-target placeholder and the transport shape (`POST /access/<id>`, `GET` for reads).
  - Every emitted file carries `vibe-access:dev-gate` (scaffold.mjs enforces).
  - `plan.notes`: uvicorn run command with the config's `sidecarPort`, the fastapi+uvicorn dependency line for the app's requirements (note-only), prod-deploy-is-out-of-scope statement.
  - `plan.patches`: empty in v1 — the sidecar is additive; nothing in the host app is edited.

### 4. Config surface — `schemas/config.schema.json`

- Add optional `sidecarPort` (integer, 1024–65535). Schema is `additionalProperties: false`, so this is a schema change; bump nothing else. Engine reads it with an 8765 default. `first-run-setup` skill text gains one line mentioning the field.

### 5. Fixtures — `tests/fixtures/`

- `streamlit-minimal/` — requirements.txt, `app.py` entry with login gate + dispatch table, `ui_config.json` with two modes (one deliberately missing its dispatch arm → unmapped coverage), `modes/one_mode.py`.
- `streamlit-pages/` — micro fixture with `pages/` directory, no login gate (auth `'none'` path).
- Fixture affordance payloads static per scope decision.

### 6. Tests — extend `tests/adapters.test.mjs` + detect tests

- Detect: streamlit-minimal → `framework: 'streamlit'` with entry + requirements paths; firebase + streamlit coexisting → `firebase-functions`; streamlit + dormant `frontend/package.json` → `streamlit` (the PriceScout case); JS-only apps unchanged.
- Adapter: matches truth table; detectRoutes on both fixtures including the unmapped reason; detectAuth session vs none; scaffold plan contains the gate marker in **every** file and zero patches; resolveAdapter returns `ready` for streamlit detection.
- Existing suite stays green (`npm test`, jest).

### 7. Registration + release hygiene

- `IMPLEMENTED_ADAPTERS` gains the adapter (no stub to remove — streamlit never had one).
- CHANGELOG entry; plugin version bump 0.2.0 → 0.3.0; README adapter mention.

### 8. Dogfood on PriceScout (gated on 1–7 green)

- Against the live repo: detect → scan → map → scaffold (apply) → run sidecar → verify cold.
- Expected artifacts landing in **PriceScout**: `access_sidecar/`, `agent-access.json`, `sidecarPort` in `.vibe-access/config.json`. The five-affordance set from scope (seed / reset / read / capture / discovery) binds to `app/compliance/posting_check` + the market-sweep path.
- Artifacts landing **here**: `docs/dogfood/<date>-pricescout.md` run notes; `adapter-notes/streamlit.md` seeded from the run.
- The B-308 closure check: original `posting_check_demo.py` pointed at the sidecar base URL should drive expectations + run end-to-end.

## Test list (acceptance)

1. Detect truth table (4 cases) passes.
2. Both fixtures route-map with correct entries + unmapped reasons.
3. Scaffold plan: gate marker in every file, notes carry port + deps, patches empty.
4. `npm test` fully green including pre-existing suites.
5. Dogfood: cold verify stamps every PriceScout affordance pass; demo script drives the sidecar.

## Blast radius

`detect.mjs` (shared — the precedence change is the one cross-adapter risk, covered by the truth table), `adapters/index.mjs` (one-line registration), new adapter dir, one schema field, fixtures/tests. Firebase adapter untouched. Host apps: additive files only, never edited.
