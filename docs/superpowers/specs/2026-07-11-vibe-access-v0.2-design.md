# vibe-access v0.2 — canonical design spec

> **Date:** 2026-07-11 · **Pattern:** mm (spec-first Cart cycle) · **Status:** design-approved, build pending
>
> This document IS the design. Downstream Cart artifacts (scope, prd, spec, checklist) compress to pointer-stubs at this file. It is written to be executable from paper by a capable agent with no session memory: every input shape, output shape, heuristic, badge condition, schema fragment, and prose contract is stated concretely. Where a judgment call was made, it is in the decisions log (§12) with the reasoning.
>
> **Repo:** `C:\Users\estev\Projects\vibe-access` · engine at `plugins/vibe-access/engine/` (pure Node ESM, one runtime dep: ajv) · schemas at `plugins/vibe-access/schemas/` · skills at `plugins/vibe-access/skills/`.
>
> **Grounding corpus:** two real manifests — `C:\Users\estev\Projects\WeSeeYouAtTheMovies\agent-access.json` (85 affordances, Firebase Functions HTTP) and `C:\Users\estev\Projects\ROROROblox\agent-access.json` (17 affordances, gRPC over a Windows named pipe wearing an `http` transport label). Plus `docs/proposed-changes.md` (evolve intake, 2026-07-10) and `docs/mcp-evolve-research-2026-07-11.md` (MCP research). Facts cited below without a source come from those four.

---

## 1. What v0.2 is

Five things, one release:

1. **`:visualize`** — the headline. Renders a tool surface (vibe-access manifest or MCP `tools/list` JSON) into ONE self-contained, human-readable, print-to-PDF HTML file. Read-only. The bare command is the reference sheet the ask describes — tools, calls, explanations, in that order on the page; the audit/grading layer is opt-in via `--grade` (§6.1, §7, D25).
2. **The documentation-hole closers** — input-shape mining (scan reads handler source for the parameters a caller must send) and `:describe` (authors real descriptions into `overrides.description` for every templated affordance). Without these the sheet renders the ask's two payloads — "the tool calls that I can use" and "an explanation for each one" — as labeled absences on 84 of 85 WSY cards. §13, D28.
3. **The capability-intent interview (P0)** — `:scaffold` and the router ask what the builder wants agents to be able to DO before diffing against the six-need checklist. Prose-only change; no engine work.
4. **Three schema enrichments** — `overrides.kind`, `authDetail`, `destructive` — that fix real expression gaps found on ROROROblox and feed the visualizer's badges. Ships as its own independently taggable step with regression tests (§16) — it is the only part of the release with blast radius on v0.1.
5. **Router: post-add cadence** — after any capability lands, recommend rescan → remap → reverify by name.

(The scan fail-open lint, previously slotted here, moves to v0.3 — §11 and D27 carry the reasons.)

Out of scope for v0.2, with rationale: §11.

---

## 2. The three facts that shaped the visualizer

Read these before touching the renderer. They come from computing over both real manifests, not eyeballing them.

1. **`transport.type` is the literal string `"http"` for all 102 affordances** — including RoRoRo's 17 gRPC-over-named-pipe methods. The schema flattens a distinction the reader needs. A naive table repeats the lie; the visualizer must derive real transport and say so.
2. **`input` and `output` are `null` in 102 of 102 entries.** Any input/output column renders 204 empty cells. The absence gets stated once at surface level, and once more where it is actionable: inside the call block. And v0.2 does not stop at stating it — §13.1 mines the shape from handler source so the call block fills instead of apologizing.
3. **"Pass" means two different things.** Of 93 passes across both files, 76 mean "the auth gate correctly rejected me — the call never ran" and only 17 mean "the call returned data." Only the free-text `verified.detail` disambiguates. A green-check column that collapses those two is the exact lie this page exists to prevent. `17/17 verified` on ROROROblox, unqualified, is misleading; the honest read is 3 ran, 12 gate-held, 2 handle-gate-held.

Design consequence, stated once and binding everywhere: **two rules that may never be dropped** — (a) verify math is always the full class decomposition (§4.3.7's classes: ran / gate-held / handle-gate-held / open / error / unverified, zero-count classes omitted, handle-gate-held NEVER folded into gate-held), rendered from one sentence template (§6.1 band 8), never a bare pass count; (b) **tool count is not graded** ("do not chase tool count" is the research's conclusion; 17 is not a better number than 85).

---

## 3. `:visualize` — CLI surface

### 3.1 Command

```
node engine/cli.mjs visualize --app <path> [--input <file>] [--out <file>] [--open] [--no-source] [--terse]
```

New file: `engine/visualize.mjs` (normalizer + renderer). `cli.mjs` gets a `visualize()` entry in `COMMANDS`, same pattern as the existing commands. A companion skill `skills/visualize/SKILL.md` wraps it (trigger phrases: "/vibe-access:visualize", "visualize the surface", "render the manifest", "make the toolsheet"), with the paired 2-line `commands/visualize.md` pointer every other user-facing skill in this plugin ships. `plugins/vibe-access/.claude-plugin/plugin.json` bumps `0.1.0 → 0.2.0` and its description line (the marketplace-facing copy) gains visualize + describe.

### 3.2 Input resolution (in order)

1. `--input <file>` — explicit. Shape is **sniffed, not flag-gated** (§4.1).
2. `<appRoot>/agent-access.json` — the default when `--input` is absent.
3. Neither exists → error, exit 1, message: `no input — expected agent-access.json at the app root or --input <file>`.

**No live-server support in the engine, ever, in v0.2.** For a live MCP server, the SKILL (the agent, in-session) reads `.mcp.json`, calls `tools/list` itself, saves the JSON payload to `.vibe-access/state/visualize-input.json`, and invokes the CLI with `--input` pointing at it. No MCP client ships inside the plugin; the HTML never makes a network call. This is the Surface Brief's `--from-mcp` architecture adopted verbatim (decision D3).

### 3.3 Output

- Default: `<appRoot>/docs/vibe-access/agent-access-<YYYY-MM-DD>.html` (date from the render clock; directory created if missing). Footprint stated out loud: that is the same committed directory the scan/verify reports live in, and the file embeds every `sourceRef` unless `--no-source` — the visualize SKILL says so and offers the gitignore line (`docs/vibe-access/*.html`) for builders who don't want rendered surfaces in history.
- `--out <file>` overrides.
- `--open` launches the file in the default browser after write. Spawned with an args array and `shell: false` — never string-concatenated into a shell; a user-supplied `--out` path must not be a command-injection surface in the plugin family that ships vibe-sec, and `shell: true` + `start` also breaks on paths with spaces. win32 `spawn('explorer.exe', [path])` · darwin `spawn('open', [path])` · else `spawn('xdg-open', [path])`. Best-effort; failure to open is a warning, not an error; no-op in non-TTY/CI.
- The render clock: `cli.mjs` computes `renderedAt = new Date().toISOString()` once and passes it in as a parameter (D24). All rendered ages (manifest age, verify-run age) are computed against it as whole days — `Math.floor(deltaMs / 86400000)`, printed `Nd` (`0d` under a day) — a deterministic pure function of two ISO strings, so the byte-identity test (§10.1) holds.
- stdout on success: JSON `{ tools, source, findings, out }` — count rendered, which input shape was sniffed, count of surface-level findings, output path. Matches the existing CLI's JSON-summary convention.

### 3.4 Flags

| Flag | Effect |
|---|---|
| `--input <file>` | Explicit input (manifest or tools/list; sniffed) |
| `--out <file>` | Output path override |
| `--open` | Open in browser after write |
| `--no-source` | Drop all `sourceRef` chips and micro-footer file names; grouping falls back to path-prefix. For artifacts leaving the building — a PDF that ships the app's internal file tree is a leak. |
| `--terse` | Suppress machine-templated description bodies (render only the UNDOCUMENTED slug). Escape hatch for the reader who already agrees the templates are noise. Default is to PRINT the template, muted — see §6.2 block 1. |
| `--grade` | Opt INTO the audit layer: THE HEADLINE, verdict strip, surface report card, findings, THE BAR, SCHEMA GAPS, and the A–F description chips (§6.1, §7). The bare command ships the reference sheet — tools, calls, explanations — which is the ask. |

Value-taking flags (`--input`, `--out`) error when the value is missing. `parseArgs` today turns a value-less trailing flag into boolean `true` — `visualize --out` writing a file literally named `true` is a bug, not a behavior; the visualize entry validates its flag values before running.

### 3.5 Exit codes

Consistent with the existing CLI: **0** success · **1** operational error (missing input, unparseable JSON, unrecognized input shape, unwritable output path) · **2** unknown command (existing top-level convention, `cli.mjs`).

**Schema-invalid is NOT exit 1.** A parseable manifest that fails ajv still renders, with a top-of-page VALIDATION finding carrying the ajv error paths — the one tool built to explain a broken surface does not refuse to open a broken surface. The same lenient path covers a manifest written by a FUTURE vibe-access carrying fields this version doesn't know: warn + render, never hard-fail on `additionalProperties`. Exit 1 is reserved for input the renderer genuinely cannot read.

### 3.6 Read-only contract

`visualize` reads the input file and writes exactly one HTML file. It never mutates `agent-access.json`, never touches `.vibe-access/state/` (except that the SKILL may have parked a tools/list capture there first), never probes a URL.

---

## 4. The input adapter — two shapes, one ToolView

### 4.1 Shape sniffing

Applied to the parsed JSON, in order:

1. Object with `schemaVersion === 1` and array `affordances` → **vibe-access manifest**. Validate against `schemas/manifest.schema.json` (ajv, already a dep); invalid → render anyway with a top-of-page VALIDATION finding listing the ajv error paths (§3.5) — only unparseable JSON or an unrecognized shape exits 1.
2. Array of objects each having a string `name` → **bare MCP tools array**.
3. Object with array `tools` → **MCP `{tools: [...]}` envelope**.
4. Object with `jsonrpc` and `result.tools` → **JSON-RPC frame** (the raw `tools/list` response).
5. Anything else → exit 1: `unrecognized input shape — expected a vibe-access manifest (schemaVersion 1) or an MCP tools/list payload`.

