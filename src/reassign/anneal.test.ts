// 欠勤の振り直しの2回目（案B「少し動かしてよい」・連絡の一覧。PRD D34・D35。ADR-0011 追記）
import { describe, expect, it } from 'vitest';
import type { Absence } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import { addDays } from '../domain/time';
import { score } from '../evaluate';
import { compile, routeCost, scheduleRoute } from '../matching';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { createDemoData } from '../seed';
import { solve } from '../solver';
import {
  annealCost,
  contactsOf,
  finishAnneal,
  prepareAnneal,
  type Routes,
  reassign,
  reassignDiff,
  STAY_WEIGHT_DEFAULT,
  settleAnneal,
  stayPointsOf,
  targetsOf,
} from './index';

const ITER = 60_000;
const absence = (staffId: string, date: string, from: string | null = null, to: string | null = null): Absence => ({
  id: `a-${staffId}-${date}`,
  staffId,
  date,
  from,
  to,
  note: '',
});

/** 列ごとの lenient の開始（訪問ID → { 担当, 開始 }） */
function startsOf(p: Problem, routes: Routes) {
  const vIndex = new Map(p.visits.map((v, i) => [v.id, i]));
  const out = new Map<string, { staffId: string; start: number }>();
  p.staff.forEach((st, s) => {
    const seq = (routes[st.id] ?? []).map((id) => vIndex.get(id)).filter((x): x is number => x !== undefined);
    for (const stop of scheduleRoute(p, s, seq, 'lenient')!.stops)
      out.set(stop.visitId, { staffId: st.id, start: stop.start });
  });
  return out;
}

type Case = {
  date: string;
  staffId: string;
  plain: Problem;
  p: Problem;
  base: Routes;
  a: ReturnType<typeof reassign>;
  targets: ReturnType<typeof targetsOf>;
  now: number | null;
};

/** seed の日・スタッフの終日の欠勤で、案A に入らない訪問が出る組を順に（決定的）max 件 */
function cases(max: number, now: number | null = null): Case[] {
  const today = '2026-10-12';
  const data = createDemoData(today);
  const out: Case[] = [];
  for (let k = 0; k < 14 && out.length < max; k++) {
    const date = addDays(today, k);
    const plain = compile(data, date);
    const base = solve(plain, { seed: data.seed, iterations: ITER }).routes;
    for (const st of plain.staff) {
      if (out.length >= max) break;
      if ((base[st.id] ?? []).length === 0) continue;
      const p = compile({ ...data, absences: [absence(st.id, date)] }, date);
      const targets = targetsOf(p, { problem: plain, routes: base }, [st.id], now);
      const a = reassign(p, base, targets, { now });
      if (a.unplaced.length > 0) out.push({ date, staffId: st.id, plain, p, base, a, targets, now });
    }
  }
  return out;
}

function runB(c: Case, weight: number, seed = 7) {
  const prep = prepareAnneal(c.p, { problem: c.plain, routes: c.base }, c.a.routes, c.targets, { now: c.now, weight });
  const solved = solve(prep.problem, { seed, iterations: ITER, initial: prep.initial });
  return { prep, solved, result: finishAnneal(prep, solved.routes) };
}

/** 元の案から変わった数（担当が変わった訪問＋開始が変わった訪問） */
function changes(c: Case, routes: Routes): number {
  const d = reassignDiff({ problem: c.plain, routes: c.base }, { problem: c.p, routes });
  return d.moved.length + d.shifted.length;
}

