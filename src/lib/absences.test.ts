// 予定の画面の急な欠勤（ADR-0011）：lib/absences と lib/runs の追加分
import { describe, expect, it } from 'vitest';
import type { AiPlan, DemoData } from '../contracts/data';
import type { Absence } from '../contracts/documents';
import { compile } from '../matching';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { reassign, targetsOf } from '../reassign';
import {
  absenceError,
  absenceText,
  applyReassign,
  baseOf,
  defaultNow,
  removeAbsence,
  revertReassign,
  roundToHalfHour,
  saveAbsence,
} from './absences';
import { addRun, findRun, planOfRun, reusableRun } from './runs';

const fixed = (id: string, c: string, at: string) => visit(id, c, at, at, { windowKind: 'fixed' });
const ab = (id: string, staffId: string, from: string | null, to: string | null, date = DATE): Absence => ({
  id,
  staffId,
  date,
  from,
  to,
  note: '',
});

function data(over: Partial<DemoData> = {}): DemoData {
  return makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.262, 140.872)],
    clients: [client('c1', 38.261, 140.871), client('c2', 38.262, 140.871), client('c3', 38.263, 140.871)],
    visits: [fixed('v1', 'c1', '09:00'), fixed('v2', 'c2', '11:00'), fixed('v3', 'c3', '14:00')],
    ...over,
  });
}
const plan = (routes: Record<string, string[]>, pins: Record<string, string> = {}): AiPlan => ({
  date: DATE,
  createdAt: 1,
  seed: 1,
  iterations: 10,
  routes,
  unassigned: [],
  score: 0,
  stopped: false,
  rules: [],
  generated: { routes, unassigned: [], score: 0 },
  pins,
  runId: 'r1',
});

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
  it('取り消しても今の案は変えない', () => {
    const d = { ...data({ absences: [ab('a1', 's1', null, null)] }), aiPlans: { [DATE]: plan({ s2: ['v1'] }) } };
    expect(removeAbsence(d, 'a1').aiPlans).toBe(d.aiPlans);
  });
  it('表示・検査・丸め・いまの時刻', () => {
    expect(absenceText(ab('a', 's', null, null))).toBe('欠勤（終日）');
    expect(absenceText(ab('a', 's', '09:00', '12:00'))).toBe('欠勤 9:00〜12:00');
    expect(absenceText(ab('a', 's', '15:00', null))).toBe('欠勤 15:00〜');
    expect(absenceText(ab('a', 's', null, '12:00'), [{ start: '08:30', end: '16:30' }])).toBe('欠勤 8:30〜12:00');
    expect(absenceError(ab('a', 's', '12:00', '12:00'))).toBe('終了は開始より後にしてください');
    expect(absenceError(ab('a', 's', '10:15', null))).toBe('時間は30分単位で選んでください');
    expect(absenceError(ab('a', 's', null, '11:00'))).toBeNull();
    expect(roundToHalfHour('10:15')).toBe('10:30');
    expect(roundToHalfHour('10:14')).toBe('10:00');
    expect(defaultNow(DATE, DATE, '10:38')).toBe('10:35');
    expect(defaultNow(DATE, '2026-10-13', '10:38')).toBeNull();
  });
});

describe('元の案（baseOf）', () => {
  it('確定した割当があればそれ。各担当の訪問は今の案の列の順（今の案に無い訪問は開始の順に挟む）', () => {
    const d: DemoData = {
      ...data(),
      manualPlans: { [DATE]: { s1: ['v3', 'v1', 'v2'], __none: [] } },
      aiPlans: { [DATE]: plan({ s1: ['v3', 'v1'], s2: ['v2'] }, { v1: 's1' }) },
    };
    const p = compile(d, DATE);
    // 今の案の順（v3→v1）を保ち、v2（11:00）は開始がより遅い最初の訪問 v3（14:00）の前へ
    expect(baseOf(d, DATE, p)).toEqual({ routes: { s1: ['v2', 'v3', 'v1'] }, from: 'confirmed', pins: {} });
  });
  it('無ければ今の案（固定も）。どちらも無ければ null', () => {
    const d: DemoData = { ...data(), aiPlans: { [DATE]: plan({ s1: ['v1', 'gone'], s2: ['v2'] }, { v1: 's1' }) } };
    const p = compile(d, DATE);
    expect(baseOf(d, DATE, p)).toEqual({ routes: { s1: ['v1'], s2: ['v2'] }, from: 'plan', pins: { v1: 's1' } });
    expect(baseOf(data(), DATE, p)).toBeNull();
  });
});

