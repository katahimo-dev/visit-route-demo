import { describe, expect, it } from 'vitest';
import { demoDataSchema } from '../contracts/data';
import { addDays } from '../domain/time';
import { createDemoData, daysFrom } from './index';

const TODAY = '2026-10-12';

describe('createDemoData', () => {
  it('同じ日付なら同じデータ', () => {
    expect(createDemoData(TODAY)).toEqual(createDemoData(TODAY));
  });

  it('契約（demoDataSchema）を通る', () => {
    expect(() => demoDataSchema.parse(createDemoData(TODAY))).not.toThrow();
    expect(() => demoDataSchema.parse(createDemoData('2027-03-01'))).not.toThrow();
  });

  it('c6 に性別の必要条件、c2 と s2 は相性×', () => {
    const d = createDemoData(TODAY);
    const c6 = d.clients.find((c) => c.id === 'c6');
    expect(c6?.requirements).toContainEqual({ itemId: 'gender', op: 'is', value: '女性' });
    expect(d.compat.c2?.s2).toBe(-2);
    expect(d.compat.c12?.s7).toBe(-2);
  });

  it('14日分の訪問がある', () => {
    const d = createDemoData(TODAY);
    const dates = new Set(d.visits.map((v) => v.date));
    for (let i = 0; i < 14; i++) expect(dates.has(addDays(TODAY, i))).toBe(true);
    expect(dates.size).toBe(14);
    expect(Object.keys(d.manualPlans)).toHaveLength(14);
  });

  it('各訪問の staffId が手作業案と一致する', () => {
    const d = createDemoData(TODAY);
    for (const v of d.visits) {
      const owner = Object.entries(d.manualPlans[v.date] ?? {}).find(([, ids]) => ids.includes(v.id))?.[0];
      expect(v.staffId).toBe(owner === '__none' ? null : (owner ?? null));
    }
  });

  it('いつもの担当は手作業案で最も多い人', () => {
    const d = createDemoData(TODAY);
    expect(d.clients.some((c) => c.usualStaffId !== null)).toBe(true);
  });
});

describe('daysFrom', () => {
  it('既存の日は変えず、足りない日だけ足す', () => {
    const d = createDemoData(TODAY);
    const e = daysFrom(d, addDays(TODAY, 7), 14);
    expect(e.visits.filter((v) => v.date < addDays(TODAY, 14))).toEqual(d.visits);
    expect(new Set(e.visits.map((v) => v.date)).size).toBe(21);
    expect(() => demoDataSchema.parse(e)).not.toThrow();
  });
});