describe('案B（prepareAnneal・finishAnneal・annealCost）', () => {
  const list = cases(4);
  it('seed に、案A で入らない訪問が出る組がある', () => {
    expect(list.length).toBeGreaterThan(0);
  });

  it('案B は案A より悪くならない（費用＋変更の減点）。入らない訪問は増えない（訪問ID の集合で ⊆）', () => {
    for (const c of list) {
      const { prep, solved, result } = runB(c, STAY_WEIGHT_DEFAULT);
      const costA = annealCost(prep.problem, prep.initial);
      expect(Number.isFinite(costA)).toBe(true);
      expect(annealCost(prep.problem, solved.routes)).toBeLessThanOrEqual(costA + 1e-6);
      expect(result.unplaced.length).toBeLessThanOrEqual(c.a.unplaced.length);
      const unA = new Set(c.a.unplaced);
      expect(result.unplaced.filter((id) => !unA.has(id))).toEqual([]);
      // 結果はいまの問題（stay なし）で可・strict
      const vIndex = new Map(c.p.visits.map((v, i) => [v.id, i]));
      c.p.staff.forEach((st, s) => {
        const seq = (result.routes[st.id] ?? []).map((id) => vIndex.get(id)!);
        for (const v of seq) expect(c.p.allowed[v]![s]).toBe(true);
        expect(scheduleRoute(c.p, s, seq, 'strict')).not.toBeNull();
      });
      // 全訪問を固定・振り直す訪問は placed か unplaced
      expect(Object.keys(result.pins).length).toBe(Object.values(result.routes).flat().length);
      expect(result.placed.length + result.unplaced.length).toBe(c.targets.length);
    }
  });

  it('変更の減点は採点（evaluate.score）に入れない：SolveResult.score はいまの問題の score と一致する', () => {
    const c = list[0]!;
    const { solved, prep } = runB(c, 5);
    expect(solved.score).toBeCloseTo(score(c.p, solved.routes).total, 6);
    expect(score(prep.problem, solved.routes).total).toBeCloseTo(solved.score, 6);
  });

  it('同じ入力・同じ種で同じ結果（決定的）', () => {
    const c = list[0]!;
    expect(runB(c, 3).result).toEqual(runB(c, 3).result);
  });

  it('減点を大きくすると変更が減る（重み0より重み5の方が、元の案から変わる訪問が少ない）', () => {
    let loose = 0;
    let strict = 0;
    for (const c of list) {
      const a = changes(c, runB(c, 0).result.routes);
      const b = changes(c, runB(c, 5).result.routes);
      expect(b).toBeLessThanOrEqual(a);
      loose += a;
      strict += b;
    }
    expect(strict).toBeLessThan(loose);
  });

  it('いまの時刻より前に始まる訪問は動かさない（担当・開始とも）。ほかの訪問はいまの時刻より前に始めない', () => {
    const now = 11 * 60;
    const withNow = cases(3, now);
    expect(withNow.length).toBeGreaterThan(0);
    let frozen = 0;
    for (const c of withNow) {
      const { result } = runB(c, 1);
      const a = startsOf(c.p, c.a.routes);
      const b = startsOf(c.p, result.routes);
      for (const [id, x] of a) {
        const v = c.p.visits.find((pv) => pv.id === id)!;
        if (v.earliest < now) {
          frozen++;
          expect(b.get(id)?.staffId).toBe(x.staffId);
          expect(b.get(id)!.start).toBeCloseTo(x.start, 6);
        } else if (b.get(id)) {
          expect(b.get(id)!.start).toBeGreaterThanOrEqual(now - 1e-6);
        }
      }
    }
    expect(frozen).toBeGreaterThan(0);
  });
});

describe('案B は案A に入っていた訪問を落とさない（keep。ADR-0011 追記）', () => {
  it('seed の14日×全スタッフの終日の欠勤で、案B の入らない訪問（訪問ID）⊆ 案A の入らない訪問。保険（settleAnneal）で案A のままにすることもない（修正前の入れ替えは重み0の 10/17 s3 で出る）', () => {
    const today = '2026-10-12';
    const data = createDemoData(today);
    let n = 0;
    let improved = 0;
    for (let k = 0; k < 14; k++) {
      const date = addDays(today, k);
      const plain = compile(data, date);
      const base = solve(plain, { seed: data.seed, iterations: 60_000 }).routes;
      const before = { problem: plain, routes: base };
      for (const st of plain.staff) {
        if ((base[st.id] ?? []).length === 0) continue;
        n++;
        const p = compile({ ...data, absences: [absence(st.id, date)] }, date);
        const targets = targetsOf(p, before, [st.id], null);
        const a = reassign(p, base, targets, { now: null });
        const ua = new Set(reassignDiff(before, { problem: p, routes: a.routes }).unplaced);
        // 重み0（変更を気にしない）で入れ替えが起きやすい。既定の重みでも見る
        for (const weight of [0, STAY_WEIGHT_DEFAULT]) {
          const prep = prepareAnneal(p, before, a.routes, targets, { now: null, weight });
          const solved = solve(prep.problem, { seed: 7, iterations: 20_000, initial: prep.initial });
          const settled = settleAnneal(prep, solved.routes);
          expect(settled.ok, `${date} ${st.id} 重み${weight}`).toBe(true);
          const ub = reassignDiff(before, { problem: p, routes: settled.result.routes }).unplaced;
          expect(
            ub.filter((id) => !ua.has(id)),
            `${date} ${st.id} 重み${weight}`,
          ).toEqual([]);
          if (weight > 0 && ub.length < ua.size) improved++;
        }
      }
    }
    expect(n).toBeGreaterThan(50);
    expect(improved).toBeGreaterThan(0);
  }, 30_000);

  it('keep は案A（初期解）に入っていて振り直す訪問でない訪問。落とした点は DROP_POINTS の10倍（annealCost）', () => {
    const c = cases(1)[0]!;
    const { prep } = runB(c, STAY_WEIGHT_DEFAULT);
    const keep = prep.problem.stay!.keep;
    const inA = new Set(Object.values(prep.initial).flat());
    const targets = new Set(prep.targets);
    prep.problem.visits.forEach((v, i) => {
      expect(keep[i], v.id).toBe(inA.has(v.id) && !targets.has(v.id));
    });
    const kept = prep.problem.visits.find((_, i) => keep[i])!.id;
    const without = Object.fromEntries(
      Object.entries(prep.initial).map(([k, ids]) => [k, ids.filter((x) => x !== kept)]),
    );
    const costA = annealCost(prep.problem, prep.initial);
    // 1件落とすと、列の費用は減るが、落とした点 100000 が足される
    expect(annealCost(prep.problem, without) - costA).toBeGreaterThan(90_000);
  });
});