Optionally, shapes 2–4 may carry a sidecar bundle `{tools, resources, prompts, serverInfo}`; when `resources`/`prompts` arrays are present they feed the Resources/Prompts grade axis (§7.2 axis 4) instead of it rendering "unknown."

### 4.2 The ToolView model

One normalized record per tool/affordance. TypeScript-ish; the implementation is a plain-object factory in `visualize.mjs` with this exact key set (tests assert the key set — §10.1).

```ts
type Provenance = 'declared' | { derived: string } | 'unclaimed';
// 'declared'         — the source data carries the field as a real field
// { derived: "..." } — inferred; the string is the derivedFrom explanation, rendered on hover AND in print
// 'unclaimed'        — nothing in the data claims it either way; counts against the grade

interface ToolView {
  name: string;                       // manifest id | MCP tool name
  purpose: string;                    // EFFECTIVE description: overrides.description ?? description (manifest) | description (MCP)
  purposeSource: 'description' | 'overrides' | 'mcp';
  purposeTemplated: boolean;          // matches the machine-template heuristic (§4.3.4)
  kind: 'read' | 'act' | 'seed' | 'reset' | 'capture' | null;   // manifest kind AS EMITTED — map bakes the effective kind into the top-level field (§8.1); for hand-edited pre-map inputs the normalizer applies the engine's effectiveKind() helper itself | MCP: readOnlyHint true → 'read', else 'act'
  tier: 'dev' | 'prod-safe' | null;   // manifest only; null for MCP
  destructive: { value: boolean | null, provenance: Provenance };  // §4.3.5
  streaming: { value: boolean, provenance: Provenance };           // derived from 'Server-streaming' in prose; MCP has no field
  inputSchema: object | null;        // manifest input | MCP inputSchema — null in 102/102 of today's corpus
  outputSchema: object | null;
  annotations: {                      // MCP's four hints, each with provenance
    readOnly: { value: boolean | null, provenance: Provenance },
    destructive: { value: boolean | null, provenance: Provenance },
    idempotent: { value: boolean | null, provenance: Provenance },
    openWorld: { value: boolean | null, provenance: Provenance }
  };
  consent: {
    mode: 'none' | 'session' | 'token' | null;   // manifest auth; MCP null
    capability: string | null;                   // mined from prose (§4.3.6) or authDetail once the schema delta lands
    detail: string | null;                       // authDetail verbatim when present
    mechanismStated: boolean;                    // false → "mechanism not stated in the surface" red slug + grade hit
  };
  transport: {
    declared: string | null;          // what the file says ('http', always, today); null for MCP inputs — tools/list carries no transport field (§4.3.3)
    real: 'http' | 'grpc-npipe' | 'stdio' | 'streamable-http' | 'unknown';  // §4.3.3
    method: string | null;
    path: string | null;
    sharedPrefix: string | null;      // group-level factored prefix (§6.1 band 5)
    pathParams: { position: number }[];  // unnamed '*' segments mined from the path
    baseUrl: string | null;
    corrected: boolean;               // real !== declared family → transport-correction note renders
  };
  prereqs: string[];                  // e.g. ['handshake'] — mined from prose ("must be the first rpc")
  provenance: { sourceRef: string | null, line: number | null, origin: string | null };
  verification: {
    status: 'unverified' | 'pass' | 'fail' | 'pending-agent' | null;
    class: 'ran' | 'gate-held' | 'handle-gate-held' | 'open' | 'error' | 'unverified';  // §4.3.7
    detail: string | null;            // verbatim
    runId: string | null;
    at: string | null;
  };
  group: string;                      // §6.1 band 3 grouping key
  grades: { letter: 'A'|'B'|'C'|'D'|'F', checks: Record<'D1'|'D2'|'D3'|'D4'|'D5'|'D6'|'D7', 'pass'|'fail'|'na'> };  // §7.1 — N/A is a first-class result
  badges: string[];                   // exception chips only (§6.2 header)
}
```

Surface-level (once, not per tool): `SurfaceView { app, adapter, source: 'manifest'|'mcp', generatedAt, renderedAt, verifyRun: {runId, at, ageAtRender} | null, discoveryRoute, counts: {...}, findings: Finding[], schemaGaps: string[], axes: AxisGrade[6], lede: string }`.

The surface-level record shapes, exactly (tests assert these key sets too — four consumers read `Finding`: the CLI stdout count, the headline picker, the FINDINGS band, and the top-of-page VALIDATION case):

```ts
interface Finding {
  id: string;                 // slug, e.g. 'auth-gate-open:get-challenges'
  severity: 'breach' | 'destructive-unclaimed' | 'tier-conflict' | 'error-cluster' | 'validation' | 'info';
  // THE HEADLINE picker = first finding by this enum order (§6.1 band 6)
  title: string;              // card headline
  body: string;               // card body, plain prose
  anchor: string;             // in-page #id the tile/headline links into
  toolRefs: string[];         // affordance ids involved (error clusters carry several)
}

interface AxisGrade {
  id: string; label: string;
  measures: { name: string, value: string | number }[];  // the counts themselves, printed as-is — no 0–100 score exists (§7.2)
  status: 'measured' | 'na';
  naReason: string | null;    // "N/A — the instrument is missing" + the §8/SCHEMA GAPS link
  anchor: string;
}
```

`schemaGaps` is `string[]` — one rendered sentence per gap, each linking the §8 delta where one exists.

### 4.3 Normalization rules (the honest-render rules)

These are the load-bearing part of the adapter. Each is a pure function with unit tests.

**4.3.1 Effective description — absolute rule.** `overrides.description ?? description`. Never render both, never render two description columns. In RoRoRo, 16 of 17 overrides are byte-identical to the base; in the 17th (`stop-accounts`) the override is the ONLY place the destructive truth lives. A renderer that reads `description` alone shows a bare template on the single most dangerous row in the file.

