// 合計点の式（solver・evaluate で同じ式・同じ順で足す）
import type { Problem } from '../contracts/problem';
import { DROP_POINTS } from '../contracts/rules';

/** スタッフごとの件数から均等の点（solver・evaluate で同じ） */
export function balancePoints(problem: Problem, counts: ArrayLike<number>): number {
  const b = problem.balance;
  if (!b) return 0;
  let off = 0;
  for (let i = 0; i < problem.staff.length; i++) {
    const c = counts[i] ?? 0;
    if (c < b.lo[i]!) off += b.lo[i]! - c;
    else if (c > b.hi[i]!) off += c - b.hi[i]!;
  }
  return off * b.perVisit;
}

/** 合計点（solver・evaluate で同じ式・同じ順で足す） */
export function totalPoints(
  problem: Problem,
  parts: { travel: number; wait: number; assign: number; balance: number; dropped: number },
): number {
  return parts.travel + parts.wait * problem.waitPerMinute + parts.assign + parts.balance + parts.dropped * DROP_POINTS;
}