describe('settleAnneal（保険：案A のままにする）', () => {
  const list = cases(2);
  it('案B が案A に入っていた訪問を落としていれば keepDropped で案A を返す', () => {
    const c = list[0]!;
    const { prep } = runB(c, STAY_WEIGHT_DEFAULT);
    const keepId = prep.problem.visits.find((_, i) => prep.problem.stay!.keep[i])!.id;
    const dropped = Object.fromEntries(
      Object.entries(prep.initial).map(([k, ids]) => [k, ids.filter((x) => x !== keepId)]),
    );
    const s = settleAnneal(prep, dropped);
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('keepDropped');
    expect(s.visitIds).toEqual([keepId]);
    expect(s.result).toEqual(finishAnneal(prep, prep.initial));
  });
  it('案B の費用が案A より高ければ notBetter で案A を返す', () => {
    // 案A で入った振り直す訪問を外す（keep ではないが、入らない点だけ高くなる）
    const c = list.find((x) => x.a.placed.length > 0)!;
    const { prep } = runB(c, STAY_WEIGHT_DEFAULT);
    const placed = c.a.placed[0]!.visitId;
    const worse = Object.fromEntries(
      Object.entries(prep.initial).map(([k, ids]) => [k, ids.filter((x) => x !== placed)]),
    );
    const s = settleAnneal(prep, worse);
    expect(s).toMatchObject({ ok: false, reason: 'notBetter' });
    expect(s.result).toEqual(finishAnneal(prep, prep.initial));
  });
  it('初期解（案A）が strict で回れず solver が捨てたときは notBetter（案A を超えたと言わない）', () => {
    const c = list[0]!;
    const { prep } = runB(c, STAY_WEIGHT_DEFAULT);
    // 計算中にデータが変わった代わりに、案A の列の訪問の時間の約束を回れない時刻にする
    const sid = Object.keys(prep.initial).find((k) => (prep.initial[k] ?? []).length >= 2)!;
    const [first, second] = prep.initial[sid]!;
    const vi = prep.problem.visits.findIndex((v) => v.id === second);
    const fi = prep.problem.visits.findIndex((v) => v.id === first);
    const at = prep.problem.visits[fi]!.earliest - 60;
    const visits = prep.problem.visits.map((v, i) => (i === vi ? { ...v, earliest: at, latest: at } : v));
    const broken = { ...prep, problem: { ...prep.problem, visits } };
    expect(annealCost(broken.problem, broken.initial)).toBe(Number.POSITIVE_INFINITY);
    const solved = solve(broken.problem, { seed: 7, iterations: 5_000, initial: broken.initial });
    const s = settleAnneal(broken, solved.routes);
    expect(s.ok).toBe(false);
    expect(s.result).toEqual(finishAnneal(broken, broken.initial));
  });
  it('良い案B はそのまま（ok。result は finishAnneal と同じ）', () => {
    const c = list[0]!;
    const { prep, solved, result } = runB(c, STAY_WEIGHT_DEFAULT);
    const s = settleAnneal(prep, solved.routes);
    expect(s).toMatchObject({ ok: true, reason: null });
    expect(s.result).toEqual(result);
  });
});