**4.3.2 The manifest → MCP projection.** `id` → `name` (the manifest's `^[a-z0-9][a-z0-9.-]*$` pattern is already MCP-legal). `kind: read` → `annotations.readOnly = { value: true, provenance: { derived: 'kind=read in manifest — not an MCP declaration' } }`. Derived never earns full annotation credit (§7.1 badge B4).

**4.3.3 Transport truth.** `transport.real` is derived, never copied: baseUrl scheme `npipe://` → `grpc-npipe`; MCP serverInfo/launch shape → `stdio` or `streamable-http`; `http(s)://` → `http`; else `unknown`. When `real` contradicts `declared`, `corrected: true` and the masthead carries a transport banner (§6.1 band 1). MCP inputs have no declared transport at all: `declared: null`, `corrected: false` always, no banner; `real` comes from the optional serverInfo sidecar and is `'unknown'` without one — the common case, rendered in the masthead as one plain line: "transport: unknown — a tools/list payload carries no transport field." npipe base URLs render as inert `<code>` chips — never `<a href>`, never concatenated with a path (`npipe://./pipe/rororo-plugin-host/rororo.plugin.v1.RoRoRoHost/Handshake` is not a URL and must never look like one).

**4.3.4 Template detection.** `purposeTemplated = true` when the effective description is reconstructible from the transport block: matches `/^(Act|Read):\s+(GET|POST|PUT|PATCH|DELETE)\s+\//` OR equals `<kindWord>: <method> <path>` after whitespace normalization. The regex convicts 84 of 85 WSY descriptions today; the reconstruction check generalizes past the Firebase phrasing.

**4.3.5 Destructive derivation ladder.** (a) Manifest carries `destructive: true|false` (the §8.3 schema delta) → `declared`. (b) MCP `annotations.destructiveHint` present → `declared`. (c) Effective description matches `/\bDESTRUCTIVE\b/i`, or `kind === 'act'` and prose matches `/\b(delete|close|kill|stop|reset|wipe|drop|irreversibl)\w*\b/i` → `{ derived: 'inferred from the word "<match>" in the description prose; no schema field carries it' }`. (d) Else `unclaimed` — and unclaimed counts against the grade. Derived is rendered as derived, always, both channels (hover title + printed provenance line): the page's honesty about its own heuristics IS the argument for the schema field.

**4.3.6 Capability mining.** When `authDetail` (schema delta §8.2) is absent, mine the effective description: `/capability\s+([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)/i` — the captured token must be DOTTED, so prose like `update-ui`'s "capability entry" never yields a junk capture — plus a `/\bhost\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\b/` sweep. Segments are `[a-z0-9-]+` joined by literal dots, so a sentence-terminating period is never swallowed into the capture: the chip and the `authDetail` backfill comparison get `host.commands.stop-accounts`, not `host.commands.stop-accounts.`. RoRoRo's capability strings surface this way today — **12 of 17, exactly** (`update-ui` correctly yields nothing; its consent story is the handle gate, not a capability). Critical distinction the renderer must keep: **"capability not stated" ≠ "no capability required."** When mode is `session`/`token` and nothing was mined, `consent.mechanismStated = false` and the card prints `auth: session — mechanism not stated in the surface` as a red slug. Conflating those two is exactly the fail-open the plugin exists to catch. Handle-ownership gates (RoRoRo's `update-ui`/`remove-ui`: prose says "gated downstream by handle ownership", verify detail says `handle-gate-held`) render as a distinct consent kind under the same `session` mode.

**4.3.7 Verify classification.** From `verified.status` + `verified.detail`: detail contains `auth-gate-held` → `gate-held`; contains `handle-gate-held` → `handle-gate-held`; contains `auth-gate-open` → `open` (this is a SECURITY finding even though status says fail — WSY's `get-challenges` declared `auth: token` and answered 200 to a cold agent); status `fail` otherwise → `error`; status `pass` with no gate detail → `ran`; status `unverified`/`pending-agent` → `unverified`. The classification word always prints beside the detail string verbatim. A bare green dot on `verified.status` is actively wrong and this page never prints one.

**4.3.8 Escaping.** Every string reaches the DOM through an escape helper (`&`, `<`, `>`, `"`, `'`); the embedded JSON island additionally escapes `</script`, U+2028, U+2029. `<meta charset="utf-8">` is mandatory — the corpus carries `→`, em-dashes, and escaped double quotes inside `verified.detail` that mojibake without it.

---

## 5. The HTML — one file, two render targets

Architecture: **TOOLSHEET** (winner of the 3-way judge panel, twice), with the graft list applied (decisions D5–D16). One `.html` file: inline `<style>`, inline `<script>` (~150 lines vanilla JS), inline SVG glyphs, data embedded as `<script type="application/json" id="surface">`. Full `<!doctype html>`. Zero network: no CDN, no external fonts, no fetch. Emailing the file works; opening from `file://` works; printing works. That is the whole contract.

**Fonts.** The 626 faces (Space Grotesk, JetBrains Mono) are NOT available offline and are not embedded — a self-contained file that survives email cannot carry megabytes of woff2. Stack, exactly:

```css
--font-ui:   'Space Grotesk', 'Segoe UI', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, monospace;
```

`local()` resolution picks up the brand faces where installed; everywhere else the system stack renders correctly and the file stays ~200KB at 85 affordances.

**Theme.** Dark screen on 626 tokens: `#0A0E1A` ground, near-white ink, cyan `#22D3EE` + magenta `#E879F9` always as a pair (cyan = structure/info, magenta = risk/failure — never one without the other existing somewhere on the page). Light print palette (§9). A visible theme toggle (screen/ink preview) sits next to the Save-as-PDF button so the on-screen preview can match what prints — nobody discovers a print stylesheet by accident, and screenshot-a-dark-page-to-PDF is the failure mode being designed out.

---

## 6. Page structure

**The tools are the page.** The bare render is the reference sheet the builder asked for — masthead, lede, index, prerequisites, cards, legend, footer. The tools start at band 3, not behind seven bands of audit furniture, and in the PDF they start on page one's heels, not several pages in. `--grade` (D25) inserts the audit bands AFTER the cards (bands 6–11); the worst finding still lives above the fold in every render as the lede's third sentence. Single reading column, max-width ~900px, so print is not a reflow — it is the same page with the chrome removed.

### 6.1 The bands, in order

1. **MASTHEAD** — app · adapter · **transport truth banner** when `corrected` (one plain sentence: "gRPC over a Windows named pipe. You cannot curl this. The `type: "http"` in the manifest is a schema artifact — see HOW TO READ THIS; SCHEMA GAPS carries the fix under `--grade`.") · freshness line: manifest `generatedAt`, verify `runId` + age, **renderedAt** — and a stale banner when the verify run predates the manifest. The rendered ages are computed at render time and frozen into the file; the footer carries `renderedAt` precisely because an emailed PDF claiming "2 days old" forever is the "last active April 16" failure reappearing inside the tool built to name it.
2. **THE LEDE** — a generated four-sentence paragraph that states the shape in words before any tile (Dossier graft). Template slots: count + transport + spread across files/services; the open surface; the worst finding; the proof summary in decomposition form. WSY exemplar: "85 HTTP routes across 13 Firebase Functions files. Fifteen answer an unauthenticated caller, fourteen of them prod GETs. One route claims to require a token and does not. 76 passes = 62 gate-held + 14 ran; 9 failed, one of them open."
3. **TOOL INDEX** — one line per tool: name · kind glyph · consent · UNDOCUMENTED marker (the A–F letter chip replaces it under `--grade`) · verify-class word. Sticky filter bar (chips: Open · Destructive · Failed · Undocumented · Dev-only · Act · Read · verify-class) + `/`-focused text filter over name+purpose+path + **density toggle** (cards ↔ compact rows). **Compact is the DEFAULT above 40 tools** (Surface Brief graft — load-bearing, not a nicety; a compact row expands to its full card on click). **All filter/density state lives in the URL hash** so "send me just the 15 open routes" is a link. A `.no-print` **"Copy as Markdown"** button serializes the full tool list (name · kind · auth · purpose · call) to the clipboard — "see the tools" usually ends with pasting them somewhere. Grouping is auto-chosen and NAMED in the section header with its reason, precedence: ≥50% of tools yield a capability string → group by capability family; tools that miss the mining sweep join a family by the name-token rule below (RoRoRo: 12 mined capabilities, and `update-ui` joins the ui family by name → events 3 / commands 4 / queries 2 / ui 4, with the remaining 4 — handshake and the lifecycle rpcs — under a residual band named for their shared path prefix; that grouping IS the consent screen); else ≥3 distinct sourceRef files → group by source file (WSY: knowledge/profiles/quiz/fantasy/admin/… — the app's feature map, which the manifest contains and never states; suppressed under `--no-source`, falls back to path prefix); else path/name prefix, exactly: the first path segment after the surface-shared base (`/api/<seg>/…` → `<seg>`), or for unpathed names the name token before the first `_` or `-`, kept as a group only when ≥3 tools share it (MCP: `manage_*`); else one flat band. `tier`, `origin`, and `transport.type` are FORBIDDEN as group axes and as columns — near-constant (84/85, 17/17, 102/102), ~zero information.
4. **PREREQUISITE CHAIN** — rendered only when mined: RoRoRo's `handshake` is mandatory and must be the first rpc on a connection; every session-auth call then carries `x-plugin-id`. Ordered list, once, above the cards; dependent cards link back. Invisible to a table; the difference between working and not.
5. **TOOL CARDS** — §6.2, grouped under section bands. Each group's band factors the shared prefix out ONCE (`transport.sharedPrefix` = the longest common path prefix across the group, cut at a `/` boundary: `/rororo.plugin.v1.RoRoRoHost/` stated in the band, stripped from all 17 cards — Dossier graft) and carries the group's auth + verify summary.
6. **THE HEADLINE** (`--grade`) — the single worst finding, full width, bordered, first band of the audit layer. Picked by the `Finding.severity` enum order (§4.2): `breach` (auth-gate-open) > `destructive-unclaimed` (on an act) > `tier-conflict` > `error-cluster` > the rest. WSY's headline is not a 500 — it is `get-challenges` answering 200 to a cold agent.
7. **VERDICT STRIP** (`--grade`) — five derived tiles, none of which is a count (Surface Brief graft): OPEN SURFACE ("15 of 85 callable with no auth — 14 prod GETs") · REACH (kind split + destructive count) · PROOF ("76 pass / 9 fail — but only 14 calls returned data") · DOCUMENTATION ("84 of 85 descriptions are scan templates") · RISK (n destructive, n privilege-shaped, n tier conflicts). Each tile anchors into its evidence section.
8. **SURFACE REPORT CARD** (`--grade`) — the six axes (§7.2), each a measured row: the counts that would have driven a score, printed as-is, link to the section that proves them — no 0–100 number, no composite letter. Beneath it, in body text, both invariant sentences, snapshot-tested as literal strings (§10.1): "Tool count is not graded." and the verify decomposition, rendered from ONE sentence template — `<N> probed — <ran> ran, <gateHeld> gate-held, <handleGateHeld> handle-gate-held, <open> open, <error> error, <unverified> unverified`, zero-count classes omitted, handle-gate-held always its own term, never folded into gate-held. RoRoRo's literal: "17 probed — 3 ran, 12 gate-held, 2 handle-gate-held."
9. **FINDINGS** (`--grade`) — every surface-level finding as a card: the auth-gate-open card; error CLUSTERS, not dots (WSY's 7 `unexpected 500`s all originate in `functions\src\games\fantasy.js` → ONE card, "one dead subsystem, seven tool names inside"); tier-conflict cards — the predicate, exactly: `tier === 'prod-safe' && destructive.value === true`, ANY provenance (derived counts: pre-§8 corpora only have derived, and `stop-accounts` — `tier: prod-safe` asserted while its own override text says DESTRUCTIVE — is the motivating case; printed as a contradiction, never silently reconciled); the schema-coverage absence stated ONCE ("0 of 85 affordances declare an input or output schema — the manifest cannot tell you what to send"); `discoveryRoute: null` ("an agent has no runtime way to find this surface — it must be handed the file"; noted: null in 2 of 2 real manifests).
10. **THE BAR** (`--grade`) — two-card calibration panel quoting the corpus's two computed-A descriptions verbatim (`request-launch`, `agent-seed` — computed by the §7.1 predicates, not hand-picked; if a predicate change demotes one, the panel quotes whatever actually grades A) with their applicable D-checks green. A grade on someone's API is a social object; the reader sees a real A before meeting an F.
11. **SCHEMA GAPS** (`--grade`) — what this surface cannot express, stated once: input/output null N/N; `transport.type` enum has one member; `overrides` carries only tier + description pre-v0.2 (kind corrections clobbered on re-map); `discoveryRoute` unused; no destructive/streaming/idempotent field. Each gap links to the corresponding §8 schema delta where one exists.
12. **HOW TO READ THIS** — promoted to a fixed, always-present section, not an appendix (Dossier graft). Contents, verbatim commitments: what "pass" means (both meanings, spelled out with the class decomposition — gate-held and handle-gate-held mean the gate worked and the call never ran; ran means data came back); "`tier: prod-safe` is an ASSERTION, not a safety proof"; what a `{?}` unnamed path parameter is; what `declared` / `derived` / `mined` / `unclaimed` mean; the transport correction; "tool count is not graded"; and the projection disclaimer: **"The MCP call blocks on these cards are a projection, not a running server — vibe-access does not emit an MCP server today."**
13. **PROVENANCE FOOTER** — source file path (suppressed under `--no-source`), byte size, verify runId, `generatedAt`, `renderedAt`, plugin version. No content hash (decision D17).

### 6.2 The per-tool card — fixed eight-block skeleton

MCP's own order. **Blocks are never silently omitted — but an empty block renders as ONE compact labeled line, not a full-height frame.** The card states its holes without being made of them: on a corpus where INPUT / OUTPUT / ANNOTATIONS / WHEN-NOT-TO-USE are empty on nearly every tool, full-height absence blocks would maximize the document for hole-count and bury the payload the builder asked to read. The ~97% description-defect rate is stated once, at surface level (D7's rule, honored inside the card too); per card, an absence gets one line and the reader gets on with the call.

**HEADER** — `name` in mono at card weight (this is the string an agent types), then the badge rail. **Chips are exceptions, never columns** (Surface Brief graft): a clean card carries no chips and is visually boring on purpose. Possible chips: `⚠ DESTRUCTIVE` (the ONLY filled chip in the entire document — scarcity is the signal; Dossier graft) · `OPEN` (auth none, outline) · `PRIVILEGE` (path matches `/\b(admin|role|permission|approve|reject|invite)\b/`) · `DEV-ONLY` · `STREAMING` · `FAILED` — those are safety/operational and always render; the audit chips — `TIER-CONFLICT` · `BREACH` (auth-gate-open) · the description-grade letter chip (A–F) — ride with `--grade` (the underlying facts still print on the bare card's footer verbatim). Every chip is glyph + word, never color alone. Derived chips get a dotted underline; hover AND print show the `derivedFrom` string.

1. **PURPOSE** — the effective description, full text, never truncated (corpus spread is 22→491 chars; a column can't hold it, a paragraph can). Provenance tag `from overrides` when applicable. **Templated descriptions print in muted italic under an UNDOCUMENTED chip with the line "No authored description — this is the scan template"** (plus the F grade chip under `--grade`) — and the chip is a to-do, not a verdict the builder is left alone with: `:describe` (§13.2) is the authoring path that empties it, and the router recommends it whenever the count is nonzero. `--terse` suppresses the body and keeps the slug (decisions D8, D9).
2. **WHEN TO USE** — extracted sentence(s), or the red slug `Not stated.`
3. **WHEN NOT TO USE** — extracted (cue words: `do not`, `never`, `only`, `outside`, `casually`, `unreachable`, `404s`), or `Not stated.` This is the criterion 56% of real tools fail and nobody else renders. `request-launch` passes ("Launches a real Roblox client — do not call casually"); `generate-quiz` has nothing, and the hole is the finding.
4. **INPUT** — when `inputSchema` exists — declared, or mined by §13.1, which after the mining pass is the expected case on the firebase adapter, not the exception: a real parameter table, one row per property: `name · type · required · default · description` (from JSON-Schema `properties` + `required`; nested objects render one level deep with a `…` expander; `enum` values listed in the type cell; mined rows carry a `mined from <sourceRef>` provenance tag — declared beats mined when both exist). When null and nothing was minable: **one line, no red slug wall** (killing the 170-duplicate-slug wall — decision D7); path-param mining still renders inferred rows: `/api/lists/*/*/like` yields two rows flagged `unnamed path parameter (position 1 / 2) — a caller cannot know what goes here.` Wildcards render in the route line as a styled `{?}` glyph with a footnote, never a bare `*` that reads as a glob (Dossier graft).
5. **OUTPUT** — same table when present. When null and the description names a return shape (`request-launch`: "Returns ok / failure_reason / PID"), it is quoted here and credited as derived.
6. **ANNOTATIONS** — the four-cell truth table: readOnly · destructive · idempotent · openWorld, each rendering exactly one of `declared: true` (solid) / `declared: false` (solid) / `derived: <why>` (dashed border, muted — half credit) / `unclaimed` (hollow hatched box — counts against the grade). This is where "the manifest is the MCP embryo" stops being metaphor: pre-§8 manifests render hollow boxes here, and the printout becomes the self-evident case for the `destructive` field.
7. **CONSENT** — mode enum + the capability string as a mono chip + the mechanism in plain words ("session — handshake first, then `x-plugin-id` header per call, then per-capability consent"). Unstated mechanism → the red slug from §4.3.6. Handle-gates render as their own consent kind.
8. **THE CALL** — two code blocks, both copyable (copy buttons are `.no-print`), both transport-correct:
   - **Native.** HTTP → `curl` with the real method, `Authorization: Bearer <TOKEN>` line when auth ≠ none (named concretely when the mechanism is known: `<FIREBASE_ID_TOKEN>`), a `-d` body with every property named from the declared-or-mined schema (`unknown` types render as `<value>` placeholders, never invented types), `*` segments replaced with `<UNNAMED_PARAM_1>` so a genuine gap is impossible to paste past. gRPC-over-npipe → the pipe target, service method, `x-plugin-id` metadata header, and the `Handshake` prerequisite spelled out — never a fake URL.
   - **MCP projection.** The literal `tools/call` JSON-RPC envelope, `arguments` filled from the declared-or-mined input schema — and only when there is truly none: `"arguments": {} /* unknown — no input schema declared or minable */`. You don't read about the hole, you try to fill it and can't — but §13.1 exists precisely so this fallback is the exception, not the corpus norm: a call block that cannot be pasted is not "the tool calls that I can use." Under the block, small: "Projection — not a running server."

**FOOTER** — one line: sourceRef (backslashes normalized for display, `:line` kept where present; never an `href` — WSY's backslash paths break in hrefs), origin, then the verify class word + detail verbatim: `GATE HELD (rejected unauthenticated — the call never ran)` / `RAN (host 1.9.0, multi-instance On)` / `OPEN — expected 401/403, got 200` / `ERROR 500` / `UNVERIFIED`. Plus the 8px mono micro-footer: `<app> · <source file> · run <runId>` — a page torn out of the PDF still says what it is. (No running page header: not achievable in vanilla CSS print — Chrome doesn't support `@page` margin boxes; the micro-footer is the honest substitute. Decision D6.)

Long identifiers: `<wbr>` injected before each capital letter in CamelCase tokens so `SubscribeMutexStateChanged` wraps at token-internal boundaries instead of blowing the measure or breaking mid-token (Dossier graft; `overflow-wrap: anywhere` alone breaks mid-token).

---

## 7. Grades and badges

Two levels, both mechanical, both showing their work. Nothing is scored that cannot be pointed at. **These grade the SURFACE — the manifest/tool-listing as documentation for an agent reader — not the app.** That sentence prints on the report card. **The entire §7 layer renders under `--grade` only** (D25): the bare sheet carries no letters, no report card, no findings bands — the builder asked for a reference sheet, and the audit earns its ink only when invited.

### 7.1 Per-tool badges (the five, exact pass conditions)

The controller's badge set, rendered in the card header rail and aggregated on the report card:

| Badge | Pass condition (exact) |
|---|---|
| **has-description** | `purposeTemplated === false` AND effective description length ≥ 40 chars. A machine template never passes regardless of length. |
| **describes-when-not-to-use** | Effective description contains at least one negative-guidance cue: `/\b(do not|don't|never|only (use|call|when)|not for|avoid|outside|casually|unreachable|404s outside)\b/i`. |
| **has-input-schema** | `inputSchema` is a non-null object with a `properties` key containing ≥1 property (an empty `{}` schema does not pass). |
| **has-annotation** | ≥1 of the four annotations has provenance `declared` (derived does NOT pass — half credit lives in the truth table's rendering, not the badge). |
| **destructive-declared** | `destructive.provenance === 'declared'` — true via manifest `destructive` field or MCP `destructiveHint`, in either polarity. `derived` and `unclaimed` both fail; declaring `destructive: false` passes (the declaration is the point). |

Failed badges do not render as chips (chips are exceptions); they render as the labeled holes inside the card blocks and as counts on the report card. Passing `destructive-declared` with `value: true` is what renders the filled DESTRUCTIVE chip.

**The description letter grade (D1–D7)** powers the A–F chip and the "why this grade" `<details>` drawer on every card (each check a pass/fail/N/A line with its predicate result — the grade is a smoke alarm, not a judge; the drawer is how a reader overrules it in one glance). Every check is a mechanical predicate over the effective description, with a stated N/A rule: **N/A removes the check from the denominator** — it neither passes nor fails; grading what the instrument cannot see is D14's lie in per-tool form.

- **D1 purpose beyond restatement** — `purposeTemplated === false` (§4.3.4). Convicts 84/85 WSY. Never N/A.
- **D2 when-to-use context** — non-template description matches the context-cue regex `/\b(for|so that|when|during|while|used? (to|for|when|by))\b/i`. Never N/A.
- **D3 when-NOT-to-use** — the describes-when-not-to-use badge condition, verbatim. Never N/A.
- **D4 inputs named in prose** — description contains an identifier-shaped token: backtick-quoted, snake_case, or camelCase word (`account_id`…). **N/A when the affordance declares/mines no input schema AND its path carries no `*` params** — a tool that takes nothing has no inputs to name.
- **D5 result shape named** — description matches `/\breturns?\b/i` or names a shape after a colon ("Returns ok / failure_reason / PID"). **N/A when `kind ∈ {seed, reset, capture}`** — a lifecycle tool's "result" is the state change, graded under D6.
- **D6 side effects stated** — description names the write outside the template text: `/\b(creat|seed|writ|delet|updat|stop|kill|clos|reset|wip|launch|send|remov|insert|revok)\w*/i`. **Applies when `kind ∈ {act, seed, reset}`; N/A for `read` and `capture`.**
- **D7 consent stated** — description matches `/\b(auth|token|capability|session|consent|permission|gate|gated|dev-only|emulator|unauthenticated|public)\b/i`. Never N/A — an `auth: none` tool passes by SAYING it is open, not by being open.

Score → letter on the fraction of APPLICABLE checks passed: ≥0.85 A · ≥0.70 B · ≥0.55 C · ≥0.40 D · below, F. (With all seven applicable that is the original 7–6 A / 5 B / 4 C / 3 D / ≤2 F ladder.) Worked example, because §10.1 asserts it: `agent-seed` — "Dev-only: seed one test user (agent-test-user), three quizAttempts docs, and one pointHistory row with fixed ids for agent-driven verification. 404s outside the emulator/dev gate." — D1 pass, D2 pass ("for"), D3 pass ("outside"), D4 N/A (no schema, no path params), D5 N/A (kind `seed`), D6 pass ("seed"), D7 pass ("Dev-only", "gate") → 5/5 applicable = **A**. Surface level: a histogram (a mean would hide "84 of 85 sit at F"), plus the calibration sentence: "The literature says ~97% of tools carry at least one description defect and 56% have unclear purpose (arXiv 2602.14878, 856 tools / 103 servers)."

### 7.2 Surface axes — measured, not scored

Six axes from the research rubric — **but no 0–100 numbers and no composite letter.** v0.2 has no defensible formula for turning "0% inputSchema, 0% outputSchema, 0 declared annotations" into one integer, and an invented weight is a lie with more digits. Each axis renders as a measured row (the `AxisGrade` shape, §4.2): the counts themselves, a `measured`/`na` status, and the anchor to the section that proves them. The verdict strip, the headline, the findings cards, and the per-tool letter carry the judgment; the axes carry the numbers. What each axis measures:

1. **SHAPE** — discriminated-action usage detected (any tool exposing an `action`/`operation`/`mode` enum), non-deferred top-5 designated (absence is a finding, not a blank), transport, and the context-cost panel for MCP inputs: token estimate of the definitions as sent (≈ chars/4 over names+descriptions+schemas), and the deferral verdict — stdio → deferred by Claude Code; **remote HTTP / Streamable-HTTP → NOT deferred** (Claude Code issue #40314, closed "not planned"), with the concrete unit: one HTTP-MCP gateway ≈ 120K tokens = 60% of a 200K window, every session, every client. For a manifest input this panel frames as "if you shipped this surface as an MCP server today, here is the tax." Count reported, explicitly not graded.
2. **DESCRIPTION QUALITY** — the D-letter histogram, the templated count (84/85), the two A-exemplars linked.
3. **SCHEMAS + ANNOTATIONS** — count with inputSchema (declared and mined stated separately), count with outputSchema, count with any DECLARED annotation. Today: three zeros, stated once, damning — §13.1 is what moves the first one.
4. **RESOURCES / PROMPTS** — MCP input with sidecar: counted. Manifest input: generative finding — every `kind: read` + `auth: none` tool flags as "candidate resource — read-only addressable state currently forced through a tool call" (WSY's 14 unauthed prod GETs light up at once). No sidecar, no manifest signal → **N/A**.
5. **FRESHNESS** — manifest age, verify-run age, verify coverage %, stale banner logic; any `updatedAt`/`lastActiveAt`-shaped field in the data gets the research's line: "a field that isn't bumped on real activity is worse than no field."
6. **SECURITY / HYGIENE** — auth-gate-open count, unauthed `act` tools, destructive-without-declaration, tier/destructive contradictions, and a secret-shaped-string scan over every `verified.detail` (regexes for bearer/key/token-looking strings — errors must not leak).

**The N/A rule, binding:** when an axis is unknowable because the schema has no field for it, the axis renders **"N/A — the instrument is missing,"** linked to the §8 delta or SCHEMA GAPS entry. Zero says the surface failed; N/A says we can't see. Collapsing them would make the grade a liar in exactly the way the raw manifest already is. There is no composite letter — there is no formula that would earn one; the report card is six measured rows and the invariant sentences, nothing else.

---

## 8. Schema deltas

Three additive changes to `schemas/manifest.schema.json`, plus a fourth to `schemas/inventory.schema.json` (§13.1 — optional `inputShape` on route entries). `schemaVersion` stays `1` — all new fields are optional; every existing manifest remains valid. The visualizer, map, and verify consume them; scan never writes the manifest three (they are authored/override territory).

**Compatibility is one-way, and the CHANGELOG + README say so:** every existing manifest stays valid under v0.2 (ajv proves it against both real manifests), but a manifest carrying `destructive` / `authDetail` / `overrides.kind` requires engine ≥ 0.2.0 — v0.1's map re-emits `overrides` wholesale, and with both `affordance` and `overrides` at `additionalProperties: false`, its `validateManifest` throws `map produced invalid manifest` on the new keys. The real user already running v0.1 needs that sentence in front of them, not discovered.

### 8.1 `overrides.kind`

**Why:** on gRPC every rpc is POST, so all 16 original RoRoRo affordances defaulted to `kind: act` when 7 are honestly `read`. Kind was hand-edited in place and gets clobbered on re-map because `overrides` only carries tier + description today.

Delta to `definitions.affordance.properties.overrides.properties`:

```json
"kind": { "enum": ["read", "act", "seed", "reset", "capture"] }
```

**map.mjs merge change** (`buildManifest`, currently ~line 25): effective kind = `overrides.kind ?? derivedKind`, resolved BEFORE the tier resolution so `assertTierLegal(effectiveKind, tier)` guards the overridden value — and **map WRITES the effective kind into the top-level `kind` field**, preserving `overrides.kind` for the next re-map. Same bake-through precedent map already sets for tier and description (both land effective in the top-level fields, with `overrides` kept as the re-map memory). Consequence: every downstream consumer — verify's posture branches, gaps' six-need coverage, the schema's own `allOf`, the visualizer — reads the corrected value from `kind`, no special-casing. One exported helper, `effectiveKind(affordance)` (`overrides.kind ?? kind`), is the single read path for any engine code that can receive a PRE-map affordance — verify's posture check and gaps call it defensively (a hand-edited manifest never went through map); on a map-emitted manifest it is the identity.

**Schema twin branch — the mechanical refusal must see the override too.** A second `allOf` branch beside the existing kind→tier rule: if `overrides.kind ∈ {seed, reset, capture}` then effective tier must be `dev` — both `tier` and, when present, `overrides.tier`. Without it, `{kind: "act", overrides: {kind: "seed"}, tier: "prod-safe"}` is schema-VALID, and `cli.mjs verify` never calls `validateManifest` — it JSON.parses and hands straight to `runVerify` — so a hand-edited manifest (the agnostic path; exactly how ROROROblox's was authored) would reach the prober having passed zero of the first two enforcement layers. §10.1 clones the existing "rejects a seed affordance tagged prod-safe" schema test for the overrides twin.

Consequence stated plainly: overriding kind to `seed`/`reset`/`capture` on a `prod-safe` affordance throws the existing mechanical refusal (`NEVER_PROD_SAFE`) unless `overrides.tier: "dev"` accompanies it. That is correct behavior, not a bug — write the test that proves it. And `assertTierLegal`'s throw now names the affordance id, not just kind + tier: with overrides live, map can abort an 85-affordance re-map over one row and must say which row (the existing `/never/i` assertions in map.test.mjs still pass).

**Migration beat, required:** ROROROblox's 7 hand-set `kind: read` rows live in the TOP-LEVEL field with `overrides` carrying only descriptions — the first v0.2 re-map would re-derive kind from method (`POST → act`) and silently flip all 7 back, reverting the exact correction this field exists to protect. The v0.2 ship moves those 7 kinds into `overrides.kind` in the RoRoRo manifest, and §10.2 gains the assertion: "ROROROblox re-maps; all 7 reads survive."

Visualizer: reads `kind` as emitted (already effective); it feeds the read-glyph and the derived readOnly annotation.

### 8.2 `authDetail`

**Why:** `none|session|token` cannot express capability-based consent. RoRoRo's real permission unit is a capability string (`host.commands.stop-accounts`); today it has nowhere to live except description prose, and prose changes — a re-map that regenerates a templated description silently empties the consent story.

Delta to `definitions.affordance.properties`:

```json
"authDetail": { "type": "string", "minLength": 1 }
```

Free text, per affordance, optional. Convention documented in the map skill: the capability string a route requires, or one sentence naming the mechanism ("Firebase ID token via Authorization: Bearer"). Visualizer: `consent.detail` verbatim; when it parses as a single capability-shaped token it also fills `consent.capability` (mining then only backfills where authDetail is absent). Verify note carried from the intake: a held gate is `PermissionDenied`/`Unauthenticated`/`FailedPrecondition`, not just HTTP 401/403 — the RoRoRo driver proved that mapping; the verify skill prose records it (full non-HTTP transport seam stays v0.3).

### 8.3 `destructive`

**Why:** MCP annotations already carry `destructiveHint`/`readOnlyHint`; the manifest is the MCP embryo. `stop-accounts` had to shout DESTRUCTIVE in 491 chars of prose while its own schema asserted `tier: prod-safe`. Formalize it.

Delta to `definitions.affordance.properties`:

```json
"destructive": { "type": "boolean" }
```

Absent = unclaimed (and the visualizer says so — absence is not `false`). **Verify posture change — the exact matrix,** because "extend the existing seed/reset posture check" describes a single branch that does not exist: verify.mjs has TWO branches with different statuses and different stamping behavior (`stampManifest` skips `skipped` results but WRITES `pending-agent`), and collapsing them either regresses capture or hands seed/reset a prod-probe escape.

| Kind / field | Local base URL | Non-local base URL |
|---|---|---|
| `capture` | `pending-agent` — never probed, ever (unchanged) | `pending-agent` (unchanged) |
| `seed` / `reset` | probed (unchanged) | `skipped` — **no `--force` escape, today or ever.** `--force` clears only the top-level non-local refusal; it never authorizes this branch. (unchanged) |
| `destructive: true` | **`skipped` — not probed even locally.** RoRoRo's `stop-accounts` kills real Roblox clients on the dev host; "local" is not "consequence-free." | `skipped` — same, and no `--force` escape |

`skipped` — not `pending-agent` — on the destructive row, deliberately: `skipped` is never stamped, so a prior `pass` stamp from an agent- or hand-driven run survives auto-verify instead of being overwritten every run, which `pending-agent` would do. Executing a destructive path is agent/hand-driver territory by design; no engine flag authorizes it. **Regression tests pin today's seed/reset/capture behavior BEFORE the destructive clause is written** — the seed/reset skip branch has no test today, which is exactly how a careless merge would hand it an escape hatch with nothing going red.

**Enforcement boundary, stated honestly:** this matrix lives in `runVerify` only. The agnostic path (ROROROblox) drives probes with an external hand-written driver and calls `stampManifest` directly — the engine cannot enforce the destructive refusal there. The verify SKILL's agnostic prose carries the matrix as instructions to the driving agent; that is a convention, not a guarantee, and the spec does not pretend otherwise.

`assertTierLegal` is untouched — destructive does not force `tier: dev` (stop-accounts is legitimately prod-facing AND destructive; tier answers "may agents touch prod," destructive answers "does it break things" — orthogonal, and the visualizer renders contradictions between the two rather than collapsing them). Visualizer: `declared` provenance, the filled DESTRUCTIVE chip, the destructive-declared badge. (`idempotent` considered and deferred — no incident demands it yet; the annotations truth table already renders its absence as unclaimed, which is the pressure that will justify it. Decision D20.)

**Merge preservation, both paths — the guard §8.2's own motivation demands.** `buildManifest` rebuilds `origin: existing` affordances from a fixed field list and does NOT spread `prev`, while the scaffolded-survivor path DOES `{...prev}` — left alone, the first re-map after a builder hand-authors `destructive: true` or `authDetail` erases both from every existing affordance while preserving them on scaffolded ones. Two silently divergent merge paths, and "a re-map that regenerates a templated description silently empties the consent story" comes true in the engine's own hands. The rule: map carries `destructive` and `authDetail` forward from `previous` on BOTH paths. The test: hand-author both on an `origin: existing` row, re-map twice, both survive both times.

All four deltas get: schema fragment, ajv validation tests (accept + reject wrong types; a field-free document still validates), map merge/preservation tests, and a CHANGELOG entry. CHANGELOG.md does not exist yet — it is created at the repo root with this release, Keep-a-Changelog format, a `0.2.0` section carrying the one-way compatibility sentence above.

---

## 9. Print

Print is the second render target, designed first-class — the ask was "exportable to PDF, which HTML would be because you just print."

- Visible **"Save as PDF"** button wired to `window.print()`, next to the ink/screen preview toggle (both `.no-print`).
- `@page { size: letter portrait; margin: 14mm 12mm; }`. Screen is already a single ~900px column, so print is the same page minus chrome.
- **Light print palette, named inks** (Dossier graft): `#FBFAF7` stock, `#111` ink, `#6B6660` secondary, and exactly two accents — **deep teal `#0F6B6B`** (structure; 626 cyan is a screen color and prints muddy) and **oxblood `#7A1F2B`**, reserved EXCLUSIVELY for destructive + failed/breach. `@media print { :root { color-scheme: light } }` forces it — nobody prints 40 pages of navy.
- **Grayscale-safe by construction:** color is never the only channel — every chip is an outlined box with its word spelled out (`⚠ DESTRUCTIVE` reads DESTRUCTIVE), verify state is glyph + classification word, unclaimed annotations are hatched hollow boxes, grades are letters. `print-color-adjust: exact` only on the DESTRUCTIVE fill. A mono laser loses zero information.
- `break-inside: avoid` on every card, finding card, and parameter table; `break-after: avoid` on group headers (no orphaned band at a page foot); `break-before: page` on the tool index and — under `--grade` — the report card and findings. NOT on every tool group: at 85 affordances a forced page per group inflates the PDF past what anyone reads, and the page budget (§10.2.6) is a shipping criterion, not a hope.
- **Every `<details>` opens for print:** `@media print { details > * { display: block !important } }` plus `beforeprint` → `d.open = true`, plus a `matchMedia('print')` listener for the Safari path. A grade drawer shut in the PDF is a grade with no evidence.
- **The filter is a print filter** (Dossier graft): filtered-out cards are `display:none`, so the active filter sets the print scope — "print me only the 15 open routes" is a real reviewer workflow. When a filter is active, a print-only banner renders: "FILTERED VIEW — showing 15 of 85. Filters: open." An unfiltered print carries no banner.
- Code blocks: `overflow-x: auto` on screen; `white-space: pre-wrap; overflow-wrap: anywhere` in print, with the `<wbr>` treatment (§6.2) carrying CamelCase.
- `a[href^="http"]::after { content: " (" attr(href) ")" }` for real links only; npipe/code chips are never anchors so they never sprout fake URLs.
- **No running header, no JS paginator, no true ToC page numbers.** Chrome doesn't support `@page` margin boxes; a `position:fixed` header can't change per section; the Dossier's self-written paginator is explicitly not grafted (decision D6). Identity is per-card via the 8px micro-footer. The tool index serves as the ToC, unnumbered.
- All interactive chrome (`filter bar, search, density toggle, copy buttons, theme toggle, Save-as-PDF button`) is `.no-print`, and nothing load-bearing lives only in an interactive control.

---

## 10. Testing

### 10.1 Unit tests (jest, `tests/visualize/`)

- **Fixtures are scrubbed twins, not copies.** This repo is PUBLIC (the marketplace canary points at it), and WeSeeYou's real manifest carries 85 internal routes, 14 unauthenticated prod-safe routes, and a live unfixed breach with method, path, and source file attached — committing it publishes an exploitable finding. The scrub: synthesize app name, base URLs, and sourceRef paths; preserve every shape, count, kind, auth mode, verify class, description length, and template ratio, so the 84/85, 12-capability, and class-decomposition assertions still hold. The existing synthetic `reference-626-manifest.json` is the precedent.
- **Normalizer:** manifest → ToolView on both scrubbed fixtures; MCP tools/list → ToolView across all three envelope shapes (against the CAPTURED 626labs fixture, §16 step 1 — not paper); effective-description rule (the stop-accounts case is THE test: override wins, template loses); transport correction (npipe → grpc-npipe, corrected flag; MCP input → `declared: null`, no banner); template detection (84/85 on the WSY fixture, exactly); capability mining (12 of 17 on the RoRoRo fixture, exact strings, no trailing periods — and the `update-ui` "capability entry" non-match is its own test); destructive ladder (declared > hint > derived-with-string > unclaimed); verify classification (all six classes from real detail strings, including `auth-gate-open` → `open`); path-param mining (`/api/lists/*/*/like` → two positions); ToolView + Finding + AxisGrade key-set assertions (exact keys, no drift).
- **Badge rules:** each of the five badges, pass and fail cases at the boundary (39-char description fails has-description; empty `properties` fails has-input-schema; derived annotation fails has-annotation; `destructive: false` PASSES destructive-declared); D1–D7 predicates against the two A-exemplars (`agent-seed` computes 5/5 applicable = A per the §7.1 worked example; `request-launch` must also compute A — if a predicate misses on the real string, fix the predicate or demote the exemplar, never hand-wave the letter) and `update-user-role` (0 of applicable = F); one N/A case each for D4, D5, D6 proving the denominator shrinks.
- **Schema + engine guards:** ajv accepts manifests with/without each new field; rejects wrong types (`destructive: "yes"`, `authDetail: 3`, `overrides.kind: "banana"`); rejects `overrides.kind: "seed"` + `tier: prod-safe` (the twin of the existing seed/prod-safe rejection test); map writes the effective kind through to `kind` AND preserves `overrides.kind` across re-map; map carries `destructive` + `authDetail` forward on BOTH merge paths (hand-author both on an `origin: existing` row, re-map twice, both survive); `assertTierLegal` throws naming the affordance id; the §8.3 posture matrix — every cell, including the PINNED pre-existing seed/reset/capture behavior written before the destructive clause — plus: a hand-authored `{kind: 'act', overrides: {kind: 'reset', tier: 'dev'}}` is skipped by runVerify non-locally and satisfies the reset need in gaps.
- **Inventory delta (§13.1):** ajv accepts route entries with/without `inputShape`; rejects wrong types; a shape-free inventory still validates (scan must not break for every existing user).
- **Input-shape mining:** each firebase handler pattern (req.body destructuring, direct property reads, req.query/params, zod/joi) yields the expected rows; a handler that reads nothing yields nothing — no invented parameters, ever.
- **HTML emit determinism:** render each fixture twice with an injected clock (`renderedAt` passed in, not read from `Date.now()` inside the renderer — the clock is a parameter, and the day-age function is pure) → byte-identical output. Snapshot test on structural landmarks: bare-render band order (tools at band 3), one HEADLINE on the `--grade` render, the two invariant strings literal ("Tool count is not graded."; "17 probed — 3 ran, 12 gate-held, 2 handle-gate-held" on RoRoRo), DESTRUCTIVE appears filled exactly once on the RoRoRo render, zero `<a href="npipe` occurrences, zero unescaped `<script` in the JSON island.

### 10.2 Real-app validation (the family bar: proven against real apps before it ships)

1. **WeSeeYou (85, HTTP):** render bare + `--grade`, eyeball, print to PDF. Must show: compact density by default, the 15-route open surface, 84/85 UNDOCUMENTED pre-`:describe`; under `--grade`: the get-challenges BREACH headline, the fantasy.js cluster as ONE finding, agent-seed as one of the two A-bar cards. Then run §13 (mining + `:describe`) and re-render: the UNDOCUMENTED count must move from 84 toward zero and the POST cards must carry named parameters.
2. **ROROROblox (17, gRPC/npipe):** render, eyeball, print. Must show: transport banner, prerequisite chain (handshake + x-plugin-id), capability-family grouping (12 mined capabilities, update-ui joined by name), stop-accounts as the only filled chip with its 491-char override as PURPOSE, "17 probed — 3 ran, 12 gate-held, 2 handle-gate-held" (never a bare 17/17). Plus the §8.1 migration proof: re-map, all 7 hand-set reads survive via `overrides.kind`.
3. **The 626Labs MCP surface:** the `tools/list` payload is captured into `tests/fixtures/` at §16 step 1 — BEFORE the MCP branch is built, so the branch is built from a file on disk, not from spec. This run renders it via `--input` end-to-end. Must show: real inputSchemas rendering as parameter tables, declared annotations where present, the remote-HTTP context-cost panel with the no-deferral verdict. Not a ship gate for the manifest renderer — the manifest path ships on 1–2 alone.
4. All three PDFs printed (or print-previewed grayscale) and eyeballed at arm's length: the DESTRUCTIVE chip and — on the `--grade` render — the BREACH card must be findable in under five seconds each.
5. **The ask's own acceptance test, and the build fails on it:** pick three tools at random (seeded) from each rendered sheet. A cold reader must be able to (a) say what the tool does from PURPOSE — a machine template is an automatic fail — and (b) copy THE CALL with every parameter named — a `<UNNAMED_PARAM_1>` placeholder or an empty `arguments: {}` on a tool that takes input is a fail. On the pre-§13 corpus this fails 84/85 on (a) and every POST on (b); that is the recorded baseline, and the post-§13 WSY render must pass it or the release is not done. This is the test the builder's four ask-parts reduce to; everything else in §10 validates the furniture around it.
6. **Page budget:** the unfiltered bare WSY PDF prints ≤ 40 letter pages. Over budget is a layout bug to fix, not a shrug — "exportable to PDF" implies something a human reads.
7. **Nothing rendered from a real app lands in the public repo unless scrubbed** — same rule as the fixtures (§10.1). Dogfood HTML/PDFs of WSY/RoRoRo live outside the repo or get the fixture scrub first; a rendered sheet of a live breach is the vulnerability this plugin exists to catch, published.

---

## 11. Out of scope for v0.2 (v0.3 backlog, with rationale)

| Cut | Rationale |
|---|---|
| **Verify transport seam for non-HTTP (gRPC/npipe)** | Bigger than one cycle: `runVerify` is fetch()-only, and a `VerifyDriver` seam per adapter is real architecture. The RoRoRo hand-driver recipe (C# driver → results through `stampManifest` + `renderVerifyReport` for artifact parity) is documented in adapter-notes and works today. The minimum bridge (`--results <file>` intake) rides with the seam, not ahead of it. |
| **dotnet-wpf-desktop adapter promotion** | The seed is complete in adapter-notes, but one target is a sample of one. Waits for a second .NET target (Sanduhr is the named candidate) to confirm the shape before the adapter calcifies wrong guesses. |
| **Full MCP-evolve grading (scan a live MCP server and grade it)** | The research is banked (`docs/mcp-evolve-research-2026-07-11.md`). v0.2 ships the VISUALIZER with grade badges — the render-and-grade half — not the live-scan half. No MCP client ships in the plugin; the in-session agent bridge covers today's need. |
| **Verify preflight checks** | Real (two RoRoRo stalls: SDK-pin mismatch, GUI startup modal) but independent of everything above; clean v0.3 unit alongside the transport seam it naturally pairs with. |
| **Scan fail-open lint (`capability-map-fail-open`)** | Cut to v0.3 alongside the transport seam, which owns the RoRoRo/gRPC path — the only place it can fire (D27). As drafted for v0.2 it had no landing place (`inventory.schema.json` is `additionalProperties: false` with no `findings[]`, and scan hard-throws on any extra key — the first post-ship `:scan` would have died on every app), no adapter-contract member to supply the method source + gate map, no CLI hand-carry surface for the agnostic path, and the only implemented adapter (firebase-functions) is not a capability-map stack. A cross-cutting cycle was riding inside a renderer release. The incident record (UpdateUI/RemoveUI, runs f7ebdbd1 → 34cf3714), the diff heuristic, and the fix-shape-in-the-finding template (D22) are banked in this spec's git history; v0.3 ships the lint WITH the inventory `findings[]` schema delta, the adapter method, and the report/stdout surfaces it needs. |
| **Composite surface letter + 0–100 axis scores** | The axes ship as measured rows (§7.2). A numeric score needs a formula someone can defend; inventing six of them plus a weighting for a v0.2 renderer is how a grade becomes a liar. Revisit when the corpus is big enough to calibrate against. |
| Standing WeSeeYou items (parameterized-path probing, optional-auth modeling, 405-fails-public-routes, CLI --strict, re-scaffold backup, multi-site firebase.json) | Carried, unprioritized against the headline; none blocks the visualizer or the interview. |

**Do-not-regress list** (from proposed-changes.md, binding on this build): foreign-handle probing of downstream-gated affordances (verify-as-security-check is the plugin's sharpest edge); handshake-rejection-is-a-pass semantics; the agnostic path's artifact-parity discipline.

---

## 12. Decisions log

1. **D1 — Toolsheet wins.** Two independent judge panels, same verdict (32 and 34). The builder's ask was four things — see the tools, SEE THE CALLS, an explanation for each, easy to read — and only Toolsheet renders a call. The Surface Brief foreclosed input/output at the input model; the Dossier had no call block.
2. **D2 — Grafts over architecture swaps.** Every Surface Brief and Dossier idea adopted here (density, chips-as-exceptions, inks, `--no-source`, verdict strip, lede, `{?}`, `<wbr>`, legend promotion, section bands, URL-hash state, Save-as-PDF, derivedFrom, print-filter) is a graft onto Toolsheet's card. You can give Toolsheet a density toggle in an afternoon; you cannot give the Surface Brief a call block without redesigning its card.
3. **D3 — No live-server code in the plugin.** Toolsheet's `npx @modelcontextprotocol/inspector` shell-out was its one no-runtime-deps violation. Cut. The agent bridges live servers in-session and hands the engine a file. Surface Brief's architecture, verbatim.
4. **D4 — Drop-zone re-render cut.** Cute; nobody drops a second manifest on a report. The embedded JSON island stays (self-describing artifact), the FileReader UI goes.
5. **D5 — Density: compact rows default above 40 tools.** 8 blocks × 85 cards uncollapsed is a scroll nobody finishes. Load-bearing, not a nicety.
6. **D6 — No self-written paginator, no running header, no true ToC page numbers.** The Dossier's best feature is its fatal risk: ~150 lines of layout code measuring font metrics that vary by OS, two layouts maintained forever. Chrome has no `@page` margin boxes; the Surface Brief's "running head" promise was not achievable and is not carried. Identity = per-card 8px micro-footer. A truly paged dossier is a v2 behind `--paged` if ever.
7. **D7 — Kill the 170 duplicate schema slugs.** Toolsheet's own section 12 said absences are "stated once," then its card spec printed `No input schema` + `No output schema` 170 times. Resolved per the judges: 0/N coverage stated once at surface level; the hole kept ONLY where actionable — inside THE CALL as `"arguments": {} /* unknown — no input schema declared */`, plus the mined path-param rows which ARE information.
8. **D8 — Templated descriptions PRINT.** The Dossier's refusal ("No description." italic scolding, 84 times) fights the builder's literal ask for an explanation for each. Default: print the template, muted italic, UNDOCUMENTED chip (F chip under `--grade`) — let the reader convict it. And the conviction has a sentence attached: `:describe` (§13.2) authors the real explanation; printing the template is the interim honesty, not the deliverable.
9. **D9 — The Dossier's `--verbatim` ships inverted as `--terse`** for the reader who already agrees and wants the noise gone.
10. **D10 — DESTRUCTIVE is the only filled chip in the document.** One filled mark across 85 cards carries more signal than a badge rail on every row. Scannable at arm's length; that is the acceptance test (§10.2.4).
11. **D11 — Print inks named, not hand-waved.** #FBFAF7 / #111 / #6B6660, deep teal #0F6B6B, oxblood #7A1F2B reserved for destructive+failed. 626 cyan prints muddy; screen keeps it, paper never sees it. Theme rule holds on screen: cyan and magenta always exist as a pair.
12. **D12 — The filter is a print filter.** Second panel called it "the biggest single win in the set," and it is one CSS decision: filtered-out cards are `display:none`, print inherits it, a print-only FILTERED VIEW banner keeps the artifact honest.
13. **D13 — Verdict strip AND report card.** The strip (five derived tiles, no counts) is what gets screenshotted; the report card is where the axes carry their evidence links. Both, in that order, inside the `--grade` layer after the cards (D25); the lede sentence above everything in every render.
14. **D14 — N/A ≠ 0 in grading.** When schema v1 has no field for a signal, the axis reads "N/A — the instrument is missing," linked to the schema delta. Zero says failed; N/A says blind. Collapsing them makes the grade lie the way the manifest already does.
15. **D15 — Two unlosable rules:** verify math is always the full class decomposition rendered from the §6.1 band-8 sentence template ("17 probed — 3 ran, 12 gate-held, 2 handle-gate-held"; zero-count classes omitted, handle-gate-held never folded into gate-held), and tool count is not graded. If the build drops either, it shipped the same lie the page was built to catch. Both are snapshot-tested as literal strings (§10.1).
16. **D16 — `--no-source` ships day one.** Grouping by sourceRef leaks internal file layout in an artifact explicitly designed to be emailed. Only one design caught it; it's a flag, not a debate.
17. **D17 — No input sha256 in the footer.** `generatedAt` + `renderedAt` + runId is enough traceability; the hash is ceremony (second panel's cut, adopted).
18. **D18 — MCP projection disclaimer is mandatory copy.** The tools/call envelopes invite the belief that vibe-access emits an MCP server. It does not, today. The HOW TO READ THIS section and each call block say so, or the sheet writes a check the plugin cannot cash.
19. **D19 — Schema deltas are additive under schemaVersion 1.** All three fields optional, all existing manifests stay valid, ajv proves both directions. A version bump buys nothing here and breaks the two shipped manifests' validity story.
20. **D20 — `idempotent` deferred.** proposed-changes.md says "consider"; no incident demands it. The annotations truth table renders its absence as unclaimed — that visible hole is the intake mechanism that will justify it when it matters.
21. **D21 — `destructive` does not imply `tier: dev`.** Tier answers "may agents touch prod"; destructive answers "does it break things." stop-accounts is legitimately both prod-facing and destructive. The visualizer renders tier/destructive contradictions instead of the schema collapsing them.
22. **D22 — Fail-open lint fix shape ships IN the finding text.** "Unknown → deny, plus a startup exhaustiveness assert — the assert is the deliverable." A finding that names the fix is a finding that gets fixed; RoRoRo proved the shape same-day.
23. **D23 — Interview output is the agent-ops-spec doc, not a pick list.** The RoRoRo spec (enumerated gaps, per-gap affordance spec, rescan→remap→reverify cadence) is the proven artifact shape; the six-need pick list remains the floor for dev-loop surfaces.
24. **D24 — Renderer clock is injected.** `renderedAt` is a parameter, not `Date.now()` deep in the renderer — determinism tests demand it, and frozen-freshness honesty (§6.1 band 1) depends on knowing exactly when the numbers were true. The CLI supplies `new Date().toISOString()`; ages render as deterministic whole days (§3.3).
25. **D25 — The bare render IS the ask; the audit is opt-in.** Tools at band 3, cards at band 5; headline / verdict strip / report card / findings / THE BAR / SCHEMA GAPS render under `--grade`, AFTER the cards. The builder asked for a reference sheet with the tools, the calls, and an explanation each — not a report card with himself as the graded party. The lede's worst-finding sentence keeps the safety signal above the fold in every render, and per-tool auth/verify facts stay on every card because "can I call this" is in-ask.
26. **D26 — Flagged overreach, kept with reasons, one line each.** MCP input branch: kept, because the manifest is the MCP embryo and the 626labs `tools/list` fixture is captured BEFORE the branch is built (§16 step 1) — nothing MCP is designed from paper anymore. SCHEMA GAPS band: kept under `--grade` — a surface that cannot express `destructive` is a fact about the surface; it rides with the audit layer, not the sheet. Theme toggle / URL-hash filter state / micro-footer / `<wbr>`: kept — each is a few lines and each serves print or navigation of an 85-card document. The lede-as-Discord-paste framing: cut; the lede is a summary, not a marketing surface.
27. **D27 — Fail-open lint deferred to v0.3** (§11). It needed four contracts this spec never wrote (inventory `findings[]` delta, an adapter-contract method for method-source + gate-map, a CLI hand-carry surface, report/stdout sections) and cannot fire on any implemented adapter. D22's fix-shape-in-the-finding survives into the v0.3 build unchanged.
28. **D28 — §13 rides in v0.2 because the ask fails without it.** 0/85 input schemas and 84/85 templated descriptions mean the two payload blocks of every card would render as labeled absences; input mining and `:describe` are what turn "the tool calls that I can use" and "an explanation for each one" from holes into content. A renderer without them is a scoreboard of its own absence — and §10.2.5 exists to fail the build that ships one.

---

## 13. Closing the documentation hole — input mining + `:describe`

The two facts that gut the ask (§2): `input`/`output` null in 102 of 102, and 84 of 85 WSY descriptions machine templates. A renderer alone turns those into beautifully labeled absences — a conviction for each tool, not an explanation for each tool. v0.2 closes them at the source, and §10.2.5 fails the build that doesn't.

(The fail-open lint that previously held this section is deferred to v0.3 — §11 and D27. Its verify-semantics rider survives in §15's router prose: on assert-backed surfaces, the verify run's ability to CONNECT is itself part of the proof.)

### 13.1 Input-shape mining (engine, firebase-functions adapter)

Scan already reads every handler file for routes and auth; it now also mines the input shape.

1. **What it reads, per handler:** `req.body` destructuring (`const { name, listId } = req.body`), direct property reads (`req.body.userId`), `req.query.*` / `req.params.*` reads, and — highest confidence — zod/joi schema objects handed to a validator. Same regex + AST-lite discipline as the existing route detection; no new runtime deps.
2. **What it writes:** inventory route entries gain an optional `inputShape` — a JSON-Schema-shaped object (`{ type: 'object', properties: { name: { type: 'string' | 'unknown' } }, required: [...] }`; types stay `unknown` unless the source states them — zod/joi gives real types and required). This is the release's fourth schema delta (§8): additive, optional, ajv accept/reject tests, and a shape-free inventory still validates — scan must not break for a single existing user.
3. **Map** writes it into the affordance's existing `input` field (in the manifest schema since v0.1, null until now). Scan-derived, so re-map refreshes it like any scanned field; a declared schema (MCP inputSchema, future hand-authored) beats mined when both exist.
4. **THE CALL fills from it:** curl gets a `-d` body with every property named; the MCP projection's `arguments` carries the same keys. `<UNNAMED_PARAM_1>` and `arguments: {}` become the fallback for the genuinely unminable, not the corpus norm.
5. **Honesty rule:** nothing is invented. A handler that reads no body yields no shape; `unknown` types render as `<value>` placeholders, never fake types; the visualizer tags mined rows `mined from <sourceRef>` — mined ≠ declared, and the card says which.

### 13.2 `:describe` — authoring the missing explanations

The remediation path every other family plugin already ships (prompt `:remediate`, sec `:fix`, test `:fix`) and this one lacked. New skill `skills/describe/SKILL.md` + the 2-line `commands/describe.md` pointer. Prose + agent work; zero engine code.

1. Reads the manifest; selects every affordance with a templated effective description (or `--only <ids>`).
2. Per affordance, the agent reads the handler source at `sourceRef` — plus JSDoc and any tests that exercise it — and authors a real description against the D1–D7 axes as an authoring checklist: purpose beyond the route, when to use, when NOT to use, inputs in prose, result shape, side effects, consent/auth in words.
3. Writes into `overrides.description` — the re-map-safe home (§4.3.1: it is already the effective-description winner and already survives re-map).
4. Batch cadence: propose per group (the §6.1 band-3 grouping), builder approves or edits, write, re-render. Nothing lands unreviewed — these strings are the consent surface an agent reader will trust.
5. Validation rides in §10.2.1: run on WeSeeYou, re-render, the UNDOCUMENTED count moves from 84 toward zero, and the §10.2.5 acceptance test passes on the post-describe render.

---

## 14. The capability-intent interview (P0)

**What broke:** `:scaffold` derives candidates from the fixed six-need checklist (seed / reset / capture / discovery / read / act). Right shape for a web dev-loop (WeSeeYou); produced nothing usable on a product plugin contract (ROROROblox), so scaffold stood down and the builder scaffolded manually outside the plugin. Builder verbatim: "there needs to be a deeper conversation during the process for the user's expected capability add."

**What changes:** prose-only — `skills/scaffold/SKILL.md` + `skills/router/SKILL.md`. No engine work. (Shippable independently as v0.1.1 if the cycle needs to split; it ships inside v0.2 here.)

**The prose contract — scaffold opens with the interview, BEFORE the gap diff, in this order:**

1. **The opening question, verbatim:** "Before I diff this app against the standard checklist — what do you want an agent, or your users' agents, to be able to DO in this app that they can't today?"
2. **Per answer, drill until each intent yields a complete affordance spec:** what triggers it (agent-initiated, event, user ask) · read or act or lifecycle (seed/reset/capture) · dev-only or prod-facing (tier, through `assertTierLegal` mechanics — seed/reset/capture can never be prod-safe, say so if the builder asks for it) · who may call it (auth mode + capability string → `authDetail`) · does it destroy anything (→ `destructive`, and destructive semantics spelled out in the description) · how an agent proves it works (the acceptance probe).
3. **Then run the six-need gap diff.** The checklist is the floor, not the ceiling: interview-derived specs join the six-need candidates in one pick list, interview items first.
4. **Output artifact** — for product surfaces, not a pick list but a capability-add design doc in the agent-ops-spec mold (proven shape: `ROROROblox/docs/superpowers/specs/2026-07-10-agent-ops-surface-design.md`), written to `docs/vibe-access/capability-add-<YYYY-MM-DD>.md`: enumerated gaps; per-gap affordance spec (`id`, `kind`, `tier`, `auth` + capability, `description` written for an agent reader with destructive semantics spelled out, acceptance probe); and the per-gap cadence — after each gap lands, rescan → remap → reverify. For dev-loop surfaces where the six-need list covered everything and the interview added nothing, the existing pick-list flow stands.
5. **The agnostic rider, binding:** when the adapter is agnostic or not-yet-implemented, scaffold must NOT stand down silently. It runs the same interview and hand-carries the resulting specs with the agent (the gate mechanism documented in adapter-notes), exactly as scan/map's agnostic path already does. "No adapter" changes who types the code, not whether the conversation happens.

**Router prose:** when the router recommends scaffold, it names the interview as the first beat ("scaffold will start by asking what you want agents to be able to do — the checklist comes after").

---

## 15. Router: the post-add cadence

Prose addition to `skills/router/SKILL.md`. After any capability lands in the app — scaffolded by the plugin or hand-built — the router recommends the loop **by name**: **rescan → remap → reverify.** The RoRoRo spec wrote this cadence by hand ("re-run scan → map → verify after each gap lands"); the router owns it now. Two accompanying sentences ship in the prose: re-map preserves overrides and verify stamps, so the loop is cheap; and on assert-backed surfaces the reverify's connection success is itself evidence (the host won't boot on an incomplete capability map).

The router also names the v0.2 surfaces: after map or verify completes, it recommends `:visualize` ("render the sheet — see what an agent sees"); when the rendered UNDOCUMENTED count is nonzero, it recommends `:describe`; after `:describe` runs, re-render and watch the count drop.

---

## 16. Build order

The renderer is the ask; it ships first, and nothing the builder didn't ask for gates it. §8 — the only part of the release with blast radius on v0.1 — ships as its own independently taggable step with regression tests, the same standing §14 already has. If the cycle runs long, the pieces that slip are the audit layer and the MCP branch, never the sheet.

1. Scrub the fixtures (§10.1) and capture one real `tools/list` payload from the 626labs connector into `tests/fixtures/` — the 2-minute move that keeps the MCP branch from being designed from paper.
2. Normalizer + ToolView (§4) against both scrubbed fixtures. Tests alongside.
3. Renderer, bare mode (§5–6): skeleton bands → card → THE CALL.
4. Grafts in the judges' order: density/compact-default + chips-when-true → print inks + DESTRUCTIVE-scarcity + `<wbr>` + `{?}` → collapse duplicate slugs → `--no-source` / `--terse` / URL-hash / Save-as-PDF / print-filter.
5. CLI wiring + skill + `commands/visualize.md` (§3). **Real-app validation, first pass (§10.2.1–2, 4, 6–7):** render both real manifests, print, page budget, arm's length — and run the §10.2.5 acceptance test, expecting the recorded pre-§13 failure. Recorded, not waived.
6. §8, as its own step: regression tests FIRST (pin today's seed/reset/capture posture before the destructive clause exists), then the schema deltas + map write-through/preservation (both paths) + the posture matrix; prove both real manifests still round-trip scan → map → verify unchanged; run the RoRoRo kind migration (7 reads into `overrides.kind`).
7. §13: input-shape mining (+ the inventory `inputShape` delta) and `:describe`. Run both on WeSeeYou; re-render; §10.2.5 now passes or the release is not done.
8. `--grade` layer (§7): badges, D-predicates, measured axes, audit bands 6–11. If the schedule bites, this is what slips to v0.3 — the sheet does not wait for it.
9. MCP input branch (§4.1 shapes 2–4), built against the captured fixture; the 626Labs render (§10.2.3) validates it.
10. Interview + router prose (§14–15).
11. CHANGELOG.md (created at repo root, Keep-a-Changelog, `0.2.0` section with the one-way compatibility note), README roster line, `plugin.json` 0.1.0 → 0.2.0 + description, tag `v0.2.0`, canary; stable promotion via the marketplace ref bump after a real install proves it.
