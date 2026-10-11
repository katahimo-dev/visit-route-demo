import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { score } from '../evaluate';
import { compile } from '../matching';
import { client, DATE, makeData, randomData, rule, staff, visit } from '../matching/fixtures';
import { createDemoData } from '../seed';
import { defaultIterations, solve } from './index';

/** 均等の条件だけ必須にしたデータ */
const withHardBalance = (d: DemoData): DemoData => ({
  ...d,
  rules: d.rules.map((r) => (r.type === 'balance' ? { ...r, hard: true } : r)),
});

describe('負担の均等（D17）', () => {
  const demo = createDemoData('2026-10-12');
  for (const date of ['2026-10-12', '2026-10-13', '2026-10-14']) {
    it(`デモデータ ${date}：既定の条件の AI案の件数が全員 目安の帯±1 に収まり、必須なら上限＋1を超えない`, () => {
      for (const data of [demo, withHardBalance(demo)]) {
        const p = compile(data, date);
        const b = p.balance!;
        expect(b).not.toBeNull();
        const r = solve(p, { seed: data.seed, iterations: defaultIterations(p) });
        p.staff.forEach((s, i) => {
          const n = r.routes[s.id]!.length;
          expect(n).toBeGreaterThanOrEqual(b.lo[i]! - 1);
          expect(n).toBeLessThanOrEqual(b.hi[i]! + 1);
          if (b.cap) expect(n).toBeLessThanOrEqual(b.cap[i]!);
        });
        expect(r.score).toBe(score(p, r.routes).total);
      }
    }, 30000);
  }

  it('必須の均等：相性◎で1人に寄せたくなる問題でも上限（hi+1）を超えず、合計点は evaluate と一致する', () => {
    // 2人・8件、時間の幅が広く、全員 s1 と相性◎
    const cl = Array.from({ length: 8 }, (_, i) => client(`c${i + 1}`, 38.26 + i * 0.002, 140.87));
    const d = makeData({
      staff: [staff('s1', 38.26, 140.87), staff('s2', 38.27, 140.88)],
      clients: cl,
      visits: cl.map((c, i) => visit(`v${i + 1}`, c.id, '09:00', '16:00', { durationMinutes: 30 })),
      compat: Object.fromEntries(cl.map((c) => [c.id, { s1: 2 as const }])),
      rules: [rule('cp', 'compatibility', 5), rule('bal', 'balance', 0, true)],
    });
    const p = compile(d, DATE);
    expect(p.balance!.perVisit).toBe(0);
    expect(p.balance!.cap).toEqual(p.balance!.hi.map((h) => h + 1));
    const r = solve(p, { seed: 3, iterations: 40000 });
    const sc = score(p, r.routes);
    expect(sc.hardViolations).toEqual([]);
    expect(r.score).toBe(sc.total);
    p.staff.forEach((s, i) => {
      expect(r.routes[s.id]!.length).toBeLessThanOrEqual(p.balance!.cap![i]!);
    });
    // 必須でなければ寄る（上限を超える人がいる）
    const soft = compile({ ...d, rules: [rule('cp', 'compatibility', 5)] }, DATE);
    const rs = solve(soft, { seed: 3, iterations: 40000 });
    expect(soft.staff.some((s, i) => rs.routes[s.id]!.length > p.balance!.cap![i]!)).toBe(true);
  });

  it('均等の点は外れた件数の2乗（重み3：1件＝30点、2件＝120点）', () => {
    const d = randomData(2, 6, 9, [rule('bal', 'balance', 3)]);
    const p = compile(d, DATE);
    const ids = p.visits.map((v) => v.id);
    const [s1, s2] = p.staff.map((s) => s.id) as [string, string];
    expect(p.balance!.lo).toEqual([3, 3]);
    // 4件・2件：それぞれ1件外れ → 30+30
    expect(score(p, { [s1]: ids.slice(0, 4), [s2]: ids.slice(4) }).balancePoints).toBe(60);
    // 5件・1件：それぞれ2件外れ → 120+120
    const sc = score(p, { [s1]: ids.slice(0, 5), [s2]: ids.slice(5) });
    expect(sc.balancePoints).toBe(240);
    expect(sc.perRule.balance).toEqual({ hits: 0, misses: 2, points: 240 });
  });

  it('必須の均等で上限を超えた手作業案は、超えた分の訪問を hardViolations（notAllowed）に出す', () => {
    const d = randomData(2, 6, 9, [rule('bal', 'balance', 3, true)]);
    const p = compile(d, DATE);
    const ids = p.visits.map((v) => v.id);
    const [s1, s2] = p.staff.map((s) => s.id) as [string, string];
    expect(p.balance!.cap).toEqual([4, 4]);
    const sc = score(p, { [s1]: ids.slice(0, 5), [s2]: ids.slice(5) });
    const capV = sc.hardViolations.filter((h) => h.label === '件数の上限（4件）を超える');
    expect(capV).toEqual([{ visitId: ids[4], staffId: s1, kind: 'notAllowed', label: '件数の上限（4件）を超える' }]);
  });
});
