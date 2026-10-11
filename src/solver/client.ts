import type { Problem, SolveOptions, SolveResult } from '../contracts/problem';

/**
 * Worker で解く。onProgress は間引いて呼ぶ。stop() でそれまでの最良案（stopped=true）で終わる。
 * 30秒たったら自動で stop する
 */
export function runSolve(
  _problem: Problem,
  _options: SolveOptions,
  _onProgress?: (p: { iteration: number; total: number; bestScore: number }) => void,
): { promise: Promise<SolveResult>; stop(): void } {
  throw new Error('未実装');
}
