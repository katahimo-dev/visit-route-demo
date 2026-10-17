// 定期パターン・訪問の種類の表示の文（ADR-0012。画面の純粋関数）
import type { Pattern, VisitType } from '../contracts/documents';
import { timesOn } from '../patterns';
import { WEEKDAY_LABELS } from './common';

/** 間隔の呼び方（1〜4週ごと） */
export const EVERY_WEEKS_LABELS: Record<number, string> = { 1: '毎週', 2: '隔週', 3: '3週ごと', 4: '4週ごと' };

/** 曜日の並び（例：「月・木」）。日曜はじまりの順 */
export function weekdaysText(weekdays: readonly number[]): string {
  return [...new Set(weekdays)]
    .sort((a, b) => a - b)
    .map((w) => WEEKDAY_LABELS[w] ?? '?')
    .join('・');
}

/** 時刻の文（ちょうど＝「10:00」、幅＝「10:00〜11:00の間」） */
export function startText(x: Pick<Pattern, 'windowKind' | 'earliestStart' | 'latestStart'>): string {
  return x.windowKind === 'fixed' ? x.earliestStart : `${x.earliestStart}〜${x.latestStart}の間`;
}

/** 毎月の第N週の文（[3, 4] → 「第3・第4」。ADR-0013） */
export function monthWeeksLabel(weeks: readonly number[]): string {
  return [...new Set(weeks)]
    .sort((a, b) => a - b)
    .map((n) => `第${n}`)
    .join('・');
}

/** 繰り返し方の文（毎週は空、「隔週」「毎月 第3・第4」） */
export function repeatText(p: Pick<Pattern, 'everyWeeks' | 'repeat' | 'monthWeeks'>): string {
  if (p.repeat === 'monthly') return `毎月 ${monthWeeksLabel(p.monthWeeks)}`;
  return p.everyWeeks === 1 ? '' : (EVERY_WEEKS_LABELS[p.everyWeeks] ?? `${p.everyWeeks}週ごと`);
}

/**
 * パターンの短い文（例：「月・木 10:00」、隔週なら「隔週 月 10:00」、毎月なら「毎月 第3・第4 木 10:00」）。
 * 曜日ごとの時刻があれば曜日ごとに時刻を並べる（「月 9:30・木 15:00」。ADR-0013）
 */
export function patternWhenText(
  p: Pick<
    Pattern,
    'weekdays' | 'everyWeeks' | 'repeat' | 'monthWeeks' | 'dayTimes' | 'windowKind' | 'earliestStart' | 'latestStart'
  >,
): string {
  const head = repeatText(p);
  const pre = head ? `${head} ` : '';
  if (p.dayTimes.length === 0) return `${pre}${weekdaysText(p.weekdays)} ${startText(p)}`;
  const days = [...new Set(p.weekdays)].sort((a, b) => a - b);
  return `${pre}${days
    .map((w) => `${WEEKDAY_LABELS[w] ?? '?'} ${startText({ windowKind: p.windowKind, ...timesOn(p, w) })}`)
    .join('・')}`;
}

/** 日付の短い文（「11/14」） */
export const mdText = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 期間の文（「11/1から」「11/1〜12/31」） */
export function periodText(p: Pick<Pattern, 'from' | 'to'>): string {
  const y = (d: string) => (d.slice(0, 4) === p.from.slice(0, 4) ? mdText(d) : `${d.slice(0, 4)}/${mdText(d)}`);
  return p.to ? `${p.from.slice(0, 4)}/${mdText(p.from)}〜${y(p.to)}` : `${p.from.slice(0, 4)}/${mdText(p.from)}から`;
}

/** 種類の名前（いない種類・種類なしは null） */
export function typeOf(types: readonly VisitType[], typeId: string | null | undefined): VisitType | null {
  return typeId ? (types.find((t) => t.id === typeId) ?? null) : null;
}
