// 予定を組む月の決まり（ADR-0063。予定のモードは廃止）：組む月（月の後半は来月）・担当なしの日の数・メニューの件数の印。
// データは書き換えない
import type { DemoData } from '../contracts/data';
import { addDays } from '../domain/time';
import { own } from './common';
import { activeDayVisits } from './dayPlan';
import { HOME_NEXT_MONTH_FROM_DAY, monthLabel } from './home';
import { monthDates, ymOf } from './month';

/** 来月（YYYY-MM） */
export const nextYm = (today: string): string => ymOf(addDays(`${ymOf(today)}-01`, 31));

/** 月の後半か（ホームが来月の準備を出すのと同じ日から。PRD D255） */
export const isLateMonth = (today: string): boolean => Number(today.slice(8, 10)) >= HOME_NEXT_MONTH_FROM_DAY;

/** 組む月：月の後半なら来月、前半なら今月（メニューの「◯月の予定」・「担当を組む」） */
export const planYm = (today: string): string => (isLateMonth(today) ? nextYm(today) : ymOf(today));

/**
 * その月の、担当なしの訪問がある日（今日以降・まだ伝えていない日）の数。ホームの「N月の担当を AI で組む」と同じ日の数え方
 * （担当が null の訪問。取り消し・〈利用者さん〉の休みの回は数えない）。compile しないので軽い
 */
export function unassignedDays(
  data: Pick<DemoData, 'visits' | 'patterns' | 'clients' | 'clientLeaves' | 'snapshots'>,
  ym: string,
  today: string,
): number {
  // 同じデータ・月・今日なら覚えた数（メニュー・既定のモードで何度も数えない。データは書き換えず新しい物になる）
  const key = `${ym}|${today}`;
  const memo = UNASSIGNED_MEMO.get(data);
  const hit = memo?.get(key);
  if (hit !== undefined) return hit;
  const n = countUnassigned(data, ym, today);
  if (memo) memo.set(key, n);
  else UNASSIGNED_MEMO.set(data, new Map([[key, n]]));
  return n;
}
const UNASSIGNED_MEMO = new WeakMap<object, Map<string, number>>();
function countUnassigned(
  data: Pick<DemoData, 'visits' | 'patterns' | 'clients' | 'clientLeaves' | 'snapshots'>,
  ym: string,
  today: string,
): number {
  let n = 0;
  for (const d of monthDates(ym)) {
    if (d < today || own(data.snapshots, d)) continue;
    if (activeDayVisits(data, d).some((v) => v.staffId === null)) n += 1;
  }
  return n;
}

/** 来月を組んでいないとみなす日の数（ホームの「担当なし」のカードと同じ。2日以上） */
export const PLAN_NEEDED_DAYS = 2;

/** メニューの「◯月の予定」の名前 */
export const planLabel = (today: string): string => `${monthLabel(planYm(today))}の予定`;

/**
 * メニューの件数の印（PRD D349）：組む月の担当なしの日の数（unassignedDays）と、今日に訪問があってまだ伝えていないか。
 * compile しないので画面を移るたびに数えても軽い
 */
export function menuBadges(
  data: Pick<DemoData, 'visits' | 'patterns' | 'clients' | 'clientLeaves' | 'snapshots'>,
  today: string,
): { planUnassignedDays: number; todayUntold: boolean } {
  return {
    planUnassignedDays: unassignedDays(data, planYm(today), today),
    todayUntold: !own(data.snapshots, today) && activeDayVisits(data, today).length > 0,
  };
}
