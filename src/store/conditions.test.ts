import { describe, expect, it } from 'vitest';
import { STORAGE_KEY } from '../contracts/data';
import { createDemoData } from '../seed';
import {
  CONDITIONS_BASE_KEY,
  captureBase,
  conditionsChanged,
  conditionsOf,
  createConditionsMemory,
  parseBase,
} from './conditions';

const fake = () => {
  const m = new Map<string, string>();
  return {
    m,
    ls: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
      removeItem: (k: string) => {
        m.delete(k);
      },
    },
  };
};
const d = createDemoData('2026-10-21');

describe('条件の変更の控え（PRD D267。ADR-0044）', () => {
  it('条件の部分だけを持つ（訪問・案・記録・確定した割当・欠勤は入れない）', () => {
    const c = conditionsOf(d) as Record<string, unknown>;
    expect(Object.keys(c).sort()).toEqual(
      [
        'availability',
        'clientLeaves',
        'clients',
        'compat',
        'items',
        'org',
        'patterns',
        'presets',
        'rules',
        'scorePresetId',
        'staff',
        'visitTypes',
      ].sort(),
    );
    for (const k of ['visits', 'aiPlans', 'aiRuns', 'manualPlans', 'absences']) expect(c[k]).toBeUndefined();
  });

  it('captureBase：控えが無く条件が変わったら、変わる前の条件を控える', () => {
    const next = { ...d, org: { ...d.org, features: { compat: false } } };
    const b = captureBase(d, next, null, 123);
    expect(b?.at).toBe(123);
    expect(b?.data.org.features).toEqual({});
    // 控えがあれば上書きしない
    expect(captureBase(d, next, b, 456)).toBeNull();
    // 条件以外（訪問・案）だけの変更・同じ中身の作り直しでは取らない
    expect(captureBase(d, { ...d, visits: [] } as typeof d, null, 1)).toBeNull();
    expect(captureBase(d, { ...d, staff: structuredClone(d.staff) }, null, 1)).toBeNull();
    expect(conditionsChanged(d, { ...d, staff: d.staff.slice(1) })).toBe(true);
  });

  it('DemoData とは別のキーに書き、読み直せる。消すと無い。読めない値は無いとみなす', () => {
    const { m, ls } = fake();
    const mem = createConditionsMemory(() => ls);
    expect(mem.read()).toBeNull();
    mem.write({ at: 5, data: conditionsOf(d) });
    expect(CONDITIONS_BASE_KEY).not.toBe(STORAGE_KEY);
    expect(m.has(CONDITIONS_BASE_KEY)).toBe(true);
    const again = createConditionsMemory(() => ls).read();
    expect(again?.at).toBe(5);
    expect(again?.data.rules).toEqual(d.rules);
    mem.clear();
    expect(mem.read()).toBeNull();
    m.set(CONDITIONS_BASE_KEY, '{');
    expect(mem.read()).toBeNull();
    expect(parseBase(JSON.stringify({ at: 1, data: { rules: 'x' } }))).toBeNull();
    expect(parseBase(null)).toBeNull();
  });

  it('別のタブで消したら無い（このタブで書いたものを返さない）', () => {
    const { m, ls } = fake();
    const mem = createConditionsMemory(() => ls);
    mem.write({ at: 5, data: conditionsOf(d) });
    m.delete(CONDITIONS_BASE_KEY);
    expect(mem.read()).toBeNull();
  });

  it('保存が使えないブラウザでも、開いている間は覚える', () => {
    const mem = createConditionsMemory(() => null);
    mem.write({ at: 7, data: conditionsOf(d) });
    expect(mem.read()?.at).toBe(7);
    mem.clear();
    expect(mem.read()).toBeNull();
    const full = createConditionsMemory(() => ({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    }));
    full.write({ at: 8, data: conditionsOf(d) });
    expect(full.read()?.at).toBe(8);
  });
});
