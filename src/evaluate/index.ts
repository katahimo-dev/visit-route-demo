// 入口（実装は evaluate 担当）
import type { PlanDiff, PlanScore, Problem, VisitExplain } from '../contracts/problem';

/** routes は staffId → 訪問ID（回る順）。problem にない訪問は無視、どの列にもない訪問は dropped */
export function score(_problem: Problem, _routes: Record<string, string[]>): PlanScore {
  throw new Error('未実装');
}
export function explain(_problem: Problem, _routes: Record<string, string[]>): VisitExplain[] {
  throw new Error('未実装');
}
export function diff(_problem: Problem, _from: Record<string, string[]>, _to: Record<string, string[]>): PlanDiff {
  throw new Error('未実装');
}
