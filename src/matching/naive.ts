// 素朴な案（点数の0点。ADR-0007）：evaluate の物差しと、solver の初期解の候補に使う。乱数・時刻は使わない（決定的）
import type { Problem } from '../contracts/problem';
import { routeCost } from './timing';

const INF = Number.POSITIVE_INFINITY;
const EPS = 1e-9;

/**
 * 素朴な案（staff 添字ごとの訪問添字の列）。訪問を、担当できる人の少ない順・開始（earliest）の早い順に、可否・件数の上限を満たす担当それぞれについて、
 * その担当の順番の中で時間の約束・稼働時間帯（strict）を守って入る位置のうち、増える移動が最も少ない位置を探し、
 * 増える移動が最も少ない担当のその位置に挟む（同じなら staff の順で先の人・前の位置）。
 * 条件の点（割当費用）は見ない（機械的に近い人に割り当てる）。どの担当にも入らない訪問だけ落とす
 */
export function naiveSeqs(problem: Problem): number[][] {
  const order = problem.visits.map((_, i) => i);
  // 担当できる人の少ない訪問を先に（後から入れる場所が無くなって落ちないように）
  const cand = problem.visits.map((_, v) => problem.allowed[v]!.filter(Boolean).length);
  order.sort((a, b) => cand[a]! - cand[b]! || problem.visits[a]!.earliest - problem.visits[b]!.earliest || a - b);
  const seqs: number[][] = problem.staff.map(() => []);
  const cap = problem.balance?.cap ?? null;
  const tr = problem.travel;
  for (const v of order) {
    const to = problem.visits[v]!.point;
    let bestS = -1;
    let bestPos = -1;
    let bestAdd = INF;
    for (let s = 0; s < problem.staff.length; s++) {
      if (!problem.allowed[v]![s]) continue;
      const seq = seqs[s]!;
      if (cap && seq.length + 1 > cap[s]!) continue;
      const home = problem.staff[s]!.point;
      for (let p = 0; p <= seq.length; p++) {
        const prev = p === 0 ? home : problem.visits[seq[p - 1]!]!.point;
        const next = p === seq.length ? home : problem.visits[seq[p]!]!.point;
        // 増える移動（前の場所→この訪問→次の場所。空の列は行きと帰り）
        const add = tr[prev]![to]! + tr[to]![next]! - (seq.length === 0 ? 0 : tr[prev]![next]!);
        if (add >= bestAdd - EPS) continue;
        const t = [...seq.slice(0, p), v, ...seq.slice(p)];
        if (routeCost(problem, s, t) === INF) continue;
        bestS = s;
        bestPos = p;
        bestAdd = add;
      }
    }
    if (bestS >= 0) seqs[bestS]!.splice(bestPos, 0, v);
  }
  return seqs;
}
