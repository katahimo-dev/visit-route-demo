// 欠勤の振り直し（ADR-0011。1回目＝案A「空き時間に入れるだけ」）。design.md §4 reassign・§5「欠勤と振り直し」。
// どれも純粋関数で決定的（乱数・Date.now を使わない。いまの時刻は引数）。DemoData は読まない・書かない
import type { Problem, Reason } from '../contracts/problem';
import type {
  CandidatesFor,
  PlaceVisit,
  Reassign,
  ReassignCandidate,
  ReassignDiff,
  ReassignDiffFn,
  ReassignPlan,
  ReassignResult,
  ReassignTarget,
  Routes,
  TargetsOf,
} from '../contracts/reassign';
import { balanceOff, bestInsertion, routeCost, scheduleRoute } from '../matching';

const INF = Number.POSITIVE_INFINITY;
const EPS = 1e-6;
/** 「ずらせば入る」を探す刻みと幅（分） */
const SHIFT_STEP = 5;
const SHIFT_MAX = 120;
/** ずらしても変わらない可否の原因（時刻に関わる原因だけはずらすと変わりうる） */
const TIME_RULES = new Set(['slot', 'time']);

export type {
  ReassignCandidate,
  ReassignDiff,
  ReassignOptions,
  ReassignPlan,
  ReassignResult,
  ReassignTarget,
  Routes,
} from '../contracts/reassign';

/** 自分のキーだけを読む（スタッフID が constructor などでも組み込みを拾わない） */
function colOf(routes: Routes, staffId: string): string[] {
  return Object.hasOwn(routes, staffId) ? (routes[staffId] ?? []) : [];
}

function indexOf(problem: Problem) {
  const vIndex = new Map(problem.visits.map((v, i) => [v.id, i]));
  const sIndex = new Map(problem.staff.map((s, i) => [s.id, i]));
  return { vIndex, sIndex };
}

/** 列の中の、問題にある訪問の添字 */
function knownOf(col: string[], vIndex: Map<string, number>): number[] {
  const out: number[] = [];
  for (const id of col) {
    const x = vIndex.get(id);
    if (x !== undefined) out.push(x);
  }
  return out;
}

type Pick = { v: number; s: number; fit: Fit; count: number; regret: number };

/** 入れる順：入れられる人の少ない訪問 → regret の大きい訪問 → earliest の早い訪問 → 問題の順。a が先なら負 */
function comparePick(problem: Problem, a: Pick, b: Pick): number {
  if (a.count !== b.count) return a.count - b.count;
  if (!(a.regret === INF && b.regret === INF)) {
    if (a.regret === INF) return -1;
    if (b.regret === INF) return 1;
    if (Math.abs(a.regret - b.regret) > EPS) return b.regret - a.regret;
  }
  const e = problem.visits[a.v]!.earliest - problem.visits[b.v]!.earliest;
  if (e !== 0) return e;
  return a.v - b.v;
}

/**
 * 始まった訪問（動かさない訪問）：時間の約束のいちばん早い開始がいまの時刻より前（2026-10-13 利用者が決定。
 * 始まっている訪問・終わった訪問）。いまの時刻が無ければ無い
 */
function started(problem: Problem, v: number, now: number | null): boolean {
  return now !== null && problem.visits[v]!.earliest < now - EPS;
}

/** 件数 count → count+1 にしたときの負担の均等の点の増分 */
function balanceDelta(problem: Problem, s: number, count: number): number {
  const b = problem.balance;
  if (!b) return 0;
  const a = balanceOff(b, s, count);
  const c = balanceOff(b, s, count + 1);
  return (c * c - a * a) * b.perVisit;
}

/** 件数の上限（必須の負担の均等）を超えるか */
function overCapOf(problem: Problem, s: number, count: number): boolean {
  const cap = problem.balance?.cap ?? null;
  return cap !== null && count + 1 > cap[s]!;
}

type Fit = { pos: number; addedCost: number; addedTravel: number };

