// §7 — the --grade layer. Five per-tool badges with exact pass conditions, the D1-D7 letter,
// and six surface axes that are MEASURED, not scored. Two rules the layer may never break:
// the bare sheet is unchanged without the flag, and tool count is NEVER graded.

import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { normalize, render, verifyDecompositionSentence } from '../engine/visualize.mjs';
import { badgesOf, describeChecks, letterOf, gradeSurface, BADGES } from '../engine/grade.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const WSY = fixture('manifest-weseeyou.json');
const RORO = fixture('manifest-rororo.json');
const MCP = fixture('mcp-tools-list.json');

const RENDERED_AT = '2026-07-11T12:00:00.000Z';
const view = (json, opts = {}) => normalize(json, { renderedAt: RENDERED_AT, ...opts });

const graded = (json) => gradeSurface(view(json));
const toolOf = (surface, name) => surface.tools.find((t) => t.name === name);

const WSY_G = graded(WSY);
const RORO_G = graded(RORO);
const MCP_G = graded(MCP);

const WSY_BARE_HTML = render(view(WSY));
const WSY_GRADE_HTML = render(view(WSY), { grade: true });
const RORO_GRADE_HTML = render(view(RORO), { grade: true });
const MCP_GRADE_HTML = render(view(MCP), { grade: true });

const count = (html, needle) => html.split(needle).length - 1;

// A one-affordance manifest, so a badge boundary is a boundary and not a fixture accident.
const one = (aff) => ({
  schemaVersion: 1,
  app: 'probe',
  adapter: 'express',
  generatedAt: '2026-07-01T00:00:00.000Z',
  baseUrls: { dev: 'http://localhost:3000' },
  discoveryRoute: null,
  affordances: [
    {
      id: 'probe-one',
      description: 'Act: POST /api/probe',
      tier: 'dev',
      kind: 'act',
      transport: { type: 'http', method: 'POST', path: '/api/probe' },
      input: null,
      output: null,
      auth: 'none',
      sourceRef: 'src/probe.js',
      origin: 'existing',
      verified: { status: 'unverified' },
      ...aff,
    },
  ],
});
const probe = (aff) => toolOf(gradeSurface(view(one(aff))), 'probe-one');

describe('§7.1 — the five badges, exact pass conditions', () => {
  test('the badge set is exactly the research rubric five', () => {
    expect(BADGES).toEqual([
      'has-description',
      'describes-when-not-to-use',
      'has-input-schema',
      'has-annotation',
      'destructive-declared',
    ]);
  });

  test('has-description — 39 chars fails, 40 passes, and a template never passes at any length', () => {
    const short = 'x'.repeat(39);
    const long = 'x'.repeat(40);
    expect(badgesOf(probe({ description: short }))).not.toContain('has-description');
    expect(badgesOf(probe({ description: long }))).toContain('has-description');
    // A machine template is not a description, however long the route string is.
    const template = { description: 'Act: POST /api/probe/with/a/very/long/route/segment/here' };
    expect(template.description.length).toBeGreaterThanOrEqual(40);
    expect(badgesOf(probe(template))).not.toContain('has-description');
  });

  test('describes-when-not-to-use — a negative-guidance cue, or nothing', () => {
    const yes = probe({ description: 'Launch a real client with the saved account. Do not call casually.' });
    const no = probe({ description: 'Launch a real client with the saved account for the operator.' });
    expect(badgesOf(yes)).toContain('describes-when-not-to-use');
    expect(badgesOf(no)).not.toContain('describes-when-not-to-use');
    // 404s outside the dev gate is the WeSeeYou phrasing, and it is negative guidance.
    expect(badgesOf(probe({ description: 'Seeds fixtures. 404s outside the emulator/dev gate.' })))
      .toContain('describes-when-not-to-use');
  });

  test('has-input-schema — an empty properties bag does not pass', () => {
    expect(badgesOf(probe({ input: { type: 'object', properties: {} } }))).not.toContain('has-input-schema');
    expect(badgesOf(probe({ input: { type: 'object' } }))).not.toContain('has-input-schema');
    expect(badgesOf(probe({ input: null }))).not.toContain('has-input-schema');
    expect(
      badgesOf(probe({ input: { type: 'object', properties: { account_id: { type: 'string' } } } }))
    ).toContain('has-input-schema');
  });

  test('has-annotation — derived does NOT pass; only a declared provenance does', () => {
    // Every manifest affordance carries a DERIVED readOnly (kind=read/act), and derived is
    // half credit in the truth table, never a badge.
    const derivedOnly = probe({});
    expect(derivedOnly.annotations.readOnly.provenance).not.toBe('declared');
    expect(badgesOf(derivedOnly)).not.toContain('has-annotation');
    // The §8.3 destructive field is a DECLARED annotation.
    expect(badgesOf(probe({ destructive: true }))).toContain('has-annotation');
  });

  test('destructive-declared — declaring false passes; derived and unclaimed both fail', () => {
    expect(badgesOf(probe({ destructive: false }))).toContain('destructive-declared');
    expect(badgesOf(probe({ destructive: true }))).toContain('destructive-declared');
    expect(badgesOf(probe({}))).not.toContain('destructive-declared');
    const derived = probe({ description: 'Delete the account and everything under it, permanently.' });
    expect(derived.destructive.value).toBe(true);
    expect(derived.destructive.provenance).not.toBe('declared');
    expect(badgesOf(derived)).not.toContain('destructive-declared');
  });

  test('MCP annotations are declared — the badge fires off destructiveHint in either polarity', () => {
    const t = toolOf(MCP_G, MCP_G.tools[0].name);
    expect(Array.isArray(t.badges)).toBe(true);
    const anyDeclared = MCP_G.tools.some((x) => x.badges.includes('has-annotation'));
    expect(anyDeclared).toBe(true);
  });
});

