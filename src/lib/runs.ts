// AI案の記録（ADR-0005）：作るたびに条件と結果を残し、比較の画面で任意の2つを比べる
import { type AiPlan, type AiRun, type DemoData, MAX_RUNS_PER_DAY, type ReassignInfo } from '../contracts/data';
import type { Problem, SolveResult } from '../contracts/problem';
import type { Preset, Rule } from '../contracts/rules';
import { score } from '../evaluate';
import { presetOf } from '../seed';
import { own } from './common';
import { calcFeaturesOf, sameCalcFeatures } from './features';

/** 記録の名前：プリセットと一致すればプリセット名、違えば「条件を変えた案」。固定を残した組み直しは件数を足す */
export function runLabel(rules: Rule[], pinCount: number, presets: readonly Preset[]): string {
  const base = presetOf(rules, presets)?.name ?? '条件を変えた案';
  return pinCount > 0 ? `${base}・固定${pinCount}件で組み直し` : base;
}

/**
 * その日の記録に1件足す。同じ条件・種・固定・結果の記録がすでにあれば足さない（同じ入力からは同じ案になる）。
 * そのとき inputKey（計算に使った問題のキー。problemKey）が違えば、その記録の inputKey を今回のものにする
 * （データを変えても同じ案になった。いまのデータで再計算を省けるように）。presetId も今の時点で一致するプリセットに書き直す。
 * 1日 MAX_RUNS_PER_DAY 件まで（古いものから消す）。
 * 欠勤の振り直し（ADR-0011）は reassign（元の案）と label（「欠勤の振り直し（〈名前〉さん）」）を付けて足す
 */
export function addRun(
  d: DemoData,
  date: string,
  x: {
    rules: Rule[];
    pins: Record<string, string>;
    result: SolveResult;
    createdAt: number;
    inputKey?: string;
    label?: string;
    reassign?: ReassignInfo;
  },
): DemoData {
  const runs = own(d.aiRuns, date) ?? [];
  /** 今の時点で重みが一致するプリセット（どれとも一致しなければ null）。記録の presetId は「最後に作ったときに一致したプリセット」 */
  const presetId = presetOf(x.rules, d.presets)?.id ?? null;
  /**
   * 作ったときの計算に効く入り切り（ADR-0028。PRD D214）。切っているものだけを書き、すべて入なら書かない
   * （記録に無ければすべて入。すべて入のデータの記録は今までと同じ形）
   */
  const calc = calcFeaturesOf(d.org.features);
  const calcField = Object.keys(calc).length > 0 ? { calcFeatures: calc } : {};
  const found = findRun(d, date, x);
  if (found) {
    // 使い回すときも presetId を今の時点のものに書き直す（プリセットの重みを変えたあとにいまの条件で作り直して同じ案になったとき、
    // 古い presetId のままだと「条件が変わった」（lib/month の rulesStale）が消えない。PR #40 の再レビュー）
    // 計算に効く入り切り（ADR-0028）も今のものに書き直す（記録として。「条件が変わった」は入り切りを見ず問題の違いで決める）
    const inputKey = x.inputKey === undefined ? found.inputKey : x.inputKey;
    if (found.inputKey === inputKey && found.presetId === presetId && sameCalcFeatures(found.calcFeatures, calc)) {
      return d;
    }
    const { calcFeatures: _old, ...rest } = found;
    const patched: AiRun = {
      ...rest,
      presetId,
      ...(inputKey !== undefined ? { inputKey } : {}),
      ...calcField,
    };
    return {
      ...d,
      aiRuns: { ...d.aiRuns, [date]: runs.map((r) => (r === found ? patched : r)) },
    };
  }
  const no = runs.reduce((m, r) => Math.max(m, r.no), 0) + 1;
  // 最新の記録を消すと番号は使い回すので、ID には作った時刻も入れて別の記録と取り違えない
  const run: AiRun = {
    id: `${date}#${no}@${x.createdAt}`,
    no,
    date,
    createdAt: x.createdAt,
    label: x.label ?? runLabel(x.rules, Object.keys(x.pins).length, d.presets),
    presetId,
    seed: x.result.seed,
    iterations: x.result.iterations,
    rules: x.rules,
    pins: x.pins,
    routes: x.result.routes,
    unassigned: x.result.unassigned,
    score: x.result.score,
    stopped: x.result.stopped,
    ...(x.inputKey !== undefined ? { inputKey: x.inputKey } : {}),
    ...(x.reassign ? { reassign: x.reassign } : {}),
    ...calcField,
  };
  return { ...d, aiRuns: { ...d.aiRuns, [date]: [...runs, run].slice(-MAX_RUNS_PER_DAY) } };
}