/**
 * 担当 s の列 known に訪問 v を、すでにある訪問の開始時刻を変えずに strict で入れられる位置のうち、
 * 増える費用（移動＋待ち×係数＋割当費用＋負担の均等）が最も少ない位置（同じなら前の位置）。
 * 入れた訪問の開始はいまの時刻以降。無ければ null。可否・件数の上限は見ない（呼ぶ側で見る）
 */
function bestFit(problem: Problem, s: number, known: number[], v: number, now: number | null): Fit | null {
  const old = scheduleRoute(problem, s, known, 'strict');
  if (!old) return null;
  const oldCost = known.length === 0 ? 0 : routeCost(problem, s, known);
  const bal = balanceDelta(problem, s, known.length);
  let best: Fit | null = null;
  for (let p = 0; p <= known.length; p++) {
    const seq = [...known.slice(0, p), v, ...known.slice(p)];
    const t = scheduleRoute(problem, s, seq, 'strict');
    if (!t) continue;
    let same = true;
    for (let k = 0; k < known.length && same; k++) {
      const before = old.stops[k]!.start;
      const after = t.stops[k < p ? k : k + 1]!.start;
      if (Math.abs(before - after) > EPS) same = false;
    }
    if (!same) continue;
    if (now !== null && t.stops[p]!.start < now - EPS) continue;
    const added = routeCost(problem, s, seq) - oldCost + bal;
    if (!Number.isFinite(added)) continue;
    if (best === null || added < best.addedCost - EPS) {
      best = { pos: p, addedCost: added, addedTravel: t.travelMinutes - old.travelMinutes };
    }
  }
  return best;
}

/** 列 col の、問題にある訪問の pos 番目の直前（最後なら列の最後）に visitId を入れた列 */
function insertAt(col: string[], vIndex: Map<string, number>, pos: number, visitId: string): string[] {
  let seen = 0;
  for (let k = 0; k < col.length; k++) {
    if (!vIndex.has(col[k]!)) continue;
    if (seen === pos) return [...col.slice(0, k), visitId, ...col.slice(k)];
    seen++;
  }
  return [...col, visitId];
}

/** routes を写し、visitId をどの列からも抜く */
function without(routes: Routes, visitId: string): Routes {
  const out: Routes = {};
  for (const [k, ids] of Object.entries(routes)) out[k] = ids.filter((id) => id !== visitId);
  return out;
}

/** 分の区間 [start, end) が、どれか1つの時間帯の中に収まるか */
function within(slots: { start: number; end: number }[], start: number, end: number): boolean {
  return slots.some((x) => x.start <= start + EPS && end <= x.end + EPS);
}

/** 元の案の、その人の列の lenient の開始時刻（訪問ID → 開始）。問題にいない人なら空 */
function baseStarts(base: ReassignPlan, staffId: string): Map<string, number> {
  const { vIndex, sIndex } = indexOf(base.problem);
  const s = sIndex.get(staffId);
  const out = new Map<string, number>();
  if (s === undefined) return out;
  const t = scheduleRoute(base.problem, s, knownOf(colOf(base.routes, staffId), vIndex), 'lenient');
  for (const stop of t?.stops ?? []) out.set(stop.visitId, stop.start);
  return out;
}

/**
 * 振り直す訪問（design.md §4 reassign）：欠勤のある人の元の案の、始まっていない訪問のうち、
 * (a) 欠勤の時間と重なる訪問（元の案の時刻（base.problem での lenient）が欠勤を差し引く前の稼働時間帯に収まり、
 *     差し引いたあとには収まらない）と、欠勤のせいでその人に可にならない訪問（absence）、
 *     欠勤と関係なくその人に可にならない訪問（notAllowed。base.problem でも可にならない）、
 * (b) 残りを列の順に足していき、足すと strict で回れなくなる訪問（unreachable。この判定の列に始まった訪問は入れない）。
 * 時間に幅のある訪問も、元の案の時刻が欠勤と重なれば振り直す（欠勤の人のまま後ろへずらさない）
 */
