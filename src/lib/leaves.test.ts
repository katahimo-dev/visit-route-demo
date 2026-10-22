// 〈利用者さん〉の休み（PRD D65。ADR-0013）の画面の純粋関数と、休みの訪問の扱い（compile・月・週・コピー）
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { ClientLeave, Visit } from '../contracts/documents';
import { addDays } from '../domain/time';
import { compile } from '../matching';
import { client, DATE, makeData, problemKey, staff, visit } from '../matching/fixtures';
import { leaveConfirmedDates, leavesOf, leaveVisits, leaveVisitsOn, removeLeave, saveLeave } from './leaves';
import { activeVisitsOn, batchTargets, clientDay, clientMonth, dayMarks, dayPlanOf, dayStatus } from './month';
import { weekDay } from './week';

const TUE = addDays(DATE, 1);
const WED = addDays(DATE, 2);
const on = (id: string, c: string, date: string, at = '10:00', over: Partial<Visit> = {}): Visit =>
  visit(id, c, at, at, { date, windowKind: 'fixed', ...over });
const L1: ClientLeave = { id: 'l1', clientId: 'c1', from: DATE, to: TUE, note: '入院' };

function data(over: Partial<DemoData> = {}): DemoData {
  return makeData({
    staff: [staff('s1', 38.26, 140.87)],
    clients: [client('c1', 38.261, 140.871), client('c2', 38.262, 140.871)],
    visits: [
      on('a1', 'c1', DATE, '10:00'),
      on('a2', 'c2', DATE, '13:00'),
      on('b1', 'c1', TUE, '10:00'),
      on('c1x', 'c1', WED, '10:00'),
      on('x1', 'c1', TUE, '15:00', { cancelled: true }),
    ],
    ...over,
  });
}

describe('lib/leaves', () => {
  it('leavesOf は開始日の順。saveLeave は同じ ID を置き換え、removeLeave は消す（訪問は変えない）', () => {
    const later: ClientLeave = { id: 'l2', clientId: 'c1', from: WED, to: WED, note: '' };
    let d = saveLeave(saveLeave(data(), later), L1);
    expect(leavesOf(d, 'c1').map((l) => l.id)).toEqual(['l1', 'l2']);
    d = saveLeave(d, { ...L1, note: 'ショートステイ' });
    expect(d.clientLeaves).toHaveLength(2);
    expect(leavesOf(d, 'c1')[0]!.note).toBe('ショートステイ');
    const r = removeLeave(d, 'l1');
    expect(r.clientLeaves.map((l) => l.id)).toEqual(['l2']);
    expect(r.visits).toBe(d.visits);
  });

  it('leaveVisits・leaveVisitsOn：期間の、その〈利用者さん〉の取り消しでない訪問だけ', () => {
    const d = data({ clientLeaves: [L1] });
    expect(leaveVisits(d, L1).map((v) => v.id)).toEqual(['a1', 'b1']);
    expect(leaveVisitsOn(d, TUE).map((x) => [x.visit.id, x.leave.id])).toEqual([['b1', 'l1']]);
    expect(leaveVisitsOn(d, WED)).toEqual([]);
  });

  it('leaveConfirmedDates：伝えた内容にその〈利用者さん〉の担当のある訪問がある日だけ（担当なしは数えない）', () => {
    const snap = (date: string, visits: { id: string; clientId: string; staffId: string | null }[]) => ({
      date,
      at: 1,
      visits: visits.map((v) => ({ ...v, start: v.staffId ? '10:00' : null })),
    });
    const d = data({
      snapshots: {
        [DATE]: snap(DATE, [
          { id: 'a1', clientId: 'c1', staffId: 's1' },
          { id: 'a2', clientId: 'c2', staffId: 's1' },
        ]),
        [TUE]: snap(TUE, [{ id: 'b1', clientId: 'c1', staffId: null }]),
        [WED]: snap(WED, [{ id: 'c1x', clientId: 'c1', staffId: 's1' }]),
      },
    });
    expect(leaveConfirmedDates(d, L1)).toEqual([DATE]);
    expect(leaveConfirmedDates(d, { ...L1, to: WED })).toEqual([DATE, WED]);
    expect(leaveConfirmedDates(d, { ...L1, clientId: 'c2' })).toEqual([DATE]);
  });
});

describe('休みの訪問は派生で外す（ADR-0013）', () => {
  it('compile は休みの〈利用者さん〉の訪問を問題に入れない。休みを消すと戻り、休みの無い日の問題は同じ', () => {
    const d = data({ clientLeaves: [L1] });
    expect(compile(d, DATE).visits.map((v) => v.id)).toEqual(['a2']);
    expect(compile(d, TUE).visits).toEqual([]);
    expect(compile(removeLeave(d, 'l1'), DATE).visits.map((v) => v.id)).toEqual(['a1', 'a2']);
    expect(problemKey(compile(d, WED))).toBe(problemKey(compile(data(), WED)));
  });

  it('月：件数・AI で組む対象から外し、日のマスに休みの〈利用者さん〉を出す。選んだ〈利用者さん〉は休みの印', () => {
    const d = data({ clientLeaves: [L1] });
    expect(activeVisitsOn(d, DATE).map((v) => v.id)).toEqual(['a2']);
    expect(dayStatus(d, DATE).count).toBe(1);
    expect(dayStatus(d, TUE).count).toBe(0);
    expect(dayMarks(d, DATE).leaves).toEqual(['c1']);
    expect(dayMarks(d, WED).leaves).toEqual([]);
    const all = (x: DemoData) => batchTargets(x, [DATE, TUE, WED], DATE, 'all', (t) => dayStatus(x, t));
    expect(all(d)).not.toContain(TUE);
    expect(all(data())).toContain(TUE);
    const day = clientDay(d, dayPlanOf(d, DATE), 'c1');
    expect(day.visits.map((v) => [v.visitId, v.leave, v.unassigned])).toEqual([['a1', true, false]]);
    const sum = clientMonth(d, [dayPlanOf(d, DATE), dayPlanOf(d, TUE), dayPlanOf(d, WED)], 'c1');
    expect(sum).toMatchObject({ planned: 1, leave: 2, cancelled: 1 });
  });

  it('週：休みの訪問は leave 付きの帯（担当なし・訪問の開始）', () => {
    const d = data({ clientLeaves: [L1] });
    const w = weekDay(d, DATE);
    expect(w.bands.map((b) => [b.visitId, b.leave ?? false, b.staffId])).toEqual([
      ['a1', true, null],
      ['a2', false, null],
    ]);
  });
});