/**
 * 同じ条件・種・固定・結果の記録（無ければ undefined。addRun のあとに引くと、足した記録かもとからある記録）。
 * 欠勤の振り直しの記録（reassign 付き）とふつうの記録、案A と案B（重みの違う案B）の記録は、結果が同じでも別の記録（ADR-0011）
 */
export function findRun(
  d: DemoData,
  date: string,
  x: { rules: Rule[]; pins: Record<string, string>; result: SolveResult; reassign?: ReassignInfo },
): AiRun | undefined {
  return (own(d.aiRuns, date) ?? []).find(
    (r) =>
      !!r.reassign === !!x.reassign &&
      r.reassign?.method === x.reassign?.method &&
      r.reassign?.stayWeight === x.reassign?.stayWeight &&
      r.seed === x.result.seed &&
      JSON.stringify(r.rules) === JSON.stringify(x.rules) &&
      JSON.stringify(r.pins) === JSON.stringify(x.pins) &&
      JSON.stringify(r.routes) === JSON.stringify(x.result.routes),
  );
}

/** FNV-1a（32bit）。basis を変えて2回かけ、キーの取り違えを減らす */
function fnv1a(text: string, basis: number): string {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * 問題（Problem）の中身のキー（AiRun.inputKey。ADR-0010）。費用と可否に効くものをすべて入れる：
 * 日付・スタッフ（自宅の地点・稼働時間帯）・訪問（地点・時間の約束・作業時間）・移動と距離の行列・可否・割当費用・待ちの点・均等。
 * 理由（reasons・infeasible）は可否と費用から決まる説明なので入れない。同じ中身なら同じキー（決定的）
 */
export function problemKey(p: Problem): string {
  const text = JSON.stringify([
    p.date,
    p.staff.map((s) => [s.id, s.point, s.slots.map((t) => [t.start, t.end])]),
    p.visits.map((v) => [v.id, v.clientId, v.point, v.earliest, v.latest, v.duration]),
    p.travel,
    p.meters,
    p.allowed,
    p.assignCost,
    p.waitPerMinute,
    p.balance ? [p.balance.perVisit, p.balance.lo, p.balance.hi, p.balance.cap] : null,
  ]);
  return `${text.length.toString(36)}-${fnv1a(text, 0x811c9dc5)}-${fnv1a(text, 0x01234567)}`;
}

/**
 * 計算し直さずに使える記録（プリセットのカードを押したときの再計算を省く。ADR-0010）。その日の記録のうち、次をすべて満たす最新のもの：
 * - 固定なし・途中で止めていない
 * - 作ったときの条件（rules）が同じ（名前・ID・重み・必須まで）・乱数の種が同じ
 * - 計算に使った問題のキー（inputKey）が、いまの条件で作った問題 target のキーと同じ（訪問・スタッフ・稼働時間・移動・相性などがすべて同じ）。
 *   inputKey が無い古い記録は使わない
 * 同じ入力からは同じ案になる（solver は決定的。反復の回数も問題から決まる）ので、作り直しても同じ案になる。無ければ undefined。
 * 例外：初期データの案（seed/plans。PRD D225・ADR-0031）は反復を10万回までに減らして作るので、画面の既定の反復で作り直すと
 * 少し違う案になることがある。それでも上の条件を満たせば使い回す（反復の回数は見ない。条件はこのまま）
 * key は problemKey(target)（すでに作ってあれば渡して計算を省く）
 */
export function reusableRun(
  runs: readonly AiRun[],
  target: Problem,
  rules: Rule[],
  seed: number,
  key: string = problemKey(target),
): AiRun | undefined {
  const rulesKey = JSON.stringify(rules);
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!;
    // 欠勤の振り直しの記録は、AI が組んだ案ではないので使わない（ADR-0011）
    if (r.reassign || Object.keys(r.pins).length > 0 || r.stopped || r.seed !== seed) continue;
    if (r.inputKey === undefined || r.inputKey !== key || JSON.stringify(r.rules) !== rulesKey) continue;
    return r;
  }
  return undefined;
}

/** 記録を今の案（予定の画面）にする。AIが出したまま＝記録の結果、固定は記録の固定。振り直しの記録なら元の案も写す */
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
    ...(run.reassign ? { reassign: run.reassign } : {}),
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
