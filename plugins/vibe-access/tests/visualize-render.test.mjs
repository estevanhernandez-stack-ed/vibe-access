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
});
