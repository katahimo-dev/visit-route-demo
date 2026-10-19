import { describe, expect, it } from 'vitest';
import { STORAGE_KEY } from '../contracts/data';
import { BACKUP_LAST_KEY, BACKUP_REMINDED_KEY, createBackupMemory } from './backup';

const fake = () => {
  const m = new Map<string, string>();
  return {
    m,
    ls: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
    },
  };
};

describe('backupMemory（PRD D227）', () => {
  it('はじめはまだ書き出していない。覚えると DemoData とは別のキーに残り、作り直しても読める', () => {
    const { m, ls } = fake();
    const b = createBackupMemory(() => ls);
    expect(b.lastExport()).toBeNull();
    b.markExported('json', '2026-10-12');
    expect(b.lastExport()).toEqual({ date: '2026-10-12', kind: 'json' });
    expect(JSON.parse(m.get(BACKUP_LAST_KEY) ?? 'null')).toEqual({ date: '2026-10-12', kind: 'json' });
    expect(BACKUP_LAST_KEY).not.toBe(STORAGE_KEY);
    expect(createBackupMemory(() => ls).lastExport()).toEqual({ date: '2026-10-12', kind: 'json' });
    b.markExported('excel', '2026-10-15');
    expect(createBackupMemory(() => ls).lastExport()).toEqual({ date: '2026-10-15', kind: 'excel' });
  });
  it('知らせた日を覚える', () => {
    const { m, ls } = fake();
    const b = createBackupMemory(() => ls);
    expect(b.lastReminded()).toBeNull();
    b.markReminded('2026-10-19');
    expect(m.get(BACKUP_REMINDED_KEY)).toBe('2026-10-19');
    expect(createBackupMemory(() => ls).lastReminded()).toBe('2026-10-19');
  });
  it('読めない値は無いとみなす', () => {
    const { m, ls } = fake();
    m.set(BACKUP_LAST_KEY, 'こわれた');
    m.set(BACKUP_REMINDED_KEY, 'きのう');
    const b = createBackupMemory(() => ls);
    expect(b.lastExport()).toBeNull();
    expect(b.lastReminded()).toBeNull();
    m.set(BACKUP_LAST_KEY, JSON.stringify({ date: '2026-10-12', kind: 'csv' }));
    expect(b.lastExport()).toBeNull();
  });
  it('localStorage が使えなくても落ちず、開いている間は覚える', () => {
    const b = createBackupMemory(() => {
      throw new Error('使えない');
    });
    expect(b.lastExport()).toBeNull();
    b.markExported('json', '2026-10-12');
    b.markReminded('2026-10-19');
    expect(b.lastExport()).toEqual({ date: '2026-10-12', kind: 'json' });
    expect(b.lastReminded()).toBe('2026-10-19');
  });
});
