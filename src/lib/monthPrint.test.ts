// 月の予定の印刷（PRD D70。ADR-0014）
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { monthPrint, printDay, staffLabels } from './monthPrint';
import { REQUESTED_OFF_NOTE } from './requestedOff';

/** 訪問に担当を書く（版2。担当は訪問に持つ） */
const assign = (d: DemoData, routes: Record<string, string[]>): DemoData => {
  const owner = new Map(Object.entries(routes).flatMap(([sid, ids]) => ids.map((id) => [id, sid] as const)));
  return { ...d, visits: d.visits.map((v) => ({ ...v, staffId: owner.get(v.id) ?? null })) };
};
const told = (d: DemoData): DemoData => ({ ...d, snapshots: { [DATE]: { date: DATE, at: 1, visits: [] } } });

function data(over: Partial<DemoData> = {}): DemoData {
  return makeData({
    staff: [staff('s1', 38.26, 140.87, { name: '山田 花' }), staff('s2', 38.27, 140.88, { name: '佐藤 一' })],
    clients: [
      client('c1', 38.265, 140.875, { displayName: '青葉' }),
      client('c2', 38.266, 140.876, { displayName: '泉' }),
      client('c3', 38.267, 140.877, { displayName: '宮城野' }),
    ],
    visits: [
      visit('v1', 'c1', '13:00', '13:00', { windowKind: 'fixed' }),
      visit('v2', 'c2', '09:00', '09:00', { windowKind: 'fixed' }),
      visit('v3', 'c3', '11:00', '11:00', { windowKind: 'fixed' }),
    ],
    ...over,
  });
}

describe('月の予定の印刷（printDay・monthPrint）', () => {
  it('訪問の担当で、開始の順に 時刻・〈利用者さん〉・担当。確定（伝えた）日は confirmed', () => {
    const d = assign(data(), { s1: ['v2', 'v1'], s2: ['v3'] });
    const p = printDay(d, DATE, null);
    expect(p.source).toBe('plan');
    expect(p.entries.map((e) => [e.start, e.clientName, e.staffName])).toEqual([
      [9 * 60, '泉', '山田 花'],
      [11 * 60, '宮城野', '佐藤 一'],
      [13 * 60, '青葉', '山田 花'],
    ]);
    const c = printDay(told(assign(data(), { s2: ['v1', 'v2'] })), DATE, null);
    expect(c.source).toBe('confirmed');
    expect(c.entries.map((e) => [e.clientName, e.staffName])).toEqual([
      ['泉', '佐藤 一'],
      ['宮城野', null],
      ['青葉', '佐藤 一'],
    ]);
  });

  it('担当なしの訪問は担当なし（開始（早）の時刻）。取り消しの訪問は出さない', () => {
    const d = data({
      visits: [...data().visits.slice(0, 2), visit('v3', 'c3', '11:00', '11:00', { cancelled: true })],
    });
    const p = printDay(d, DATE, null);
    expect(p.entries.map((e) => [e.clientName, e.staffName])).toEqual([
      ['泉', null],
      ['青葉', null],
    ]);
  });

  it('〈スタッフ〉で絞ると、その人の担当とその人の休みだけ', () => {
    const d = assign(
      data({ absences: [{ id: 'a', staffId: 's2', date: DATE, from: null, to: null, note: REQUESTED_OFF_NOTE }] }),
      { s1: ['v2', 'v1'], s2: ['v3'] },
    );
    const p = printDay(d, DATE, 's1');
    expect(p.entries.map((e) => e.clientName)).toEqual(['泉', '青葉']);
    expect(p.off).toEqual([]);
    const all = printDay(d, DATE, null);
    expect(all.off).toEqual([{ staffId: 's2', name: '佐藤 一', label: '佐藤', kind: 'requested' }]);
    expect(printDay(d, DATE, 's2').off).toEqual([{ staffId: 's2', name: '佐藤 一', label: '佐藤', kind: 'requested' }]);
  });

  it('〈利用者さん〉の休みの訪問は一覧に出さず「休み」に名前。勤務の無い〈スタッフ〉も休みに出す', () => {
    const d = assign(
      data({
        clientLeaves: [{ id: 'l1', clientId: 'c1', from: DATE, to: DATE, note: '入院' }],
        availability: [{ staffId: 's2', date: DATE, slots: [] }],
      }),
      { s1: ['v2', 'v1'], s2: ['v3'] },
    );
    const p = printDay(d, DATE, null);
    expect(p.entries.map((e) => e.clientName)).not.toContain('青葉');
    expect(p.leaves).toEqual(['青葉']);
    expect(p.off).toEqual([{ staffId: 's2', name: '佐藤 一', label: '佐藤', kind: 'noShift' }]);
    // 絞ると、その人の担当だった〈利用者さん〉の休みだけ
    expect(printDay(d, DATE, 's1').leaves).toEqual(['青葉']);
    expect(printDay(d, DATE, 's2').leaves).toEqual([]);
  });

  it('月は日曜はじまりの週ごと。前後の月の日は空のマス', () => {
    const weeks = monthPrint(data(), '2026-10', null);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]![0]!.date).toBe('2026-09-27');
    expect(weeks[0]![0]!.inMonth).toBe(false);
    const mon = weeks.flat().find((x) => x.date === DATE)!;
    expect(mon.entries).toHaveLength(3);
  });
});

describe('レビューの指摘（PR #20）', () => {
  it('〈スタッフ〉で絞っても担当の決まっていない件数（pending）が分かる', () => {
    expect(printDay(data(), DATE, 's1')).toMatchObject({ entries: [], pending: 3 });
    const p = printDay(assign(data(), { s1: ['v2'] }), DATE, 's1');
    expect(p.source).toBe('plan');
    expect(p.pending).toBe(2);
  });

  it('名字が重なる人はフルネーム、重ならない人は名字', () => {
    const labels = staffLabels([
      { id: 'a', name: '山田 花', active: true },
      { id: 'b', name: '山田 一', active: true },
      { id: 'c', name: '佐藤 次郎', active: true },
      { id: 'd', name: '佐藤 休', active: false },
    ]);
    expect([...labels.values()]).toEqual(['山田 花', '山田 一', '佐藤', '佐藤']);
    const d = assign(
      data({
        staff: [staff('s1', 38.26, 140.87, { name: '山田 花' }), staff('s2', 38.27, 140.88, { name: '山田 一' })],
      }),
      { s1: ['v2'], s2: ['v1'] },
    );
    expect(printDay(d, DATE, null).entries.map((e) => e.staffLabel)).toEqual(['山田 花', null, '山田 一']);
  });
});

describe('最終勤務日（ADR-0015）', () => {
  it('最終勤務日の後の人は休みに出さない（当日までは今までどおり）', () => {
    const d = data({
      staff: [
        staff('s1', 38.26, 140.87, { name: '山田 花', lastDay: '2026-10-11' }),
        staff('s2', 38.27, 140.88, { name: '佐藤 一', workDays: [2] }),
      ],
    });
    expect(printDay(d, DATE, null).off.map((o) => o.name)).toEqual(['佐藤 一']);
    expect(printDay(d, '2026-10-11', null).off.map((o) => o.name)).toEqual(['山田 花', '佐藤 一']);
  });
});
