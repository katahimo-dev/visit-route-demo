// 〈利用者さん〉の休み（PRD D65。ADR-0013）の画面の純粋関数と、休みの訪問の扱い（compile・月・週・コピー）
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { ClientLeave, Visit } from '../contracts/documents';
import { reconcile } from '../domain/scheduleModel';
import { addDays } from '../domain/time';
import { compile } from '../matching';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { copyDayVisits } from './copyDay';
import {
  keepLeaveVisits,
  leaveConfirmedDates,
  leavesOf,
  leaveVisits,
  leaveVisitsOn,
  removeLeave,
  saveLeave,
} from './leaves';
import { activeVisitsOn, batchTargets, clientDay, clientMonth, dayMarks, dayPlanOf, dayStatus } from './month';
import { problemKey } from './runs';
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

  it('leaveConfirmedDates：確定した割当にその〈利用者さん〉の訪問がある日だけ（未割当の列は数えない）', () => {
    const d = data({
      manualPlans: { [DATE]: { s1: ['a1', 'a2'] }, [TUE]: { __none: ['b1'] }, [WED]: { s1: ['c1x'] } },
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

  it('月：件数・まとめて作る対象から外し、日のマスに休みの〈利用者さん〉を出す。選んだ〈利用者さん〉は休みの印', () => {
    const d = data({ clientLeaves: [L1] });
    expect(activeVisitsOn(d, DATE).map((v) => v.id)).toEqual(['a2']);
    expect(dayStatus(d, DATE).count).toBe(1);
    expect(dayStatus(d, TUE).count).toBe(0);
    expect(dayMarks(d, DATE).leaves).toEqual(['c1']);
    expect(dayMarks(d, WED).leaves).toEqual([]);
    expect(batchTargets(d, DATE.slice(0, 7), DATE, 'empty')).not.toContain(TUE);
    expect(batchTargets(data(), DATE.slice(0, 7), DATE, 'empty')).toContain(TUE);
    const day = clientDay(d, dayPlanOf(d, DATE), 'c1');
    expect(day.visits.map((v) => [v.visitId, v.leave, v.unassigned])).toEqual([['a1', true, false]]);
    expect(day.noPlan).toBe(false);
    const sum = clientMonth(d, [dayPlanOf(d, DATE), dayPlanOf(d, TUE), dayPlanOf(d, WED)], 'c1');
    expect(sum).toMatchObject({ planned: 1, leave: 2, cancelled: 1 });
  });

  it('週：休みの訪問は leave 付きの帯（担当なし・訪問の開始）', () => {
    const d = data({ clientLeaves: [L1], aiPlans: {} });
    const w = weekDay(d, DATE);
    expect(w.bands.map((b) => [b.visitId, b.leave ?? false, b.staffId])).toEqual([
      ['a1', true, null],
      ['a2', false, null],
    ]);
  });

  it('前の同じ曜日からコピー：休みの訪問は写さない', () => {
    const d = data({ clientLeaves: [L1] });
    let n = 0;
    const c = copyDayVisits(d, DATE, addDays(DATE, 7), () => `new${++n}`);
    expect(c.visits.map((v) => v.clientId)).toEqual(['c2']);
  });
});

describe('確定し直すときの休みの訪問（ADR-0013）', () => {
  it('keepLeaveVisits：休みの訪問は前の確定した割当の担当のまま残し、休みを消すと元の確定に戻る（重ならない）', () => {
    // 前の確定：s1 に a1（のちに休み）・a2。休みのあとの今の案では a2 だけを s2 に確定し直す
    const before = { s1: ['a1', 'a2'] };
    const cols = keepLeaveVisits({ s2: ['a2'] }, ['a1'], before);
    expect(cols).toEqual({ s2: ['a2'], s1: ['a1'] });
    // 前の確定に無い休みの訪問・未割当だった休みの訪問は足さない
    expect(keepLeaveVisits({ s2: ['a2'] }, ['zz'], before)).toEqual({ s2: ['a2'] });
    expect(keepLeaveVisits({ s2: ['a2'] }, ['a1'], { __none: ['a1'] })).toEqual({ s2: ['a2'] });
    expect(keepLeaveVisits({ s2: ['a2'] }, ['a1'], undefined)).toEqual({ s2: ['a2'] });
    // 休みを消したあと：a1 は s1、a2 は s2（staffId が残っていても重ならない）
    const d = data();
    const visits = d.visits
      .filter((v) => v.date === DATE)
      .map((v) => (v.id === 'a1' ? { ...v, staffId: 's1' } : { ...v, staffId: 's2' }));
    const view = reconcile(cols, visits, ['s1', 's2']);
    expect(view.cols.s1).toEqual(['a1']);
    expect(view.cols.s2).toEqual(['a2']);
  });
});