export const targetsOf: TargetsOf = (problem, base, absentStaffIds, now) => {
  const { vIndex, sIndex } = indexOf(problem);
  const before = indexOf(base.problem);
  const out: ReassignTarget[] = [];
  const done = new Set<string>();
  for (const staffId of absentStaffIds) {
    const s = sIndex.get(staffId);
    if (s === undefined || done.has(staffId)) continue;
    done.add(staffId);
    const bs = before.sIndex.get(staffId);
    const baseSlots = bs === undefined ? [] : base.problem.staff[bs]!.slots;
    const slots = problem.staff[s]!.slots;
    const starts = baseStarts(base, staffId);
    const chain: number[] = [];
    for (const v of knownOf(colOf(base.routes, staffId), vIndex)) {
      if (started(problem, v, now)) continue;
      const pv = problem.visits[v]!;
      const visitId = pv.id;
      const bv = before.vIndex.get(visitId);
      const allowedBefore = bs !== undefined && bv !== undefined && base.problem.allowed[bv]![bs]!;
      const at = starts.get(visitId);
      const overlaps =
        at !== undefined && within(baseSlots, at, at + pv.duration) && !within(slots, at, at + pv.duration);
      if (!problem.allowed[v]![s]) {
        const slot = problem.reasons[v]![s]!.some((r) => r.points === INF && TIME_RULES.has(r.ruleId));
        out.push({ visitId, fromStaffId: staffId, reason: slot && allowedBefore ? 'absence' : 'notAllowed' });
        continue;
      }
      if (overlaps) {
        out.push({ visitId, fromStaffId: staffId, reason: 'absence' });
        continue;
      }
      const seq = [...chain, v];
      if (routeCost(problem, s, seq) === INF) {
        out.push({ visitId, fromStaffId: staffId, reason: 'unreachable' });
        continue;
      }
      chain.push(v);
    }
  }
  return out;
};

/**
 * 案A「空き時間に入れるだけ」：他の人の担当・順番・開始時刻を変えずに、振り直す訪問を1件ずつ入れる。
 * 入れる順は、入れられる人の少ない訪問から（同じなら regret の大きい訪問、それも同じなら earliest の早い順・問題の順）。
 * 位置は増える費用が最も少ない位置（同じなら staff の順で先の人・前の位置）
 */