describe('stay（変更の減点）と routeCost', () => {
  const d = makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.262, 140.872)],
    clients: [client('c1', 38.261, 140.871)],
    visits: [visit('w1', 'c1', '09:00', '12:00')],
  });
  it('元の担当と違えば movePoints、開始のずれ1分ごとに minutePoints を足す（無ければ今までと同じ）', () => {
    const p = compile(d, DATE);
    const plain0 = routeCost(p, 0, [0]);
    const plain1 = routeCost(p, 1, [0]);
    const start = scheduleRoute(p, 0, [0], 'strict')!.stops[0]!.start;
    const stay = { staff: [0], start: [start - 30], keep: [false], ...stayPointsOf(3) };
    expect(stayPointsOf(3)).toEqual({ movePoints: 30, minutePoints: 0.6000000000000001 });
    const q: Problem = { ...p, stay };
    expect(routeCost(q, 0, [0])).toBeCloseTo(plain0 + 30 * stay.minutePoints, 6);
    const start1 = scheduleRoute(p, 1, [0], 'strict')!.stops[0]!.start;
    expect(routeCost(q, 1, [0])).toBeCloseTo(plain1 + 30 + Math.abs(start1 - (start - 30)) * stay.minutePoints, 6);
    expect(routeCost({ ...p, stay: { ...stay, staff: [null], start: [null] } }, 1, [0])).toBeCloseTo(plain1, 6);
  });
  it('重みは 0〜5 に収める', () => {
    expect(stayPointsOf(-1).movePoints).toBe(0);
    expect(stayPointsOf(9).movePoints).toBe(50);
  });
});

describe('contactsOf（連絡の一覧）', () => {
  const fixed = (id: string, c: string, at: string, minutes = 60) =>
    visit(id, c, at, at, { windowKind: 'fixed', durationMinutes: minutes });
  const d = makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.262, 140.872), staff('s3', 38.3, 140.95)],
    clients: [client('c1', 38.261, 140.871), client('c2', 38.262, 140.871), client('c3', 38.263, 140.871)],
    visits: [fixed('v1', 'c1', '09:00', 90), visit('w2', 'c2', '10:00', '12:00'), fixed('v3', 'c3', '14:00')],
  });
  it('担当が変わる訪問・開始が変わる訪問・スタッフごとの増える/外れる/開始が変わる訪問', () => {
    const p = compile(d, DATE);
    const before = { problem: p, routes: { s1: ['v1', 'v3'], s2: ['w2'], s3: [] } };
    // v1（9:00〜10:30）は s2 へ（w2 の前に入り、w2 は 10:00 から v1 のあとへずれる）、v3 は入らない
    const after = { problem: p, routes: { s1: [], s2: ['v1', 'w2'], s3: [] } };
    const list = contactsOf(before, after);
    const diff = reassignDiff(before, after);
    expect(list.staffChanged.map((x) => [x.visitId, x.fromStaffId, x.toStaffId])).toEqual([
      ['v1', 's1', 's2'],
      ['v3', 's1', null],
    ]);
    expect(list.timeChanged.map((x) => x.visitId)).toEqual(['w2']);
    expect(diff.shifted.map((x) => x.visitId)).toEqual(['w2']);
    expect(list.staff.find((x) => x.staffId === 's2')!.shifted.map((x) => x.visitId)).toEqual(['w2']);
    const s1 = list.staff.find((x) => x.staffId === 's1')!;
    const s2 = list.staff.find((x) => x.staffId === 's2')!;
    expect(s1.removed.map((x) => x.visitId)).toEqual(['v1', 'v3']);
    expect(s2.added.map((x) => x.visitId)).toEqual(['v1']);
    expect(list.staff.map((x) => x.staffId)).toEqual(diff.changedStaff);
    expect(list.staffChanged[0]).toMatchObject({ clientId: 'c1', fromStart: 540, toStart: 540 });
  });
  it('変わらなければ空', () => {
    const p = compile(d, DATE);
    const plan = { problem: p, routes: { s1: ['v1', 'v3'], s2: ['w2'] } };
    expect(contactsOf(plan, plan)).toEqual({ staffChanged: [], timeChanged: [], staff: [] });
  });
});