describe('§7.1 — the D1-D7 letter, and N/A shrinks the denominator', () => {
  test('agent-seed computes A — 5 of 5 applicable, D4 and D5 N/A', () => {
    const t = toolOf(WSY_G, 'agent-seed');
    expect(t.grades.checks).toEqual({
      D1: 'pass',
      D2: 'pass',
      D3: 'pass',
      D4: 'na',
      D5: 'na',
      D6: 'pass',
      D7: 'pass',
    });
    expect(t.grades.letter).toBe('A');
  });

  test('update-user-role computes F — a scan template passes nothing it is asked', () => {
    const t = toolOf(WSY_G, 'update-user-role');
    expect(t.grades.letter).toBe('F');
    expect(Object.values(t.grades.checks).filter((v) => v === 'pass')).toHaveLength(0);
  });

  test('D4 is N/A when the tool takes nothing — no schema, no path params', () => {
    const t = probe({ description: 'Kicks the health check so that the operator can see it is alive.' });
    expect(t.transport.pathParams).toHaveLength(0);
    expect(t.grades.checks.D4).toBe('na');
    // Give it a path param and D4 becomes a real check it can fail.
    const withParam = probe({
      description: 'Kicks the health check so that the operator can see it is alive.',
      transport: { type: 'http', method: 'POST', path: '/api/probe/*' },
    });
    expect(withParam.grades.checks.D4).toBe('fail');
  });

  test('D5 is N/A for lifecycle kinds — a seed/reset/capture result is the state change', () => {
    for (const kind of ['seed', 'reset', 'capture']) {
      expect(probe({ kind, description: 'Seeds one fixture user so that a cold agent has state to read.' }).grades.checks.D5).toBe('na');
    }
    expect(probe({ kind: 'act', description: 'Sends the invite so that the guest can join.' }).grades.checks.D5).toBe('fail');
  });

  test('D6 is N/A for read and capture — there is no write to state', () => {
    expect(probe({ kind: 'read', description: 'Returns the roster of active accounts for the operator UI.' }).grades.checks.D6).toBe('na');
    expect(probe({ kind: 'capture', description: 'Grabs a screenshot for the operator UI.' }).grades.checks.D6).toBe('na');
    expect(probe({ kind: 'act', description: 'Returns the roster of active accounts for the operator UI.' }).grades.checks.D6).toBe('fail');
  });

  test('the letter reads the fraction of APPLICABLE checks, not of seven', () => {
    // 2 of 2 applicable is an A even though five checks never ran.
    expect(letterOf({ D1: 'pass', D2: 'pass', D3: 'na', D4: 'na', D5: 'na', D6: 'na', D7: 'na' })).toBe('A');
    expect(letterOf({ D1: 'pass', D2: 'fail', D3: 'na', D4: 'na', D5: 'na', D6: 'na', D7: 'na' })).toBe('D');
    // 2 of 3 applicable = 0.67 → C. The same two passes over seven checks would be an F:
    // the denominator is what N/A moves, and the letter follows it.
    expect(letterOf({ D1: 'pass', D2: 'pass', D3: 'fail', D4: 'na', D5: 'na', D6: 'na', D7: 'na' })).toBe('C');
    expect(letterOf({ D1: 'pass', D2: 'pass', D3: 'fail', D4: 'fail', D5: 'fail', D6: 'fail', D7: 'fail' })).toBe('F');
    expect(letterOf({ D1: 'fail', D2: 'fail', D3: 'fail', D4: 'fail', D5: 'fail', D6: 'fail', D7: 'fail' })).toBe('F');
    expect(letterOf({ D1: 'pass', D2: 'pass', D3: 'pass', D4: 'pass', D5: 'pass', D6: 'pass', D7: 'pass' })).toBe('A');
  });

  test('describeChecks is a pure predicate set over the effective description', () => {
    const t = toolOf(RORO_G, 'stop-accounts');
    // The override carries the destructive truth; the base description is the template.
    expect(describeChecks(t)).toEqual(t.grades.checks);
    expect(t.grades.checks.D1).toBe('pass');
    expect(t.grades.letter).not.toBe('F');
  });
});

