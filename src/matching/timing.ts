// 1人のルートの時刻（contracts/problem.ts の規則の唯一の実装）。solver・evaluate はここを使う
import type { Problem, RouteTiming, StopTiming } from '../contracts/problem';

/** 浮動小数の誤差の許し */
const EPS = 1e-9;

/**
 * t0 以降で、作業 [t, t+duration] が時間帯の1つに収まる最も早い t。無ければ Infinity。
 * slots は開始の順・重なりなし
 */
export function fitStart(slots: { start: number; end: number }[], t0: number, duration: number): number {
  for (const sl of slots) {
    const t = t0 > sl.start ? t0 : sl.start;
    if (t + duration <= sl.end + EPS) return t;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * 1人のルートの時刻。strict で時間の違反があれば null。
 * lenient では違反を記録して続ける（収まる時間帯がなければ max(到着, earliest) に始めたことにする）
 */
export function scheduleRoute(
  problem: Problem,
  staff: number,
  visits: number[],
  mode: 'strict' | 'lenient',
): RouteTiming | null {
  const st = problem.staff[staff]!;
  const slots = st.slots;
  const home = st.point;
  const stops: StopTiming[] = [];
  const violations: RouteTiming['violations'] = [];
  let travelMinutes = 0;
  let waitMinutes = 0;
  let meters = 0;
  let prevPoint = home;
  let prevEnd = 0;
  for (let k = 0; k < visits.length; k++) {
    const v = problem.visits[visits[k]!]!;
    const travelIn = problem.travel[prevPoint]![v.point]!;
    meters += problem.meters[prevPoint]![v.point]!;
    travelMinutes += travelIn;
    // 最初の訪問は、最初の時間帯の開始に自宅を出たときの到着が下限（待ちは0）
    const ready = k === 0 ? (slots[0]?.start ?? Number.NEGATIVE_INFINITY) + travelIn : prevEnd + travelIn;
    const lower = ready > v.earliest ? ready : v.earliest;
    let start = fitStart(slots, lower, v.duration);
    if (start === Number.POSITIVE_INFINITY) {
      if (mode === 'strict') return null;
      violations.push({ visitId: v.id, kind: 'slot' });
      start = lower;
    }
    if (start > v.latest + EPS) {
      if (mode === 'strict') return null;
      violations.push({ visitId: v.id, kind: 'time' });
    }
    const arrival = k === 0 ? start : prevEnd + travelIn;
    const wait = start - arrival;
    waitMinutes += wait;
    const end = start + v.duration;
    stops.push({ visitId: v.id, arrival, start, end, wait, travelIn });
    prevEnd = end;
    prevPoint = v.point;
  }
  if (visits.length > 0) {
    travelMinutes += problem.travel[prevPoint]![home]!;
    meters += problem.meters[prevPoint]![home]!;
  }
  return { stops, travelMinutes, waitMinutes, meters, violations };
}

/**
 * strict の scheduleRoute と同じ規則で、ルートの費用（移動分＋待ち分×waitPerMinute＋割当費用）だけを
 * 配列を作らずに求める（solver の差分評価用）。違反があれば Infinity。
 * problem.stay（案B の変更の減点。ADR-0011 追記）があれば、元の担当と違う訪問・元の開始からのずれの点も足す
 * （evaluate の採点には入れない）
 */
export function routeCost(problem: Problem, staff: number, visits: ArrayLike<number>, length = visits.length): number {
  const st = problem.staff[staff]!;
  const slots = st.slots;
  const home = st.point;
  const travel = problem.travel;
  const pv = problem.visits;
  const ac = problem.assignCost;
  let travelMinutes = 0;
  let waitMinutes = 0;
  let assign = 0;
  const stay = problem.stay;
  let stayPoints = 0;
  let prevPoint = home;
  let prevEnd = 0;
  for (let k = 0; k < length; k++) {
    const vi = visits[k]!;
    const v = pv[vi]!;
    const travelIn = travel[prevPoint]![v.point]!;
    travelMinutes += travelIn;
    const ready = k === 0 ? (slots[0]?.start ?? Number.NEGATIVE_INFINITY) + travelIn : prevEnd + travelIn;
    const lower = ready > v.earliest ? ready : v.earliest;
    const start = fitStart(slots, lower, v.duration);
    if (start > v.latest + EPS) return Number.POSITIVE_INFINITY;
    if (k > 0) waitMinutes += start - (prevEnd + travelIn);
    assign += ac[vi]![staff]!;
    if (stay) {
      const was = stay.staff[vi];
      if (was !== null && was !== undefined && was !== staff) stayPoints += stay.movePoints;
      const at = stay.start[vi];
      if (at !== null && at !== undefined) stayPoints += Math.abs(start - at) * stay.minutePoints;
    }
    prevEnd = start + v.duration;
    prevPoint = v.point;
  }
  if (length > 0) travelMinutes += travel[prevPoint]![home]!;
  return travelMinutes + waitMinutes * problem.waitPerMinute + assign + stayPoints;
}
