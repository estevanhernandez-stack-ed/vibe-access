import { describe, test, expect } from '@jest/globals';
import { mineInputShape } from '../engine/adapters/firebase-functions/input-shape.mjs';

const REF = 'functions/src/social/lists.js';

describe('mineInputShape — req.body destructuring', () => {
  test('names every destructured key', () => {
    const src = `exports.addItem = async (req, res) => {
      const { name, listId } = req.body;
      res.json({ ok: true });
    };`;
    const shape = mineInputShape(src, src, REF);
    expect(shape).toEqual({
      type: 'object',
      properties: {
        name: { type: 'unknown', 'x-in': 'body' },
        listId: { type: 'unknown', 'x-in': 'body' },
      },
      'x-mined-by': 'reads',
      'x-mined-from': REF,
    });
  });

  test('handles renames, defaults and rest — key names only, never the local alias', () => {
    const src = `const { listId: id, limit = 20, ...rest } = req.body;`;
    const shape = mineInputShape(src, src, REF);
    expect(Object.keys(shape.properties)).toEqual(['listId', 'limit']);
  });

  test('a reads-mined shape never claims requiredness', () => {
    const src = `const { name } = req.body;`;
    const shape = mineInputShape(src, src, REF);
    expect(shape.required).toBeUndefined();
    expect(shape['x-mined-by']).toBe('reads');
  });
});

describe('mineInputShape — direct property reads', () => {
  test('req.body.X and optional-chained req.body?.X both land', () => {
    const src = `const words = req.body?.words || [];
      const userId = req.body.userId;`;
    const shape = mineInputShape(src, src, REF);
    expect(Object.keys(shape.properties)).toEqual(['words', 'userId']);
    expect(shape.properties.words['x-in']).toBe('body');
  });

  test('bracket reads land', () => {
    const src = `const v = req.body['movieId'];`;
    const shape = mineInputShape(src, src, REF);
    expect(Object.keys(shape.properties)).toEqual(['movieId']);
  });
});

describe('mineInputShape — query and params', () => {
  test('req.query.* is tagged x-in: query, req.params.* is tagged x-in: path', () => {
    const src = `const id = req.query.id;
      const { page } = req.query;
      const slug = req.params.slug;`;
    const shape = mineInputShape(src, src, REF);
    expect(shape.properties).toEqual({
      id: { type: 'unknown', 'x-in': 'query' },
      page: { type: 'unknown', 'x-in': 'query' },
      slug: { type: 'unknown', 'x-in': 'path' },
    });
  });
});

describe('mineInputShape — zod', () => {
  test('an inline z.object gives real types and real requiredness', () => {
    const src = `const parsed = z.object({
        title: z.string(),
        count: z.number().optional(),
        tags: z.array(z.string()),
        live: z.boolean().default(false),
      }).parse(req.body);`;
    const shape = mineInputShape(src, src, REF);
    expect(shape.properties).toEqual({
      title: { type: 'string', 'x-in': 'body' },
      count: { type: 'number', 'x-in': 'body' },
      tags: { type: 'array', 'x-in': 'body' },
      live: { type: 'boolean', 'x-in': 'body' },
    });
    expect(shape.required).toEqual(['title', 'tags']);
    expect(shape['x-mined-by']).toBe('zod');
  });

  test('a named module-scope schema referenced by .parse(req.body) resolves through the file source', () => {
    const file = `const BookSchema = z.object({ screeningId: z.string(), seats: z.number() });
      const bookScreening = onRequest({ cors: true }, async (req, res) => {
        const data = BookSchema.parse(req.body);
      });`;
    const handler = `const bookScreening = onRequest({ cors: true }, async (req, res) => {
        const data = BookSchema.parse(req.body);
      });`;
    const shape = mineInputShape(handler, file, REF);
    expect(shape['x-mined-by']).toBe('zod');
    expect(shape.required).toEqual(['screeningId', 'seats']);
    expect(shape.properties.seats.type).toBe('number');
  });

  test('a schema validating req.query tags its properties x-in: query', () => {
    const src = `const q = z.object({ page: z.number() }).parse(req.query);`;
    expect(mineInputShape(src, src, REF).properties.page['x-in']).toBe('query');
  });
});

describe('mineInputShape — joi', () => {
  test('joi requiredness is opt-in, never assumed', () => {
    const src = `const schema = Joi.object({
        email: Joi.string().required(),
        nickname: Joi.string(),
      });
      const value = schema.validate(req.body);`;
    const shape = mineInputShape(src, src, REF);
    expect(shape['x-mined-by']).toBe('joi');
    expect(shape.required).toEqual(['email']);
    expect(shape.properties.nickname).toEqual({ type: 'string', 'x-in': 'body' });
  });
});

describe('mineInputShape — path wildcards named from the handler slicing them', () => {
  const HANDLER = `const pathParts = req.path.split("/");
      const listOwnerId = pathParts[pathParts.length - 3];
      const listType = pathParts[pathParts.length - 2];`;

  test('offsets from the end resolve onto the route wildcards, in left-to-right order', () => {
    const shape = mineInputShape(HANDLER, HANDLER, REF, '/api/lists/*/*/like');
    expect(Object.entries(shape.properties)).toEqual([
      ['listOwnerId', { type: 'unknown', 'x-in': 'path' }],
      ['listType', { type: 'unknown', 'x-in': 'path' }],
    ]);
  });

  test('a slice that lands on a LITERAL segment is discarded — it named no parameter', () => {
    const src = `const pathParts = req.path.split("/");
      const verb = pathParts[pathParts.length - 1];`;
    expect(mineInputShape(src, src, REF, '/api/lists/*/like')).toBeNull();
  });

  test('a route with no wildcards mines no path parameters', () => {
    expect(mineInputShape(HANDLER, HANDLER, REF, '/api/lists')).toBeNull();
  });

  test('path parameters lead the body properties they are called alongside', () => {
    const src = `${HANDLER}
      const { title } = req.body;`;
    const shape = mineInputShape(src, src, REF, '/api/lists/*/*/like');
    expect(Object.keys(shape.properties)).toEqual(['listOwnerId', 'listType', 'title']);
  });
});

describe('mineInputShape — the honesty rule', () => {
  test('a handler that reads no input yields no shape — nothing is invented', () => {
    const src = `exports.ping = async (req, res) => res.json({ pong: true });`;
    expect(mineInputShape(src, src, REF)).toBeNull();
  });

  test('an empty handler source yields null', () => {
    expect(mineInputShape('', '', REF)).toBeNull();
    expect(mineInputShape(null, null, REF)).toBeNull();
  });

  test('a bare req.body reference with no property read invents nothing', () => {
    const src = `if (Object.keys(req.body).length === 0) return res.status(400).end();`;
    expect(mineInputShape(src, src, REF)).toBeNull();
  });

  test('a validator with no recognizable types leaves them unknown, never guessed', () => {
    const src = `const s = z.object({ payload: z.custom() }).parse(req.body);`;
    expect(mineInputShape(src, src, REF).properties.payload.type).toBe('unknown');
  });
});
