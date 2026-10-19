import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DemoData, STORAGE_KEY } from '../contracts/data';
import type { Pattern } from '../contracts/documents';
import { createDemoData } from '../seed';
import {
  BROKEN_KEY,
  backup,
  currentData,
  exportJson,
  extendDays,
  flushSave,
  importJson,
  isImportError,
  load,
  migrate,
  rememberCurrent,
  reset,
  save,
} from './index';

/** 環境は node なので localStorage の簡単なモック */
function mockStorage() {
  const m = new Map<string, string>();
  const ls = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
  return m;
}

let mem: Map<string, string>;
beforeEach(() => {
  mem = mockStorage();
});

const err = (x: unknown) => {
  expect(isImportError(x as DemoData)).toBe(true);
  return x as { code: string; message: string };
};

describe('書き出し・読み込み', () => {
  it('書き出して読み込むと同じデータ', async () => {
    const d = createDemoData('2026-10-12');
    const text = await exportJson(d).text();
    expect(exportJson(d).type).toBe('application/json');
    expect(importJson(text)).toEqual(d);
  });

  it('壊れた JSON は ImportError（日本語）', () => {
    const e = err(importJson('{こわれた'));
    expect(e.code).toBe('INVALID_ARGUMENT');
    expect(e.message).toMatch(/JSON/);
  });

  it('版違いは ImportError', () => {
    const d = { ...createDemoData('2026-10-12'), version: 99 };
    expect(err(migrate(d)).message).toContain('版');
  });

  it('型違いは ImportError で、場所を日本語で示す', () => {
    const d = createDemoData('2026-10-12');
    const bad = { ...d, staff: d.staff.map((s, i) => (i === 2 ? { ...s, name: 123 } : s)) };
    const e = err(migrate(bad));
    expect(e.message).toContain('staff の 3件目の name：');
    expect(err(migrate([])).message).toContain('形');
  });
});

describe('AI案の手直し（ADR-0004）の移行', () => {
  // 読み込みで、いない訪問を指す案は直す（repair）ので、その日の本当の訪問IDを使う
  const [v1 = '', v2 = ''] = createDemoData('2026-10-12')
    .visits.filter((v) => v.date === '2026-10-12')
    .map((v) => v.id);
  const old = {
    date: '2026-10-12',
    createdAt: 1,
    seed: 1,
    iterations: 100,
    routes: { s1: [v1], s2: [] },
    unassigned: [v2],
    score: 123,
    stopped: false,
    rules: [],
  };
  it('generated・pins が無い保存データは、generated＝routes の写し・pins＝{} で補って読める（版は上げない）', () => {
    const d = { ...createDemoData('2026-10-12'), aiPlans: { '2026-10-12': old }, prevAiPlans: { '2026-10-12': old } };
    const r = migrate(JSON.parse(JSON.stringify(d))) as DemoData;
    expect(isImportError(r)).toBe(false);
    expect(r.version).toBe(1);
    const plan = r.aiPlans['2026-10-12']!;
    expect(plan.generated).toEqual({ routes: { s1: [v1], s2: [] }, unassigned: [v2], score: 123 });
    expect(plan.pins).toEqual({});
    // 前の版の prevAiPlans は捨て、記録（aiRuns）は {} で補う
    expect('prevAiPlans' in r).toBe(false);
    expect(r.aiRuns).toEqual({});
  });
  it('generated・pins があればそのまま', () => {
    const plan = { ...old, generated: { routes: { s1: [] }, unassigned: [], score: 1 }, pins: { [v1]: 's1' } };
    const d = { ...createDemoData('2026-10-12'), aiPlans: { '2026-10-12': plan } };
    const r = migrate(JSON.parse(JSON.stringify(d))) as DemoData;
    expect(r.aiPlans['2026-10-12']).toEqual(plan);
  });
});

describe('load・save', () => {
  it('無ければ初期データを作って保存する', () => {
    const d = load();
    expect(d.version).toBe(1);
    expect(d.visits.length).toBeGreaterThan(0);
    expect(mem.has(STORAGE_KEY)).toBe(true);
  });

  it('壊れた JSON は退避して初期データを返す', () => {
    mem.set(STORAGE_KEY, '{こわれた');
    const d = load();
    expect(d.staff).toHaveLength(8);
    expect(mem.get(BROKEN_KEY)).toBe('{こわれた');
  });

  it('保存したものを読み直せる（間引きは最後の値）', () => {
    vi.useFakeTimers();
    const a = createDemoData('2026-10-12');
    const b = { ...a, seed: 42 };
    const flushed = vi.fn();
    save(a, flushed);
    save(b, flushed);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    expect(flushed).toHaveBeenCalledTimes(1);
    expect(flushed).toHaveBeenCalledWith(null);
    expect((JSON.parse(mem.get(STORAGE_KEY) ?? '{}') as DemoData).seed).toBe(42);
  });

  it('容量超過は文言を onError に渡す', () => {
    (globalThis.localStorage as Storage).setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    const onError = vi.fn();
    save(createDemoData('2026-10-12'), onError);
    flushSave();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('保存容量'));
  });

  it('reset は初期データで置き換える', () => {
    mem.set(STORAGE_KEY, JSON.stringify({ ...createDemoData('2026-10-12'), seed: 7 }));
    const d = reset();
    expect(d.seed).toBe(1);
    expect((JSON.parse(mem.get(STORAGE_KEY) ?? '{}') as DemoData).seed).toBe(1);
  });
});

