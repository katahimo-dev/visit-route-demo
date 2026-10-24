// 予定のモード［変更｜確認］（PRD D348。ADR-0061・ADR-0062）の決まり。
// 月・週・日の予定の画面で、仕事の段階ごとに出す操作を絞る。既定のモード・モードごとに出す操作・メニューの件数は純粋関数でここに置く。
// データは書き換えない
import type { DemoData } from '../contracts/data';
import { addDays } from '../domain/time';
import { own } from './common';
import { activeDayVisits } from './dayPlan';
import { HOME_NEXT_MONTH_FROM_DAY, monthLabel } from './home';
import { monthDates, ymOf } from './month';

/** 予定のモード：変更（先の月の担当を整える・前日と当日の欠勤・キャンセル）・確認（日々の確認と連絡） */
export type ScheduleMode = 'change' | 'check';

export const SCHEDULE_MODES: readonly ScheduleMode[] = ['change', 'check'];

/** 切り替えの名前 */
export const MODE_LABEL: Record<ScheduleMode, string> = { change: '変更', check: '確認' };

/** モードの1行の説明（ナビの行の下に出す。staff は〈スタッフ〉の呼び方） */
export function modeLead(mode: ScheduleMode, staff: string): string {
  if (mode === 'change') return '担当を AI で組む・動かす、欠勤・キャンセルを登録して影響のある訪問を組み直します';
  return `その日の担当を見て、${staff}に伝えたら確定します（札は動かしません）`;
}

/** モードで出す操作（予定の3画面で共通） */
export type ModeTools = {
  /** 欠勤・キャンセルを登録 */
  absence: boolean;
  /** 「AI で組む ▾」 */
  ai: boolean;
  /** 予定をメールで送る */
  mail: boolean;
  /** 札をドラッグ・キーで動かす（担当・日時を変える） */
  move: boolean;
};

/**
 * モードごとに出す操作：変更＝すべて、確認＝欠勤の登録・メール（AI で組む・札を動かすは出さない。見て伝えるだけ）
 */
export function modeTools(mode: ScheduleMode): ModeTools {
  if (mode === 'check') return { absence: true, ai: false, mail: true, move: false };
  return { absence: true, ai: true, mail: true, move: true };
}

/** 文字をモードとして読む（古い 'plan'（組む）は変更。読めなければ null） */
export const parseMode = (s: string | null | undefined): ScheduleMode | null =>
  s === 'plan' ? 'change' : SCHEDULE_MODES.includes(s as ScheduleMode) ? (s as ScheduleMode) : null;

/** 来月（YYYY-MM） */
export const nextYm = (today: string): string => ymOf(addDays(`${ymOf(today)}-01`, 31));

/** 月の後半か（ホームが来月の準備を出すのと同じ日から。PRD D255） */
export const isLateMonth = (today: string): boolean => Number(today.slice(8, 10)) >= HOME_NEXT_MONTH_FROM_DAY;

/** 整える月：月の後半なら来月、前半なら今月（メニューの「◯月の予定」） */
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

/** 来月を組んでいないとみなす日の数（ホームの「担当を AI で組む」のカードと同じ。2日以上） */
export const PLAN_NEEDED_DAYS = 2;

/**
 * 既定のモード（選んでいないとき。PRD D348）：月の後半で、来月をまだ組んでいなければ（担当なしの訪問がある日が2日以上）変更、
 * それ以外は確認
 */
export function defaultMode(today: string, nextMonthUnassignedDays: number): ScheduleMode {
  return isLateMonth(today) && nextMonthUnassignedDays >= PLAN_NEEDED_DAYS ? 'change' : 'check';
}

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
