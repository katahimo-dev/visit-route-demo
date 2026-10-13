// 焼きなまし（ADR-0003）。ClassClassify の anneal.ts の構成：貪欲な初期解（素朴な案の方が良ければそれ）・差分評価・
// 初期温度を改悪幅の中央値から・指数冷却・最後に貪欲な仕上げ。止めるのは反復回数（時刻は使わない）
import type { Problem, SolveOptions, SolveResult, Solver } from '../contracts/problem';
import { DROP_POINTS } from '../contracts/rules';
import { balanceOff, balancePoints, totalPoints } from '../matching/cost';
import { naiveSeqs } from '../matching/naive';
import { routeCost, scheduleRoute } from '../matching/timing';

const INF = Number.POSITIVE_INFINITY;
const EPS = 1e-9;
/** 仕上げの繰り返しの上限 */
const POLISH_PASSES = 10;

/** seed 付きの乱数（mulberry32）。[0, 1) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSolver(problem: Problem, options: SolveOptions): Solver {
  const rand = mulberry32(options.seed);
  const total = Math.max(0, Math.floor(options.iterations));
  const S = problem.staff.length;
  const V = problem.visits.length;
  const allowedStaff: number[][] = problem.visits.map((_, v) => {
    const out: number[] = [];
    for (let s = 0; s < S; s++) if (problem.allowed[v]![s]) out.push(s);
    return out;
  });
  const ok = (v: number, s: number) => problem.allowed[v]![s] === true;

  // --- 状態 ---
  const routes: number[][] = problem.staff.map(() => []);
  const cost = new Float64Array(S);
  const routeOf = new Int32Array(V).fill(-1);
  const unassigned: number[] = [];
  const unPos = new Int32Array(V).fill(-1);
  const counts = new Int32Array(S);
  let current = 0;

  // 差分評価用の作業領域
  const bufA = new Int32Array(V + 1);
  const bufB = new Int32Array(V + 1);
  const bufC = new Int32Array(V + 1);
  const bufD = new Int32Array(V + 1);

  const bal = problem.balance;
  const cap = bal?.cap ?? null;
  /** s の件数を1つ増やしても上限（必須の均等）を超えないか */
  const roomFor = (s: number): boolean => !cap || counts[s]! + 1 <= cap[s]!;
  /** 件数を a: da, b: db だけ変えたときの均等の点の差（外れた件数の2乗） */
  const balDelta = (a: number, da: number, b: number, db: number): number => {
    if (!bal) return 0;
    const one = (s: number, c: number) => {
      const e = balanceOff(bal, s, c);
      return e * e;
    };
    let d = 0;
    if (a >= 0) d += one(a, counts[a]! + da) - one(a, counts[a]!);
    if (b >= 0 && b !== a) d += one(b, counts[b]! + db) - one(b, counts[b]!);
    else if (b >= 0 && b === a) d += one(a, counts[a]! + da + db) - one(a, counts[a]! + da);
    return d * bal.perVisit;
  };

  /** route の idx 番目を除いた列を out に写す。長さを返す */
  const without = (route: ArrayLike<number>, len: number, idx: number, out: Int32Array): number => {
    let k = 0;
    for (let i = 0; i < len; i++) if (i !== idx) out[k++] = route[i]!;
    return k;
  };
  let lastPos = -1;
  /** base（長さ len）に v を入れる最良の位置の費用。位置は lastPos */
  const bestInsert = (s: number, v: number, base: ArrayLike<number>, len: number): number => {
    let best = INF;
    lastPos = -1;
    for (let p = 0; p <= len; p++) {
      for (let i = 0; i < p; i++) bufD[i] = base[i]!;
      bufD[p] = v;
      for (let i = p; i < len; i++) bufD[i + 1] = base[i]!;
      const c = routeCost(problem, s, bufD, len + 1);
      if (c < best) {
        best = c;
        lastPos = p;
      }
    }
    return best;
  };

  const addUnassigned = (v: number) => {
    unPos[v] = unassigned.length;
    unassigned.push(v);
    routeOf[v] = -1;
  };
  const removeUnassigned = (v: number) => {
    const i = unPos[v]!;
    const last = unassigned.pop()!;
    if (last !== v) {
      unassigned[i] = last;
      unPos[last] = i;
    }
    unPos[v] = -1;
  };
  const setRoute = (s: number, seq: ArrayLike<number>, len: number, c: number) => {
    const r: number[] = new Array(len);
    for (let i = 0; i < len; i++) {
      r[i] = seq[i]!;
      routeOf[seq[i]!] = s;
    }
    routes[s] = r;
    cost[s] = c;
    counts[s] = len;
  };
  /** v を s の pos に入れた列を作って置く */
  const putAt = (s: number, base: ArrayLike<number>, len: number, v: number, pos: number, c: number) => {
    for (let i = 0; i < pos; i++) bufD[i] = base[i]!;
    bufD[pos] = v;
    for (let i = pos; i < len; i++) bufD[i + 1] = base[i]!;
    setRoute(s, bufD, len + 1, c);
  };

  // --- 近傍：それぞれ差分を返し、apply で採る ---
  type Move = { d: number; apply: () => void } | null;

  /** v を担当 b の最良位置へ移す（b が同じなら列の中で最良位置へ） */
  const relocate = (v: number, b: number): Move => {
    const a = routeOf[v]!;
    const ra = routes[a]!;
    const idx = ra.indexOf(v);
    const lenA = without(ra, ra.length, idx, bufA);
    if (a === b) {
      const c = bestInsert(a, v, bufA, lenA);
      if (c === INF) return null;
      const pos = lastPos;
      return { d: c - cost[a]!, apply: () => putAt(a, bufA, lenA, v, pos, c) };
    }
    if (!roomFor(b)) return null;
    const cA = lenA === 0 ? 0 : routeCost(problem, a, bufA, lenA);
    if (cA === INF) return null;
    const rb = routes[b]!;
    const cB = bestInsert(b, v, rb, rb.length);
    if (cB === INF) return null;
    const pos = lastPos;
    const d = cA - cost[a]! + cB - cost[b]! + balDelta(a, -1, b, 1);
    return {
      d,
      apply: () => {
        setRoute(a, bufA, lenA, cA);
        putAt(b, rb, rb.length, v, pos, cB);
      },
    };
  };

  /** 2訪問の担当を入れ替える（それぞれ相手の列の最良位置へ） */
  const swap = (v1: number, v2: number): Move => {
    const a = routeOf[v1]!;
    const b = routeOf[v2]!;
    if (a === b || a < 0 || b < 0 || !ok(v1, b) || !ok(v2, a)) return null;
    const ra = routes[a]!;
    const rb = routes[b]!;
    const lenA = without(ra, ra.length, ra.indexOf(v1), bufA);
    const lenB = without(rb, rb.length, rb.indexOf(v2), bufC);
    const cA = bestInsert(a, v2, bufA, lenA);
    if (cA === INF) return null;
    const posA = lastPos;
    const cB = bestInsert(b, v1, bufC, lenB);
    if (cB === INF) return null;
    const posB = lastPos;
    return {
      d: cA - cost[a]! + cB - cost[b]!,
      apply: () => {
        putAt(a, bufA, lenA, v2, posA, cA);
        putAt(b, bufC, lenB, v1, posB, cB);
      },
    };
  };

  /** 同じ列の中で i 番目を j 番目へ */
  const shift = (s: number, i: number, j: number): Move => {
    const r = routes[s]!;
    const len = r.length;
    const lenA = without(r, len, i, bufA);
    const v = r[i]!;
    for (let k = 0; k < j; k++) bufB[k] = bufA[k]!;
    bufB[j] = v;
    for (let k = j; k < lenA; k++) bufB[k + 1] = bufA[k]!;
    const c = routeCost(problem, s, bufB, len);
    if (c === INF) return null;
    return { d: c - cost[s]!, apply: () => setRoute(s, bufB, len, c) };
  };

  /**
   * 未割当の v を b の最良位置に入れる（allowEject なら、入らないとき・件数の上限のとき b の1件と入れ替える。
   * 入れ替えは件数が変わらないので上限を超えない）
   */
  const insert = (v: number, b: number, allowEject: boolean): Move => {
    const rb = routes[b]!;
    const len = rb.length;
    const room = roomFor(b);
    const c = room ? bestInsert(b, v, rb, len) : INF;
    if (c !== INF) {
      const pos = lastPos;
      return {
        d: c - cost[b]! - DROP_POINTS + balDelta(b, 1, -1, 0),
        apply: () => {
          removeUnassigned(v);
          putAt(b, rb, len, v, pos, c);
        },
      };
    }
    if (!allowEject || len === 0) return null;
    // 入らなければ、b の列から乱数で選んだ1件を外して入れてみる（外した方は未割当へ）
    const bestK = (rand() * len) | 0;
    const lenA0 = without(rb, len, bestK, bufA);
    const best = bestInsert(b, v, bufA, lenA0);
    const bestPos = lastPos;
    if (best === INF) return null;
    const w = rb[bestK]!;
    return {
      // 入れ替えは件数が変わらない（均等の点は同じ）。未割当の数も同じ
      d: best - cost[b]!,
      apply: () => {
        const lenA = without(rb, len, bestK, bufA);
        removeUnassigned(v);
        putAt(b, bufA, lenA, v, bestPos, best);
        addUnassigned(w);
      },
    };
  };

  /** 入っている v を外す */
  const drop = (v: number): Move => {
    const a = routeOf[v]!;
    const ra = routes[a]!;
    const lenA = without(ra, ra.length, ra.indexOf(v), bufA);
    const cA = lenA === 0 ? 0 : routeCost(problem, a, bufA, lenA);
    if (cA === INF) return null;
    return {
      d: cA - cost[a]! + DROP_POINTS + balDelta(a, -1, -1, 0),
      apply: () => {
        setRoute(a, bufA, lenA, cA);
        addUnassigned(v);
      },
    };
  };

  const pick = <T>(xs: readonly T[]): T => xs[(rand() * xs.length) | 0]!;
  /** 入っている訪問を1つ（無ければ -1） */
  const pickAssigned = (): number => {
    if (unassigned.length === V) return -1;
    for (;;) {
      const v = (rand() * V) | 0;
      if (routeOf[v]! >= 0) return v;
    }
  };

  /** 乱数で近傍を1つ作る（作れなければ null） */
  const randomMove = (): Move => {
    const r = rand();
    if (unassigned.length > 0 && r < 0.15) {
      const v = pick(unassigned);
      const cand = allowedStaff[v]!;
      if (cand.length === 0) return null;
      return insert(v, pick(cand), true);
    }
    const v = pickAssigned();
    if (v < 0) return null;
    const a = routeOf[v]!;
    if (r < 0.5) {
      const cand = allowedStaff[v]!;
      const b = pick(cand);
      return relocate(v, b);
    }
    if (r < 0.75) {
      const b = pick(allowedStaff[v]!);
      if (b === a || routes[b]!.length === 0) return null;
      return swap(v, pick(routes[b]!));
    }
    if (r < 0.995) {
      const route = routes[a]!;
      if (route.length < 2) return null;
      const i = route.indexOf(v);
      let j = (rand() * (route.length - 1)) | 0;
      if (j >= i) j++;
      return shift(a, i, j);
    }
    return drop(v);
  };

  const recomputeTotal = (): number => {
    let t = 0;
    for (let s = 0; s < S; s++) t += cost[s]!;
    return t + balancePoints(problem, counts) + unassigned.length * DROP_POINTS;
  };

  // --- 初期解：候補の少ない訪問から、開始が早い順に、最良の担当・位置へ ---
  const order = Array.from({ length: V }, (_, v) => v).sort(
    (x, y) =>
      allowedStaff[x]!.length - allowedStaff[y]!.length ||
      problem.visits[x]!.earliest - problem.visits[y]!.earliest ||
      x - y,
  );
  for (const v of order) addUnassigned(v);
  for (const v of order) {
    let bb = -1;
    let bd = INF;
    for (const b of allowedStaff[v]!) {
      const m = insert(v, b, false);
      if (m && m.d < bd - EPS) {
        bd = m.d;
        bb = b;
      }
    }
    // apply は作業領域を使うので、最良の担当で作り直してから採る
    if (bb >= 0) insert(v, bb, false)!.apply();
  }
  current = recomputeTotal();

  /** 列（staff 添字ごとの訪問添字）を今の状態にする */
  const loadRoutes = (rs: number[][]) => {
    for (const v of unassigned.slice()) removeUnassigned(v);
    routeOf.fill(-1);
    for (let s = 0; s < S; s++) {
      const r = rs[s]!;
      setRoute(s, r, r.length, routeCost(problem, s, r));
    }
    for (let v = 0; v < V; v++) if (routeOf[v]! < 0) addUnassigned(v);
    current = recomputeTotal();
  };

  // 素朴な案の方が良ければ、そこから始める（AI案の費用 ≤ 素朴な案。決定的）
  if (V > 0 && S > 0) {
    const greedy = routes.map((r) => r.slice());
    const greedyTotal = current;
    loadRoutes(naiveSeqs(problem));
    if (!(current < greedyTotal - EPS)) loadRoutes(greedy);
  }

  // --- 初期温度：ランダムな近傍の改悪幅の中央値 ---
  const samples: number[] = [];
  for (let k = 0; k < 300 && V > 0; k++) {
    const m = randomMove();
    if (m && m.d > EPS && m.d < DROP_POINTS / 2) samples.push(m.d);
  }
  samples.sort((x, y) => x - y);
  const T0 = Math.max(samples[samples.length >> 1] ?? 1, 0.5);
  const Tend = T0 * 1e-3;
  const alpha = total > 0 ? (Tend / T0) ** (1 / total) : 1;
  let T = T0;

  let bestTotal = current;
  let bestRoutes = routes.map((r) => r.slice());
  let iter = 0;
  let finished = false;

  const loadBest = () => loadRoutes(bestRoutes);

  // --- 最良解に戻して貪欲に仕上げ（よくなる手だけを採る） ---
  const polish = () => {
    loadBest();
    for (let pass = 0, improved = true; improved && pass < POLISH_PASSES; pass++) {
      improved = false;
      for (let v = 0; v < V; v++) {
        const cand = allowedStaff[v]!;
        if (routeOf[v]! < 0) {
          for (const b of cand) {
            const m = insert(v, b, false);
            if (m && m.d < -EPS) {
              m.apply();
              current += m.d;
              improved = true;
              break;
            }
          }
          continue;
        }
        for (const b of cand) {
          const m = relocate(v, b);
          if (m && m.d < -EPS) {
            m.apply();
            current += m.d;
            improved = true;
          }
        }
      }
      for (let v1 = 0; v1 < V; v1++) {
        if (routeOf[v1]! < 0) continue;
        for (let v2 = v1 + 1; v2 < V; v2++) {
          if (routeOf[v2]! < 0 || routeOf[v1] === routeOf[v2]) continue;
          const m = swap(v1, v2);
          if (m && m.d < -EPS) {
            m.apply();
            current += m.d;
            improved = true;
          }
        }
      }
    }
    current = recomputeTotal();
    bestRoutes = routes.map((r) => r.slice());
    bestTotal = current;
  };

  const step = (n: number): boolean => {
    if (finished) return true;
    const end = Math.min(total, iter + Math.max(1, Math.floor(n)));
    if (V > 0 && S > 0) {
      while (iter < end) {
        iter++;
        T *= alpha;
        const m = randomMove();
        if (!m) continue;
        if (m.d <= 0 || rand() < Math.exp(-m.d / T)) {
          m.apply();
          current += m.d;
          if (current < bestTotal - EPS) {
            bestTotal = current;
            bestRoutes = routes.map((r) => r.slice());
          }
        }
      }
    } else {
      iter = total;
    }
    if (iter >= total) {
      polish();
      finished = true;
    }
    return finished;
  };

  const best = (): SolveResult => {
    // evaluate.score と同じ式・同じ順で点を出し直す
    let travel = 0;
    let wait = 0;
    let assign = 0;
    const bc = new Int32Array(S);
    const out: Record<string, string[]> = {};
    const placed = new Uint8Array(V);
    for (let s = 0; s < S; s++) {
      const r = bestRoutes[s]!;
      const t = scheduleRoute(problem, s, r, 'lenient')!;
      travel += t.travelMinutes;
      wait += t.waitMinutes;
      for (const v of r) {
        assign += problem.assignCost[v]![s]!;
        placed[v] = 1;
      }
      bc[s] = r.length;
      out[problem.staff[s]!.id] = r.map((v) => problem.visits[v]!.id);
    }
    const un: string[] = [];
    for (let v = 0; v < V; v++) if (!placed[v]) un.push(problem.visits[v]!.id);
    const score = totalPoints(problem, {
      travel,
      wait,
      assign,
      balance: balancePoints(problem, bc),
      dropped: un.length,
    });
    return { routes: out, unassigned: un, score, seed: options.seed, iterations: iter, stopped: !finished };
  };

  return { step, iteration: () => iter, bestScore: () => bestTotal, best };
}

/** Worker なしで最後まで解く */
export function solve(problem: Problem, options: SolveOptions): SolveResult {
  const s = createSolver(problem, options);
  while (!s.step(10000));
  return s.best();
}
