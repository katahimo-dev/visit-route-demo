// AI案の記録（ADR-0005）：作るたびに条件と結果を残し、比較の画面で任意の2つを比べる
import { type AiPlan, type AiRun, type DemoData, MAX_RUNS_PER_DAY } from '../contracts/data';
import type { SolveResult } from '../contracts/problem';
import type { Rule } from '../contracts/rules';
import { presetOf } from '../seed';
import { own } from './common';

/** 記録の名前：プリセットと一致すればプリセット名、違えば「条件を変えた案」。固定を残した組み直しは件数を足す */
export function runLabel(rules: Rule[], pinCount: number): string {
  const base = presetOf(rules)?.name ?? '条件を変えた案';
  return pinCount > 0 ? `${base}・固定${pinCount}件で組み直し` : base;
}

/**
 * その日の記録に1件足す。同じ条件・種・固定・結果の記録がすでにあれば足さない（同じ入力からは同じ案になる）。
 * 1日 MAX_RUNS_PER_DAY 件まで（古いものから消す）
 */
export function addRun(
  d: DemoData,
  date: string,
  x: { rules: Rule[]; pins: Record<string, string>; result: SolveResult; createdAt: number },
): DemoData {
  const runs = own(d.aiRuns, date) ?? [];
  const same = (r: AiRun) =>
    r.seed === x.result.seed &&
    JSON.stringify(r.rules) === JSON.stringify(x.rules) &&
    JSON.stringify(r.pins) === JSON.stringify(x.pins) &&
    JSON.stringify(r.routes) === JSON.stringify(x.result.routes);
  if (runs.some(same)) return d;
  const no = runs.reduce((m, r) => Math.max(m, r.no), 0) + 1;
  // 最新の記録を消すと番号は使い回すので、ID には作った時刻も入れて別の記録と取り違えない
  const run: AiRun = {
    id: `${date}#${no}@${x.createdAt}`,
    no,
    date,
    createdAt: x.createdAt,
    label: runLabel(x.rules, Object.keys(x.pins).length),
    presetId: presetOf(x.rules)?.id ?? null,
    seed: x.result.seed,
    iterations: x.result.iterations,
    rules: x.rules,
    pins: x.pins,
    routes: x.result.routes,
    unassigned: x.result.unassigned,
    score: x.result.score,
    stopped: x.result.stopped,
  };
  return { ...d, aiRuns: { ...d.aiRuns, [date]: [...runs, run].slice(-MAX_RUNS_PER_DAY) } };
}

/** 記録を今の案（AI案の画面）にする。AIが出したまま＝記録の結果、固定は記録の固定 */
export function planOfRun(run: AiRun): AiPlan {
  return {
    date: run.date,
    createdAt: run.createdAt,
    seed: run.seed,
    iterations: run.iterations,
    routes: run.routes,
    unassigned: run.unassigned,
    score: run.score,
    stopped: run.stopped,
    rules: run.rules,
    generated: { routes: run.routes, unassigned: run.unassigned, score: run.score },
    pins: run.pins,
  };
}
