import { describe, test, expect } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupFiles, rollback } from '../engine/backup.mjs';

describe('backup/rollback', () => {
  test('round-trips a modified file back to its backed-up contents', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'va-bk-'));
    try {
      const target = join(tmp, 'functions', 'index.js');
      mkdirSync(join(tmp, 'functions'), { recursive: true });
      writeFileSync(target, 'original');
      backupFiles(tmp, ['functions/index.js'], 'batch1');
      writeFileSync(target, 'mutated');
      rollback(tmp, 'batch1');
      expect(readFileSync(target, 'utf8')).toBe('original');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('rollback on unknown batch throws a named error', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'va-bk-'));
    try {
      expect(() => rollback(tmp, 'ghost')).toThrow(/no backup/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