export const reassign: Reassign = (problem, baseRoutes, targets, options) => {
  const { vIndex, sIndex } = indexOf(problem);
  const routes: Routes = {};
  for (const [k, ids] of Object.entries(baseRoutes)) routes[k] = [...ids];
  // 元の案のその人の列にある振り直す訪問だけを抜く（問題に無い・元の案に無いものは無視）
  const pending: number[] = [];
  for (const t of targets) {
    const v = vIndex.get(t.visitId);
    if (v === undefined || !sIndex.has(t.fromStaffId) || pending.includes(v)) continue;
    const col = colOf(routes, t.fromStaffId);
    if (!col.includes(t.visitId)) continue;
    routes[t.fromStaffId] = col.filter((id) => id !== t.visitId);
    pending.push(v);
  }

  const placed: ReassignResult['placed'] = [];
  const unplaced: string[] = [];
  const S = problem.staff.length;
  while (pending.length > 0) {
    const knowns = problem.staff.map((st) => knownOf(colOf(routes, st.id), vIndex));
    let pick: Pick | null = null;
    const stuck: number[] = [];
    for (const v of pending) {
      let count = 0;
      let first: { s: number; fit: Fit } | null = null;
      let second = INF;
      for (let s = 0; s < S; s++) {
        if (!problem.allowed[v]![s]) continue;
        const known = knowns[s]!;
        if (overCapOf(problem, s, known.length)) continue;
        const fit = bestFit(problem, s, known, v, options.now);
        if (!fit) continue;
        count++;
        if (first === null || fit.addedCost < first.fit.addedCost - EPS) {
          if (first) second = Math.min(second, first.fit.addedCost);
          first = { s, fit };
        } else {
          second = Math.min(second, fit.addedCost);
        }
      }
      if (!first) {
        stuck.push(v);
        continue;
      }
      const regret = second === INF ? INF : second - first.fit.addedCost;
      const cand: Pick = { v, s: first.s, fit: first.fit, count, regret };
      if (pick === null || comparePick(problem, cand, pick) < 0) pick = cand;
    }
    // 入れられる人がいない訪問は、ほかを入れても入るようにはならない（入れるほど狭くなる）
    for (const v of stuck) {
      pending.splice(pending.indexOf(v), 1);
      unplaced.push(problem.visits[v]!.id);
    }
    if (!pick) break;
    const staffId = problem.staff[pick.s]!.id;
    const visitId = problem.visits[pick.v]!.id;
    routes[staffId] = insertAt(colOf(routes, staffId), vIndex, pick.fit.pos, visitId);
    pending.splice(pending.indexOf(pick.v), 1);
    placed.push({ visitId, staffId, addedCost: pick.fit.addedCost, addedTravel: pick.fit.addedTravel });
  }
  // 入らなかった訪問は問題の順に
  unplaced.sort((a, b) => (vIndex.get(a) ?? 0) - (vIndex.get(b) ?? 0));

  const pins: Record<string, string> = {};
  const inRoute = new Set<string>();
  for (const st of problem.staff) {
    for (const id of colOf(routes, st.id)) {
      if (!vIndex.has(id)) continue;
      pins[id] = st.id;
      inRoute.add(id);
    }
  }
  const unassigned = problem.visits.map((v) => v.id).filter((id) => !inRoute.has(id));
  return { routes, placed, unplaced, unassigned, pins };
};

/** 訪問の時間の約束を d 分ずらした問題（ずらせば入るかを見る用。ほかは同じものを指す） */
function shifted(problem: Problem, v: number, d: number): Problem {
  const visits = problem.visits.slice();
  const pv = visits[v]!;
  visits[v] = { ...pv, earliest: pv.earliest + d, latest: pv.latest + d };
  return { ...problem, visits };
}

/** 「この人に入れる」の結果と、その人の既存の訪問への影響 */
type Placement = {
  routes: Routes;
  delayedCount: number;
  maxDelayMinutes: number;
  startsBeforeNow: boolean;
};

/**
 * 候補の人に入れる（placeVisit と候補の影響の見込み）。
 * 1. 他の訪問の開始を変えない strict の最良の位置（候補の「入る」と同じ。bestFit）
 * 2. 無ければ、いまの時刻より前の位置を除いて（始まった訪問より前には入れない・入れた訪問の開始がいまの時刻以降）、
 *    strict で回れる位置のうち費用（routeCost）の最も少ない位置、それも無ければ開始（earliest）の順の位置（lenient）。
 *    いまの時刻以降に入る位置が無ければ、始まった訪問より後ろの位置から選ぶ（startsBeforeNow）
 * 訪問の時刻（時間の約束）は変えない。影響は lenient の時刻で、既存の訪問の開始の遅れを数える
 */