describe('控え（backup。例外の画面）', () => {
  const seedOf = (text: string | undefined) => (JSON.parse(text ?? '{}') as DemoData).seed;

  it('画面の最新のデータ（メモリ）を優先し、待っている保存も先に書く', () => {
    reset();
    vi.useFakeTimers();
    save({ ...createDemoData('2026-10-12'), seed: 9 });
    const b = backup();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    expect(b.source).toBe('memory');
    expect(b.saveError).toBeNull();
    expect(b.files.map((f) => f.kind)).toEqual(['current']);
    expect(seedOf(b.files[0]?.text)).toBe(9);
    expect(seedOf(mem.get(STORAGE_KEY))).toBe(9);
  });

  it('データの画面の書き出しと同じ形の JSON', async () => {
    const d = { ...createDemoData('2026-10-12'), seed: 5 };
    rememberCurrent(d);
    expect(backup().files[0]?.text).toBe(await exportJson(d).text());
  });

  it('保存に失敗していたら（容量超過）、文言を返し、メモリの最新を書き出す', () => {
    reset();
    (globalThis.localStorage as Storage).setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    save({ ...createDemoData('2026-10-12'), seed: 11 });
    const b = backup();
    expect(b.saveError).toContain('保存容量');
    expect(b.source).toBe('memory');
    expect(seedOf(b.files[0]?.text)).toBe(11);
  });

  it('保存が使えない（localStorage が無い）ときもメモリから書き出す', () => {
    rememberCurrent(null);
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    save({ ...createDemoData('2026-10-12'), seed: 12 });
    const b = backup();
    expect(b.source).toBe('memory');
    expect(b.saveError).toMatch(/保存が使えません/);
    expect(b.files.map((f) => f.kind)).toEqual(['current']);
    expect(seedOf(b.files[0]?.text)).toBe(12);
  });

  it('メモリに無ければ保存してある文字をそのまま（壊れていても手を加えない）、何も無ければ空', () => {
    reset();
    rememberCurrent(null);
    mem.set(STORAGE_KEY, '{こわれた');
    const b = backup();
    expect(b.source).toBe('storage');
    expect(b.files).toEqual([{ kind: 'current', text: '{こわれた' }]);
    mem.delete(STORAGE_KEY);
    expect(backup()).toEqual({ files: [], source: null, saveError: null });
  });

  it('STORAGE_KEY が壊れて load() が退避したあとは、初期データと壊れたデータの2つを書き出す', () => {
    reset();
    mem.set(STORAGE_KEY, '{こわれた');
    const d = load();
    expect(currentData()).toBe(d);
    const b = backup();
    expect(b.files.map((f) => f.kind)).toEqual(['current', 'broken']);
    expect(seedOf(b.files[0]?.text)).toBe(d.seed);
    expect(b.files[1]?.text).toBe('{こわれた');
  });
});

describe('extendDays', () => {
  it('今日以降の訪問があれば何もしない', () => {
    const d = createDemoData('2026-10-12');
    expect(extendDays(d, '2026-10-20')).toBe(d);
  });
  it('今日以降の訪問が無ければ14日分足し、既存の日は変えない', () => {
    const d = createDemoData('2026-10-12');
    const e = extendDays(d, '2026-11-20');
    expect(e.visits.filter((v) => v.date < '2026-11-20')).toEqual(d.visits);
    expect(e.visits.some((v) => v.date === '2026-11-20')).toBe(true);
    expect(e.manualPlans['2026-10-12']).toEqual(d.manualPlans['2026-10-12']);
  });
  it('パターンのあるデータで今日以降の訪問が無いとき、起動するとパターンから訪問が足される', () => {
    const d = createDemoData('2026-10-12');
    const client = d.clients.find((c) => c.active)!;
    const pattern: Pattern = {
      id: 'p1',
      clientId: client.id,
      typeId: null,
      weekdays: [1, 4], // 月・木
      everyWeeks: 1,
      repeat: 'weekly',
      monthWeeks: [],
      dayTimes: [],
      windowKind: 'fixed',
      earliestStart: '10:00',
      latestStart: '10:00',
      durationMinutes: 60,
      from: '2026-10-01',
      to: null,
      usualStaffId: null,
      note: '',
    };
    // seed のパターン（ADR-0012）を p1 だけにする（seed の訪問はパターンから外す）
    const withPattern: DemoData = { ...d, patterns: [pattern], visits: d.visits.map((v) => ({ ...v, pattern: null })) };
    mem.set(STORAGE_KEY, JSON.stringify(withPattern));
    // 今日＝2026-11-20（金）。今日〜12/3 の月・木
    vi.useFakeTimers({ now: Date.parse('2026-11-20T09:00:00+09:00'), toFake: ['Date'] });
    let loaded: DemoData;
    try {
      loaded = load();
    } finally {
      vi.useRealTimers();
    }
    expect(loaded.visits.filter((v) => v.date < '2026-11-20')).toEqual(withPattern.visits);
    const added = loaded.visits.filter((v) => v.date >= '2026-11-20');
    expect(added.map((v) => v.id)).toEqual(['2026-11-23_p1', '2026-11-26_p1', '2026-11-30_p1', '2026-12-03_p1']);
    expect(added.every((v) => v.pattern?.id === 'p1' && v.clientId === client.id)).toBe(true);
    // 保存もされる
    expect((JSON.parse(mem.get(STORAGE_KEY) ?? '{}') as DemoData).visits).toEqual(loaded.visits);
    // パターンがあれば seed の daysFrom は使わない
    expect(extendDays(withPattern, '2026-11-20').visits).toEqual(loaded.visits);
  });
});
