// 手直し（D18）：移した訪問を、移した先の担当の列の中で最も費用の少ない位置に入れる
import type { Problem } from '../contracts/problem';
import { routeCost } from './timing';

/**
 * routes（担当ID → 訪問IDの列）から visitId を抜き、staffId の列の、strict で最も費用
 * （移動＋待ち×係数＋割当費用。routeCost）の少ない位置に入れた新しい routes を返す。
 * どの位置でも strict で入らなければ、開始時刻（earliest）の順の位置に入れる（evaluate の hardViolations で違反として見える）。
 * problem にない訪問ID（計算に入れていない訪問）は列の中の位置を変えずに残す。
 * staffId が problem にない担当なら列の最後に足す。routes は書き換えない
 */
export function bestInsertion(
  problem: Problem,
  routes: Record<string, string[]>,
  visitId: string,
  staffId: string,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, ids] of Object.entries(routes)) out[k] = ids.filter((id) => id !== visitId);
  // 自分のキーだけを見る（スタッフID が constructor などでも Object の組み込みを拾わない）
  const col = Object.hasOwn(out, staffId) ? (out[staffId] ?? []) : [];
  const vIndex = new Map(problem.visits.map((v, i) => [v.id, i]));
  const s = problem.staff.findIndex((x) => x.id === staffId);
  const v = vIndex.get(visitId);
  if (s < 0 || v === undefined) {
    out[staffId] = [...col, visitId];
    return out;
  }
  // 列の中の、problem にある訪問の添字と、その元の列での位置
  const known: number[] = [];
  const at: number[] = [];
  col.forEach((id, k) => {
    const x = vIndex.get(id);
    if (x !== undefined) {
      known.push(x);
      at.push(k);
    }
  });
  let bestPos = -1;
  let best = Number.POSITIVE_INFINITY;
  const seq = new Array<number>(known.length + 1);
  for (let p = 0; p <= known.length; p++) {
    for (let i = 0; i < p; i++) seq[i] = known[i]!;
    seq[p] = v;
    for (let i = p; i < known.length; i++) seq[i + 1] = known[i]!;
    const c = routeCost(problem, s, seq);
    if (c < best) {
      best = c;
      bestPos = p;
    }
  }
  if (bestPos < 0) {
    // strict では入らない：開始時刻の順の位置（同じ時刻ならあと）
    const e = problem.visits[v]!.earliest;
    bestPos = known.findIndex((x) => problem.visits[x]!.earliest > e);
    if (bestPos < 0) bestPos = known.length;
  }
  // 元の列での位置に直す（known の bestPos 番目の直前。最後なら列の最後）
  const k = bestPos < known.length ? at[bestPos]! : col.length;
  out[staffId] = [...col.slice(0, k), visitId, ...col.slice(k)];
  return out;
}