describe('§7.2 — six axes, MEASURED, never scored', () => {
  test('six axes, each measured or N/A, with the counts printed as-is', () => {
    for (const s of [WSY_G, RORO_G, MCP_G]) {
      expect(s.axes).toHaveLength(6);
      for (const a of s.axes) {
        expect(Object.keys(a).sort()).toEqual(['anchor', 'id', 'label', 'measures', 'naReason', 'status'].sort());
        expect(['measured', 'na']).toContain(a.status);
        if (a.status === 'na') expect(a.naReason).toMatch(/the instrument is missing/i);
        else expect(a.naReason).toBeNull();
      }
    }
  });

  test('no 0-100 score and no composite letter exists anywhere on the surface', () => {
    for (const s of [WSY_G, RORO_G, MCP_G]) {
      expect(s.composite).toBeUndefined();
      expect(s.score).toBeUndefined();
      for (const a of s.axes) expect(a.score).toBeUndefined();
    }
    for (const html of [WSY_GRADE_HTML, RORO_GRADE_HTML, MCP_GRADE_HTML]) {
      expect(html).not.toMatch(/\bout of 10\b/i);
      expect(html).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
      // No composite is ASSERTED anywhere — the page says out loud that none exists.
      expect(html).not.toMatch(/composite\s+(grade|letter|score)\s*[:=]/i);
      expect(html).toContain('no composite letter');
    }
  });

  test('the N/A axis says the instrument is missing — it never reads zero', () => {
    // An MCP payload with no resources/prompts sidecar cannot be counted on axis 4.
    const axis = MCP_G.axes.find((a) => a.id === 'resources-prompts');
    expect(axis.status).toBe('na');
    expect(axis.measures).toEqual([]);
    // A manifest surface generates the candidate-resource count instead.
    const wsyAxis = WSY_G.axes.find((a) => a.id === 'resources-prompts');
    expect(wsyAxis.status).toBe('measured');
    expect(wsyAxis.measures.some((m) => /candidate resource/i.test(m.name))).toBe(true);
  });

  test('the description-quality axis is a histogram, never a mean', () => {
    const axis = WSY_G.axes.find((a) => a.id === 'description-quality');
    const f = axis.measures.find((m) => m.name === 'F');
    expect(f.value).toBe(84);
    expect(axis.measures.find((m) => m.name === 'A').value).toBe(1);
    expect(axis.measures.some((m) => /mean|average/i.test(m.name))).toBe(false);
  });

  test('the schemas + annotations axis states declared and mined separately', () => {
    const axis = WSY_G.axes.find((a) => a.id === 'schemas-annotations');
    const names = axis.measures.map((m) => m.name);
    expect(names.some((n) => /declared input/i.test(n))).toBe(true);
    expect(names.some((n) => /mined input/i.test(n))).toBe(true);
    expect(names.some((n) => /declared annotation/i.test(n))).toBe(true);
  });

  // The bait is assembled at runtime, never written as a literal. GitHub's secret
  // scanner reads source files, not runtime values, and it flagged the old literal —
  // a false positive on our own detector's test fixture. That matters: a recurring
  // false alarm is how a real alert gets ignored. Nothing here authenticates to
  // anything — the header is the public {"alg":"HS256"} every HS256 token shares,
  // and the payload and signature are placeholders.
  const b64 = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '');
  const fakeJwt = () => `${b64('{"alg":"HS256"}')}.${b64('{"sub":"fixture"}')}.not-a-signature`;
  const leakyDetail = (secret) => ({
    verified: { status: 'fail', at: '2026-07-09T22:10:42.833Z', runId: 'aaa', detail: secret },
  });
  const leakCount = (m) =>
    gradeSurface(view(m))
      .axes.find((a) => a.id === 'security-hygiene')
      .measures.find((x) => /secret-shaped/i.test(x.name)).value;

  // One string used to trip two of the detector's three branches at once, so a
  // broken branch could still pass. Each branch now stands on its own.
  test('the security axis catches a jwt-shaped string in a verify detail', () => {
    expect(leakCount(one(leakyDetail(`unexpected 500 — token ${fakeJwt()} rejected`)))).toBe(1);
  });

  test('the security axis catches a bearer header in a verify detail', () => {
    expect(leakCount(one(leakyDetail('unexpected 500 — Authorization: Bearer s3cr3t-looking-value rejected')))).toBe(1);
  });

  test('the security axis catches a key=value secret in a verify detail', () => {
    expect(leakCount(one(leakyDetail('unexpected 500 — api_key=abcd1234efgh rejected')))).toBe(1);
  });

  test('a clean surface reports zero secret-shaped strings', () => {
    const clean = WSY_G.axes.find((a) => a.id === 'security-hygiene');
    expect(clean.measures.find((m) => /secret-shaped/i.test(m.name)).value).toBe(0);
    expect(clean.measures.find((m) => /open/i.test(m.name)).value).toBe(15);
  });
});

