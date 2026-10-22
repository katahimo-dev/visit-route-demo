// 予定の画面の急な欠勤（ADR-0011。版2は ADR-0053：振り直しは提案を当てる型）：lib/absences
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Absence } from '../contracts/documents';
import { compile } from '../matching';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { findVisit } from '../patterns';
import { reassign, targetsOf } from '../reassign';
import {
  absenceError,
  absenceText,
  applyReassign,
  baseOf,
  chooseReassign,
  removeAbsence,
  revertReassign,
  roundToHalfHour,
  saveAbsence,
  withoutAbsencesOn,
} from './absences';
import { dayRoutes, pinsOf } from './dayPlan';

const fixed = (id: string, c: string, at: string, over = {}) => visit(id, c, at, at, { windowKind: 'fixed', ...over });
const ab = (id: string, staffId: string, from: string | null, to: string | null, date = DATE): Absence => ({
  id,
  staffId,
  date,
  from,
  to,
  note: '',
});

/** s1 が3件（v3 はピン） */
function data(over: Partial<DemoData> = {}): DemoData {
  return makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.262, 140.872)],
    clients: [client('c1', 38.261, 140.871), client('c2', 38.262, 140.871), client('c3', 38.263, 140.871)],
    visits: [
      fixed('v1', 'c1', '09:00', { staffId: 's1' }),
      fixed('v2', 'c2', '11:00', { staffId: 's1' }),
      fixed('v3', 'c3', '14:00', { staffId: 's1', pinned: true }),
    ],
    ...over,
  });
}

describe('欠勤の保存・取り消し', () => {
  it('同じ人・同じ日の欠勤はその1件を置き換える（1人1日1件）', () => {
    const d0 = data();
    const d1 = saveAbsence(d0, ab('a1', 's1', null, null));
    const d2 = saveAbsence(d1, ab('a2', 's1', '09:00', '12:00'));
    expect(d2.absences).toEqual([ab('a2', 's1', '09:00', '12:00')]);
    const d3 = saveAbsence(d2, ab('a3', 's2', null, null));
    expect(d3.absences.map((a) => a.id)).toEqual(['a2', 'a3']);
    // 同じ ID を直す
    const d4 = saveAbsence(d3, { ...ab('a3', 's2', '15:00', null), note: '早退' });
    expect(d4.absences[1]).toMatchObject({ id: 'a3', from: '15:00', note: '早退' });
    expect(removeAbsence(d4, 'a2').absences.map((a) => a.id)).toEqual(['a3']);
  });
  it('取り消しても訪問の担当は変えない', () => {
    const d = data({ absences: [ab('a1', 's1', null, null)] });
    expect(removeAbsence(d, 'a1').visits).toBe(d.visits);
  });
  it('表示・検査・丸め', () => {
    expect(absenceText(ab('a', 's', null, null))).toBe('欠勤（終日）');
    expect(absenceText(ab('a', 's', '09:00', '12:00'))).toBe('欠勤 9:00〜12:00');
    expect(absenceText(ab('a', 's', '15:00', null))).toBe('欠勤 15:00〜');
    expect(absenceText(ab('a', 's', null, '12:00'), [{ start: '08:30', end: '16:30' }])).toBe('欠勤 8:30〜12:00');
    expect(absenceError(ab('a', 's', '12:00', '12:00'))).toBe('終了は開始より後にしてください');
    expect(absenceError(ab('a', 's', '10:15', null))).toBe('時間は30分単位で選んでください');
    expect(absenceError(ab('a', 's', null, '11:00'))).toBeNull();
    expect(roundToHalfHour('10:15')).toBe('10:30');
    expect(roundToHalfHour('10:14')).toBe('10:00');
  });
});

describe('元の案（baseOf）', () => {
  it('その日の担当の並び（訪問の担当・開始の順）とピン。問題に無い訪問は除く', () => {
    const d = data();
    const p = compile(d, DATE);
    expect(baseOf(d, DATE, p)).toEqual({ routes: { s1: ['v1', 'v2', 'v3'] }, pins: { v3: 's1' } });
  });
});

