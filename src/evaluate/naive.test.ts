// 素朴な案（solver の初期解の候補）と、AI案がそれより悪くならないこと（ADR-0007。レビュー H1・H2）
import { describe, expect, it } from 'vitest';
import { compile } from '../matching';
import { client, DATE, makeData, randomData, rule, staff, visit } from '../matching/fixtures';
import { applyPreset, createDemoData, INITIAL_PRESETS } from '../seed';
import { defaultIterations, solve } from '../solver';
import { naivePlan, normalize, score, toHundred } from './index';

describe('素朴な案', () => {
  it('件数の上限（必須の均等）と必須の条件を守り、必須の違反が無い', () => {
    const p = compile(
      makeData({
        staff: [
          staff('s1', 38.26, 140.87, { traits: { license: ['看護師'] } }),
          staff('s2', 38.27, 140.89, { traits: { license: ['なし'] } }),
        ],
        clients: [
          client('c1', 38.262, 140.872, { requirements: [{ itemId: 'license', op: 'hasAny', value: ['看護師'] }] }),
          client('c2', 38.261, 140.871),
          client('c3', 38.263, 140.873),
          client('c4', 38.264, 140.874),
        ],
        visits: [
          visit('v1', 'c1', '09:00', '09:00', { windowKind: 'fixed' }),
          visit('v2', 'c2', '11:00', '11:00', { windowKind: 'fixed' }),
          visit('v3', 'c3', '13:00', '13:00', { windowKind: 'fixed' }),
          visit('v4', 'c4', '15:00', '15:00', { windowKind: 'fixed' }),
        ],
        rules: [rule('req', 'clientRequirement', 0, true), rule('bal', 'balance', 3, true)],
      }),
      DATE,
    );
    const routes = naivePlan(p);
    const sc = score(p, routes);
    expect(sc.hardViolations).toEqual([]);
    expect(sc.dropped).toBe(0);
    // v1 は s1 だけ。s1 の近くでも、件数の上限（目安の上＋1＝3件）を超えて s1 に寄せない
    expect(routes.s1).toContain('v1');
    expect(routes.s1!.length).toBeLessThanOrEqual(p.balance!.cap![0]!);
  });

  it('担当できる人の少ない訪問を先に入れ、あとの訪問は順番の途中にも挟む（入る訪問を落とさない）', () => {
    // s2 は 16時からの v3 しか担当できない人がいない。v2（15:30〜）を先に s2 に入れると v3 が入らない
    const p = compile(
      makeData({
        staff: [staff('s1', 38.26, 140.87), staff('s2', 38.27, 140.89)],
        clients: [client('c1', 38.262, 140.872), client('c2', 38.271, 140.891), client('c3', 38.272, 140.892)],
        visits: [
          visit('v1', 'c1', '09:00', '09:00', { windowKind: 'fixed' }),
          visit('v2', 'c2', '15:30', '15:30', { windowKind: 'fixed' }),
          visit('v3', 'c3', '16:00', '16:00', { windowKind: 'fixed' }),
        ],
        compat: { c3: { s1: -2 } },
        rules: [rule('cp', 'compatibility', 3)],
      }),
      DATE,
    );
    const routes = naivePlan(p);
    expect(score(p, routes).dropped).toBe(0);
    expect(routes.s2).toContain('v3');
  });

  it('手作業案（必須の違反あり）の点も 0〜100 に収まり、違反は hardViolations に出る（画面は「参考」）', () => {
    const d = randomData(4, 20, 3, [rule('req', 'clientRequirement', 0, true)]);
    const p = compile(d, DATE);
    const s = normalize(p);
    // 担当できない組を無理に入れる
    const v = p.visits.findIndex((_, i) => p.allowed[i]!.some((x) => !x));
    expect(v).toBeGreaterThanOrEqual(0);
    const bad = p.allowed[v]!.findIndex((x) => !x);
    const routes = { [p.staff[bad]!.id]: [p.visits[v]!.id] };
    const sc = score(p, routes);
    expect(sc.hardViolations.length).toBeGreaterThan(0);
    const h = toHundred(sc.total, s);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(100);
  });
});

describe('AI案は素朴な案より悪くならない（初期解の候補に素朴な案）', () => {
  it('ランダムな問題で、反復が少なくても AI案の費用 ≤ 素朴な案', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const q = compile(randomData(5, 25, seed), DATE);
      const naive = score(q, naivePlan(q)).total;
      for (const iterations of [0, 50, 2000]) {
        expect(solve(q, { seed, iterations }).score).toBeLessThanOrEqual(naive + 1e-6);
      }
    }
  });

  it('seed の14日すべて・各プリセットで、AI案の費用 ≤ 素朴な案、AI案の点 > 0。平日・土日の点の範囲を出す', () => {
    const demo = createDemoData('2026-10-12');
    const dates = [...new Set(demo.visits.map((v) => v.date))].sort();
    expect(dates).toHaveLength(14);
    /** プリセット名 → 平日・土日の点 */
    const ranges = new Map<string, { weekday: number[]; weekend: number[] }>();
    for (const date of dates) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      for (const preset of INITIAL_PRESETS) {
        const q = compile({ ...demo, rules: applyPreset(demo.rules, preset) }, date);
        const s = normalize(q);
        const naiveRoutes = naivePlan(q);
        const r = solve(q, { seed: demo.seed, iterations: defaultIterations(q) });
        expect(r.score).toBeLessThanOrEqual(score(q, naiveRoutes).total + 1e-6);
        expect(score(q, naiveRoutes).dropped).toBe(0);
        const h = toHundred(r.score, s);
        expect(h, `${date} ${preset.name}`).toBeGreaterThan(0);
        expect(h).toBeLessThanOrEqual(100);
        const e = ranges.get(preset.name) ?? { weekday: [], weekend: [] };
        (weekday >= 1 && weekday <= 5 ? e.weekday : e.weekend).push(h);
        ranges.set(preset.name, e);
      }
    }
    const span = (xs: number[]) => `${Math.min(...xs)}〜${Math.max(...xs)}点（${xs.length}日）`;
    for (const [name, e] of ranges) console.info(`[点数] ${name}：平日 ${span(e.weekday)}・土日 ${span(e.weekend)}`);
  }, 300000);
});
