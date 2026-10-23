import { describe, expect, it } from 'vitest';
import { demoDataSchema } from '../contracts/data';
import { addDays } from '../domain/time';
import { dayStatus } from '../lib/month';
import { visitsOn } from '../patterns';
import { createDemoData, seedPatternStart } from './index';
import { createInitialData, SEED_PLAN_DAYS, withSeedPlans } from './plans';

const TODAY = '2026-10-21';
const data = createInitialData(TODAY);
const days = Array.from({ length: SEED_PLAN_DAYS }, (_, i) => addDays(TODAY, i));

describe('createInitialData（PRD D225。版2）', () => {
  it('今日から続けて7日分の担当・開始を訪問に書き、8日目からは書かない', () => {
    expect(SEED_PLAN_DAYS).toBe(7);
    expect([...new Set(data.visits.map((v) => v.date))].sort()).toEqual(days);
    for (const d of days) {
      const placed = visitsOn(data, d).filter((v) => !v.cancelled);
      expect(placed.every((v) => v.start !== null || v.staffId === null)).toBe(true);
      expect(placed.some((v) => v.staffId !== null)).toBe(true);
      // AI が組んだ担当にはピンを付けない
      expect(placed.every((v) => !v.pinned)).toBe(true);
    }
    expect(visitsOn(data, addDays(TODAY, 7)).every((v) => v.start === null)).toBe(true);
  });

  it('同じ日付なら同じデータ（種と反復回数で決まる）', () => {
    expect(createInitialData(TODAY)).toEqual(data);
  });

  it('訪問・伝えた内容のほかは createDemoData と同じ', () => {
    const base = createDemoData(TODAY);
    expect({ ...data, visits: [], snapshots: {} }).toEqual(base);
  });

  it('繰り返しは前の月の初めから。過去の日（前の月の1日〜昨日）は伝えた状態で、今日からは伝えていない', () => {
    expect(seedPatternStart(TODAY)).toBe('2026-09-01');
    expect(seedPatternStart('2027-01-05')).toBe('2026-12-01');
    expect(data.patterns.every((p) => p.from === '2026-09-01')).toBe(true);
    const told = Object.keys(data.snapshots).sort();
    expect(told[0]).toBe('2026-09-01');
    expect(told.at(-1)).toBe(addDays(TODAY, -1));
    expect(told.every((d) => d < TODAY)).toBe(true);
    for (const d of ['2026-09-01', '2026-10-01', addDays(TODAY, -1)]) {
      const s = dayStatus(data, d);
      expect(s.count).toBeGreaterThan(0);
      expect(s.state).toBe('told');
    }
  });

  it('契約（demoDataSchema）を通る', () => {
    expect(() => demoDataSchema.parse(data)).not.toThrow();
  });

  it('作った直後は「まだ伝えていない」', () => {
    for (const d of days) expect(dayStatus(data, d).state).toBe('none');
  });

  it('同じデータにもう一度反映しても変わらない（担当・開始が同じなら書かない）', () => {
    expect(withSeedPlans(data, TODAY).visits).toEqual(data.visits);
  });
});
