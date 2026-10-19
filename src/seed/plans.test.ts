import { describe, expect, it } from 'vitest';
import { aiPlanSchema, aiRunSchema, demoDataSchema } from '../contracts/data';
import { addDays } from '../domain/time';
import { currentRuleKeys, dayStatus, planStale, rulesStale } from '../lib/month';
import { planOfRun, problemKey, reusableRun } from '../lib/runs';
import { compile } from '../matching';
import { applyPreset, createDemoData, INITIAL_PRESETS } from './index';
import { createInitialData, SEED_ITERATIONS, SEED_PLAN_DAYS, seedCreatedAt, withSeedPlans } from './plans';

const TODAY = '2026-10-21';
const data = createInitialData(TODAY);
const days = Array.from({ length: SEED_PLAN_DAYS }, (_, i) => addDays(TODAY, i));
const standard = INITIAL_PRESETS[0]!;

describe('createInitialData（PRD D225）', () => {
  it('今日から続けて7日分の今の案があり、8日目からは無い', () => {
    expect(SEED_PLAN_DAYS).toBe(7);
    expect(Object.keys(data.aiPlans).sort()).toEqual(days);
    expect(Object.keys(data.aiRuns).sort()).toEqual(days);
    expect(data.aiPlans[addDays(TODAY, 7)]).toBeUndefined();
  });

  it('同じ日付なら同じデータ（種と反復回数で決まる）', () => {
    expect(createInitialData(TODAY)).toEqual(data);
  });

  it('案のほかは createDemoData と同じ（確定した割当・訪問の担当は入れない）', () => {
    const base = createDemoData(TODAY);
    expect({ ...data, aiPlans: {}, aiRuns: {} }).toEqual(base);
    expect(data.manualPlans).toEqual({});
    expect(data.visits.every((v) => v.staffId === null)).toBe(true);
  });

  it('契約（demoDataSchema・aiPlanSchema・aiRunSchema）を通る', () => {
    expect(() => demoDataSchema.parse(data)).not.toThrow();
    for (const d of days) {
      expect(() => aiPlanSchema.parse(data.aiPlans[d])).not.toThrow();
      for (const r of data.aiRuns[d]!) expect(() => aiRunSchema.parse(r)).not.toThrow();
    }
  });

  it('記録は日の画面・まとめて作ると同じ書き方（点数の基準「標準」・記録1件・今の案はその記録）', () => {
    const rules = applyPreset(data.rules, standard);
    for (const d of days) {
      const runs = data.aiRuns[d]!;
      expect(runs).toHaveLength(1);
      const run = runs[0]!;
      expect(run.no).toBe(1);
      expect(run.label).toBe(standard.name);
      expect(run.presetId).toBe(standard.id);
      expect(run.rules).toEqual(rules);
      expect(run.pins).toEqual({});
      expect(run.stopped).toBe(false);
      expect(run.seed).toBe(data.seed);
      expect(run.iterations).toBeLessThanOrEqual(SEED_ITERATIONS);
      expect(run.createdAt).toBe(seedCreatedAt(TODAY));
      expect(run.id).toBe(`${d}#1@${seedCreatedAt(TODAY)}`);
      expect(run.calcFeatures).toBeUndefined();
      const p = compile({ ...data, rules }, d);
      expect(run.inputKey).toBe(problemKey(p));
      // 今の案は記録をそのまま（AI が出したまま・固定なし）
      expect(data.aiPlans[d]).toEqual(planOfRun(run));
      // 同じ条件・いまのデータなら日の画面のプリセットのカードは再計算しない
      expect(reusableRun(runs, p, rules, data.seed)).toBe(run);
    }
  });

  it('作った直後は「案あり（未確定）」で、条件が変わったにならない', () => {
    const keys = currentRuleKeys(data.rules, data.presets);
    for (const d of days) {
      expect(dayStatus(data, d).state).toBe('plan');
      expect(rulesStale(data, d, keys)).toBe(false);
      expect(planStale(data, data, d)).toBe(false);
    }
  });

  it('案か確定した割当がすでにある日は変えない', () => {
    const base = createDemoData(TODAY);
    const d1 = addDays(TODAY, 1);
    const withSaved = { ...base, manualPlans: { [d1]: {} } };
    const out = withSeedPlans(withSaved, TODAY);
    expect(out.aiPlans[d1]).toBeUndefined();
    expect(out.aiRuns[d1]).toBeUndefined();
    expect(withSeedPlans(out, TODAY)).toBe(out);
  });
});
