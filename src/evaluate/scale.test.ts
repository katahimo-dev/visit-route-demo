import { describe, expect, it } from 'vitest';
import { type Problem, SCORE_MAX } from '../contracts/problem';
import { compile } from '../matching';
import { DATE, randomData } from '../matching/fixtures';
import { applyPreset, createDemoData, INITIAL_PRESETS as PRESETS } from '../seed';
import { defaultIterations, solve } from '../solver';
import { hundredBreakdown, naivePlan, normalize, ruleLowerBounds, score, toHundred } from './index';

const DEMO_DATE = '2026-10-13';

describe('点数（ADR-0007 案A。100 −（費用 − 下限）÷ 訪問の件数）', () => {
  const demo = createDemoData('2026-10-12');
  const p = compile(demo, DEMO_DATE);
  const scale = normalize(p);
  const naiveCost = score(p, naivePlan(p)).total;

  it('下限は100点。訪問の件数は Problem の訪問の数', () => {
    expect(SCORE_MAX).toBe(100);
    expect(scale.visits).toBe(p.visits.length);
    expect(scale.visits).toBeGreaterThan(0);
    expect(toHundred(scale.lowerBound, scale)).toBe(100);
    expect(scale.lowerBound).toBeLessThan(naiveCost);
  });

  it('1件あたり10分ぶん余計なら90点', () => {
    expect(toHundred(scale.lowerBound + 10 * scale.visits, scale)).toBe(90);
    expect(toHundred(scale.lowerBound + 35 * scale.visits, scale)).toBe(65);
  });

  it('費用が低いほど点が高く（単調）、0〜100 に収まる', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let c = scale.lowerBound - 500; c <= scale.lowerBound + 120 * scale.visits; c += 7) {
      const h = toHundred(c, scale);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(100);
      expect(h).toBeLessThanOrEqual(prev);
      prev = h;
    }
    expect(toHundred(scale.lowerBound + 1e9, scale)).toBe(0);
    expect(toHundred(scale.lowerBound - 1e6, scale)).toBe(100);
  });

  it('訪問が0件なら常に100点・内訳は空', () => {
    const empty = { ...scale, visits: 0 };
    expect(toHundred(scale.lowerBound + 999, empty)).toBe(100);
    expect(hundredBreakdown(score(p, naivePlan(p)), empty, p)).toEqual([]);
  });

  it('決定的：同じ入力で同じ物差し', () => {
    const again = normalize(compile(createDemoData('2026-10-12'), DEMO_DATE));
    expect(again).toEqual(scale);
  });

  it(`デモデータ ${DEMO_DATE}：AI案は素朴な案より点が高く、内訳の合計はおおむね 100−点数`, () => {
    const r = solve(p, { seed: demo.seed, iterations: defaultIterations(p) });
    const sc = score(p, r.routes);
    expect(scale.lowerBound).toBeLessThanOrEqual(sc.total + 1e-6);
    const h = toHundred(sc.total, scale);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeGreaterThanOrEqual(toHundred(naiveCost, scale));
    const parts = hundredBreakdown(sc, scale, p);
    const sum = parts.reduce((a, x) => a + x.points, 0);
    expect(Math.abs(sum - (100 - h))).toBeLessThanOrEqual(0.5 + 1e-9);
    console.info(
      `[点数] ${DEMO_DATE} AI案 費用${Math.round(sc.total)}→${h}点 / 素朴な案 費用${Math.round(naiveCost)}→${toHundred(naiveCost, scale)}点 / 下限 ${Math.round(scale.lowerBound)}（割当${Math.round(scale.lowerAssign)}・移動${Math.round(scale.lowerTravel)}）・${scale.visits}件`,
      parts.map((x) => `${x.label} −${x.points.toFixed(1)}`).join('・'),
    );
  }, 30000);

  it(`デモデータ ${DEMO_DATE}：どのプリセットの AI案も下限以上の費用`, () => {
    for (const preset of PRESETS) {
      const q = compile({ ...demo, rules: applyPreset(demo.rules, preset) }, DEMO_DATE);
      const s = normalize(q);
      const naive = score(q, naivePlan(q)).total;
      const r = solve(q, { seed: demo.seed, iterations: defaultIterations(q) });
      expect(s.lowerBound).toBeLessThanOrEqual(r.score + 1e-6);
      expect(s.lowerBound).toBeLessThanOrEqual(naive + 1e-6);
      console.info(
        `[点数] ${preset.name}：AI案 費用${Math.round(r.score)}→${toHundred(r.score, s)}点 / 素朴な案 ${Math.round(naive)} / 下限 ${Math.round(s.lowerBound)}`,
      );
    }
  }, 60000);

  it('ランダムな問題でも、下限は素朴な案・AI案・適当な案の費用以下', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const q: Problem = compile(randomData(5, 25, seed), DATE);
      const s = normalize(q);
      const naiveRoutes = naivePlan(q);
      expect(score(q, naiveRoutes).hardViolations).toEqual([]);
      expect(s.lowerBound).toBeLessThanOrEqual(score(q, naiveRoutes).total + 1e-6);
      for (const iterations of [200, 2000, 20000]) {
        const r = solve(q, { seed, iterations });
        expect(s.lowerBound).toBeLessThanOrEqual(r.score + 1e-6);
      }
      // 何も入れない案（全部落とす）も下限以上
      expect(s.lowerBound).toBeLessThanOrEqual(score(q, {}).total + 1e-6);
    }
  }, 60000);
});

describe('ruleLowerBounds（下限の条件ごとの内訳。PRD D173 の点数の理由）', () => {
  it('条件ごとの下限の和は物差しの割当の下限（lowerAssign）と同じ（理由の点の和＝割当費用）', () => {
    const p = compile(createDemoData('2026-10-12'), DEMO_DATE);
    const lower = ruleLowerBounds(p);
    const sum = Object.values(lower).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(normalize(p).lowerAssign, 6);
  });
});
