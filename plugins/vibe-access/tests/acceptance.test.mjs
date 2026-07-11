// §10.2.5 — the ask's own acceptance test, and the build fails on it.
//
// Pick three tools at random (SEEDED, so the run is reproducible) from each rendered
// sheet. A cold reader must be able to (a) say what the tool does from PURPOSE — a
// machine template is an automatic fail — and (b) copy THE CALL with every parameter
// named — an <UNNAMED_PARAM_n> placeholder, or an empty arguments bag on a tool that
// takes input, is a fail.
//
// On the pre-§13 corpus this fails 84/85 on (a) and every POST on (b). That is the
// RECORDED BASELINE, pinned below so nobody can quietly claim the hole was never there.
// The post-§13 render must pass, or the release is not done.
import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { normalize, render } from '../engine/visualize.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const RENDERED_AT = '2026-07-11T12:00:00.000Z';

const BEFORE = fixture('manifest-weseeyou.json');
const AFTER = fixture('manifest-weseeyou-described.json');

const view = (m) => normalize(m, { renderedAt: RENDERED_AT });

// mulberry32 — a seeded PRNG, so "at random" is reproducible and the same three tools
// are judged on every run and by every reader.
function seeded(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickThree(tools, seed = 2026_0711) {
  const rnd = seeded(seed);
  const idx = new Set();
  while (idx.size < 3) idx.add(Math.floor(rnd() * tools.length));
  return [...idx].map((i) => tools[i]);
}

const propsOf = (t) => Object.keys(t.inputSchema?.properties ?? {});

// (a) — can a cold reader say what it does?
const readsAsPurpose = (t) => Boolean(t.purpose) && t.purposeTemplated === false;

// (b) — can a cold reader paste THE CALL with every parameter named? The card is the
// unit under test: the curl line, the MCP projection and the parameter table all live
// in it, and the reader copies from it.
function callIsPastable(t, html) {
  const card = cardOf(html, t.name);
  if (/&lt;UNNAMED_PARAM_/.test(card) || /<UNNAMED_PARAM_/.test(card)) return false;
  const props = propsOf(t);
  if (props.length === 0) return true; // a tool that takes nothing has nothing to name
  return props.every((p) => card.includes(p));
}

function cardOf(html, id) {
  const start = html.indexOf(`<article class="card" id="tool-${id}"`);
  if (start === -1) throw new Error(`no card rendered for ${id}`);
  const end = html.indexOf('</article>', start);
  return html.slice(start, end === -1 ? html.length : end);
}

describe('§10.2.5 — the recorded baseline (pre-describe, pre-mining)', () => {
  const v = view(BEFORE);
  const html = render(v);

  test('84 of 85 fail (a): the description is a machine template', () => {
    expect(v.tools.filter((t) => !readsAsPurpose(t))).toHaveLength(84);
  });

  test('every POST fails (b): no tool declares or mines an input', () => {
    const posts = v.tools.filter((t) => t.transport.method === 'POST');
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((t) => propsOf(t).length === 0)).toBe(true);
  });

  test('the seeded three fail the acceptance test outright', () => {
    const three = pickThree(v.tools);
    expect(three.every((t) => readsAsPurpose(t) && callIsPastable(t, html))).toBe(false);
  });
});

describe('§10.2.5 — the post-describe render must pass, or the release is not done', () => {
  const v = view(AFTER);
  const html = render(v);

  test('the seeded three pass BOTH halves', () => {
    for (const t of pickThree(v.tools)) {
      expect({ id: t.name, purpose: readsAsPurpose(t) }).toEqual({ id: t.name, purpose: true });
      expect({ id: t.name, call: callIsPastable(t, html) }).toEqual({ id: t.name, call: true });
    }
  });

  test('and so does every other tool on the sheet — the sample was not the lucky one', () => {
    const failedPurpose = v.tools.filter((t) => !readsAsPurpose(t)).map((t) => t.name);
    const failedCall = v.tools.filter((t) => !callIsPastable(t, html)).map((t) => t.name);
    expect(failedPurpose).toEqual([]);
    expect(failedCall).toEqual([]);
  });

  test('UNDOCUMENTED moves 84 -> 0 of 85', () => {
    expect(view(BEFORE).tools.filter((t) => t.purposeTemplated).length).toBe(84);
    expect(v.tools.filter((t) => t.purposeTemplated).length).toBe(0);
  });

  test('66 of the 85 carry a mined input shape — and the sheet says mined, not declared', () => {
    const mined = v.tools.filter((t) => t.inputSchema?.['x-mined-from']);
    expect(mined).toHaveLength(66);
    expect(html).toContain('mined from');
  });

  test('the open route is still described as open — describing a breach never covers it', () => {
    const open = v.tools.find((t) => t.name === 'get-challenges');
    expect(open.verification.class).toBe('open');
    expect(open.purpose).toMatch(/auth-gate-open|PUBLIC/);
  });
});
