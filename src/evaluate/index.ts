// 入口（evaluate：手作業案・AI案を同じ Problem で採点・説明・差分）
import {
  type HundredPart,
  type PlanDiff,
  type PlanScore,
  type Problem,
  type Reason,
  type RouteTiming,
  type RuleAchievement,
  SCORE_MAX,
  SCORE_MULTIPLIER,
  type ScoreScale,
  type StopTiming,
  type VisitExplain,
} from '../contracts/problem';
import { DROP_POINTS } from '../contracts/rules';
import { balanceOff, balancePoints, naiveSeqs, scheduleRoute, totalPoints } from '../matching';

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
    // 自分のキーだけを見る（スタッフID が constructor などでも Object の組み込みを拾わない）
    for (const id of Object.hasOwn(routes, s.id) ? (routes[s.id] ?? []) : []) {
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
      const own = infeasible.get(v);
      return {
        visitId: pv.id,
        staffId: null,
        reasons: own && own.length > 0 ? own.slice(0, EXPLAIN_REASONS) : whyUnassigned(problem, p, v),
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

const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;

/**
 * 担当の候補はいるのに入らなかった訪問の理由（どの担当も可にならない訪問は Problem.infeasible が持つ）。
 * 候補ごとに、今の案のその人の列に strict で入るかを試し、入らなければ重なる訪問の時刻を出す。
 * 候補でない人は可否の原因ごとに人数をまとめる。例「さくら：14:00〜15:00・16:00〜16:45 と重なる」「必要条件：資格に保育士を含む ✗（6人）」
 */
function whyUnassigned(problem: Problem, p: Placed, v: number): Reason[] {
  const pv = problem.visits[v]!;
  const out: Reason[] = [];
  const blocked = new Map<string, number>();
  for (let s = 0; s < problem.staff.length; s++) {
    const st = problem.staff[s]!;
    if (!problem.allowed[v]![s]) {
      const label = notAllowedLabel(problem.reasons[v]![s]!);
      blocked.set(label, (blocked.get(label) ?? 0) + 1);
      continue;
    }
    const seq = p.seqs[s]!;
    let fits = false;
    for (let pos = 0; pos <= seq.length && !fits; pos++) {
      const t = [...seq];
      t.splice(pos, 0, v);
      fits = scheduleRoute(problem, s, t, 'strict') !== null;
    }
    const cap = problem.balance?.cap?.[s];
    if (fits && cap !== undefined && seq.length + 1 > cap) {
      out.push({ ruleId: BALANCE_RULE_KEY, label: `${st.name}：件数の上限（${cap}件）`, points: INF });
    } else if (fits) {
      out.push({ ruleId: 'cost', label: `${st.name}：入れられるが、ほかの訪問との兼ね合いで外れた`, points: 0 });
    } else {
      // 約束の幅の前後に作業が重なる訪問（移動も要るので少し広めに見る）
      const from = pv.earliest - 60;
      const to = pv.latest + pv.duration + 60;
      const near = p.timings[s]!.stops.filter((x) => x.end > from && x.start < to).map(
        (x) => `${hm(x.start)}〜${hm(x.end)}`,
      );
      out.push({
        ruleId: 'time',
        label: `${st.name}：${near.length > 0 ? `${near.join('・')} の訪問と時間が合わない` : '時間が合わない'}`,
        points: INF,
      });
    }
  }
  for (const [label, n] of blocked) out.push({ ruleId: 'notAllowed', label: `${label}（${n}人）`, points: INF });
  return out;
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

// ---- 点数（ADR-0007。表示だけ。solver の費用は変えない。下限＝160点・素朴な案＝0点）----

/**
 * 素朴な案（staffId → 訪問ID。回る順）。中身は matching の naiveSeqs：担当できる人の少ない順（同じなら開始の早い順）に、増える移動が最も少ない担当の、
 * その順番の中で最も安い位置（strict で入る位置）に挟む。入らない訪問だけ落とす。決定的
 */
export function naivePlan(problem: Problem): Record<string, string[]> {
  const seqs = naiveSeqs(problem);
  const routes: Record<string, string[]> = {};
  problem.staff.forEach((st, s) => {
    routes[st.id] = seqs[s]!.map((v) => problem.visits[v]!.id);
  });
  return routes;
}

/** 浮動小数の誤差の許し（matching/timing と同じ） */
const EPS = 1e-9;

/** u と v の両方を担当できる人がいるか */
function shareStaff(problem: Problem, u: number, v: number): boolean {
  const au = problem.allowed[u]!;
  const av = problem.allowed[v]!;
  for (let s = 0; s < problem.staff.length; s++) if (au[s] && av[s]) return true;
  return false;
}

/**
 * 同じ人のルートで u のすぐあとに v を置けうるか（緩めた判定：u を最も早く始めて終え、移動して v の latest に間に合う。
 * 稼働時間帯は見ない）。下限に使うので、本当に置ける組を落とさないことだけが要る
 */
function canPrecede(problem: Problem, u: number, v: number): boolean {
  if (u === v) return false;
  const pu = problem.visits[u]!;
  const pv = problem.visits[v]!;
  return (
    pu.earliest + pu.duration + problem.travel[pu.point]![pv.point]! <= pv.latest + EPS && shareStaff(problem, u, v)
  );
}

/**
 * 100点満点の物差し。lowerBound（100点）＝どの案の費用もこれ以上になる下限：
 * - 割当：各訪問を、可否を満たす担当のうち割当費用が最小の人に
 * - 移動：ルートの移動＝各訪問に来る移動の和＋帰り＝各訪問から出る移動の和＋行き。よって
 *   max(Σ 来る移動の最小, Σ 出る移動の最小) 以上。来る元＝担当できる人の自宅か前に置けうる訪問、出る先＝担当できる人の自宅か後に置けうる訪問
 * - 1件ごとに（割当＋移動）の下限が落とした訪問の点を超えるなら、落とした訪問の点にする（落とす案もあるので）
 * - 待ち・負担の均等は0。担当の候補がいない訪問は落とした訪問の点
 * naive（0点）＝素朴な案（naivePlan）を score で採点した費用
 */
export function normalize(problem: Problem): ScoreScale {
  const nV = problem.visits.length;
  let lowerAssign = 0;
  let lowerDropped = 0;
  let sumIn = 0;
  let sumOut = 0;
  for (let v = 0; v < nV; v++) {
    const pv = problem.visits[v]!;
    let min = INF;
    let inMin = INF;
    let outMin = INF;
    for (let s = 0; s < problem.staff.length; s++) {
      if (!problem.allowed[v]![s]) continue;
      if (problem.assignCost[v]![s]! < min) min = problem.assignCost[v]![s]!;
      const home = problem.staff[s]!.point;
      inMin = Math.min(inMin, problem.travel[home]![pv.point]!);
      outMin = Math.min(outMin, problem.travel[pv.point]![home]!);
    }
    if (min === INF) {
      lowerDropped++;
      continue;
    }
    for (let u = 0; u < nV; u++) {
      const pu = problem.visits[u]!;
      if (problem.travel[pu.point]![pv.point]! < inMin && canPrecede(problem, u, v))
        inMin = problem.travel[pu.point]![pv.point]!;
      if (problem.travel[pv.point]![pu.point]! < outMin && canPrecede(problem, v, u))
        outMin = problem.travel[pv.point]![pu.point]!;
    }
    lowerAssign += min;
    sumIn += Math.min(DROP_POINTS, min + inMin) - min;
    sumOut += Math.min(DROP_POINTS, min + outMin) - min;
  }
  const lowerTravel = Math.max(sumIn, sumOut);
  const naiveRoutes = naivePlan(problem);
  return {
    lowerBound: totalPoints(problem, {
      travel: lowerTravel,
      wait: 0,
      assign: lowerAssign,
      balance: 0,
      dropped: lowerDropped,
    }),
    naive: score(problem, naiveRoutes).total,
    naiveRoutes,
    lowerAssign,
    lowerTravel,
    lowerDropped,
  };
}

/** 下限＝SCORE_MAX（160）点の物差しの1点あたり（100点 × 倍率） */
const FULL = 100 * SCORE_MULTIPLIER;

/**
 * 費用 → 点数（高いほど良い。費用について単調に減る。0〜SCORE_MAX の整数）。
 * 下限＝100・素朴な案＝0 の点に SCORE_MULTIPLIER（1.6）を掛けた値（ADR-0007 追記）。100 を超えてよく、0 で止める
 */
export function toHundred(cost: number, scale: ScoreScale): number {
  const span = scale.naive - scale.lowerBound;
  if (!(span > 0)) return SCORE_MAX;
  const p = Math.round((FULL * (scale.naive - cost)) / span);
  return p < 0 ? 0 : p > SCORE_MAX ? SCORE_MAX : p;
}

/**
 * 減点の内訳：費用の成分ごとの下限からの超過 × 160/(naive − lowerBound)（点数と同じ倍率）。大きい順。
 * 合計は 160−点数（丸めと 0 で止めた分を除く。画面では 0 未満の成分を出さないので、表示の合計とは合わないことがある）。naive ≤ lowerBound なら空
 */
export function hundredBreakdown(sc: PlanScore, scale: ScoreScale, problem: Problem): HundredPart[] {
  const span = scale.naive - scale.lowerBound;
  if (!(span > 0)) return [];
  const k = FULL / span;
  const parts: HundredPart[] = [
    { key: 'travel', label: '移動', points: (sc.travelMinutes - scale.lowerTravel) * k },
    { key: 'wait', label: '待ち', points: sc.waitMinutes * problem.waitPerMinute * k },
    { key: 'assign', label: '担当の条件', points: (sc.assignPoints - scale.lowerAssign) * k },
    { key: 'balance', label: '負担の均等', points: sc.balancePoints * k },
    { key: 'dropped', label: '入らない訪問', points: (sc.dropped - scale.lowerDropped) * DROP_POINTS * k },
  ];
  return parts.sort((a, b) => b.points - a.points);
}

// ---- 条件ごとの達成の件数（ADR-0008）----

/**
 * 条件（Rule.id）ごとの達成の件数。割当済みの訪問のうち、その条件の判定（理由）がある訪問を total、
 * その条件の理由がすべて点0以下（満たした・加点）の訪問を met にする。相性は ◎・○・△・× の件数も数える。
 * 負担の均等（BALANCE_RULE_KEY）は、稼働のある人か訪問のある人のうち、目安の帯に収まった人数（unit 'staff'）。
 * 並びは理由に初めて出た順（problem の訪問・担当の順。決定的）、負担の均等は最後
 */
export function achievements(problem: Problem, routes: Record<string, string[]>): RuleAchievement[] {
  const p = place(problem, routes);
  const by = new Map<string, RuleAchievement>();
  for (let v = 0; v < problem.visits.length; v++) {
    const s = p.staffOf[v]!;
    if (s < 0) continue;
    const ok = new Map<string, boolean>();
    for (const r of problem.reasons[v]![s]!) {
      // 可否・固定などの内部の原因は数えない（条件の ID だけ）
      if (r.ruleId === 'noPlace' || r.ruleId === 'slot' || r.ruleId === 'time' || r.ruleId === 'pin') continue;
      ok.set(r.ruleId, (ok.get(r.ruleId) ?? true) && r.points <= 0);
      if (r.level !== undefined) {
        const e = entry(by, r.ruleId);
        e.compat ??= { great: 0, good: 0, poor: 0, ng: 0 };
        if (r.level === 2) e.compat.great++;
        else if (r.level === 1) e.compat.good++;
        else if (r.level === -1) e.compat.poor++;
        else e.compat.ng++;
      }
    }
    for (const [ruleId, met] of ok) {
      const e = entry(by, ruleId);
      e.total++;
      if (met) e.met++;
    }
  }
  const out = [...by.values()];
  const b = problem.balance;
  if (b) {
    const e: RuleAchievement = { ruleId: BALANCE_RULE_KEY, unit: 'staff', total: 0, met: 0, compat: null };
    for (let s = 0; s < problem.staff.length; s++) {
      const n = p.seqs[s]!.length;
      if (problem.staff[s]!.slots.length === 0 && n === 0) continue;
      e.total++;
      if (balanceOff(b, s, n) === 0) e.met++;
    }
    out.push(e);
  }
  return out;
}

function entry(by: Map<string, RuleAchievement>, ruleId: string): RuleAchievement {
  let e = by.get(ruleId);
  if (!e) {
    e = { ruleId, unit: 'visit', total: 0, met: 0, compat: null };
    by.set(ruleId, e);
  }
  return e;
}