function placement(problem: Problem, routes: Routes, visitId: string, staffId: string, now: number | null): Placement {
  const { vIndex, sIndex } = indexOf(problem);
  const v = vIndex.get(visitId);
  const s = sIndex.get(staffId);
  const rest = without(routes, visitId);
  const none = { delayedCount: 0, maxDelayMinutes: 0, startsBeforeNow: false };
  if (v === undefined || s === undefined) return { routes: bestInsertion(problem, rest, visitId, staffId), ...none };
  const col = colOf(rest, staffId);
  const known = knownOf(col, vIndex);
  const fit = bestFit(problem, s, known, v, now);
  if (fit) {
    rest[staffId] = insertAt(col, vIndex, fit.pos, visitId);
    return { routes: rest, ...none };
  }
  const old = scheduleRoute(problem, s, known, 'lenient');
  // 始まった訪問より前には入れない
  let pMin = 0;
  known.forEach((x, k) => {
    if (started(problem, x, now)) pMin = k + 1;
  });
  const tried: { p: number; t: NonNullable<ReturnType<typeof scheduleRoute>>; cost: number }[] = [];
  for (let p = pMin; p <= known.length; p++) {
    const seq = [...known.slice(0, p), v, ...known.slice(p)];
    const t = scheduleRoute(problem, s, seq, 'lenient');
    if (!t) continue;
    tried.push({ p, t, cost: routeCost(problem, s, seq) });
  }
  const afterNow = tried.filter((x) => now === null || x.t.stops[x.p]!.start >= now - EPS);
  const pool = afterNow.length > 0 ? afterNow : tried;
  let best: (typeof pool)[number] | undefined = pool[0];
  for (const x of pool) if (x.cost < (best?.cost ?? INF) - EPS) best = x;
  if (best && best.cost === INF) {
    // strict ではどこにも入らない：開始の順の位置（同じ時刻ならあと）に最も近い位置
    const e = problem.visits[v]!.earliest;
    let order = known.findIndex((x) => problem.visits[x]!.earliest > e);
    if (order < 0) order = known.length;
    best = pool.find((x) => x.p >= order) ?? pool.at(-1);
  }
  if (!best) return { routes: bestInsertion(problem, rest, visitId, staffId), ...none };
  const chosen = best;
  rest[staffId] = insertAt(col, vIndex, chosen.p, visitId);
  let delayedCount = 0;
  let maxDelay = 0;
  known.forEach((_, k) => {
    const a = old?.stops[k]?.start;
    const b = chosen.t.stops[k < chosen.p ? k : k + 1]?.start;
    if (a === undefined || b === undefined) return;
    const d = Math.round(b - a);
    if (d >= 1) {
      delayedCount++;
      maxDelay = Math.max(maxDelay, d);
    }
  });
  const startsBeforeNow = now !== null && chosen.t.stops[chosen.p]!.start < now - EPS;
  return { routes: rest, delayedCount, maxDelayMinutes: maxDelay, startsBeforeNow };
}

/**
 * 入らない訪問を受けられる人の候補（問題のすべての人）。並び：入る人が先で増える費用の小さい順、
 * 次に「ずらせば入る」分の絶対値の小さい順（同じなら遅らせる方）、最後に入らない人。同じなら staff の順。
 * 「この人に入れる」の影響（遅れる既存の訪問・いまの時刻より前に入る）と、列に元から必須の違反があるかも返す
 */
export const candidatesFor: CandidatesFor = (problem, routes, visitId, options) => {
  const { vIndex } = indexOf(problem);
  const v = vIndex.get(visitId);
  if (v === undefined) return [];
  const rest = without(routes, visitId);
  const list = problem.staff.map((st, s) => {
    const known = knownOf(colOf(rest, st.id), vIndex);
    const reasons = problem.reasons[v]![s]!;
    const violations: Reason[] = reasons.filter((r) => r.points === INF || r.points > 0);
    const overCap = overCapOf(problem, s, known.length);
    const allowed = problem.allowed[v]![s]!;
    const routeBroken = known.length > 0 && scheduleRoute(problem, s, known, 'strict') === null;
    const fit = allowed && !overCap && !routeBroken ? bestFit(problem, s, known, v, options.now) : null;
    let shiftMinutes: number | null = null;
    // ずらせば入るか：時刻に関わらない必須の原因が無く、件数の上限を超えず、列に元から違反の無い人だけ
    const timeOnly = reasons.every((r) => r.points !== INF || TIME_RULES.has(r.ruleId));
    if (!fit && !overCap && !routeBroken && timeOnly) {
      for (let a = SHIFT_STEP; a <= SHIFT_MAX && shiftMinutes === null; a += SHIFT_STEP) {
        for (const d of [a, -a]) {
          if (bestFit(shifted(problem, v, d), s, known, v, options.now)) {
            shiftMinutes = d;
            break;
          }
        }
      }
    }
    const effect = fit
      ? { delayedCount: 0, maxDelayMinutes: 0, startsBeforeNow: false }
      : placement(problem, rest, visitId, st.id, options.now);
    const c: ReassignCandidate & { order: number } = {
      staffId: st.id,
      fits: fit !== null,
      addedTravel: fit ? fit.addedTravel : null,
      addedCost: fit ? fit.addedCost : null,
      shiftMinutes,
      overCap,
      violations,
      routeBroken,
      delayedCount: effect.delayedCount,
      maxDelayMinutes: effect.maxDelayMinutes,
      startsBeforeNow: effect.startsBeforeNow,
      order: s,
    };
    return c;
  });
  const rank = (c: (typeof list)[number]) => (c.fits ? 0 : c.shiftMinutes !== null ? 1 : 2);
  list.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) {
      const d = (a.addedCost ?? 0) - (b.addedCost ?? 0);
      if (Math.abs(d) > EPS) return d;
    }
    if (ra === 1) {
      const d = Math.abs(a.shiftMinutes ?? 0) - Math.abs(b.shiftMinutes ?? 0);
      if (d !== 0) return d;
      const later = (b.shiftMinutes ?? 0) - (a.shiftMinutes ?? 0);
      if (later !== 0) return later;
    }
    return a.order - b.order;
  });
  return list.map(({ order: _order, ...c }) => c);
};

