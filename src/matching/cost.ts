// 合計点の式（solver・evaluate で同じ式・同じ順で足す）
import type { Problem } from '../contracts/problem';
import { DROP_POINTS, KEEP_DROP_POINTS } from '../contracts/rules';

/** 1人の件数が目安の帯 [lo, hi] から外れた件数 */
export function balanceOff(b: NonNullable<Problem['balance']>, staff: number, count: number): number {
  const lo = b.lo[staff]!;
  const hi = b.hi[staff]!;
  return count < lo ? lo - count : count > hi ? count - hi : 0;
}

/** スタッフごとの件数から均等の点＝Σ perVisit × 外れた件数²（solver・evaluate で同じ） */
export function balancePoints(problem: Problem, counts: ArrayLike<number>): number {
  const b = problem.balance;
  if (!b) return 0;
  let sq = 0;
  for (let i = 0; i < problem.staff.length; i++) {
    const e = balanceOff(b, i, counts[i] ?? 0);
    sq += e * e;
  }
  return sq * b.perVisit;
}

/** 合計点（solver・evaluate で同じ式・同じ順で足す） */
export function totalPoints(
  problem: Problem,
  parts: { travel: number; wait: number; assign: number; balance: number; dropped: number },
): number {
  return parts.travel + parts.wait * problem.waitPerMinute + parts.assign + parts.balance + parts.dropped * DROP_POINTS;
}

/**
 * 訪問 v を落としたときの solver の費用：Problem.stay.keep の訪問（案B の、案A に入っている訪問）は KEEP_DROP_POINTS、
 * ほかは DROP_POINTS（ADR-0011 追記）。採点（totalPoints・evaluate）は常に DROP_POINTS
 */
export function dropPointsOf(problem: Problem, v: number): number {
  return problem.stay?.keep?.[v] ? KEEP_DROP_POINTS : DROP_POINTS;
}
