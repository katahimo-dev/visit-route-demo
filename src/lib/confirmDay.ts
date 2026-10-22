// 「確定」＝〈スタッフ〉に伝えた内容（ADR-0053）の書き方と、月の「問題の無い日をまとめて確定」（PRD D223）・
// 確定のあとの「次の確定していない日へ」（PRD D224）の純粋関数。データは書き換えず、新しい DemoData を返す（書くのは画面の update(fn)）
import type { DemoData } from '../contracts/data';
import type { Problem } from '../contracts/problem';
import { weekday } from '../domain/time';
import { WEEKDAY_LABELS } from './common';
import { tellDay } from './dayPlan';
import type { Attention, DayStatus } from './month';
import { mdText } from './patternText';

/**
 * その日を確定する（今の担当・開始を伝えた内容として残す。日の画面の「確定（伝えた）」と月のまとめて確定で共通）。
 * problem はその日の問題（計算に入れる訪問を決める）。at は確定した時刻
 */
export function confirmDay(d: DemoData, date: string, problem: Problem, at: number = Date.now()): DemoData {
  return tellDay(d, date, problem, at);
}

/** まとめて確定の対象と残す日（PRD D223） */
export type BulkConfirm = {
  /** 確定する日（日付の順） */
  targets: string[];
  /** 要対応の訪問があって残す日（月の要対応に出る日） */
  problem: string[];
  /** 伝えたあとに変わった日（未連絡の変更あり。連絡の一覧で確かめてから日の予定で確定する） */
  changed: string[];
};

/**
 * 「確定していない日」（月の右の欄。`monthProgress` の unconfirmed）のうち、まだ伝えていない日で、要対応の訪問が無く、
 * 月の要対応（`attentionList`）に出ない日を確定する（要対応に出ている日を黙って確定しない。ADR-0031）
 */
export function bulkConfirmTargets(
  unconfirmed: readonly string[],
  statusOf: (date: string) => DayStatus | undefined,
  attention: readonly Pick<Attention, 'date' | 'kind'>[] = [],
): BulkConfirm {
  const flagged = new Set(attention.filter((a) => a.kind !== 'changed').map((a) => a.date));
  const out: BulkConfirm = { targets: [], problem: [], changed: [] };
  for (const date of unconfirmed) {
    const s = statusOf(date);
    if (!s || s.count === 0 || s.state === 'told') continue;
    if (s.care > 0 || flagged.has(date)) out.problem.push(date);
    else if (s.state === 'changed') out.changed.push(date);
    else out.targets.push(date);
  }
  return out;
}

/** 月の右の欄のボタンの文 */
export const bulkConfirmLabel = (n: number): string => `問題の無い日をまとめて確定（${n}日）`;

/** 押せないときの理由（見える文） */
export function bulkConfirmWhy(b: BulkConfirm): string {
  if (b.problem.length > 0)
    return '問題の無い日がありません（問題のある日は要対応で確かめてから、日の予定で確定します）';
  if (b.changed.length > 0)
    return '問題の無い日がありません（未連絡の変更のある日は、日の予定の連絡の一覧で確かめて確定します）';
  return '確定していない日はありません';
}

/** 「10/22（水）」 */
export const dayLabel = (date: string): string => `${mdText(date)}（${WEEKDAY_LABELS[weekday(date)]}）`;

/** 日付を並べる上限（超えたら「…」で略す） */
const LIST_MAX = 7;

/** 「10/22（水）・10/23（木）・… 計 N日」（多ければ先頭の LIST_MAX−1 日と「…」） */
export function datesText(dates: readonly string[]): string {
  const shown = dates.length > LIST_MAX ? dates.slice(0, LIST_MAX - 1) : dates;
  const more = dates.length > shown.length ? '・…' : '';
  return `${shown.map(dayLabel).join('・')}${more} 計 ${dates.length}日`;
}

/** 確認ダイアログの中身（独自の確認。ADR-0026） */
export function bulkConfirmDialog(b: BulkConfirm, staffTerm: string): { title: string; body: string } {
  const lines = [
    datesText(b.targets),
    `今の担当と時刻を${staffTerm}に伝えた内容として残します（あとの変更は「未連絡の変更」になります）。`,
  ];
  if (b.problem.length > 0)
    lines.push(`問題のある ${b.problem.length}日は残します（要対応で確認）：${b.problem.map(dayLabel).join('・')}`);
  if (b.changed.length > 0)
    lines.push(`未連絡の変更のある ${b.changed.length}日も残します（日の予定の連絡の一覧で確かめます）。`);
  return { title: `問題の無い ${b.targets.length}日を確定しますか？`, body: lines.join('\n') };
}

/** 確定のあとに移る、次の確定していない日（date より後。無ければ null。PRD D224） */
export function nextUnconfirmed(unconfirmed: readonly string[], date: string): string | null {
  return [...unconfirmed].sort().find((d) => d > date) ?? null;
}