describe('BINDING — tool count is never graded', () => {
  test('no badge, no letter, no axis, and no measure grades the number of tools', () => {
    for (const s of [WSY_G, RORO_G, MCP_G]) {
      for (const a of s.axes) {
        for (const m of a.measures) {
          // A count of tools may be REPORTED; it may never carry a letter or a verdict.
          expect(String(m.value)).not.toMatch(/^[A-F]$/);
          expect(m.name).not.toMatch(/\bgrade\b/i);
        }
      }
      // The letter lives on descriptions, not on the surface, and never on the count.
      expect(s.grades).toBeUndefined();
      expect(s.letter).toBeUndefined();
    }
    // 17 is not a better number than 85: the two surfaces differ by 68 tools and neither
    // count moves a letter anywhere on the page.
    expect(RORO_G.counts.total).toBe(17);
    expect(WSY_G.counts.total).toBe(85);
    for (const html of [WSY_GRADE_HTML, RORO_GRADE_HTML, MCP_GRADE_HTML]) {
      expect(html).toContain('Tool count is not graded.');
      expect(html).not.toMatch(/grade[^<]{0,20}\b\d+ tools\b/i);
      expect(html).not.toMatch(/\b\d+ tools\b[^<]{0,20}grade/i);
    }
  });

  test('the SHAPE axis reports the context cost and says out loud it is not graded', () => {
    const axis = RORO_G.axes.find((a) => a.id === 'shape');
    expect(axis.measures.some((m) => /token/i.test(m.name))).toBe(true);
    expect(RORO_GRADE_HTML).toContain('Count reported, explicitly not graded.');
  });
});

