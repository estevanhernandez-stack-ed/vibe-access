# Dogfood: streamlit adapter vs PriceScout — full pass

*2026-07-17 · branch `streamlit-adapter` · the acceptance gate from `streamlit-adapter-plan.md` step 8*

## Result

**Every affordance stamped pass.** detect → scan → map → scaffold → wire → verify ran end to end against the live repo, and the closure check held: seed → capture → state → reset drove real B-308 semantics over HTTP with no Streamlit in the path.

| stage | outcome |
|---|---|
| detect | `streamlit`, entry `app/price_scout_app.py`, dormant `frontend/package.json` seen and outranked |
| scan (pre-scaffold) | 0 routes · 11 unmapped — all 11 sidebar modes inventoried with handlers resolved |
| scaffold | 5 affordances applied (seed / reset / read-state / capture / discovery), gate marker everywhere |
| scan (post-scaffold) | 5 routes from the `vibe-access:route` markers · 11 unmapped modes |
| map + overrides | kinds/tiers baked (`seed/reset/capture` → dev; `assertTierLegal` clean), `discoveryRoute=/access/manifest` |
| gaps | 5 of 6 met; `act-as-user` open by design (websocket puppeteering is scoped out) |
| verify (cold) | seed / reset / state / manifest **pass** (200s), capture **pending-agent** |
| agent drive | capture swept Addison Area (1 theater, 18 showings, live Fandango napi path), state then reported the probe film **missing** against the real book — correct four-status semantics — stamped pass |

## Wiring findings (fixes that flowed back into the adapter)

1. **Sync handlers, not async** — wired app logic calls `asyncio.run()` (the scraper), which dies inside uvicorn's event loop under an `async def` route. Template now emits sync `def` handlers; FastAPI's threadpool absorbs blocking DB work too.
2. **Snake→kebab route names** — `agent_seed.py` produced manifest id `agent_seed`, which fails the id pattern (`[a-z0-9.-]`). Adapter kebab-izes sidecar module names.
3. **Helper modules flagged as unmapped** — `_app.py` (bootstrap) drew a "lacks route marker" finding. Underscore-prefixed modules are now skipped as helpers by Python convention.

## App-side bootstrap lessons (PriceScout `access_sidecar/affordances/_app.py`)

The sidecar has no login flow, so it must do what the app does at login: set `config.DB_FILE` per company, resolve/seed `config.CURRENT_COMPANY_ID` from the companies table, and handle stale local DBs — `create_all` never ALTERs, and this repo's dev DB carried a pre-tenant `showings` shape. The bootstrap rebuilds a stale table only when it's EMPTY; populated-but-stale raises loudly ("migrate it in the app, the sidecar won't drop data"). These are app-wiring patterns, not adapter code — candidates for the scaffold's TODO docstring if they recur on the next Streamlit app.

## B-308 closure

The original CompIntel handoff specified four HTTP endpoints deliberately not ported into the Streamlit build. The sidecar re-materializes them: `POST /access/seed` ≈ create expectation, `GET /access/state` ≈ run check, plus reset and market-capture. The demo script's flow (expectations in → run → outliers out) reproduces over these endpoints with a base-URL change.

*Sidecar run: `VIBE_ACCESS_DEV=1 uvicorn access_sidecar.access_api:app --host 127.0.0.1 --port 8765` from the app root, PriceScout venv.*
