import { describe, expect, it } from 'vitest';
import type { Problem } from '../contracts/problem';
import { score } from '../evaluate';
import { compile, scheduleRoute } from '../matching';
import { client, DATE, makeData, randomData, rule, staff, visit } from '../matching/fixtures';
import { createSolver, defaultIterations, solve } from './index';

const RULES = [
  rule('cp', 'compatibility', 3),
  rule('co', 'continuity', 2),
  rule('bal', 'balance', 1),
  rule('w', 'wait', 3),
];

function withConditions(seed: number, nStaff: number, nVisits: number): Problem {
  const d = randomData(nStaff, nVisits, seed, [
    ...RULES,
    rule('req', 'clientRequirement', 0, true),
    rule('pref', 'clientPreference', 3),
  ]);
  d.clients.forEach((c, i) => {
    if (i % 5 === 0) c.requirements = [{ itemId: 'gender', op: 'is', value: '女性' }];
    if (i % 3 === 0) c.preferences = [{ itemId: 'years', op: 'gte', value: 3 }];
    if (i % 4 === 0) c.usualStaffId = d.staff[i % d.staff.length]!.id;
    d.compat[c.id] = { [d.staff[(i * 7) % d.staff.length]!.id]: 2, [d.staff[(i * 3) % d.staff.length]!.id]: -2 };
  });
  return compile(d, DATE);
}

describe('solver', () => {
  it('同じ問題・seed・反復回数なら同じ結果', () => {
    const p = withConditions(11, 6, 24);
    const a = solve(p, { seed: 5, iterations: 30000 });
    const b = solve(p, { seed: 5, iterations: 30000 });
    expect(b).toEqual(a);
    expect(a.iterations).toBe(30000);
    expect(a.stopped).toBe(false);
  });

  it('出た案は可否・時間を守り（hardViolations が空）、score は evaluate の total と一致する', () => {
    for (const seed of [1, 2, 3]) {
      const p = withConditions(seed, 5, 30);
      const r = solve(p, { seed, iterations: 40000 });
      const sc = score(p, r.routes);
      expect(sc.hardViolations).toEqual([]);
      expect(r.score).toBe(sc.total);
      expect(sc.dropped).toBe(r.unassigned.length);
      const all = [...Object.values(r.routes).flat(), ...r.unassigned].sort();
      expect(all).toEqual(p.visits.map((v) => v.id).sort());
      p.staff.forEach((s, i) => {
        const seq = r.routes[s.id]!.map((id) => p.visits.findIndex((v) => v.id === id));
        expect(scheduleRoute(p, i, seq, 'strict')).not.toBeNull();
      });
    }
  });

  it('途中で止めた best() は stopped=true で、そこまでの最良案', () => {
    const p = withConditions(4, 5, 30);
    const s = createSolver(p, { seed: 1, iterations: 100000 });
    expect(s.step(1000)).toBe(false);
    const r = s.best();
    expect(r.stopped).toBe(true);
    expect(r.iterations).toBe(1000);
    expect(score(p, r.routes).hardViolations).toEqual([]);
    expect(r.score).toBe(score(p, r.routes).total);
  });

  it('全条件の重み0なら、近さを見ない割当より総移動が短い', () => {
    const p = compile(randomData(8, 20, 21), DATE);
    expect(p.waitPerMinute).toBe(0);
    const r = solve(p, { seed: 1, iterations: 50000 });
    expect(r.unassigned).toEqual([]);
    // 近さを見ない割当：開始が早い順に、時間が合う担当へ順番に回す
    const order = p.visits.map((_, i) => i).sort((a, b) => p.visits[a]!.earliest - p.visits[b]!.earliest);
    const seqs: number[][] = p.staff.map(() => []);
    let k = 0;
    for (const v of order) {
      for (let t = 0; t < p.staff.length; t++) {
        const s = (k + t) % p.staff.length;
        if (p.allowed[v]![s] && scheduleRoute(p, s, [...seqs[s]!, v], 'strict')) {
          seqs[s]!.push(v);
          k = s + 1;
          break;
        }
      }
    }
    const naive = Object.fromEntries(p.staff.map((s, i) => [s.id, seqs[i]!.map((v) => p.visits[v]!.id)]));
    expect(score(p, r.routes).travelMinutes).toBeLessThan(score(p, naive).travelMinutes);
  });

  it('相性◎の重みを上げると、担当が◎の人へ寄る', () => {
    const data = (w: number) =>
      makeData({
        staff: [staff('near', 38.26, 140.87), staff('far', 38.26, 140.9)],
        clients: [client('c1', 38.261, 140.871)],
        visits: [visit('v1', 'c1', '10:00', '11:00')],
        compat: { c1: { far: 2 } },
        rules: [rule('cp', 'compatibility', w)],
      });
    const pick = (w: number) => solve(compile(data(w), DATE), { seed: 1, iterations: 2000 }).routes;
    expect(pick(0.5).near).toEqual(['v1']);
    expect(pick(3).far).toEqual(['v1']);
  });

  it('どの担当も可でない訪問は未割当', () => {
    const d = randomData(3, 8, 5, [rule('req', 'clientRequirement', 0, true)]);
    d.clients[0]!.requirements = [{ itemId: 'license', op: 'hasAny', value: ['看護師'] }];
    const p = compile(d, DATE);
    expect(p.infeasible.map((x) => x.visit)).toEqual([0]);
    const r = solve(p, { seed: 1, iterations: 5000 });
    expect(r.unassigned).toContain('v1');
  });

  it('速さ：8人・20件で3秒、30人・150件で30秒以内（CI 向けに緩めて計測）', () => {
    for (const [S, V, limit] of [
      [8, 20, 6000],
      [30, 150, 30000],
    ] as const) {
      const p = withConditions(7, S, V);
      const t0 = performance.now();
      const r = solve(p, { seed: 1, iterations: defaultIterations(p) });
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(limit);
      expect(score(p, r.routes).hardViolations).toEqual([]);
    }
  }, 120000);
});
