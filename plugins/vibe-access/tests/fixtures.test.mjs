import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { validateManifest } from '../engine/schema.mjs';

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

describe('real manifest fixtures', () => {
  test('WeSeeYou: parses, validates, 85 affordances', () => {
    const m = load('manifest-weseeyou.json');
    expect(m.affordances).toHaveLength(85);
    expect(m.adapter).toBe('firebase-functions');
    const r = validateManifest(m);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  test('RoRoRo: parses, validates, 17 affordances', () => {
    const m = load('manifest-rororo.json');
    expect(m.affordances).toHaveLength(17);
    expect(m.baseUrls.dev).toMatch(/^npipe:\/\//);
    const r = validateManifest(m);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  test('the real data the honest-render rules depend on is intact', () => {
    const wsy = load('manifest-weseeyou.json');
    const rororo = load('manifest-rororo.json');

    // input/output null on all 102 (§2 fact 2)
    for (const a of [...wsy.affordances, ...rororo.affordances]) {
      expect(a.input).toBeNull();
      expect(a.output).toBeNull();
      expect(a.transport.type).toBe('http'); // §2 fact 1: the flattened label
    }

    // 84 of 85 WeSeeYou descriptions are the template (§13)
    const templated = wsy.affordances.filter((a) =>
      /^(Act|Read|Seed|Reset|Capture): /.test(a.description)
    );
    expect(templated).toHaveLength(84);
  });

  test('fixtures carry no secrets, tokens, emails, or absolute local paths', () => {
    for (const name of ['manifest-weseeyou.json', 'manifest-rororo.json', 'mcp-tools-list.json']) {
      const raw = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
      expect(raw).not.toMatch(/(AIza|sk-|ghp_|gho_|xox[abpr]-|Bearer |eyJ[A-Za-z0-9_-]{10,})/);
      expect(raw).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(raw).not.toMatch(/[A-Za-z]:\\\\(Users|Program)/);
    }
  });
});

describe('MCP tools/list fixture', () => {
  const mcp = load('mcp-tools-list.json');

  test('has the tools[] shape', () => {
    expect(Array.isArray(mcp.tools)).toBe(true);
    expect(mcp.tools.length).toBeGreaterThanOrEqual(6);
    for (const t of mcp.tools) {
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
      if (t.inputSchema !== undefined) {
        expect(t.inputSchema.type).toBe('object');
        expect(typeof t.inputSchema.properties).toBe('object');
      }
    }
  });

  test('carries the two ragged real-world cases the renderer must survive', () => {
    const noSchema = mcp.tools.filter((t) => t.inputSchema === undefined);
    expect(noSchema.length).toBeGreaterThanOrEqual(1);

    const noDescription = mcp.tools.filter((t) => t.description === undefined);
    expect(noDescription.length).toBeGreaterThanOrEqual(1);

    const emptyProps = mcp.tools.filter(
      (t) => t.inputSchema && Object.keys(t.inputSchema.properties).length === 0
    );
    expect(emptyProps.length).toBeGreaterThanOrEqual(1);
  });

  test('discriminated-action tools expose an action enum', () => {
    const mp = mcp.tools.find((t) => t.name === 'manage_projects');
    expect(mp.inputSchema.properties.action.enum).toContain('findByRepo');
    expect(mp.inputSchema.required).toContain('action');
    expect(mp.annotations.readOnlyHint).toBe(false);
  });
});
