// 控え（バックアップ）の書き出しの記録と知らせ（PRD D227。ADR-0032）：最後に書き出した日の文と、起動したときに知らせるかを決める純粋関数。
// 日付は日本時間の YYYY-MM-DD を引数で受ける（Date.now を読まない）。記録の読み書きは store の backupMemory
import type { DemoData } from '../contracts/data';
import { NONE } from '../domain/scheduleModel';

/** この日数以上書き出していなければ知らせる */
export const BACKUP_REMIND_DAYS = 14;
/** 起動したときの知らせ（トースト） */
export const BACKUP_REMIND_TEXT = '控え（バックアップ）を2週間以上書き出していません。データの画面で書き出せます';
/** まだ書き出していないときの文 */
export const NEVER_EXPORTED_TEXT = 'まだ書き出していません';

/** a から b までの日数（b − a。日付は YYYY-MM-DD） */
export function daysBetween(a: string, b: string): number {
  const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86400000);
}

/** 「10/12（7日前）」「10/19（今日）」。まだなら「まだ書き出していません」 */
export function exportAgoText(last: string | null, today: string): string {
  if (last === null) return NEVER_EXPORTED_TEXT;
  const n = daysBetween(last, today);
  const md = `${Number(last.slice(5, 7))}/${Number(last.slice(8, 10))}`;
  return `${md}（${n <= 0 ? '今日' : `${n}日前`}）`;
}

/** 確定した日の数（確定した割当に1件でも担当の決まった訪問がある日） */
export function confirmedDayCount(data: Pick<DemoData, 'manualPlans'>): number {
  let n = 0;
  for (const routes of Object.values(data.manualPlans)) {
    if (Object.entries(routes).some(([staffId, ids]) => staffId !== NONE && ids.length > 0)) n++;
  }
  return n;
}

/**
 * 起動したときに控えの知らせを出すか：確定した日が1日以上あり、最後に書き出してから BACKUP_REMIND_DAYS 日以上
 * （まだ書き出していないときも）、かつ今日はまだ知らせていない（1日1回まで）
 */
export function shouldRemindBackup(x: {
  lastExport: string | null;
  lastReminded: string | null;
  today: string;
  confirmedDays: number;
}): boolean {
  if (x.confirmedDays < 1) return false;
  if (x.lastReminded !== null && x.lastReminded >= x.today) return false;
  if (x.lastExport === null) return true;
  return daysBetween(x.lastExport, x.today) >= BACKUP_REMIND_DAYS;
}

/** 時刻（ms）を日本時間の「10/19 14:03」に */
export function jstStamp(at: number): string {
  const j = new Date(at + 9 * 3600 * 1000).toISOString();
  return `${Number(j.slice(5, 7))}/${Number(j.slice(8, 10))} ${j.slice(11, 16)}`;
}

/** 「直前の状態に戻す」の欄の文：「10/19 14:03 の『初期状態に戻す』の前の状態に戻せます」 */
export const previousText = (p: { at: number; reason: string }): string =>
  `${jstStamp(p.at)} の『${p.reason}』の前の状態に戻せます`;
