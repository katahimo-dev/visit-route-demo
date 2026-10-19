// 初期データに今日から7日分の AI案を入れる（PRD D225。ADR-0031）。
// 起動したとき（データが無い・初期状態に戻す）に1回だけ、点数の基準のプリセットで1日ずつ解く。
// 書き方は月の「まとめて作る」と同じ（lib/month の applyDayRun：記録を1件足し、今の案にする）。
// 同じ日付なら同じデータ（乱数はデータの種、止めるのは反復回数。Date.now を使わない）
import type { DemoData } from '../contracts/data';
import { addDays } from '../domain/time';
import { attempt } from '../lib/common';
import { applyDayRun } from '../lib/month';
import { problemKey } from '../lib/runs';
import { compile } from '../matching';
import { defaultIterations, solve } from '../solver';
import { createDemoData } from './index';
import { applyPreset, scorePresetOf } from './presets';

/** 案を入れる日数（今日から） */
export const SEED_PLAN_DAYS = 7;

/**
 * 初期の案の反復回数の上限。画面の既定（defaultIterations：約2秒）より少なくし、起動を待たせない
 * （8人・約17件の日で 1日 約40ms。点数は既定の反復と1点以内）
 */
export const SEED_ITERATIONS = 100_000;

/** 初期の案を作った時刻：その日の日本時間 0:00（同じ日付なら同じ値） */
export const seedCreatedAt = (today: string): number => Date.parse(`${today}T00:00:00+09:00`);

/**
 * today から days 日分、訪問があって案も確定した割当も無い日に、点数の基準のプリセットで AI案を作る。
 * 作れない日（問題を作れない・訪問や働ける人が無い）は飛ばす（起動を止めない）。元のデータは書き換えない
 */
export function withSeedPlans(data: DemoData, today: string, days: number = SEED_PLAN_DAYS): DemoData {
  const preset = scorePresetOf(data.presets, data.scorePresetId);
  const rules = preset ? applyPreset(data.rules, preset) : data.rules;
  const createdAt = seedCreatedAt(today);
  let out = data;
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    if (Object.hasOwn(out.aiPlans, date) || Object.hasOwn(out.manualPlans, date)) continue;
    const p = attempt(() => compile({ ...out, rules }, date)).value;
    if (!p || p.visits.length === 0 || p.staff.length === 0) continue;
    const iterations = Math.min(defaultIterations(p), SEED_ITERATIONS);
    const result = solve(p, { seed: out.seed, iterations });
    out = applyDayRun(out, date, { rules, result, createdAt, inputKey: problemKey(p), onlyEmpty: true });
  }
  return out;
}

/** 起動したときの初期データ：seed の訪問・人・決まり（createDemoData）に、今日から7日分の案を入れたもの */
export function createInitialData(today: string): DemoData {
  return withSeedPlans(createDemoData(today), today);
}
