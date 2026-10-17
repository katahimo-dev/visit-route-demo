// 月の予定の印刷（PRD D70。ADR-0014）
import { describe, expect, it } from 'vitest';
import type { AiPlan, DemoData } from '../contracts/data';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { monthPrint, printDay, staffLabels } from './monthPrint';
import { REQUESTED_OFF_NOTE } from './requestedOff';

const plan = (routes: Record<string, string[]>): AiPlan => ({
  date: DATE,
  createdAt: 1,
  seed: 1,
  iterations: 1,
  routes,
  unassigned: [],
  score: 0,
  stopped: false,
  rules: [],
  generated: { routes, unassigned: [], score: 0 },
  pins: {},
});

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
  it('確定した割当があればそれ、無ければ今の案。開始の順に 時刻・〈利用者さん〉・担当', () => {
    const d = data({ aiPlans: { [DATE]: plan({ s1: ['v2', 'v1'], s2: ['v3'] }) } });
    const p = printDay(d, DATE, null);
    expect(p.source).toBe('plan');
    expect(p.entries.map((e) => [e.start, e.clientName, e.staffName])).toEqual([
      [9 * 60, '泉', '山田 花'],
      [11 * 60, '宮城野', '佐藤 一'],
      [13 * 60, '青葉', '山田 花'],
    ]);
    const c = printDay({ ...d, manualPlans: { [DATE]: { s2: ['v1', 'v2'], __none: ['v3'] } } }, DATE, null);
    expect(c.source).toBe('confirmed');
    expect(c.entries.map((e) => [e.clientName, e.staffName])).toEqual([
      ['泉', '佐藤 一'],
      ['宮城野', null],
      ['青葉', '佐藤 一'],
    ]);
  });

  it('案の無い日は担当なし（開始（早）の時刻）。取り消しの訪問は出さない', () => {
    const d = data({
      visits: [...data().visits.slice(0, 2), visit('v3', 'c3', '11:00', '11:00', { cancelled: true })],
    });
    const p = printDay(d, DATE, null);
    expect(p.source).toBeNull();
    expect(p.entries.map((e) => [e.clientName, e.staffName])).toEqual([
      ['泉', null],
      ['青葉', null],
    ]);
  });

  it('〈スタッフ〉で絞ると、その人の担当とその人の休みだけ', () => {
    const d = data({
      aiPlans: { [DATE]: plan({ s1: ['v2', 'v1'], s2: ['v3'] }) },
      absences: [{ id: 'a', staffId: 's2', date: DATE, from: null, to: null, note: REQUESTED_OFF_NOTE }],
    });
    const p = printDay(d, DATE, 's1');
    expect(p.entries.map((e) => e.clientName)).toEqual(['泉', '青葉']);
    expect(p.off).toEqual([]);
    const all = printDay(d, DATE, null);
    expect(all.off).toEqual([{ staffId: 's2', name: '佐藤 一', label: '佐藤', kind: 'requested' }]);
    expect(printDay(d, DATE, 's2').off).toEqual([{ staffId: 's2', name: '佐藤 一', label: '佐藤', kind: 'requested' }]);
  });

  it('〈利用者さん〉の休みの訪問は一覧に出さず「休み」に名前。勤務の無い〈スタッフ〉も休みに出す', () => {
    const d = data({
      aiPlans: { [DATE]: plan({ s1: ['v2', 'v1'], s2: ['v3'] }) },
      clientLeaves: [{ id: 'l1', clientId: 'c1', from: DATE, to: DATE, note: '入院' }],
      availability: [{ staffId: 's2', date: DATE, slots: [] }],
    });
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
  it('案も確定も無い日は、〈スタッフ〉で絞っても担当の決まっていない件数（pending）が分かる', () => {
    const d = data();
    expect(printDay(d, DATE, 's1')).toMatchObject({ source: null, entries: [], pending: 3 });
    const p = printDay({ ...d, aiPlans: { [DATE]: plan({ s1: ['v2'] }) } }, DATE, 's1');
    expect(p.source).toBe('plan');
    expect(p.pending).toBe(2);
  });

  it('確定した割当が取り消し・休み・休止の〈利用者さん〉の訪問だけなら、確定とみなさない（今の案を使う）', () => {
    const base = data({
      visits: [...data().visits.slice(0, 2), visit('v3', 'c3', '11:00', '11:00', { cancelled: true })],
      aiPlans: { [DATE]: plan({ s1: ['v2', 'v1'] }) },
    });
    // 取り消しの訪問だけ
    expect(printDay({ ...base, manualPlans: { [DATE]: { s2: ['v3'] } } }, DATE, null).source).toBe('plan');
    // 休みの訪問だけ
    const leave = { ...base, clientLeaves: [{ id: 'l', clientId: 'c1', from: DATE, to: DATE, note: '' }] };
    expect(printDay({ ...leave, manualPlans: { [DATE]: { s2: ['v1'] } } }, DATE, null).source).toBe('plan');
    // 休止の〈利用者さん〉の訪問だけ
    const inactive = { ...base, clients: base.clients.map((c) => (c.id === 'c2' ? { ...c, active: false } : c)) };
    expect(printDay({ ...inactive, manualPlans: { [DATE]: { s2: ['v2'] } } }, DATE, null).source).toBe('plan');
    // 今ある訪問があれば確定
    expect(printDay({ ...base, manualPlans: { [DATE]: { s2: ['v2'] } } }, DATE, null).source).toBe('confirmed');
  });

  it('名字が重なる人はフルネーム、重ならない人は名字', () => {
    const labels = staffLabels([
      { id: 'a', name: '山田 花', active: true },
      { id: 'b', name: '山田 一', active: true },
      { id: 'c', name: '佐藤 次郎', active: true },
      { id: 'd', name: '佐藤 休', active: false },
    ]);
    expect([...labels.values()]).toEqual(['山田 花', '山田 一', '佐藤', '佐藤']);
    const d = data({
      staff: [staff('s1', 38.26, 140.87, { name: '山田 花' }), staff('s2', 38.27, 140.88, { name: '山田 一' })],
      aiPlans: { [DATE]: plan({ s1: ['v2'], s2: ['v1'] }) },
    });
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