/**
 * 候補の人に入れる：候補の「入る」と同じ位置（他の訪問の開始を変えない strict の最良）。
 * 無ければ、いまの時刻より前の位置を除いて strict の最良、無ければ開始の順に lenient（placement）。
 * 訪問の時刻は変えない。あとの訪問の開始が遅れることがある（画面は候補の delayedCount で確認を出す）
 */
export const placeVisit: PlaceVisit = (problem, routes, visitId, staffId, options) =>
  placement(problem, routes, visitId, staffId, options.now).routes;

/** 列ごとの lenient の時刻（訪問ID → { 担当, 開始 }）と移動の合計 */
function timesOf(problem: Problem, routes: Routes) {
  const { vIndex } = indexOf(problem);
  const at = new Map<string, { staffId: string; start: number }>();
  let travel = 0;
  problem.staff.forEach((st, s) => {
    const known = knownOf(colOf(routes, st.id), vIndex);
    const t = scheduleRoute(problem, s, known, 'lenient');
    if (!t) return;
    travel += t.travelMinutes;
    for (const stop of t.stops) at.set(stop.visitId, { staffId: st.id, start: stop.start });
  });
  return { at, travel };
}

/** 元の案と振り直した案の差（時刻は lenient。before と after で問題が違ってよい） */
export const reassignDiff: ReassignDiffFn = (before, after) => {
  const a = timesOf(before.problem, before.routes);
  const b = timesOf(after.problem, after.routes);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const v of [...after.problem.visits, ...before.problem.visits]) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    ids.push(v.id);
  }
  const moved: ReassignDiff['moved'] = [];
  const shiftedList: ReassignDiff['shifted'] = [];
  const unplaced: string[] = [];
  const changed = new Set<string>();
  for (const id of ids) {
    const x = a.at.get(id);
    const y = b.at.get(id);
    const from = x?.staffId ?? null;
    const to = y?.staffId ?? null;
    if (from !== to) {
      moved.push({ visitId: id, from, to });
      if (from) changed.add(from);
      if (to) changed.add(to);
      if (from && !to) unplaced.push(id);
      continue;
    }
    if (x && y) {
      const minutes = Math.round(y.start - x.start);
      if (minutes !== 0) {
        shiftedList.push({ visitId: id, minutes });
        changed.add(y.staffId);
      }
    }
  }
  const order = [...after.problem.staff, ...before.problem.staff].map((s) => s.id);
  const changedStaff = [...new Set(order)].filter((id) => changed.has(id));
  return { moved, shifted: shiftedList, unplaced, changedStaff, travelDelta: b.travel - a.travel };
};
