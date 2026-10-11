import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DemoData, STORAGE_KEY } from '../contracts/data';
import { createDemoData } from '../seed';
import {
  BROKEN_KEY,
  exportJson,
  extendDays,
  flushSave,
  importJson,
  isImportError,
  load,
  migrate,
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
  const old = {
    date: '2026-10-12',
    createdAt: 1,
    seed: 1,
    iterations: 100,
    routes: { s1: ['v1'], s2: [] },
    unassigned: ['v2'],
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
    expect(plan.generated).toEqual({ routes: { s1: ['v1'], s2: [] }, unassigned: ['v2'], score: 123 });
    expect(plan.pins).toEqual({});
    expect(r.prevAiPlans['2026-10-12']!.pins).toEqual({});
  });
  it('generated・pins があればそのまま', () => {
    const plan = { ...old, generated: { routes: { s1: [] }, unassigned: [], score: 1 }, pins: { v1: 's1' } };
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
});
