// 希望休のまとめ入力（PRD D69。ADR-0014）
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Absence } from '../contracts/documents';
import { compile } from '../matching';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { attentionList, dayMarks, dayPlanOf, dayStatus, staffDay, staffMonth } from './month';
import {
  absentLeftOf,
  isRequestedOff,
  offDayState,
  REQUESTED_OFF_NOTE,
  requestedOffDates,
  toggleRequestedOff,
} from './requestedOff';

/** DATE は月曜。s1・s2 は平日勤務 */
const SAT = '2026-10-17';
const TUE = '2026-10-13';
const off = (id: string, staffId: string, date: string, over: Partial<Absence> = {}): Absence => ({
  id,
  staffId,
  date,
  from: null,
  to: null,
  note: REQUESTED_OFF_NOTE,
  ...over,
});

function data(over: Partial<DemoData> = {}): DemoData {
  return makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.27, 140.88)],
    clients: [client('c1', 38.265, 140.875)],
    visits: [visit('v1', 'c1', '10:00', '11:00')],
    ...over,
  });
}

describe('希望休の判定と付け外し', () => {
  it('終日でメモが「希望休」なら希望休。時間帯の欠勤・別のメモはふつうの欠勤', () => {
    expect(isRequestedOff(off('a', 's1', DATE))).toBe(true);
    expect(isRequestedOff(off('a', 's1', DATE, { from: '09:00' }))).toBe(false);
    expect(isRequestedOff(off('a', 's1', DATE, { note: '通院' }))).toBe(false);
  });

  it('マスの扱い：今日より前・勤務の無い日・ほかの欠勤は押せない。勤務日は入れる、希望休は外す', () => {
    const d = data({ absences: [off('a1', 's1', TUE), off('a2', 's2', TUE, { note: '通院' })] });
    expect(offDayState(d, 's1', DATE, TUE)).toBe('past');
    expect(offDayState(d, 's1', SAT, DATE)).toBe('noShift');
    expect(offDayState(d, 's1', TUE, DATE)).toBe('requested');
    expect(offDayState(d, 's2', TUE, DATE)).toBe('absent');
    expect(offDayState(d, 's2', DATE, DATE)).toBe('open');
    // 稼働時間の上書きで休みにした日も押せない
    const o = data({ availability: [{ staffId: 's1', date: DATE, slots: [] }] });
    expect(offDayState(o, 's1', DATE, DATE)).toBe('noShift');
  });

  it('続けて押すと入れる → 外す。押せない日は変えない。今の案・確定した割当は変えない', () => {
    const plan = { s1: ['v1'] };
    let d = data({ manualPlans: { [DATE]: plan } });
    const a = toggleRequestedOff(d, 's1', DATE, DATE, 'x1');
    expect(a.result).toBe('added');
    expect(a.data.absences).toEqual([off('x1', 's1', DATE)]);
    expect(a.data.manualPlans).toEqual(d.manualPlans);
    d = a.data;
    const b = toggleRequestedOff(d, 's1', TUE, DATE, 'x2').data;
    expect(requestedOffDates(b, 's1', '2026-10')).toEqual([DATE, TUE]);
    const c = toggleRequestedOff(b, 's1', DATE, DATE, 'x3');
    expect(c.result).toBe('removed');
    expect(requestedOffDates(c.data, 's1', '2026-10')).toEqual([TUE]);
    const n = toggleRequestedOff(c.data, 's1', SAT, DATE, 'x4');
    expect(n.result).toBe('unchanged');
    expect(n.data).toBe(c.data);
  });
});

describe('休みの人に残る訪問（absentLeftOf）と月の印', () => {
  it('希望休の人に案の訪問が残れば数える。時間帯の欠勤は重なる訪問だけ', () => {
    const d = data({ absences: [off('a1', 's1', DATE)] });
    const p = compile(d, DATE);
    expect(absentLeftOf(p, { s1: ['v1'], s2: [] })).toBe(1);
    expect(absentLeftOf(p, { s1: [], s2: ['v1'] })).toBe(0);
    expect(absentLeftOf(p, { s1: ['v1'] }, 's2')).toBe(0);
    const late = data({ absences: [off('a1', 's1', DATE, { from: '13:00', note: '' })] });
    expect(absentLeftOf(compile(late, DATE), { s1: ['v1'] })).toBe(0);
    const early = data({ absences: [off('a1', 's1', DATE, { to: '12:00', note: '' })] });
    expect(absentLeftOf(compile(early, DATE), { s1: ['v1'] })).toBe(1);
  });

  it('dayStatus：残る訪問があれば手当てが必要。案の無い日は数えない', () => {
    const d = data({ absences: [off('a1', 's1', DATE)], manualPlans: { [DATE]: { s1: ['v1'] } } });
    const s = dayStatus(d, DATE, { absentLeft: 1 });
    expect(s.absentLeft).toBe(1);
    expect(s.needsCare).toBe(true);
    expect(dayStatus(data(), DATE, { absentLeft: 1 }).absentLeft).toBe(0);
  });

  it('dayMarks：希望休の人は requested に（欠勤 absent には入れない）', () => {
    const d = data({ absences: [off('a1', 's1', DATE), off('a2', 's2', DATE, { note: '通院' })] });
    const m = dayMarks(d, DATE);
    expect(m.requested).toEqual(['s1']);
    expect(m.absent).toEqual(['s2']);
    expect(m.off).toEqual([]);
  });

  it('要対応：希望休だけの日は出さない。休みの人に訪問が残る日は出す', () => {
    const d = data({ absences: [off('a1', 's1', DATE), off('a2', 's2', TUE, { note: '通院' })] });
    const st = (date: string, absentLeft: number) => ({ ...dayStatus(d, date), absentLeft });
    const list = attentionList(d, [st(DATE, 0), st(TUE, 0)], DATE);
    expect(list.map((a) => [a.date, a.kind])).toEqual([[TUE, 'absence']]);
    const left = attentionList(d, [st(DATE, 2)], DATE);
    expect(left.map((a) => [a.kind, a.count])).toEqual([['absentLeft', 2]]);
  });

  it('staffDay・staffMonth：希望休は requested、残る訪問の数、月の希望休の日数（欠勤と分ける）', () => {
    const d = data({
      absences: [off('a1', 's1', DATE), off('a2', 's1', TUE, { note: '通院', from: '15:00' })],
      manualPlans: { [DATE]: { s1: ['v1'] } },
    });
    const day = staffDay(d, dayPlanOf(d, DATE), 's1');
    expect(day.requested).toBe(true);
    expect(day.absentLeft).toBe(1);
    const tue = staffDay(d, dayPlanOf(d, TUE), 's1');
    expect(tue.requested).toBe(false);
    const m = staffMonth(d, [dayPlanOf(d, DATE), dayPlanOf(d, TUE)], 's1');
    expect([m.requestedDays, m.absenceDays]).toEqual([1, 1]);
  });
});