describe('振り直した結果を書く・元の案に戻す', () => {
  const setup = () => {
    const d0: DemoData = { ...data(), aiPlans: { [DATE]: plan({ s1: ['v1', 'v2', 'v3'], s2: [] }, { v3: 's1' }) } };
    const d1 = saveAbsence(d0, ab('a1', 's1', null, '12:00'));
    const p = compile(d1, DATE);
    const base = baseOf(d1, DATE, p)!;
    const result = reassign(p, base.routes, targetsOf(p, base.routes, ['s1'], null), { now: null });
    const d2 = applyReassign(d1, DATE, {
      problem: p,
      result,
      base,
      absenceIds: ['a1'],
      now: null,
      label: '欠勤の振り直し（s1さん）',
      createdAt: 5,
    });
    return { d1, d2, p, result };
  };
  it('今の案を結果にし、全訪問を固定、記録に「欠勤の振り直し」を1件足す', () => {
    const { d2, result } = setup();
    const x = d2.aiPlans[DATE]!;
    expect(x.routes).toEqual(result.routes);
    expect(x.generated.routes).toEqual(result.routes);
    expect(x.pins).toEqual(result.pins);
    expect(x.reassign).toMatchObject({
      method: 'insert',
      from: 'plan',
      baseRoutes: { s1: ['v1', 'v2', 'v3'], s2: [] },
      basePins: { v3: 's1' },
      absenceIds: ['a1'],
      now: null,
    });
    const runs = d2.aiRuns[DATE]!;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ label: '欠勤の振り直し（s1さん）', reassign: x.reassign });
    expect(x.runId).toBe(runs[0]!.id);
    // 記録から開くと reassign も写る
    expect(planOfRun(runs[0]!).reassign).toEqual(x.reassign);
  });
  it('同じ結果なら記録は増えない。振り直しの記録は reusableRun に使わず、ふつうの記録とは別', () => {
    const { d1, d2, p, result } = setup();
    const again = applyReassign(d2, DATE, {
      problem: p,
      result,
      base: baseOf(d1, DATE, p)!,
      absenceIds: ['a1'],
      now: null,
      label: '欠勤の振り直し（s1さん）',
      createdAt: 6,
    });
    expect(again.aiRuns[DATE]).toHaveLength(1);
    const runs = again.aiRuns[DATE]!;
    expect(reusableRun(runs, p, d2.rules, d2.seed, runs[0]!.inputKey)).toBeUndefined();
    const solved = { routes: result.routes, unassigned: [], score: 0, seed: d2.seed, iterations: 0, stopped: false };
    expect(findRun(again, DATE, { rules: d2.rules, pins: result.pins, result: solved })).toBeUndefined();
    const plain = addRun(again, DATE, { rules: d2.rules, pins: result.pins, result: solved, createdAt: 7 });
    expect(plain.aiRuns[DATE]).toHaveLength(2);
  });
  it('元の案に戻すと、担当・固定が元に戻り reassign・runId が外れる。欠勤を取り消しても今の案は変わらない', () => {
    const { d2, p } = setup();
    const removed = removeAbsence(d2, 'a1');
    expect(removed.aiPlans[DATE]).toEqual(d2.aiPlans[DATE]);
    const back = revertReassign(removed, DATE, compile(removed, DATE));
    const x = back.aiPlans[DATE]!;
    expect(x.routes).toEqual({ s1: ['v1', 'v2', 'v3'], s2: [] });
    expect(x.generated.routes).toEqual(x.routes);
    expect(x.pins).toEqual({ v3: 's1' });
    expect(x.reassign).toBeUndefined();
    expect(x.runId).toBeUndefined();
    expect(revertReassign(back, DATE, p)).toBe(back);
  });
});
