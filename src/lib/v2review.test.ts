// PR #80（版2）のレビューの直し（ADR-0053）：伝えた内容の ID の読み替え・since は今日から・全部取り消した日の未連絡の変更・
// 振り直す前に戻すときの足した訪問・繰り返しを直すときのピン・休止中の人の担当・終了した〈利用者さん〉の過去の回
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { addDays } from '../domain/time';
import { findVisit, putVisits, removePattern, splitPattern, visitsOn } from '../patterns';
import { createDemoData } from '../seed';
import { withSeedPlans } from '../seed/plans';
import { revertReassign } from './absences';
import { changeCount, dayProblemOf, dayRoutes, tellDay, toldChanges, writeRoutes } from './dayPlan';
import { dayStatus } from './month';
import { cancelVisitOp, endPatternOp } from './visitOps';

const TODAY = '2026-10-22';
const BASE = withSeedPlans(createDemoData(TODAY), TODAY, 3);
const base = (): DemoData => structuredClone(BASE);
const restOf = (d: DemoData, id: string) => {
  const { id: _i, from: _f, ...rest } = d.patterns.find((p) => p.id === id)!;
  return rest;
};

describe('伝えた内容と繰り返しを分けたとき（1）', () => {
  it('「これ以降」で分けて ID が変わっても、中身が同じなら未連絡の変更にしない', () => {
    const day = addDays(TODAY, 1);
    let d = tellDay(base(), day, dayProblemOf(base(), day)!, 1);
    const v = visitsOn(d, day).find((x) => x.pattern && x.staffId)!;
    const pid = v.pattern!.id;
    const r = splitPattern(d, pid, { ...restOf(d, pid), note: 'メモだけ' }, TODAY, TODAY, 'ptNEW');
    d = { ...d, patterns: r.patterns, visits: r.visits };
    const p = dayProblemOf(d, day)!;
    expect(p.visits.some((x) => x.id === `${v.pattern!.date}_ptNEW`)).toBe(true);
    expect(changeCount(toldChanges(d, day, p, dayRoutes(d, day, p)))).toBe(0);
    expect(dayStatus(d, day).state).toBe('told');
  });
});

describe('since は今日から（2）', () => {
  it('since が過去でも今日から分け、過去の日に同じ訪問を2件にしない', () => {
    const past = addDays(TODAY, -3);
    const d0 = base();
    const v = visitsOn(d0, past).find((x) => x.pattern)!;
    const d = { ...d0, visits: putVisits(d0.visits, [{ ...v, staffId: d0.staff[0]!.id, pinned: true }]) };
    const pid = v.pattern!.id;
    const r = splitPattern(d, pid, { ...restOf(d, pid), note: 'x' }, addDays(TODAY, -7), TODAY, 'ptPAST');
    const after = { ...d, patterns: r.patterns, visits: r.visits };
    expect(visitsOn(after, past).filter((x) => x.clientId === v.clientId)).toHaveLength(1);
    expect(r.patterns.find((p) => p.id === 'ptPAST')?.from).toBe(TODAY);
  });
});

describe('伝えた日の訪問を全部取り消す（3）', () => {
  it('問題が無くなっても、伝えた訪問は「外れる」の未連絡の変更', () => {
    let d = tellDay(base(), TODAY, dayProblemOf(base(), TODAY)!, 1);
    for (const v of visitsOn(d, TODAY)) d = cancelVisitOp(d, v.id, false);
    const s = dayStatus(d, TODAY, null);
    expect(s.state).toBe('changed');
    expect(s.changes).toBe(d.snapshots[TODAY]!.visits.filter((x) => x.staffId).length);
    expect(toldChanges(d, TODAY, null, {})!.staffChanged.every((x) => x.toStaffId === null)).toBe(true);
  });
});

