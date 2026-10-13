import { describe, expect, it } from 'vitest';
import type { Problem } from '../contracts/problem';
import { compile } from '../matching';
import { DATE, randomData } from '../matching/fixtures';
import { applyPreset, createDemoData, PRESETS } from '../seed';
import { defaultIterations, solve } from '../solver';
import { hundredBreakdown, naivePlan, normalize, score, toHundred } from './index';

const DEMO_DATE = '2026-10-13';

describe('100点満点（ADR-0007）', () => {
  const demo = createDemoData('2026-10-12');
  const p = compile(demo, DEMO_DATE);
  const scale = normalize(p);

  it('下限 < 素朴な案。素朴な案自身は0点、下限は100点', () => {
    expect(scale.lowerBound).toBeLessThan(scale.naive);
    expect(toHundred(scale.naive, scale)).toBe(0);
    expect(toHundred(scale.lowerBound, scale)).toBe(100);
    expect(score(p, scale.naiveRoutes).hardViolations).toEqual([]);
  });

  it('費用が低いほど点が高く（単調）、0〜100 に収まる', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let c = scale.lowerBound - 500; c <= scale.naive + 500; c += 7) {
      const h = toHundred(c, scale);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(100);
      expect(h).toBeLessThanOrEqual(prev);
      prev = h;
    }
    expect(toHundred(scale.naive + 1e6, scale)).toBe(0);
    expect(toHundred(scale.lowerBound - 1e6, scale)).toBe(100);
  });

  it('素朴な案 ≤ 下限なら常に100点', () => {
    const flat = { ...scale, naive: scale.lowerBound };
    expect(toHundred(scale.lowerBound + 999, flat)).toBe(100);
    expect(hundredBreakdown(score(p, scale.naiveRoutes), flat, p)).toEqual([]);
  });

  it('決定的：同じ入力で同じ素朴な案・物差し', () => {
    const again = normalize(compile(createDemoData('2026-10-12'), DEMO_DATE));
    expect(again).toEqual(scale);
    expect(naivePlan(p)).toEqual(scale.naiveRoutes);
  });

  it(`デモデータ ${DEMO_DATE}：AI案は素朴な案より点が高く、内訳の合計はおおむね 100−点数`, () => {
    const r = solve(p, { seed: demo.seed, iterations: defaultIterations(p) });
    const sc = score(p, r.routes);
    expect(scale.lowerBound).toBeLessThanOrEqual(sc.total + 1e-6);
    const h = toHundred(sc.total, scale);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(toHundred(scale.naive, scale));
    const parts = hundredBreakdown(sc, scale, p);
    const sum = parts.reduce((a, x) => a + x.points, 0);
    expect(Math.abs(sum - (100 - h))).toBeLessThan(1);
    console.info(
      `[100点] ${DEMO_DATE} AI案 費用${Math.round(sc.total)}→${h}点 / 素朴な案 費用${Math.round(scale.naive)} / 下限 ${Math.round(scale.lowerBound)}（割当${Math.round(scale.lowerAssign)}・移動${Math.round(scale.lowerTravel)}）`,
      parts.map((x) => `${x.label} −${x.points.toFixed(1)}`).join('・'),
    );
  }, 30000);

  it(`デモデータ ${DEMO_DATE}：どのプリセットの AI案も下限以上の費用`, () => {
    for (const preset of PRESETS) {
      const q = compile({ ...demo, rules: applyPreset(demo.rules, preset) }, DEMO_DATE);
      const s = normalize(q);
      const r = solve(q, { seed: demo.seed, iterations: defaultIterations(q) });
      expect(s.lowerBound).toBeLessThanOrEqual(r.score + 1e-6);
      expect(s.lowerBound).toBeLessThanOrEqual(s.naive + 1e-6);
      console.info(
        `[100点] ${preset.name}：AI案 費用${Math.round(r.score)}→${toHundred(r.score, s)}点 / 素朴な案 ${Math.round(s.naive)} / 下限 ${Math.round(s.lowerBound)}`,
      );
    }
  }, 60000);

  it('ランダムな問題でも素朴な案は必須を守り0点、下限は素朴な案・AI案・適当な案の費用以下', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const q: Problem = compile(randomData(5, 25, seed), DATE);
      const s = normalize(q);
      expect(score(q, s.naiveRoutes).hardViolations).toEqual([]);
      if (s.naive > s.lowerBound) expect(toHundred(s.naive, s)).toBe(0);
      expect(s.lowerBound).toBeLessThanOrEqual(s.naive + 1e-6);
      for (const iterations of [200, 2000, 20000]) {
        const r = solve(q, { seed, iterations });
        expect(s.lowerBound).toBeLessThanOrEqual(r.score + 1e-6);
      }
      // 何も入れない案（全部落とす）も下限以上
      expect(s.lowerBound).toBeLessThanOrEqual(score(q, {}).total + 1e-6);
    }
  }, 60000);
});