describe('BINDING — the bare sheet is unchanged when --grade is absent', () => {
  test('no letters, no report card, no findings band, no headline without the flag', () => {
    expect(WSY_BARE_HTML).not.toContain('data-band="headline"');
    expect(WSY_BARE_HTML).not.toContain('data-band="verdict"');
    expect(WSY_BARE_HTML).not.toContain('data-band="report-card"');
    expect(WSY_BARE_HTML).not.toContain('data-band="findings"');
    expect(WSY_BARE_HTML).not.toContain('data-band="the-bar"');
    expect(WSY_BARE_HTML).not.toContain('data-band="schema-gaps"');
    expect(WSY_BARE_HTML).not.toContain('class="chip grade');
    expect(WSY_BARE_HTML).not.toContain('why this grade');
    // The tools still start at band 3 — the reference sheet is the ask.
    expect(WSY_BARE_HTML.indexOf('data-band="index"')).toBeLessThan(WSY_BARE_HTML.indexOf('data-band="cards"'));
  });

  test('grading does not mutate the surface it grades', () => {
    const s = view(RORO);
    const before = JSON.stringify(s);
    gradeSurface(s);
    expect(JSON.stringify(s)).toBe(before);
    expect(s.tools.every((t) => t.grades === null)).toBe(true);
    expect(s.axes).toEqual([]);
  });

  test('the graded render keeps the bare bands in place and appends the audit AFTER the cards', () => {
    const at = (b) => WSY_GRADE_HTML.indexOf(`data-band="${b}"`);
    expect(at('cards')).toBeGreaterThan(at('index'));
    for (const b of ['headline', 'verdict', 'report-card', 'findings', 'the-bar', 'schema-gaps']) {
      expect(at(b)).toBeGreaterThan(at('cards'));
    }
    expect(at('how-to-read')).toBeGreaterThan(at('schema-gaps'));
  });
});

