---
name: describe
description: This skill should be used when the user says "/vibe-access:describe", "write real descriptions", "document the affordances", "fix the UNDOCUMENTED count", or after visualize shows a wall of machine templates. Reads the manifest, reads the handler source behind every templated affordance, and authors real descriptions into overrides.description. Agent work — no engine code, nothing lands unreviewed.
---

# vibe-access describe

Load `skills/guide/SKILL.md` first. Requires `agent-access.json` at the app root (else
recommend `/vibe-access:map`).

**What this closes.** Map generates `Act: POST /api/lists` — a description that restates
the route and tells an agent reader nothing. On WeSeeYou that is 84 of 85 affordances.
The manifest is the consent surface an agent reads before it calls anything; a wall of
machine templates makes it a directory, not a document. This skill turns the templates
into sentences a cold reader can act on. It is the only step in vibe-access where the
agent WRITES prose into the manifest — treat every string as load-bearing.

**Scope.** Descriptions only. Never change `kind`, `tier`, `auth`, `transport`, or
`verified` from here — those are scan/map/verify territory, and quietly editing them
under cover of a docs pass is exactly the drift the manifest exists to prevent.

## 1. Select the targets

The set is every affordance whose EFFECTIVE description (`overrides.description ??
description`) is a machine template. Do not eyeball it — ask the engine, which owns the
predicate the visualizer grades against:

```bash
node -e "
const m=require('<app>/agent-access.json');
import('./engine/visualize.mjs').then(({isTemplatedDescription})=>{
  const t=m.affordances.filter(a=>isTemplatedDescription(a.overrides?.description ?? a.description, a));
  console.log(t.length+' of '+m.affordances.length+' undocumented');
  for(const a of t) console.log([a.id,a.kind,a.tier,a.auth,a.sourceRef].join(' | '));
});"
```

`--only <id,id,...>` narrows to a hand-picked list. Nothing else is a target: an
affordance that already carries an authored description is left alone unless the user
names it.

## 2. Read the source — this is the whole job

Per affordance, before writing a word:

- Open the handler at `sourceRef`. Read the function body. What does it actually do —
  what it writes, what it returns, what it refuses.
- Read the JSDoc / leading comments if any.
- Read any test that exercises it. A test names the contract better than the handler does.
- Read the `input` shape in the manifest. If it is mined (`x-mined-from`), the properties
  are real reads out of the handler — name them in the prose, but do not invent types the
  source never stated.

If the source does not answer a question, the description does not answer it either. An
invented "returns the updated list" that the handler never returns is worse than the
template it replaced — the template at least lied about nothing.

## 3. Author against D1–D7

The seven axes are an AUTHORING CHECKLIST here, not a scoreboard. Write one paragraph,
plain prose, no bullets, no marketing. Hit what applies:

| Axis | What the sentence must carry |
|---|---|
| **D1** purpose beyond the route | What it does in the app's own nouns. `Act: POST /api/lists` is not a purpose; "Creates a named watchlist for the signed-in user" is. |
| **D2** when to use | The situation that calls for it: "for", "when", "so that", "used to". |
| **D3** when NOT to use | The negative guidance. "Do not", "never", "only when", "not for", "404s outside the emulator". This is the axis every generated description misses and the one a cold agent needs most. |
| **D4** inputs in prose | Name the parameters as identifiers — backticked or camelCase — so the reader sees them in the sentence, not just in a table. N/A when it takes nothing. |
| **D5** result shape | What comes back. N/A for seed/reset/capture, where the result is the state change. |
| **D6** side effects | What it writes, deletes, sends, charges, kills. Required for act/seed/reset. Say it in the words a human would use in an incident review. |
| **D7** consent and auth | In words, not in the enum. "Requires a Firebase ID token"; "Open — no auth, and it answers anyone." An `auth: none` route passes this axis by SAYING it is open, never by being open. |

Two standing rules:

- **Say destructive out loud when it is.** If the handler stops sessions, wipes state, or
  spends money, the description says so in its first clause — and the affordance gets
  `destructive: true` (the §8.3 field), because prose alone is not a claim the engine can
  read. RoRoRo's `stop-accounts` is the exemplar: the override is the only place the
  destructive truth lives.
- **Never fabricate a gate.** If the handler has no auth check, the description does not
  get to imply one. Writing "requires authentication" over an open route is the fail-open
  this plugin exists to catch, committed in the documentation layer.

Target length: 1–3 sentences, ~40–300 characters. Longer is fine when the tool earns it
(a destructive one always does).

## 4. Write into `overrides.description`

`overrides.description` is the re-map-safe home. It is already the effective-description
winner (§4.3.1) and already survives re-map; the top-level `description` field does not.
Write there, always, even when the affordance has no other override:

```json
{
  "id": "create-list",
  "description": "Act: POST /api/lists",
  "overrides": { "description": "Creates a named watchlist for the signed-in user..." }
}
```

Leave the generated `description` in place. It is the scan's record of what the route is;
the override is the human record of what it means. Map re-emits both.

## 5. Batch cadence — nothing lands unreviewed

These strings are the consent surface an agent reader will trust. They do not get
auto-applied 84 at a time.

1. **Group** by the visualizer's band-3 grouping (path prefix / capability family). Work
   one group per round.
2. **Propose** the group's descriptions to the user in one message — id, one line each,
   the source you read them from.
3. **Approve or edit.** The user edits in the message; you take the edit verbatim. If the
   user is silent on a row, it is not approved.
4. **Write** the approved rows into `overrides.description`, then re-validate:
   `node engine/cli.mjs map --app <target>` must still round-trip (a broken manifest is a
   failed docs pass), or validate directly if a re-map would overwrite a pending scan.
5. **Re-render** after the last group: `node engine/cli.mjs visualize --app <target>` and
   report the UNDOCUMENTED count movement — the number before, the number after, plainly.
   If it did not move as far as expected, say so; do not round it in your favor.

## 6. Report

Close with the movement and nothing dressed up:

- UNDOCUMENTED: N before → M after, of T affordances.
- Which groups landed, which the user declined.
- Any affordance you could NOT describe because the source did not say enough — name it.
  An honest "I could not tell what this does from the handler" is a finding about the
  handler, and it belongs in front of the builder.

The §10.2.5 acceptance test is the bar: pick three affordances at random from the
re-rendered sheet. A cold reader must be able to say what each one does from PURPOSE
alone, and paste THE CALL with every parameter named. A machine template is an automatic
fail on the first; an empty `arguments: {}` on a tool that takes input is a fail on the
second.
