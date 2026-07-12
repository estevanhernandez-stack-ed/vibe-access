import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { normalize, render, verifyDecompositionSentence } from '../engine/visualize.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const WSY = fixture('manifest-weseeyou.json');
const RORO = fixture('manifest-rororo.json');
const MCP = fixture('mcp-tools-list.json');

const RENDERED_AT = '2026-07-11T12:00:00.000Z';
const view = (json, opts = {}) => normalize(json, { renderedAt: RENDERED_AT, ...opts });

const WSY_HTML = render(view(WSY));
const RORO_HTML = render(view(RORO));
const MCP_HTML = render(view(MCP));

const count = (html, needle) => html.split(needle).length - 1;
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

describe('emit shape', () => {
  test('one self-contained HTML document', () => {
    for (const html of [WSY_HTML, RORO_HTML, MCP_HTML]) {
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<meta charset="utf-8">');
      expect(html.trimEnd().endsWith('</html>')).toBe(true);
      expect(html).toContain('<style>');
    }
  });

  test('deterministic — same input renders byte-identical output', () => {
    expect(render(view(WSY))).toBe(WSY_HTML);
    expect(render(view(RORO))).toBe(RORO_HTML);
    expect(render(view(MCP))).toBe(MCP_HTML);
  });

  test('zero external references — nothing on this page hits the network', () => {
    for (const html of [WSY_HTML, RORO_HTML, MCP_HTML]) {
      expect(html).not.toMatch(/<link\b/i);
      expect(html).not.toMatch(/<script[^>]+\bsrc=/i);
      expect(html).not.toMatch(/\bsrc\s*=\s*["']https?:/i);
      expect(html).not.toMatch(/\bhref\s*=\s*["']https?:/i);
      expect(html).not.toMatch(/\bhref\s*=\s*["']\/\//);
      expect(html).not.toMatch(/\/\/cdn/i);
      expect(html).not.toMatch(/@import/i);
      expect(html).not.toMatch(/url\(\s*['"]?https?:/i);
      expect(html).not.toMatch(/\bfetch\s*\(/);
      expect(html).not.toMatch(/XMLHttpRequest/);
      // npipe base URLs are never anchors (§4.3.3).
      expect(html).not.toContain('href="npipe');
    }
  });

  test('system font stack — the 626 faces are not embedded', () => {
    expect(WSY_HTML).toContain('--font-ui:');
    expect(WSY_HTML).toContain('system-ui');
    expect(WSY_HTML).toContain('ui-monospace');
    expect(WSY_HTML).not.toMatch(/@font-face/i);
  });

  test('dark screen tokens plus a print flip to ink on paper', () => {
    expect(WSY_HTML).toContain('#0b1526');
    expect(WSY_HTML).toContain('#17d4fa');
    expect(WSY_HTML).toContain('#f22f89');
    expect(WSY_HTML).toContain('@media print');
    expect(WSY_HTML).toContain('color-scheme: light');
    expect(WSY_HTML).toContain('window.print()');
  });
});

describe('bands (§6.1) — the tools are the page', () => {
  test('the bare render carries the reference-sheet bands, in order', () => {
    const bands = ['masthead', 'lede', 'index', 'cards', 'how-to-read', 'provenance'];
    const at = bands.map((b) => WSY_HTML.indexOf(`data-band="${b}"`));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test('the audit bands are opt-in — the bare sheet carries no grades', () => {
    expect(WSY_HTML).not.toContain('data-band="report-card"');
    expect(WSY_HTML).not.toContain('data-band="verdict"');
  });

  test('the prerequisite chain renders only when mined', () => {
    expect(RORO_HTML).toContain('data-band="prereqs"');
    expect(MCP_HTML).not.toContain('data-band="prereqs"');
  });

  test('the transport banner corrects the manifest lie', () => {
    expect(RORO_HTML).toContain('grpc-npipe');
    expect(RORO_HTML).toContain('You cannot curl this');
    expect(WSY_HTML).not.toContain('You cannot curl this');
  });
});

describe('cards — the fixed eight-block skeleton (§6.2)', () => {
  const BLOCKS = [
    'purpose', 'when-to-use', 'when-not-to-use', 'input',
    'output', 'annotations', 'consent', 'call',
  ];

  test('every affordance produces a card', () => {
    const v = view(WSY);
    expect(count(WSY_HTML, 'class="card"')).toBe(v.tools.length);
    expect(count(RORO_HTML, 'class="card"')).toBe(17);
    for (const t of v.tools) expect(WSY_HTML).toContain(`id="tool-${t.name}"`);
  });

  test('all eight blocks are present on every card, never silently omitted', () => {
    for (const [html, n] of [[WSY_HTML, 85], [RORO_HTML, 17], [MCP_HTML, view(MCP).tools.length]]) {
      for (const b of BLOCKS) expect(count(html, `data-block="${b}"`)).toBe(n);
    }
  });

  test('THE CALL renders — native plus the MCP projection, with the disclaimer', () => {
    expect(WSY_HTML).toContain('curl -X POST');
    expect(WSY_HTML).toContain('"method": "tools/call"');
    expect(count(WSY_HTML, 'Projection — not a running server.')).toBe(85);
    // No input schema anywhere in the corpus: the hole is kept where it is actionable.
    expect(WSY_HTML).toContain('no input schema declared or minable');
  });

  test('the gRPC call block is never a fake URL', () => {
    expect(RORO_HTML).toContain('npipe://./pipe/rororo-plugin-host');
    // The only "curl" on a gRPC sheet is the banner telling you that you cannot.
    expect(RORO_HTML).not.toContain('curl -X');
    expect(RORO_HTML).toContain('You cannot curl this');
    expect(RORO_HTML).toContain('x-plugin-id');
  });

  test('unnamed path params are impossible to paste past', () => {
    const starred = view(WSY).tools.filter((t) => t.transport.pathParams.length > 0);
    expect(starred.length).toBeGreaterThan(0);
    expect(WSY_HTML).toContain('UNNAMED_PARAM_1');
  });

  test('the templated description prints, muted, under an UNDOCUMENTED slug', () => {
    expect(WSY_HTML).toContain('UNDOCUMENTED');
    expect(WSY_HTML).toContain('No authored description — this is the scan template');
    const terse = render(view(WSY), { terse: true });
    expect(terse).toContain('UNDOCUMENTED');
    expect(terse).not.toContain('>Act: POST /api/generate-quiz<');
  });

  test('the override wins on the one card where the truth lives (§4.3.1)', () => {
    expect(RORO_HTML).toContain('DESTRUCTIVE - closes real Roblox clients');
    expect(RORO_HTML).toContain('⚠ DESTRUCTIVE');
  });

  test('the card footer prints the verify class word beside the detail verbatim', () => {
    expect(RORO_HTML).toContain('HANDLE-GATE-HELD');
    expect(RORO_HTML).toContain('GATE-HELD');
    expect(WSY_HTML).toContain('OPEN');
  });
});

describe('the two honesty rules the renderer may never drop', () => {
  test('verify math renders the full class decomposition, never a bare pass count', () => {
    const roro = view(RORO);
    const sentence = verifyDecompositionSentence(roro.counts.verify);
    expect(sentence).toBe('17 probed — 3 ran, 12 gate-held, 2 handle-gate-held.');
    expect(RORO_HTML).toContain(sentence);
    expect(RORO_HTML).not.toContain('17/17');
    // handle-gate-held is never folded into gate-held.
    expect(RORO_HTML).toContain('handle-gate-held');
    const wsy = view(WSY);
    expect(WSY_HTML).toContain(verifyDecompositionSentence(wsy.counts.verify));
  });

  test('tool count is never graded', () => {
    for (const html of [WSY_HTML, RORO_HTML, MCP_HTML]) {
      expect(html).toContain('Tool count is not graded.');
      expect(html).not.toMatch(/grade[^<]{0,20}\b\d+ tools\b/i);
    }
  });
});

describe('no fixed-width overflow', () => {
  test('long identifiers and paths wrap instead of blowing the measure', () => {
    expect(WSY_HTML).not.toMatch(/white-space:\s*nowrap/i);
    expect(WSY_HTML).toContain('overflow-wrap: anywhere');
    expect(RORO_HTML).toContain('<wbr>');
    expect(WSY_HTML).toContain('overflow-x: auto');
  });
});

describe('escaping (§4.3.8)', () => {
  test('the JSON island never breaks out of its script tag', () => {
    for (const html of [WSY_HTML, RORO_HTML, MCP_HTML]) {
      const island = html.split('<script type="application/json" id="surface">')[1].split('</script>')[0];
      expect(island).not.toContain('</script');
      expect(island).not.toContain(LINE_SEP);
      expect(island).not.toContain(PARA_SEP);
      expect(() => JSON.parse(island)).not.toThrow();
    }
  });

  test('--no-source strips the file tree out of the artifact', () => {
    const html = render(view(WSY, { noSource: true }), { noSource: true });
    expect(html).not.toContain('functions\\src');
    expect(html).not.toContain('functions/src');
  });

  test('--no-source scrubs the JSON island and the findings, not just the visible chips', () => {
    // The island is what Copy-as-Markdown reads, and the finding titles quote the clustered
    // source file by name. Both have to be clean or the flag is a lie.
    const html = render(view(WSY, { noSource: true }));
    const island = html.split('<script type="application/json" id="surface">')[1].split('</script>')[0];
    const data = JSON.parse(island);
    expect(data.tools.length).toBeGreaterThan(0);
    expect(data.tools.every((t) => t.provenance.sourceRef === null)).toBe(true);
    expect(data.tools.every((t) => t.provenance.line === null)).toBe(true);
    expect(JSON.stringify(data.findings)).not.toContain('functions');
    expect(html).not.toContain('functions/src');
    expect(html).not.toContain('functions\\\\src');
    // ...and the un-flagged render still carries them, so the assertion means something.
    expect(WSY_HTML).toContain('functions/src');
  });

  test('the leak flag has one owner — render throws rather than half-honoring it', () => {
    expect(() => render(view(WSY), { noSource: true })).toThrow(/normalize/);
    // The scrubbed view needs no flag at render: the view carries it.
    expect(() => render(view(WSY, { noSource: true }))).not.toThrow();
    expect(() => render(view(WSY, { noSource: true }), { noSource: true })).not.toThrow();
  });
});

describe('print (§9) — the ink palette is token-driven, not patched per selector', () => {
  const printBlock = (html) => html.split('@media print{')[1].split('\n@page')[0];

  test('@media print redefines the tokens themselves', () => {
    const p = printBlock(WSY_HTML);
    for (const tok of ['--ink:#111', '--ink-2:#6B6660', '--ink-3:#6B6660', '--line:#ddd8d0',
      '--cyan:#0F6B6B', '--magenta:#7A1F2B', '--navy:#FBFAF7', '--code-bg:#F3F1EC']) {
      expect(p).toContain(tok);
    }
    expect(p).toContain('color-scheme: light');
  });

  test('no rule hard-references a screen ink or a screen accent', () => {
    // The bug class: `.tname{color:var(--ink)}` renders near-white on white paper. Every
    // color in the sheet is a token, so nothing can be left behind on the flip.
    const css = WSY_HTML.split('<style>')[1].split('</style>')[0];
    const screenOnly = ['#e9eff8', '#a9b8ce', '#71849f', '#1d3050', '#17d4fa', '#f22f89', '#0b1526', '#101e33'];
    const decls = css.split('\n').filter((l) => !l.includes('--'));
    for (const hex of screenOnly) {
      expect(decls.join('\n')).not.toContain(hex);
    }
  });

  test('the ink preview toggle actually has rules to apply', () => {
    expect(WSY_HTML).toContain(':root[data-ink]{');
    expect(WSY_HTML).toContain(':root[data-ink] .chip');
    // The dead `body.ink` class toggle is gone.
    expect(WSY_HTML).not.toContain("classList.toggle('ink')");
  });

  test('density is a screen affordance — paper prints every card whole', () => {
    expect(WSY_HTML).toContain('@media screen{');
    const screen = WSY_HTML.split('@media screen{')[1].split('\n}')[0];
    expect(screen).toContain('[data-density=rows]');
    // The route, the footer, and the micro-footer are the per-card honesty channel: a page
    // torn out of the PDF still says what it is.
    const p = printBlock(WSY_HTML);
    expect(p).not.toContain('[data-density=rows]');
    expect(p).not.toContain('.card .route{display:none}');
  });

  // F2 — the review found the derived reason on paper in exactly zero places: the DESTRUCTIVE
  // chip carried it in a `title=` (renders in no PDF) and `.ann .why{display:none}` deleted the
  // rest. §6.2: "hover AND print show the derivedFrom string." §4.3.5: "rendered as derived,
  // always, both channels (hover title + printed provenance line)."
  test('the derived reason is real TEXT in the markup, not only a title attribute', () => {
    const stop = view(RORO).tools.find((t) => t.name === 'stop-accounts');
    const why = stop.destructive.provenance.derived;
    expect(why).toMatch(/inferred from the word/);
    // channel 1 — the hover, on screen (attribute: quotes escaped)
    expect(RORO_HTML).toContain(`title="${why.replace(/"/g, '&quot;')}"`);
    // channel 2 — the printed line, in a real element with real text
    expect(RORO_HTML).toContain(`<p class="chip-why"><b>⚠ DESTRUCTIVE</b> is derived, not declared — ${why}</p>`);
  });

  test('every derived annotation prints its reason — a derived cell with no why is a bare claim', () => {
    for (const [html, json] of [[WSY_HTML, WSY], [RORO_HTML, RORO]]) {
      const reasons = new Set();
      for (const t of view(json).tools) {
        for (const k of ['readOnly', 'destructive', 'idempotent', 'openWorld']) {
          const p = t.annotations[k].provenance;
          if (p && typeof p === 'object' && p.derived) reasons.add(p.derived);
        }
      }
      expect(reasons.size).toBeGreaterThan(0);
      for (const r of reasons) {
        expect(html).toContain(`<span class="why">${r}</span>`);
      }
    }
  });

  test('NO print rule hides the elements that carry a derived reason', () => {
    const p = printBlock(WSY_HTML);
    // The regression this pins: `.ann .why{display:none}` — the whole reason, gone at the one
    // moment the sheet claims to be a document.
    const hidden = p
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /display:\s*none/.test(l))
      .filter((l) => /\.why|\.chip-why/.test(l));
    expect(hidden).toEqual([]);
    expect(p).toContain('.ann .why{display:inline');
    // ...and the print block never re-hides the chip line either.
    expect(p).not.toMatch(/\.chip-why\{[^}]*display:\s*none/);
  });

  test('the screen is where the compact channel lives — and only the screen', () => {
    // The hiding is a SCREEN rule, so paper cannot inherit it. Delete the screen rule and the
    // sheet gets noisier; delete a print rule and the sheet gets dishonest.
    const screen = WSY_HTML.split('@media screen{')[1].split('\n}')[0];
    expect(screen).toContain(':root:not([data-ink]) .chip-why{display:none}');
    // The ink preview IS the paper preview: it shows what paper shows.
    expect(screen).not.toContain('[data-ink] .chip-why{display:none}');
  });

  test('THE CALL is pasteable — the prose that qualifies it lives outside the code block', () => {
    // The copy button copies the <pre>. Prose glued to the end of a curl is a command that
    // fails on paste, and "both copyable" is the §6.2 contract.
    const after = render(view(fixture('manifest-weseeyou-described.json')));
    const pres = [...after.matchAll(/<pre class="code">([\s\S]*?)<\/pre>/g)].map((m) => m[1]);
    expect(pres.length).toBeGreaterThan(0);
    for (const pre of pres) {
      expect(pre).not.toContain('Parameters mined from');
      expect(pre).not.toContain('a caller cannot know what goes here');
    }
    // The words are not gone — they moved one line down, and they print.
    expect(after).toContain('<p class="callnote">Parameters mined from');
    expect(printBlock(after)).not.toMatch(/\.callnote\{[^}]*display:\s*none/);
  });

  test('the MCP projection is a details that stays shut on paper when a native call exists', () => {
    expect(count(WSY_HTML, '<details class="mcp pc">')).toBe(85);
    expect(count(RORO_HTML, '<details class="mcp pc">')).toBe(17);
    // An MCP-sourced surface has no native call, so the projection IS the payload: open.
    expect(MCP_HTML).not.toContain('class="mcp pc"');
    expect(MCP_HTML).toContain('<details class="mcp" open>');
    expect(printBlock(WSY_HTML)).toContain('details:not(.pc)>*{display:block!important}');
  });

  // §10.2.6 — the page budget is a shipping criterion, and the cuts that buy it are DENSITY.
  // The one rule: a print rule may change how a fact is set, never whether it is set.
  test('the parameter table runs in on paper — same cells, same order, one line each', () => {
    const p = printBlock(WSY_HTML);
    expect(p).toContain('.params,.params tbody,.params tr{display:block}');
    expect(p).toContain('.params td{display:inline');
    expect(p).toContain('.params thead{display:none}');
    // The header carried the column names; when it goes, the one cell whose value cannot name
    // itself takes its label with it. Losing a column name is losing information.
    expect(p).toContain('.params td:nth-child(4)::before{content:" · default "}');
  });

  test('no print rule deletes a fact — only the chrome and the empty rows may go', () => {
    const p = printBlock(WSY_HTML);
    // Everything the sheet is allowed to hide on paper: interactive chrome, the hidden-by-filter
    // cards, the table header whose names moved into the cells. Anything else that goes dark in
    // print is a fact the PDF stops carrying — the F2 class of bug.
    const allowed = ['.no-print', '.params thead', 'details.pc>summary::-webkit-details-marker'];
    const killers = p
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /display:\s*none/.test(l))
      .filter((l) => !allowed.some((sel) => l.startsWith(sel)));
    expect(killers).toEqual([]);
  });
});

// ================================================================ the judge-panel grafts (§6, D2)
// The acceptance bar is not "complete" — it is SCANNABLE at 85 tools.

describe('graft 1 — density: compact rows are the DEFAULT above 40 tools (D5)', () => {
  test('the default is rendered into the markup, not applied by a script after paint', () => {
    // A JS-applied default is a flash of 85 uncollapsed cards, and it is nothing at all with
    // scripting off. The renderer knows the count; it says so in the attribute.
    expect(WSY_HTML).toContain('<html lang="en" data-density="rows">');
    expect(RORO_HTML).toContain('<html lang="en">');
    expect(MCP_HTML).not.toContain('data-density="rows"');
    // ...and the JS no longer sets it, so there is exactly one owner of the default.
    expect(WSY_HTML).not.toContain('cards.length>40');
  });

  test('density state rides in the URL hash, like every other view state', () => {
    expect(WSY_HTML).toContain("d=rows");
    expect(WSY_HTML).toContain('hashchange');
  });
});

describe('graft 2 — chips only when the fact is TRUE (D10)', () => {
  const chipsIn = (html) => [...html.matchAll(/<span class="chip[^"]*"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);

  test('a chip never states a negative — "not destructive" is noise, not signal', () => {
    for (const html of [WSY_HTML, RORO_HTML, MCP_HTML]) {
      for (const c of chipsIn(html)) {
        expect(c).not.toMatch(/\bnot\b|\bno\b|false/i);
      }
    }
  });

  test('a clean card carries an empty rail and is visually boring on purpose', () => {
    // 85 cards, 15 open, 1 dev-only, a handful privilege-shaped: most rails are empty.
    expect(count(WSY_HTML, '<span class="rail"></span>')).toBeGreaterThan(30);
  });

  test('OPEN is chipped only on the auth-none cards, never on the gated ones', () => {
    const open = view(WSY).tools.filter((t) => t.consent.mode === 'none').length;
    expect(open).toBe(15);
    expect(count(WSY_HTML, '○ OPEN')).toBe(open);
  });
});

describe('graft 3 — print inks + DESTRUCTIVE scarcity (D10, D11)', () => {
  const cssOf = (html) => html.split('<style>')[1].split('</style>')[0];

  test('the danger ink is spent ONLY on danger — if everything is red, nothing is', () => {
    // #7A1F2B oxblood on paper / magenta on screen is a scarce resource. It belongs to the
    // destructive chip, the failed/open verify classes, and the risk banners. An absence slug
    // is not a danger; 253 red absence slugs on the WeSeeYou page would drown the two marks
    // the reader actually has to see.
    const allowed = [
      '.chip.filled', '.chip.risk', '.banner.risk', '.v-open,.v-error',
      'body.filtered .print-filter',
      // A breach finding card (--grade band 9) is danger — the ink is spent on the one thing
      // it exists for. An axis row, a tile, and a letter chip are not, and none of them take it.
      '.finding.sev-breach',
    ];
    const offenders = cssOf(WSY_HTML)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('var(--magenta)') && !l.startsWith('--'))
      .filter((l) => !allowed.some((sel) => l.startsWith(sel)));
    expect(offenders).toEqual([]);
  });

  test('DESTRUCTIVE is the only FILLED chip in the entire document', () => {
    for (const html of [WSY_HTML, RORO_HTML, MCP_HTML]) {
      for (const m of html.matchAll(/<span class="chip filled"[^>]*>([^<]+)<\/span>/g)) {
        expect(m[1]).toContain('DESTRUCTIVE');
      }
    }
  });

  test('the filled chip is RARE — one loud mark across 85 cards, not a badge rail', () => {
    expect(count(WSY_HTML, 'class="chip filled"')).toBeLessThanOrEqual(2);
    expect(count(RORO_HTML, 'class="chip filled"')).toBeLessThanOrEqual(3);
    expect(count(RORO_HTML, 'class="chip filled"')).toBeGreaterThan(0);
  });
});

describe('graft 4 — <wbr> in long identifiers and paths', () => {
  test('CamelCase rpc names wrap at token-internal boundaries, not mid-token', () => {
    expect(RORO_HTML).toContain('Subscribe<wbr>Mutex<wbr>State<wbr>Changed');
    // The path separators break too, so /rororo.plugin.v1.RoRoRoHost/… never blows the measure.
    expect(RORO_HTML).toContain('rororo.<wbr>plugin.<wbr>v1.');
    expect(WSY_HTML).toContain('<wbr>');
  });
});

describe('graft 5 — {?} is the unknown parameter, never a bare glob', () => {
  test('a `*` segment renders as a footnoted {?} glyph in the route line', () => {
    expect(WSY_HTML).toContain('<span class="qmark"');
    expect(WSY_HTML).toContain('{?}');
    expect(WSY_HTML).toMatch(/class="qmark" title="[^"]*unnamed path parameter/);
    // Never a bare asterisk in a rendered route.
    expect(WSY_HTML).not.toMatch(/<code>[^<]*\*[^<]*<\/code>/);
  });

  test('the glyph is styled, not danger-inked — it is a gap, not a fire', () => {
    const css = WSY_HTML.split('<style>')[1].split('</style>')[0];
    expect(css).toMatch(/\.qmark\{[^}]*underline/);
    expect(css).not.toMatch(/\.qmark\{[^}]*var\(--magenta\)/);
  });
});

describe('graft 6 — collapse the duplicate slugs (D7)', () => {
  test('an empty block is ONE compact labeled line, not a full-height frame', () => {
    // 85 cards × 4 near-always-empty blocks = the wall this graft exists to kill.
    expect(WSY_HTML).not.toContain('<p class="slug">Not stated.</p>');
    expect(count(WSY_HTML, 'class="block empty"')).toBeGreaterThan(200);
    const css = WSY_HTML.split('<style>')[1].split('</style>')[0];
    expect(css).toContain('.block.empty{display:inline-block');
    expect(css).toContain('.block.empty h4{display:inline');
  });

  test('the absence is stated ONCE at surface level, not 170 times on the cards', () => {
    const v = view(WSY);
    expect(v.counts.templated).toBe(84);
    expect(v.counts.withInputSchema).toBe(0);
    expect(count(WSY_HTML, 'absence-note"')).toBe(1);
    expect(WSY_HTML).toContain('84 of 85 descriptions are scan templates');
    expect(WSY_HTML).toContain('0 of 85 declare an input schema');
    // The to-do sentence rides with the surface statement — once, not on every card.
    expect(count(WSY_HTML, '/vibe-access:describe')).toBe(1);
  });

  test('the consent epigram is stated once too, not on 70 of 85 cards', () => {
    // The auth MODE is per-card — "can I call this" is in-ask. The sentence behind it is not.
    expect(count(WSY_HTML, 'is not "no capability required."')).toBe(1);
    expect(WSY_HTML).toContain('data-band="how-to-read"');
    expect(count(WSY_HTML, 'mechanism not stated in the surface.')).toBeGreaterThan(50);
    expect(WSY_HTML).not.toContain('class="slug"');
  });

  test('the card still says it — one muted line each, and the template still prints (D8)', () => {
    expect(count(WSY_HTML, 'No authored description — this is the scan template')).toBe(84);
    expect(WSY_HTML).toContain('class="tmpl"');
    expect(count(WSY_HTML, 'class="block empty" data-block="input"')).toBeGreaterThan(50);
  });
});

describe('graft 7 — --terse and --no-source', () => {
  test('--terse drops the machine template body and keeps the slug', () => {
    const terse = render(view(WSY), { terse: true });
    expect(terse).toContain('UNDOCUMENTED');
    expect(terse).toContain('No authored description — this is the scan template');
    expect(terse).not.toContain('class="tmpl"');
    // Everything else survives: the call a reader pastes is not noise.
    expect(count(terse, 'class="card"')).toBe(85);
    expect(terse).toContain('curl -X POST');
  });

  test('--no-source drops the micro-footer file names too, not just the chips', () => {
    const html = render(view(WSY, { noSource: true }));
    expect(html).not.toContain('.js:');
    expect(html).toContain('class="micro"');
  });
});

describe('graft 8 — the URL hash is the deep link', () => {
  test('every card carries a permalink anchor', () => {
    const v = view(WSY);
    expect(count(WSY_HTML, 'class="anchor no-print"')).toBe(v.tools.length);
    expect(WSY_HTML).toContain('title="link to this tool"');
  });

  test('a #tool-… hash opens and reveals that card, even in compact density', () => {
    // Without this, "send me the link to get-challenges" lands the reader on a collapsed row.
    expect(WSY_HTML).toContain("indexOf('#tool-')");
    expect(WSY_HTML).toContain("scrollIntoView");
    expect(WSY_HTML).toContain("classList.add('open')");
  });

  test('filter state and tool anchors share the hash without clobbering each other', () => {
    expect(WSY_HTML).toContain('f=');
    expect(WSY_HTML).toContain('d=rows');
    expect(WSY_HTML).toContain('q=');
  });
});

describe('graft 9 — Save as PDF, and the print filter (D12)', () => {
  test('the Save-as-PDF affordance is a button, and it prints', () => {
    expect(WSY_HTML).toContain('id="pdf"');
    expect(WSY_HTML).toContain('Save as PDF');
    expect(WSY_HTML).toContain('window.print()');
    expect(WSY_HTML).toContain('class="controls no-print"');
  });

  test('the filter IS the print filter — filtered-out cards are display:none and paper agrees', () => {
    const css = WSY_HTML.split('<style>')[1].split('</style>')[0];
    expect(css).toContain('.hidden{display:none}');
    const print = WSY_HTML.split('@media print{')[1].split('\n@page')[0];
    // Nothing in the print block resurrects a hidden card — that would make the PDF lie.
    expect(print).not.toMatch(/\.hidden\{display:(?!none)/);
    expect(print).toContain('body.filtered .print-filter{display:block');
  });

  test('the FILTERED VIEW banner keeps a filtered artifact honest', () => {
    expect(WSY_HTML).toContain('class="print-filter"');
    expect(WSY_HTML).toContain('FILTERED VIEW');
    expect(WSY_HTML).toContain("classList.toggle('filtered'");
  });
});

describe('the filter is the print filter (§9) — it must hide the RIGHT index rows', () => {
  test('cards and index rows are paired by identity, never by position', () => {
    // The cards are group-clustered; the index is in surface order. Position pairing hid the
    // wrong rows on 80 of WSY's 85 tools.
    expect(WSY_HTML).not.toContain('if(rows[i])');
    expect(WSY_HTML).toContain("rowFor['#'+c.id]");
  });

  test('every card id has exactly one index row pointing at it', () => {
    for (const html of [WSY_HTML, RORO_HTML, MCP_HTML]) {
      const ids = [...html.matchAll(/<article class="card" id="([^"]+)"/g)].map((m) => m[1]);
      const hrefs = [...html.matchAll(/<a class="row" href="#([^"]+)"/g)].map((m) => m[1]);
      expect(ids.length).toBeGreaterThan(0);
      expect([...ids].sort()).toEqual([...hrefs].sort());
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });
});

describe('graft 10 — the text filter searches name+purpose+method+path, not the whole card (§6.1)', () => {
  test('every card carries a data-search index of exactly those four fields', () => {
    const v = view(WSY);
    expect(count(WSY_HTML, ' data-search="')).toBe(v.tools.length);
    const t = v.tools[0];
    const idx = WSY_HTML.split(`id="tool-${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"`)[1] ?? '';
    expect(idx.slice(0, 400)).toContain('data-search="');
  });

  test('match() reads the index, never the rendered textContent', () => {
    // c.textContent swept in the curl block, the tools/call envelope, the annotations table and
    // the footer sourceRef: `unknown` hit 85/85, `token` 70/85, `post` 40/85 on this fixture.
    expect(WSY_HTML).toContain('c.dataset.search');
    expect(WSY_HTML).not.toContain('var t=c.textContent.toLowerCase()');
  });

  test('regression — the over-matching terms are not in the search index of every card', () => {
    const idx = [...WSY_HTML.matchAll(/data-search="([^"]*)"/g)].map((m) => m[1]);
    expect(idx.length).toBe(85);
    // These are call-block / footer noise. They must not be indexed on cards that do not name them.
    expect(idx.filter((s) => s.includes('unknown')).length).toBe(0);
    expect(idx.filter((s) => s.includes('bearer')).length).toBe(0);
    // A real term still finds its tools.
    expect(idx.filter((s) => s.includes('admin')).length).toBeGreaterThan(0);
    // Index is lowercased — a case-folded query works.
    for (const s of idx) expect(s).toBe(s.toLowerCase());
  });
});

describe('graft 11 — the filter bar ships all 8 chips of §6.1 band 3', () => {
  test('Open · Destructive · Failed · Undocumented · Dev-only · Act · Read · verify-class', () => {
    for (const f of ['open', 'destructive', 'failed', 'undocumented', 'dev', 'act', 'read']) {
      expect(WSY_HTML).toContain(`data-filter="${f}"`);
    }
    expect(WSY_HTML).toMatch(/data-filter="v:[a-z-]+"/);
    expect(WSY_HTML).toContain('Dev-only');
  });

  test('the tier axis is IN THE DOM — Dev-only cannot filter what the card never carried', () => {
    // WSY: exactly 1 of 85 affordances is tier: dev (agent-seed). That needle is the chip.
    expect(count(WSY_HTML, 'data-tier="dev"')).toBe(1);
    expect(count(WSY_HTML, 'data-tier="prod-safe"')).toBe(84);
    expect(WSY_HTML).toContain("c.dataset.tier!=='dev'");
  });

  test('act / read / verify-class predicates read the attributes the card already carries', () => {
    expect(WSY_HTML).toContain("c.dataset.kind!=='act'");
    expect(WSY_HTML).toContain("c.dataset.kind!=='read'");
    expect(WSY_HTML).toContain("'v:'+c.dataset.vclass");
  });

  test('a verify-class chip is emitted only for classes the surface actually contains', () => {
    const v = view(WSY);
    const present = new Set(v.tools.map((t) => t.verification.class));
    const chips = new Set(
      [...WSY_HTML.matchAll(/data-filter="v:([a-z-]+)"/g)].map((m) => m[1])
    );
    expect(chips).toEqual(present);
    expect(chips.size).toBeGreaterThan(0);
  });
});

describe('mined is never rendered as declared (§13.1.5, §7.2 axis 3)', () => {
  // The post-mining WSY corpus: 0 affordances DECLARE a shape, 66 carry one mined out of
  // the handler source. The absence note is the sheet's one surface-level statement about
  // input coverage — it may never spend a mined count as a declared one.
  const DESCRIBED = fixture('manifest-weseeyou-described.json');
  const v = view(DESCRIBED);
  const html = render(v);

  test('the counts split declared from mined', () => {
    expect(v.counts.withDeclaredInputSchema).toBe(0);
    expect(v.counts.withMinedInputSchema).toBe(66);
    expect(v.counts.withInputSchema).toBe(66);
  });

  test('the absence note states 0 declared and names the mined shapes as mined', () => {
    expect(html).not.toContain('66 of 85 declare an input schema');
    expect(html).toContain('0 of 85 declare an input schema');
    expect(html).toContain('66 carry a shape mined from handler source');
    expect(count(html, 'absence-note"')).toBe(1);
  });

  test('the schema-coverage finding still fires — mined does not close the declared gap', () => {
    const f = v.findings.find((x) => x.id === 'schema-coverage');
    expect(f).toBeTruthy();
    expect(f.title).toContain('0 of 85');
    expect(v.schemaGaps.join(' ')).toContain('mined');
  });
});
