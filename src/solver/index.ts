// 入口（実装は solver 担当）
import type { Problem, SolveOptions, SolveResult, Solver } from '../contracts/problem';

export function createSolver(_problem: Problem, _options: SolveOptions): Solver {
  throw new Error('未実装');
}
export function solve(_problem: Problem, _options: SolveOptions): SolveResult {
  throw new Error('未実装');
}
/** 問題の大きさから決める反復回数の既定（目安3秒） */
export function defaultIterations(_problem: Problem): number {
  throw new Error('未実装');
}
export { runSolve } from './client';
