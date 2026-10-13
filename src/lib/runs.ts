// AI案の記録（ADR-0005）：作るたびに条件と結果を残し、比較の画面で任意の2つを比べる
import { type AiPlan, type AiRun, type DemoData, MAX_RUNS_PER_DAY } from '../contracts/data';
import type { Problem, SolveResult } from '../contracts/problem';
import type { Preset, Rule } from '../contracts/rules';
import { score } from '../evaluate';
import { presetOf } from '../seed';
import { own } from './common';

/** 記録の名前：プリセットと一致すればプリセット名、違えば「条件を変えた案」。固定を残した組み直しは件数を足す */
export function runLabel(rules: Rule[], pinCount: number, presets: readonly Preset[]): string {
  const base = presetOf(rules, presets)?.name ?? '条件を変えた案';
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
  if (findRun(d, date, x)) return d;
  const no = runs.reduce((m, r) => Math.max(m, r.no), 0) + 1;
  // 最新の記録を消すと番号は使い回すので、ID には作った時刻も入れて別の記録と取り違えない
  const run: AiRun = {
    id: `${date}#${no}@${x.createdAt}`,
    no,
    date,
    createdAt: x.createdAt,
    label: runLabel(x.rules, Object.keys(x.pins).length, d.presets),
    presetId: presetOf(x.rules, d.presets)?.id ?? null,
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

/** 同じ条件・種・固定・結果の記録（無ければ undefined。addRun のあとに引くと、足した記録かもとからある記録） */
export function findRun(
  d: DemoData,
  date: string,
  x: { rules: Rule[]; pins: Record<string, string>; result: SolveResult },
): AiRun | undefined {
  return (own(d.aiRuns, date) ?? []).find(
    (r) =>
      r.seed === x.result.seed &&
      JSON.stringify(r.rules) === JSON.stringify(x.rules) &&
      JSON.stringify(r.pins) === JSON.stringify(x.pins) &&
      JSON.stringify(r.routes) === JSON.stringify(x.result.routes),
  );
}

/** 記録の費用といまの費用の差の許し（同じ計算なら一致する。浮動小数の誤差だけ許す） */
const SAME_COST_EPS = 1e-6;

/**
 * 計算し直さずに使える記録（プリセットのカードを押したときの再計算を省く。ADR-0010）。その日の記録のうち、次をすべて満たす最新のもの：
 * - 固定なし・途中で止めていない
 * - 作ったときの条件（rules）が target を作った条件と同じ（名前・ID・重み・必須まで）・乱数の種が同じ
 * - 記録の案がいまの問題でそのまま有効：訪問の集まりが同じ（どの列か未割当に1回ずつ）・担当はいまの問題の人だけ・必須と時間の違反なし
 * - いまの問題で付け直した費用が、記録した費用と同じ（訪問・スタッフ・移動・相性などが変わっていれば、たいてい費用が変わる）
 * 同じ入力からは同じ案になる（solver は決定的）ので、これらが同じなら作り直しても同じ案になるとみなす。無ければ undefined
 */
export function reusableRun(runs: readonly AiRun[], target: Problem, rules: Rule[], seed: number): AiRun | undefined {
  const key = JSON.stringify(rules);
  const visitIds = new Set(target.visits.map((v) => v.id));
  const staffIds = new Set(target.staff.map((s) => s.id));
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!;
    if (Object.keys(r.pins).length > 0 || r.stopped || r.seed !== seed || JSON.stringify(r.rules) !== key) continue;
    const listed = [...Object.values(r.routes).flat(), ...r.unassigned];
    if (listed.length !== visitIds.size || new Set(listed).size !== listed.length) continue;
    if (!listed.every((id) => visitIds.has(id))) continue;
    if (!Object.entries(r.routes).every(([sid, ids]) => ids.length === 0 || staffIds.has(sid))) continue;
    const sc = score(target, r.routes);
    if (sc.hardViolations.length > 0 || sc.dropped !== r.unassigned.length) continue;
    if (Math.abs(sc.total - r.score) > SAME_COST_EPS) continue;
    return r;
  }
  return undefined;
}

/** 記録を今の案（予定の画面）にする。AIが出したまま＝記録の結果、固定は記録の固定 */
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
    runId: run.id,
  };
}

/** routes から problem に無い訪問IDを除く（担当のキーと並びはそのまま） */
export function alignRoutes(problem: Problem, routes: Record<string, string[]>): Record<string, string[]> {
  const ids = new Set(problem.visits.map((v) => v.id));
  const out: Record<string, string[]> = {};
  for (const [s, list] of Object.entries(routes)) out[s] = list.filter((id) => ids.has(id));
  return out;
}

/**
 * 今の案を、いまの問題（その日の計算に入れる訪問）に合わせる。訪問を取り消す・足す・編集する・コピーすると
 * 案の作成後に訪問が変わるので、描画のたびにこれを通す。
 * problem に無い訪問IDは routes・generated.routes・pins から除き、problem にあってどの列にも無い訪問は unassigned に入れ、
 * score は付け直す。合わせるものが無ければ plan をそのまま返す（同じオブジェクト）
 */
export function alignPlan(problem: Problem, plan: AiPlan): AiPlan {
  const ids = new Set(problem.visits.map((v) => v.id));
  const routes = alignRoutes(problem, plan.routes);
  const genRoutes = alignRoutes(problem, plan.generated.routes);
  const pins = Object.fromEntries(Object.entries(plan.pins).filter(([id]) => ids.has(id)));
  const unassignedOf = (r: Record<string, string[]>) => {
    const placed = new Set(Object.values(r).flat());
    return problem.visits.map((v) => v.id).filter((id) => !placed.has(id));
  };
  const unassigned = unassignedOf(routes);
  const genUnassigned = unassignedOf(genRoutes);
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));
  const count = (r: Record<string, string[]>) => Object.values(r).flat().length;
  const unchanged =
    count(routes) === count(plan.routes) &&
    count(genRoutes) === count(plan.generated.routes) &&
    Object.keys(pins).length === Object.keys(plan.pins).length &&
    sameSet(unassigned, plan.unassigned) &&
    sameSet(genUnassigned, plan.generated.unassigned);
  if (unchanged) return plan;
  return {
    ...plan,
    routes,
    unassigned,
    score: score(problem, routes).total,
    generated: { routes: genRoutes, unassigned: genUnassigned, score: score(problem, genRoutes).total },
    pins,
  };
}
