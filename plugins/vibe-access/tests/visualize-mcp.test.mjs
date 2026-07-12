// Item 9 — the MCP input branch (§4.1 shapes 2-4, §10.2.3). An MCP tools/list payload
// normalizes into the SAME ToolView model as a manifest, and the sheet stays honest about
// what the payload does NOT carry: no transport, no auth model, no verify data.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalize, render } from '../engine/visualize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MCP = JSON.parse(readFileSync(join(here, 'fixtures/mcp-tools-list.json'), 'utf8'));

const opts = { renderedAt: '2026-07-11T00:00:00.000Z' };
const view = normalize(MCP, opts);
const html = render(view, opts);
const tool = (name) => view.tools.find((t) => t.name === name);

describe('MCP tools/list → ToolView (the mapping)', () => {
  test('name, description, and the declared inputSchema come across', () => {
    const t = tool('manage_projects');
    expect(t.name).toBe('manage_projects');
    expect(t.purpose).toBe(MCP.tools[0].description);
    expect(t.purposeSource).toBe('mcp');
    expect(t.inputSchema).toEqual(MCP.tools[0].inputSchema);
    expect(t.inputSchema['x-mined-from']).toBeUndefined();
  });

  test('readOnlyHint drives kind; destructiveHint is a DECLARED destructive', () => {
    expect(tool('project_context').kind).toBe('read');
    expect(tool('project_context').annotations.readOnly).toEqual({ value: true, provenance: 'declared' });
    expect(tool('manage_projects').kind).toBe('act');
    expect(tool('manage_tasks').destructive).toEqual({ value: true, provenance: 'declared' });
    expect(tool('manage_projects').destructive).toEqual({ value: false, provenance: 'declared' });
    // Declared in either polarity — so nothing here is an unclaimed-destruction finding.
    expect(view.findings.filter((f) => f.severity === 'destructive-unclaimed')).toHaveLength(0);
  });

  test('a declared schema is rendered as DECLARED, never as mined', () => {
    expect(html).toContain('declared by the server');
    expect(html).not.toContain('mined from');
    // the enum + requiredness of the real payload survive into the table
    expect(html).toContain('enum(list | get | create | update | archive | findByRepo | linkRepo)');
  });
});

describe('MCP — an absent or thin description is UNDOCUMENTED, exactly like a template', () => {
  test('the normalizer counts the hole', () => {
    // get_mcp_instructions (no description), manage_milestones (15 chars), verify_gold_standard (33)
    expect(view.counts.undocumented).toBe(3);
    expect(view.counts.templated).toBe(0);
  });

  test('the card says so, and says why it is thin', () => {
    expect(html).toContain('UNDOCUMENTED');
    expect(html).toMatch(/15 characters/);
    // a real description is not slugged
    const card = html.slice(html.indexOf('id="tool-manage_projects"'), html.indexOf('id="tool-manage_tasks"'));
    expect(card).not.toContain('UNDOCUMENTED');
  });
});

describe('MCP — the surface says what it cannot know', () => {
  test('no verify data reads as not verified, never as an empty pass count', () => {
    expect(view.lede).toContain('Not verified');
    expect(view.lede).not.toContain('probed');
    expect(html).toContain('no verify run stamped');
    expect(html).not.toContain('10 probed');
  });

  test('a tools/list payload carries no auth model — and the lede never invents one', () => {
    expect(view.lede).not.toContain('Every affordance declares a gate');
    expect(view.lede).toContain('no auth model');
    for (const t of view.tools) expect(t.consent.mode).toBeNull();
  });

  test('transport is unknown and stated as such', () => {
    expect(html).toContain('transport: unknown — a tools/list payload carries no transport field.');
  });

  // Silence is not `none`. The legend defines `auth: none` as OPEN — printing it for an
  // undeclared mode would assert an open surface for a bearer-gated server.
  test('an undeclared consent mode never renders as auth: none, anywhere on the page', () => {
    expect(html).not.toContain('auth: none');
    expect(html).toContain('auth: not declared');
    expect(html).not.toContain('○ OPEN');
  });
});

const cardOf = (name) => {
  const s = html.indexOf(`id="tool-${name}"`);
  return html.slice(s, html.indexOf('</article>', s));
};
const inputOf = (name) => {
  const card = cardOf(name);
  const i = card.indexOf('data-block="input"');
  return card.slice(i, card.indexOf('</section>', i));
};

describe('MCP — a DECLARED-empty input schema is a statement, not an absence', () => {
  test('the card says the server declares no arguments', () => {
    const t = tool('get_mcp_instructions');
    expect(t.inputSchema).toEqual({ type: 'object', properties: {}, required: [] });
    expect(inputOf('get_mcp_instructions')).toContain(
      'Declares no arguments — the server says this tool takes nothing.'
    );
    expect(inputOf('get_mcp_instructions')).not.toContain('no schema declared');
    const card = cardOf('get_mcp_instructions');
    expect(card).toContain('declared empty — the surface says this tool takes no arguments');
    expect(card).not.toContain('no input schema declared or minable');
  });

  test('an absent schema still reads as absent, and the count agrees with the cards', () => {
    expect(tool('verify_gold_standard').inputSchema).toBeNull();
    expect(inputOf('verify_gold_standard')).toContain('no schema declared');
    expect(cardOf('verify_gold_standard')).toContain('no input schema declared or minable');
    // 9 of 10 declare a schema — get_mcp_instructions counts, verify_gold_standard does not.
    expect(view.counts.withDeclaredInputSchema).toBe(9);
    expect(html).toContain('9 of 10 declare an input schema');
  });

  test('the absent-description slug never claims a scan template on an MCP surface', () => {
    expect(tool('get_mcp_instructions').purpose).toBe('');
    expect(html).not.toContain('this is the scan template');
    expect(html).toContain('No description — the server ships none for this tool.');
  });
});

describe('MCP — nested schema properties survive into the table and the call', () => {
  const nested = {
    tools: [
      {
        name: 'save_record',
        description: 'Persist a record. Writes to the store.',
        inputSchema: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: { title: { type: 'string' }, count: { type: 'integer' } },
              required: ['title'],
            },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['data'],
        },
      },
    ],
  };
  const nv = normalize(nested, opts);
  const nh = render(nv, opts);

  test('nested properties flatten into the parameter table with dotted names', () => {
    // wbr() inserts a soft break after the dot — the name is still data.title on the page.
    expect(nh.replace(/<wbr>/g, '')).toContain('<code>data.title</code>');
    expect(nh.replace(/<wbr>/g, '')).toContain('<code>data.count</code>');
  });

  test('THE CALL names every parameter — no silently-empty {}', () => {
    expect(nh).toContain('"title": "&lt;title&gt;"');
    expect(nh).toContain('"count": 0');
    expect(nh).toContain('"&lt;tagsItem&gt;"');
    expect(nh).not.toMatch(/"data":\s*\{\}/);
  });
});