describe('振り直す前に戻す（5）', () => {
  it('振り直したあとに足した・担当を当てた訪問は、今の担当のまま残す', () => {
    const d0 = base();
    const routes: Record<string, string[]> = {};
    for (const v of visitsOn(d0, TODAY)) if (v.staffId) routes[v.staffId] = [...(routes[v.staffId] ?? []), v.id];
    const sid = Object.keys(routes)[0]!;
    const v0 = visitsOn(d0, TODAY)[0]!;
    const nv = { ...v0, id: 'vNEW', pattern: null, staffId: sid, pinned: true, start: null };
    const d: DemoData = {
      ...d0,
      visits: [...d0.visits, nv],
      reassigns: { [TODAY]: { method: 'insert', baseRoutes: routes, basePins: {}, absenceIds: [] } },
    };
    const out = revertReassign(d, TODAY, dayProblemOf(d, TODAY)!);
    expect(findVisit(out, 'vNEW')).toMatchObject({ staffId: sid, pinned: true });
    expect(out.reassigns[TODAY]).toBeUndefined();
  });
});

describe('繰り返しを直す・消す・終わらせるときのピン（6）', () => {
  const pinned = () => {
    const d0 = base();
    const day = addDays(TODAY, 2);
    const v = visitsOn(d0, day).find((x) => x.pattern)!;
    const other = d0.staff.find((s) => s.id !== v.staffId && s.active)!.id;
    return { d: { ...d0, visits: putVisits(d0.visits, [{ ...v, staffId: other, pinned: true }]) }, v, other, day };
  };
  it('「これ以降」で分けても、ピンの回の担当は残る（新しい繰り返しの回になる）', () => {
    const { d, v, other, day } = pinned();
    const pid = v.pattern!.id;
    const r = splitPattern(d, pid, { ...restOf(d, pid), note: 'y' }, TODAY, TODAY, 'ptPIN');
    const after = { ...d, patterns: r.patterns, visits: r.visits };
    const x = visitsOn(after, day).find((y) => y.clientId === v.clientId && y.pattern?.date === v.pattern!.date)!;
    expect(x).toMatchObject({ id: `${v.pattern!.date}_ptPIN`, staffId: other, pinned: true });
  });
  it('消す・終わらせるときもピンの回は残す', () => {
    const { d, v, other } = pinned();
    const r = removePattern(d, v.pattern!.id, TODAY);
    expect(r.visits.find((x) => x.id === v.id)).toMatchObject({ staffId: other, pattern: null });
    const e = endPatternOp(d, v.pattern!.id, TODAY, TODAY);
    expect(e.data.visits.find((x) => x.id === v.id)).toMatchObject({ staffId: other, pinned: true });
  });
});

describe('列に入らない人の担当（任意）・終了した〈利用者さん〉の過去の回（任意）', () => {
  it('writeRoutes は休止中の人の訪問の担当を消さない', () => {
    const d0 = base();
    const v = visitsOn(d0, TODAY).find((x) => x.staffId)!;
    const d = { ...d0, staff: d0.staff.map((s) => (s.id === v.staffId ? { ...s, active: false } : s)) };
    const p = dayProblemOf(d, TODAY)!;
    const out = writeRoutes(d, TODAY, p, dayRoutes(d, TODAY, p));
    expect(findVisit(out, v.id)?.staffId).toBe(v.staffId);
  });
  it('終わった繰り返しは、〈利用者さん〉が利用中でなくても過去の回を出す', () => {
    const d0 = base();
    const past = addDays(TODAY, -2);
    const v = visitsOn(d0, past).find((x) => x.pattern)!;
    const ended = endPatternOp(d0, v.pattern!.id, addDays(TODAY, -1), TODAY).data;
    const d = {
      ...ended,
      clients: ended.clients.map((c) => (c.id === v.clientId ? { ...c, stage: 'ended' as const, active: false } : c)),
    };
    expect(visitsOn(d, past).some((x) => x.id === v.id)).toBe(true);
    expect(visitsOn(d, addDays(TODAY, 7)).some((x) => x.clientId === v.clientId && x.pattern)).toBe(false);
  });
});
