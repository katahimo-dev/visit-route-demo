// 入口（solver：焼きなまし。Worker なしの純粋関数と、Worker で解く runSolve）
import type { Problem } from '../contracts/problem';

export { createSolver, solve } from './anneal';
export { runSolve } from './client';

/**
 * 問題の大きさから決める反復回数の既定（中位のノートPCで約3秒の目安）。
 * 1回の手の重さは列の長さ L（＝訪問数÷人数）にほぼ比例する。node で計測して
 * 1回 ≈ (0.35 + 0.25×L) µs（開発機。中位のノートPCはその1.5倍ほどとみて、開発機で約2秒ぶん）
 */
export function defaultIterations(problem: Problem): number {
  const V = problem.visits.length;
  if (V === 0) return 0;
  const L = V / Math.max(1, problem.staff.length);
  const n = Math.round(BUDGET_MICROS / (0.35 + 0.25 * L));
  return Math.max(MIN_ITERATIONS, Math.min(MAX_ITERATIONS, n));
}
const BUDGET_MICROS = 2_000_000;
const MIN_ITERATIONS = 50_000;
const MAX_ITERATIONS = 3_000_000;