describe('振り直した結果を当てる・振り直す前に戻す（版2）', () => {
  const setup = () => {
    const d1 = saveAbsence(data(), ab('a1', 's1', null, '12:00'));
    const p = compile(d1, DATE);
    const base = baseOf(d1, DATE, p);
    const before = { problem: compile(withoutAbsencesOn(d1, DATE), DATE), routes: base.routes };
    const result = reassign(p, base.routes, targetsOf(p, before, ['s1']));
    const d2 = applyReassign(d1, DATE, { problem: p, result, base, absenceIds: ['a1'] });
    return { d1, d2, p, result };
  };
  it('結果を訪問の担当に書き、振り直しの情報（元の並び・ピン・案A・欠勤）を残す。担当が変わった訪問はピン', () => {
    const { d2, p, result } = setup();
    expect(dayRoutes(d2, DATE, p)).toEqual(
      Object.fromEntries(Object.entries(result.routes).filter(([, x]) => x.length > 0)),
    );
    expect(d2.reassigns[DATE]).toEqual({
      method: 'insert',
      insertRoutes: result.routes,
      baseRoutes: { s1: ['v1', 'v2', 'v3'] },
      basePins: { v3: 's1' },
      absenceIds: ['a1'],
    });
    const moved = ['v1', 'v2'].filter((id) => findVisit(d2, id)!.staffId !== 's1');
    expect(moved.length).toBeGreaterThan(0);
    for (const id of moved) expect(findVisit(d2, id)!.pinned).toBe(true);
    // 担当の変わらない元のピンは残す
    expect(pinsOf([findVisit(d2, 'v3')!])).toEqual({ v3: 's1' });
  });
  it('振り直す前に戻すと、担当・ピンが元に戻り振り直しの情報が消える。欠勤を取り消しても担当は変わらない', () => {
    const { d2, p } = setup();
    const removed = removeAbsence(d2, 'a1');
    expect(removed.visits).toBe(d2.visits);
    const back = revertReassign(removed, DATE, compile(removed, DATE));
    expect(['v1', 'v2', 'v3'].map((id) => findVisit(back, id)!.staffId)).toEqual(['s1', 's1', 's1']);
    expect(pinsOf(['v1', 'v2', 'v3'].map((id) => findVisit(back, id)!))).toEqual({ v3: 's1' });
    expect(back.reassigns).toEqual({});
    expect(revertReassign(back, DATE, p)).toBe(back);
  });
  it('続けて振り直すと、元の並びは最初のものを引き継ぎ欠勤は累積。戻すと最初の元の並びへ', () => {
    const { d2 } = setup();
    const d3 = saveAbsence(d2, ab('a2', 's2', null, null));
    const p3 = compile(d3, DATE);
    const base3 = baseOf(d3, DATE, p3);
    const before3 = { problem: compile(withoutAbsencesOn(d3, DATE), DATE), routes: base3.routes };
    const r3 = reassign(p3, base3.routes, targetsOf(p3, before3, ['s1', 's2']));
    const d4 = applyReassign(d3, DATE, { problem: p3, result: r3, base: base3, absenceIds: ['a2'] });
    expect(d4.reassigns[DATE]).toMatchObject({
      baseRoutes: { s1: ['v1', 'v2', 'v3'] },
      basePins: { v3: 's1' },
      absenceIds: ['a1', 'a2'],
    });
    const back = revertReassign(d4, DATE, p3);
    expect(['v1', 'v2', 'v3'].map((id) => findVisit(back, id)!.staffId)).toEqual(['s1', 's1', 's1']);
  });
  it('chooseReassign：案B を当てると method・stayWeight が変わり、元の並びの情報は引き継ぐ。案A に戻せる', () => {
    const { d2, p, result } = setup();
    const routesB = { s1: [], s2: ['v1', 'v2', 'v3'] };
    const b = { routes: routesB, placed: [], unplaced: [], unassigned: [], pins: {} };
    const d3 = chooseReassign(d2, DATE, { problem: p, result: b, method: 'anneal', stayWeight: 4 });
    expect(d3.reassigns[DATE]).toMatchObject({
      method: 'anneal',
      stayWeight: 4,
      baseRoutes: { s1: ['v1', 'v2', 'v3'] },
    });
    expect(findVisit(d3, 'v1')!.staffId).toBe('s2');
    const d4 = chooseReassign(d3, DATE, { problem: p, result, method: 'insert' });
    expect(d4.reassigns[DATE]!.method).toBe('insert');
    expect(d4.reassigns[DATE]!.stayWeight).toBeUndefined();
    // 振り直しのあとでなければ何もしない
    expect(chooseReassign(data(), DATE, { problem: p, result, method: 'insert' })).toEqual(data());
  });
});
