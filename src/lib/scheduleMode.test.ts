import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { isLateMonth, nextYm, planLabel, planYm, unassignedDays } from './scheduleMode';

describe('月の後半・組む月', () => {
  it('15日から後半', () => {
    expect(isLateMonth('2026-10-14')).toBe(false);
    expect(isLateMonth('2026-10-15')).toBe(true);
  });
  it('来月は年をまたぐ', () => {
    expect(nextYm('2026-12-31')).toBe('2027-01');
    expect(nextYm('2026-01-31')).toBe('2026-02');
  });
  it('組む月は後半なら来月、前半なら今月', () => {
    expect(planYm('2026-10-24')).toBe('2026-11');
    expect(planYm('2026-10-03')).toBe('2026-10');
    expect(planLabel('2026-10-24')).toBe('11月の予定');
  });
});

describe('unassignedDays', () => {
  const base = {
    patterns: [],
    clients: [{ id: 'c1', active: true }],
    clientLeaves: [],
    snapshots: {},
  } as unknown as DemoData;
  const visit = (id: string, date: string, staffId: string | null, extra = {}) => ({
    id,
    clientId: 'c1',
    date,
    staffId,
    cancelled: false,
    earliestStart: '09:00',
    latestStart: '09:00',
    duration: 60,
    ...extra,
  });
  it('今日以降で担当なしの訪問がある日を数える（伝えた日・取り消しは数えない）', () => {
    const data = {
      ...base,
      visits: [
        visit('a', '2026-11-02', null),
        visit('b', '2026-11-02', null),
        visit('c', '2026-11-03', 's1'),
        visit('d', '2026-11-04', null, { cancelled: true }),
        visit('e', '2026-11-05', null),
        visit('f', '2026-11-06', null),
      ],
      snapshots: { '2026-11-06': {} },
    } as unknown as DemoData;
    expect(unassignedDays(data, '2026-11', '2026-10-24')).toBe(2);
    expect(unassignedDays(data, '2026-11', '2026-11-03')).toBe(1);
  });
});
