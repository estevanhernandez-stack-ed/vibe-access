// §13.1 — the FOURTH schema delta, end to end: inventory → map → manifest → render.
// Additive and optional at every layer. A shape-free inventory still validates; the
// single real user running v0.1 does not break.
import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { validateInventory, validateManifest } from '../engine/schema.mjs';
import { buildManifest } from '../engine/map.mjs';
import { scan } from '../engine/scan.mjs';
import { normalize, render } from '../engine/visualize.mjs';

const NOW = '2026-07-11T00:00:00.000Z';
const baseUrls = { dev: 'http://localhost:5000' };
const APP = new URL('./fixtures/app-firebase', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const SHAPE = {
  type: 'object',
  properties: { listId: { type: 'unknown', 'x-in': 'body' } },
  'x-mined-by': 'reads',
  'x-mined-from': 'functions/src/lists.js',
};

const inventory = (routePatch = {}) => ({
  schemaVersion: 1,
  app: 'demo',
  adapter: 'firebase-functions',
  generatedAt: NOW,
  routes: [
    {
      name: 'addItem',
      method: 'POST',
      path: '/api/items',
      sourceRef: 'functions/src/lists.js',
      auth: 'token',
      ...routePatch,
    },
  ],
  unmapped: [],
});

describe('inventory schema — the fourth delta', () => {
  test('a shape-free inventory still validates', () => {
    expect(validateInventory(inventory()).valid).toBe(true);
  });

  test('a route carrying an inputShape validates', () => {
    expect(validateInventory(inventory({ inputShape: SHAPE })).valid).toBe(true);
  });

  test('a zod-mined shape with a required array validates', () => {
    const shape = { ...SHAPE, required: ['listId'], 'x-mined-by': 'zod' };
    expect(validateInventory(inventory({ inputShape: shape })).valid).toBe(true);
  });

  test('rejects a non-object inputShape', () => {
    expect(validateInventory(inventory({ inputShape: 'yes' })).valid).toBe(false);
  });

  test('rejects an unknown miner', () => {
    const bad = { ...SHAPE, 'x-mined-by': 'vibes' };
    expect(validateInventory(inventory({ inputShape: bad })).valid).toBe(false);
  });

  test('rejects an unknown slot', () => {
    const bad = structuredClone(SHAPE);
    bad.properties.listId['x-in'] = 'header';
    expect(validateInventory(inventory({ inputShape: bad })).valid).toBe(false);
  });

  test('rejects a shape that will not say where it came from', () => {
    const bad = structuredClone(SHAPE);
    delete bad['x-mined-from'];
    expect(validateInventory(inventory({ inputShape: bad })).valid).toBe(false);
  });
});

describe('map — mined shapes land in input, declared beats mined', () => {
  test('the mined shape becomes the affordance input', () => {
    const m = buildManifest(inventory({ inputShape: SHAPE }), { baseUrls, now: NOW });
    expect(m.affordances[0].input).toEqual(SHAPE);
    expect(validateManifest(m).valid).toBe(true);
  });

  test('no mined shape leaves input null — nothing is invented', () => {
    const m = buildManifest(inventory(), { baseUrls, now: NOW });
    expect(m.affordances[0].input).toBeNull();
  });

  test('re-map REFRESHES a previously mined shape — it is a scanned field', () => {
    const first = buildManifest(inventory({ inputShape: SHAPE }), { baseUrls, now: NOW });
    const nextShape = {
      ...SHAPE,
      properties: { listId: { type: 'unknown', 'x-in': 'body' }, note: { type: 'unknown', 'x-in': 'body' } },
    };
    const second = buildManifest(inventory({ inputShape: nextShape }), {
      previous: first,
      baseUrls,
      now: NOW,
    });
    expect(Object.keys(second.affordances[0].input.properties)).toEqual(['listId', 'note']);
  });

  test('re-map DROPS a mined shape when the handler stops reading', () => {
    // A mined slot is OWNED by scan. An absent mine clears it — otherwise the manifest
    // keeps asserting "mined from f.js" for a property that file no longer reads.
    const first = buildManifest(inventory({ inputShape: SHAPE }), { baseUrls, now: NOW });
    expect(first.affordances[0].input).toEqual(SHAPE);
    const second = buildManifest(inventory(), { previous: first, baseUrls, now: NOW });
    expect(second.affordances[0].input).toBeNull();
    expect(validateManifest(second).valid).toBe(true);
  });

  test('a DECLARED schema survives re-map and is never clobbered by a mined one', () => {
    const declared = { type: 'object', properties: { listId: { type: 'string' } }, required: ['listId'] };
    const previous = buildManifest(inventory(), { baseUrls, now: NOW });
    previous.affordances[0].input = declared;
    const second = buildManifest(inventory({ inputShape: SHAPE }), { previous, baseUrls, now: NOW });
    expect(second.affordances[0].input).toEqual(declared);
  });
});

describe('scan — mining against the firebase fixture app', () => {
  const { inventory: inv } = scan(APP, { now: NOW });
  const byName = new Map(inv.routes.map((r) => [r.name, r]));

  test('the inventory validates with mined shapes in it', () => {
    expect(validateInventory(inv).valid).toBe(true);
  });

  test('a handler that reads req.body?.words yields exactly that one property', () => {
    const shape = byName.get('generateAnagramsBatch').inputShape;
    expect(Object.keys(shape.properties)).toEqual(['words']);
    expect(shape['x-mined-from']).toContain('anagrams');
  });

  test('a handler that reads nothing carries no inputShape at all', () => {
    expect(byName.get('ping').inputShape).toBeUndefined();
    expect(byName.get('leaderboard').inputShape).toBeUndefined();
  });
});

describe('render — mined is not declared, and the card says which', () => {
  const manifest = buildManifest(inventory({ inputShape: SHAPE }), { baseUrls, now: NOW });
  const html = render(normalize(manifest, { renderedAt: NOW }));

  test('the parameter table is tagged with the source it was mined from', () => {
    expect(html).toContain('mined from functions/src/lists.js');
  });

  test('THE CALL names the mined parameter instead of an empty body', () => {
    expect(html).toContain(`-d '{"listId":"&lt;listId&gt;"}'`);
  });

  test('a reads-mined shape prints requiredness as unstated, never as optional', () => {
    expect(html).toContain('<td>unstated</td>');
    expect(html).not.toContain('<td>optional</td>');
  });

  test('query parameters go in the URL, not the JSON body', () => {
    const q = structuredClone(SHAPE);
    q.properties = { page: { type: 'unknown', 'x-in': 'query' } };
    const m = buildManifest(inventory({ inputShape: q, method: 'GET' }), { baseUrls, now: NOW });
    const out = render(normalize(m, { renderedAt: NOW }));
    expect(out).toContain('/api/items?page=%3Cpage%3E');
    expect(out).not.toContain('-d ');
  });
});
