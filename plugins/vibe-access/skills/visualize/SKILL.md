---
name: visualize
description: This skill should be used when the user says "/vibe-access:visualize", "visualize the surface", "render the manifest", "make the toolsheet", or wants a readable HTML sheet of everything an agent can call. Renders a manifest OR a live MCP server's tools/list into one self-contained HTML file in docs/vibe-access/. Read-only against the app; writes exactly one HTML file.
---

# vibe-access visualize

Load skills/guide/SKILL.md. Input is either an `agent-access.json` manifest or an MCP
`tools/list` payload — the engine sniffs the shape, there is no mode flag.

## The manifest path (the default)

1. Run `node engine/cli.mjs visualize --app <target>`. It reads `<target>/agent-access.json`
   and writes `<target>/docs/vibe-access/agent-access-<YYYY-MM-DD>.html`.
   Flags: `--input <file>` · `--out <file>` · `--open` · `--no-source` · `--terse`.
2. Say the footprint out loud before it lands: that is the same committed directory the scan
   and verify reports live in, and the file embeds every `sourceRef` unless you pass
   `--no-source`. Offer the gitignore line `docs/vibe-access/*.html` to anyone who does not
   want rendered surfaces in history, and `--no-source` for any sheet leaving the building.
3. Report what the page says, not that it rendered: tool count, how many descriptions are
   still machine templates, the open (unauthenticated) surface, and the verify decomposition
   as the page prints it — ran / gate-held / handle-gate-held / open / error / unverified.
   Never collapse that into a bare pass count, and never grade the tool count: 17 is not a
   better number than 85.
4. Recommend `/vibe-access:describe` when the UNDOCUMENTED count is high — a sheet of
   machine templates answers nobody's question.

## The live-MCP path (you do the fetching, in-session)

No MCP client ships in the engine, and the HTML never makes a network call. When the user
wants a sheet for a running MCP server, YOU are the client:

1. Read the server entry from `.mcp.json` (project) or the user's Claude config, and confirm
   which server they mean when there is more than one.
2. Call `tools/list` yourself, in-session — the connected MCP tools are already in your
   context; if the server is not connected, say so rather than guessing at its surface.
3. Save the raw payload to `<target>/.vibe-access/state/visualize-input.json`. Any of the
   three shapes is fine: a bare tools array, `{ tools: [...] }`, or the full JSON-RPC
   `{ result: { tools: [...] } }` envelope. Include `serverInfo` when you have it — the
   transport banner reads it.
4. Run `node engine/cli.mjs visualize --app <target> --input .vibe-access/state/visualize-input.json`.
5. Report as above. MCP inputs carry no verify stamps and no declared transport — the page
   says so; do not invent either.

Never hand-edit the emitted HTML, and never re-render a real app's surface into a public repo
without scrubbing it first: a rendered sheet of a live breach is the exact vulnerability this
plugin exists to catch, published.
