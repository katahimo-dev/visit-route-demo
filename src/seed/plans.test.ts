import { describe, expect, it } from 'vitest';
import { demoDataSchema } from '../contracts/data';
import { addDays } from '../domain/time';
import { dayStatus } from '../lib/month';
import { visitsOn } from '../patterns';
import { createDemoData } from './index';
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

  it('訪問のほかは createDemoData と同じ（伝えた内容は入れない）', () => {
    const base = createDemoData(TODAY);
    expect({ ...data, visits: [] }).toEqual(base);
    expect(data.snapshots).toEqual({});
  });

  it('契約（demoDataSchema）を通る', () => {
    expect(() => demoDataSchema.parse(data)).not.toThrow();
  });

  it('作った直後は「まだ伝えていない」', () => {
    for (const d of days) expect(dayStatus(data, d).state).toBe('none');
  });

  it('同じデータにもう一度当てても変わらない（担当・開始が同じなら書かない）', () => {
    expect(withSeedPlans(data, TODAY).visits).toEqual(data.visits);
  });
});
