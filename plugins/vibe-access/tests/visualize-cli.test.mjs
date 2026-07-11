import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// §3 — the CLI surface, exercised as a process. The contract under test is input resolution,
// the output path, the read-only promise, and the exit codes — not the renderer (covered in
// visualize-render.test.mjs).

const CLI = fileURLToPath(new URL('../engine/cli.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

const run = (args, cwd) =>
  spawnSync(process.execPath, [CLI, 'visualize', ...args], { cwd, encoding: 'utf8' });

let root;
let appRoot;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'vibe-access-cli-'));
  appRoot = join(root, 'app');
  mkdirSync(appRoot, { recursive: true });
  copyFileSync(join(FIXTURES, 'manifest-weseeyou.json'), join(appRoot, 'agent-access.json'));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const today = () => new Date().toISOString().slice(0, 10);

describe('visualize CLI (§3)', () => {
  test('defaults to <appRoot>/agent-access.json and the dated docs path', () => {
    const r = run(['--app', appRoot]);
    expect(r.status).toBe(0);
    const summary = JSON.parse(r.stdout);
    expect(summary.source).toBe('manifest');
    expect(summary.tools).toBeGreaterThan(0);
    expect(typeof summary.findings).toBe('number');
    const expected = join(appRoot, 'docs', 'vibe-access', `agent-access-${today()}.html`);
    expect(summary.out).toBe(expected);
    expect(readFileSync(expected, 'utf8').startsWith('<!doctype html>')).toBe(true);
  });

  test('read-only: the manifest is untouched and no state dir is created', () => {
    const before = readFileSync(join(appRoot, 'agent-access.json'), 'utf8');
    run(['--app', appRoot]);
    expect(readFileSync(join(appRoot, 'agent-access.json'), 'utf8')).toBe(before);
    expect(existsSync(join(appRoot, '.vibe-access'))).toBe(false);
  });

  test('--input takes an explicit file; --out overrides the path', () => {
    const out = join(root, 'out', 'roro.html');
    const r = run(['--app', appRoot, '--input', join(FIXTURES, 'manifest-rororo.json'), '--out', out]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).out).toBe(out);
    expect(existsSync(out)).toBe(true);
  });

  test('an MCP tools/list payload is sniffed, not flag-gated', () => {
    const out = join(root, 'out', 'mcp.html');
    const r = run(['--app', appRoot, '--input', join(FIXTURES, 'mcp-tools-list.json'), '--out', out]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).source).toBe('mcp');
  });

  test('no input anywhere → exit 1 with the named message', () => {
    const bare = join(root, 'bare');
    mkdirSync(bare, { recursive: true });
    const r = run(['--app', bare]);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(
      'no input — expected agent-access.json at the app root or --input <file>'
    );
  });

  test('unparseable JSON → exit 1, not a crashed stack', () => {
    const bad = join(root, 'bad.json');
    writeFileSync(bad, '{ nope');
    const r = run(['--app', appRoot, '--input', bad]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unparseable JSON/);
  });

  test('an unrecognized shape → exit 1', () => {
    const odd = join(root, 'odd.json');
    writeFileSync(odd, JSON.stringify({ hello: 'world' }));
    const r = run(['--app', appRoot, '--input', odd]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unrecognized input shape/);
  });

  test('a value-less --out errors instead of writing a file named "true"', () => {
    const r = run(['--app', appRoot, '--out']);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe('--out requires a value');
    expect(existsSync(join(appRoot, 'true'))).toBe(false);
  });

  test('--no-source scrubs every sourceRef out of the emitted file', () => {
    const withSource = join(root, 'out', 'src.html');
    const without = join(root, 'out', 'nosrc.html');
    run(['--app', appRoot, '--out', withSource]);
    run(['--app', appRoot, '--out', without, '--no-source']);
    const src = readFileSync(join(appRoot, 'agent-access.json'), 'utf8');
    const raw = JSON.parse(src).affordances.find((a) => a.sourceRef)?.sourceRef;
    expect(raw).toBeTruthy();
    // The renderer posix-normalizes sourceRefs; the micro-footer prints them unbroken.
    const ref = raw.replace(/\\/g, '/');
    expect(readFileSync(withSource, 'utf8')).toContain(ref);
    expect(readFileSync(without, 'utf8')).not.toContain(ref);
    expect(readFileSync(without, 'utf8')).not.toContain(raw);
  });

  test('unknown command still exits 2 (the top-level convention holds)', () => {
    const r = spawnSync(process.execPath, [CLI, 'nope'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
  });
});
