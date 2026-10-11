// 入口（evaluate：手作業案・AI案を同じ Problem で採点・説明・差分）
import type { PlanDiff, PlanScore, Problem, Reason, RouteTiming, StopTiming, VisitExplain } from '../contracts/problem';
import { balanceOff, balancePoints, scheduleRoute, totalPoints } from '../matching';

const INF = Number.POSITIVE_INFINITY;
/** 説明に出す理由の数 */
const EXPLAIN_REASONS = 3;

type Placed = {
  /** staff 添字ごとの訪問添字の列（problem にない訪問・重複は除く） */
  seqs: number[][];
  /** visit 添字 → staff 添字（-1 は未割当） */
  staffOf: Int32Array;
  timings: RouteTiming[];
};

/** routes（staffId → 訪問ID）を添字にする。problem にない担当（'__none' など）の列は未割当とみなす */
function place(problem: Problem, routes: Record<string, string[]>): Placed {
  const vIndex = new Map(problem.visits.map((v, i) => [v.id, i]));
  const staffOf = new Int32Array(problem.visits.length).fill(-1);
  const seqs = problem.staff.map((s, si) => {
    const out: number[] = [];
    for (const id of routes[s.id] ?? []) {
      const v = vIndex.get(id);
      if (v === undefined || staffOf[v]! >= 0) continue;
      staffOf[v] = si;
      out.push(v);
    }
    return out;
  });
  const timings = seqs.map((seq, si) => scheduleRoute(problem, si, seq, 'lenient')!);
  return { seqs, staffOf, timings };
}

/** 可否で外れた原因の文言 */
function notAllowedLabel(reasons: Reason[]): string {
  const labels = reasons.filter((r) => r.points === INF).map((r) => r.label);
  return labels.length > 0 ? labels.join('・') : '担当できない組み合わせ';
}

/** perRule の負担の均等のキー（Problem に条件のIDがないので型の名前。初期データの条件のIDと同じ） */
export const BALANCE_RULE_KEY = 'balance';

const TIME_LABEL = { time: '時間の約束に間に合わない', slot: '稼働時間帯に作業が収まらない' } as const;

function scorePlaced(problem: Problem, p: Placed): PlanScore {
  let travel = 0;
  let wait = 0;
  let meters = 0;
  let assign = 0;
  const perRule: PlanScore['perRule'] = {};
  const hardViolations: PlanScore['hardViolations'] = [];
  const counts = new Int32Array(problem.staff.length);
  for (let s = 0; s < problem.staff.length; s++) {
    const staffId = problem.staff[s]!.id;
    const t = p.timings[s]!;
    travel += t.travelMinutes;
    wait += t.waitMinutes;
    meters += t.meters;
    for (const v of p.seqs[s]!) {
      // 手作業案は可否で外れた組でも割当費用（有限の部分）を数える
      assign += problem.assignCost[v]![s]!;
      const rs = problem.reasons[v]![s]!;
      for (const r of rs) {
        const e = perRule[r.ruleId] ?? { hits: 0, misses: 0, points: 0 };
        if (r.points > 0) e.misses++;
        else e.hits++;
        if (r.points !== INF) e.points += r.points;
        perRule[r.ruleId] = e;
      }
      if (!problem.allowed[v]![s]) {
        hardViolations.push({
          visitId: problem.visits[v]!.id,
          staffId,
          kind: 'notAllowed',
          label: notAllowedLabel(rs),
        });
      }
    }
    for (const x of t.violations)
      hardViolations.push({ visitId: x.visitId, staffId, kind: x.kind, label: TIME_LABEL[x.kind] });
    counts[s] = p.seqs[s]!.length;
  }
  let dropped = 0;
  for (let v = 0; v < problem.visits.length; v++) if (p.staffOf[v]! < 0) dropped++;
  const balance = balancePoints(problem, counts);
  const b = problem.balance;
  if (b) {
    // 負担の均等：達成＝目安の帯に収まったスタッフ、違反＝外れたスタッフ（稼働のない人も帯 [0,0] で数える）
    const e = { hits: 0, misses: 0, points: balance };
    for (let s = 0; s < problem.staff.length; s++) {
      if (balanceOff(b, s, counts[s]!) > 0) e.misses++;
      else e.hits++;
      // 必須の均等：上限を超えた分（列のあとの方の訪問）を違反にする
      const cap = b.cap?.[s];
      if (cap !== undefined && counts[s]! > cap) {
        for (const v of p.seqs[s]!.slice(cap)) {
          hardViolations.push({
            visitId: problem.visits[v]!.id,
            staffId: problem.staff[s]!.id,
            kind: 'notAllowed',
            label: `件数の上限（${cap}件）を超える`,
          });
        }
      }
    }
    perRule[BALANCE_RULE_KEY] = e;
  }
  return {
    total: totalPoints(problem, { travel, wait, assign, balance, dropped }),
    travelMinutes: travel,
    waitMinutes: wait,
    meters,
    assignPoints: assign,
    balancePoints: balance,
    dropped,
    perRule,
    hardViolations,
  };
}

/** routes は staffId → 訪問ID（回る順）。problem にない訪問は無視、どの列にもない訪問は dropped */
export function score(problem: Problem, routes: Record<string, string[]>): PlanScore {
  return scorePlaced(problem, place(problem, routes));
}

/** 訪問ごとの理由（点の絶対値の大きい順に3つまで。移動 'travel' と待ち 'wait' を含む）と時刻 */
export function explain(problem: Problem, routes: Record<string, string[]>): VisitExplain[] {
  const p = place(problem, routes);
  const stopOf = new Map<string, StopTiming>();
  for (const t of p.timings) for (const st of t.stops) stopOf.set(st.visitId, st);
  const infeasible = new Map(problem.infeasible.map((x) => [x.visit, x.reasons]));
  return problem.visits.map((pv, v) => {
    const s = p.staffOf[v]!;
    if (s < 0) {
      return {
        visitId: pv.id,
        staffId: null,
        reasons: (infeasible.get(v) ?? []).slice(0, EXPLAIN_REASONS),
        timing: null,
      };
    }
    const timing = stopOf.get(pv.id) ?? null;
    const list: Reason[] = [...problem.reasons[v]![s]!];
    if (timing) {
      list.push({ ruleId: 'travel', label: `移動${Math.round(timing.travelIn)}分`, points: timing.travelIn });
      if (timing.wait > 0 && problem.waitPerMinute > 0) {
        list.push({
          ruleId: 'wait',
          label: `待ち${Math.round(timing.wait)}分`,
          points: timing.wait * problem.waitPerMinute,
        });
      }
    }
    // 安定な並べ替え（同じ大きさなら元の順）
    list.sort((a, b) => Math.abs(b.points) - Math.abs(a.points) || 0);
    return { visitId: pv.id, staffId: problem.staff[s]!.id, reasons: list.slice(0, EXPLAIN_REASONS), timing };
  });
}

/** 担当が変わった訪問ID、移動分の差（to−from）、合計点の差（to−from） */
export function diff(problem: Problem, from: Record<string, string[]>, to: Record<string, string[]>): PlanDiff {
  const a = place(problem, from);
  const b = place(problem, to);
  const changedVisits: string[] = [];
  for (let v = 0; v < problem.visits.length; v++) {
    if (a.staffOf[v] !== b.staffOf[v]) changedVisits.push(problem.visits[v]!.id);
  }
  const sa = scorePlaced(problem, a);
  const sb = scorePlaced(problem, b);
  return { changedVisits, travelDelta: sb.travelMinutes - sa.travelMinutes, scoreDelta: sb.total - sa.total };
}