describe('§6.1 bands 6-11 — the audit layer renders its evidence', () => {
  test('exactly one HEADLINE, and it is the worst finding by severity order', () => {
    expect(count(WSY_GRADE_HTML, 'data-band="headline"')).toBe(1);
    // WeSeeYou's headline is not a 500 — it is get-challenges answering 200 to a cold agent.
    const headline = WSY_GRADE_HTML.split('data-band="headline"')[1].split('</section>')[0];
    expect(headline).toContain('get-challenges');
  });

  test('the report card prints both invariant sentences, verbatim', () => {
    const roro = view(RORO);
    expect(RORO_GRADE_HTML).toContain('17 probed — 3 ran, 12 gate-held, 2 handle-gate-held.');
    expect(RORO_GRADE_HTML).toContain(verifyDecompositionSentence(roro.counts.verify));
    expect(RORO_GRADE_HTML).toContain('Tool count is not graded.');
    expect(RORO_GRADE_HTML).toContain('These grade the SURFACE');
  });

  test('the findings band renders every finding, error clusters as ONE card', () => {
    const s = WSY_G;
    const band = WSY_GRADE_HTML.split('data-band="findings"')[1].split('data-band="the-bar"')[0];
    for (const f of s.findings) expect(band).toContain(f.title.split('"')[0].slice(0, 40));
    const clusters = s.findings.filter((f) => f.severity === 'error-cluster');
    expect(clusters.length).toBeGreaterThan(0);
    for (const c of clusters) expect(c.toolRefs.length).toBeGreaterThan(0);
  });

  test('THE BAR quotes what actually grades A — computed, never hand-picked', () => {
    const band = WSY_GRADE_HTML.split('data-band="the-bar"')[1].split('</section>')[0];
    const best = WSY_G.tools.filter((t) => t.grades.letter === 'A');
    expect(best.length).toBeGreaterThan(0);
    expect(band).toContain(best[0].name);
  });

  test('SCHEMA GAPS states what the surface cannot express', () => {
    const band = WSY_GRADE_HTML.split('data-band="schema-gaps"')[1].split('</section>')[0];
    for (const gap of WSY_G.schemaGaps) expect(band).toContain(gap.slice(0, 40));
  });

  test('the letter chip rides the card rail and the index row under --grade', () => {
    expect(WSY_GRADE_HTML).toContain('GRADE F');
    expect(WSY_GRADE_HTML).toContain('GRADE A');
    // The drawer is how a reader overrules the smoke alarm in one glance.
    expect(WSY_GRADE_HTML).toContain('why this grade');
    expect(count(WSY_GRADE_HTML, 'why this grade')).toBe(85);
  });

  test('the graded page still hits zero network and stays self-contained', () => {
    for (const html of [WSY_GRADE_HTML, RORO_GRADE_HTML, MCP_GRADE_HTML]) {
      expect(html).not.toMatch(/<link\b/i);
      expect(html).not.toMatch(/\bsrc\s*=\s*["']https?:/i);
      expect(html).not.toMatch(/\bfetch\s*\(/);
    }
  });

  test('the audit chips never state a negative, and never steal the filled ink', () => {
    for (const m of WSY_GRADE_HTML.matchAll(/<span class="chip filled"[^>]*>([^<]+)<\/span>/g)) {
      expect(m[1]).toContain('DESTRUCTIVE');
    }
    for (const m of RORO_GRADE_HTML.matchAll(/<span class="chip[^"]*"[^>]*>([^<]+)<\/span>/g)) {
      expect(m[1]).not.toMatch(/\bnot\b|false/i);
    }
  });
});

// The axes and the verdict tiles exist to point at evidence. An anchor that resolves to nothing
// is a claim of evidence with no evidence behind it — §6.1 bands 7 and 8 are explicit.
describe('§6.1 — every anchor resolves to a section in the same document', () => {
  const anchors = (html) => [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const ids = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

  test.each([
    ['WSY graded', () => WSY_GRADE_HTML],
    ['RORO graded', () => RORO_GRADE_HTML],
    ['MCP graded', () => MCP_GRADE_HTML],
    ['WSY bare', () => WSY_BARE_HTML],
  ])('%s has no dead anchors', (_label, get) => {
    const html = get();
    const present = ids(html);
    const dead = [...new Set(anchors(html))].filter((a) => !present.has(a));
    expect(dead).toEqual([]);
  });

  test('the axis anchors are real targets, not decoration', () => {
    for (const a of WSY_G.axes) {
      expect(WSY_GRADE_HTML).toContain(`id="${a.anchor.slice(1)}"`);
    }
  });
});

// §4, line 104: a shape-2/3/4 payload may carry a resources/prompts sidecar, and when it does
// the Resources/Prompts axis COUNTS it. Before this, the axis keyed on source alone and the
// N/A line asserted a fact about the input that the code had never looked at.
describe('§7.2 axis 4 — the resources/prompts sidecar is actually read', () => {
  const axis4 = (surface) => surface.axes.find((a) => a.id === 'resources-prompts');

  test('an MCP bundle carrying the sidecar counts resources and prompts', () => {
    const g = graded({
      tools: MCP.tools,
      resources: [{ uri: 'file:///a' }, { uri: 'file:///b' }],
      prompts: [{ name: 'p1' }],
    });
    const a = axis4(g);
    expect(a.status).toBe('measured');
    expect(a.measures).toEqual([
      { name: 'resources declared', value: 2 },
      { name: 'prompts declared', value: 1 },
    ]);
  });

  test('an MCP payload with no sidecar still says the instrument is missing', () => {
    expect(axis4(MCP_G).status).toBe('na');
    expect(axis4(MCP_G).naReason).toMatch(/instrument is missing/);
  });

  test('a manifest still reports candidate resources', () => {
    expect(axis4(WSY_G).status).toBe('measured');
    expect(axis4(WSY_G).measures[0].name).toMatch(/candidate resources/);
  });
});
