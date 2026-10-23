// 初期データに今日から7日分の担当を入れる（PRD D225。ADR-0031・ADR-0053）。
// 起動したとき（データが無い・初期状態に戻す）に1回だけ、点数の基準の重みで1日ずつ AI で組み、担当・開始を訪問に書く
// （lib/dayPlan の writeRoutes。「AI で組む」の提案を反映したのと同じ）。
// 同じ日付なら同じデータ（乱数はデータの種、止めるのは反復回数。Date.now を使わない）
import type { DemoData } from '../contracts/data';
import type { Features } from '../contracts/features';
import { addDays } from '../domain/time';
import { dayProblemOf, writeRoutes } from '../lib/dayPlan';
import { visitsOn } from '../patterns';
import { defaultIterations, solve } from '../solver';
import { createDemoData, seedPatternStart } from './index';

/** 担当を入れる日数（今日から） */
export const SEED_PLAN_DAYS = 7;

/**
 * 初期の担当の反復回数の上限。画面の既定（defaultIterations：約2秒）より少なくし、起動を待たせない
 * （8人・約17件の日で 1日 約40ms。点数は既定の反復と1点以内）
 */
export const SEED_ITERATIONS = 100_000;

/**
 * today から days 日分、AI で組んで担当・開始を訪問に書く。作れない日（問題を作れない・訪問や働ける人が無い）は飛ばす
 * （起動を止めない）。元のデータは書き換えない。条件の重みは点数の基準（data.rules は基準にそろっている）
 */
export function withSeedPlans(data: DemoData, today: string, days: number = SEED_PLAN_DAYS): DemoData {
  let out = data;
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const p = dayProblemOf(out, date);
    if (!p || p.visits.length === 0 || p.staff.length === 0) continue;
    const iterations = Math.min(defaultIterations(p), SEED_ITERATIONS);
    const result = solve(p, { seed: out.seed, iterations });
    out = writeRoutes(out, date, p, result.routes, { pins: {} });
  }
  return out;
}

/**
 * 起動したときの初期データ：seed の人・決まり・繰り返し（createDemoData）に、今日から7日分の担当を入れたもの。
 * features は機能の入り切り（既定はすべて入の {}）。担当を組む前に入れる（計算に効く機能（相性・担当を限る）を組むときに使う。PRD D276）
 */
export function createInitialData(today: string, features: Features = {}): DemoData {
  const d = createDemoData(today);
  return withPastTold(withSeedPlans({ ...d, org: { ...d.org, features } }, today), today);
}

/**
 * 繰り返しの開始日（前の月の1日）から昨日までを「伝えた」状態にする（過去の予定は済んだもの。月の予定で混み具合を見られる）。
 * 担当は繰り返しの担当（重ならない人を選んである）のまま、伝えた内容に今の担当を写す（開始は書かない＝時刻の違いを数えない）。
 * 確定した時刻はその日の18:00（日本時間）。計算しないので起動を待たせない
 */
export function withPastTold(data: DemoData, today: string): DemoData {
  const snapshots = { ...data.snapshots };
  for (let date = seedPatternStart(today); date < today; date = addDays(date, 1)) {
    const visits = visitsOn(data, date).filter((v) => !v.cancelled);
    if (visits.length === 0) continue;
    snapshots[date] = {
      date,
      at: Date.parse(`${date}T18:00:00+09:00`),
      visits: visits.map((v) => ({ id: v.id, clientId: v.clientId, staffId: v.staffId, start: null })),
    };
  }
  return { ...data, snapshots };
}
