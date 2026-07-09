# AccessAdapter contract

Every framework adapter exports an object satisfying:

    interface AccessAdapter {
      id: string;                          // stable slug, e.g. 'firebase-functions'
      matches(detection): boolean;         // pure predicate over detect() output; first true wins
      detectRoutes(ctx): { routes: RouteEntry[]; unmapped: UnmappedEntry[] };
      detectAuth(route, ctx): 'none' | 'session' | 'token';
      scaffoldAffordance(spec, ctx): ScaffoldPlan;   // PURE PLAN — no filesystem writes
      gateMechanism(): { kind: string; description: string };
    }

    RouteEntry     = { name, method, path, sourceRef, handlerSourcePath|null, sourceExportName }
    UnmappedEntry  = { sourceRef, reason }
    ctx            = { appRoot, detection, config }   // config may be null pre-bootstrap
    spec           = { id, kind: 'seed'|'reset'|'read-state'|'capture'|'discovery', description }
    ScaffoldPlan   = { files: {path, contents}[]; patches: {path, anchor, insert, note}[]; notes: string[] }

Rules (the KTD-3 honesty rule, inherited from vibe-lingual):
- `matches()` throwing is treated as no-match, never propagated.
- If no implemented adapter claims the app, `resolveAdapter` walks the stubs only to find
  the most specific LABEL and returns `{ adapter: null, status: 'not-yet-implemented' }`.
  Stand down cleanly; never mishandle an unrecognized stack.
- `scaffoldAffordance` returns a plan; applying it (with backup) is `engine/scaffold.mjs`'s job.
- Every dev-tier scaffolded file MUST contain the adapter's gate mechanism. The engine
  refuses to apply a dev-tier plan whose file contents don't include the gate marker
  string `vibe-access:dev-gate` (checked in scaffold.mjs).

Adding an adapter: implement under `adapters/<id>/` mirroring `firebase-functions/`,
remove the `_stubs/<id>.mjs` entry, register in `index.mjs` IMPLEMENTED_ADAPTERS,
add fixtures + extend `tests/adapters.test.mjs`. Agnostic-path runs write
`~/.claude/plugins/data/vibe-access/adapter-notes/<stack>.md` — the seed for this work.
