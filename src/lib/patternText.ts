// 定期パターン・訪問の種類の表示の文（ADR-0012。画面の純粋関数）
import type { Pattern, VisitType } from '../contracts/documents';
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

/** パターンの短い文（例：「月・木 10:00」、隔週なら「隔週 月 10:00」） */
export function patternWhenText(
  p: Pick<Pattern, 'weekdays' | 'everyWeeks' | 'windowKind' | 'earliestStart' | 'latestStart'>,
): string {
  const every = p.everyWeeks === 1 ? '' : `${EVERY_WEEKS_LABELS[p.everyWeeks] ?? `${p.everyWeeks}週ごと`} `;
  return `${every}${weekdaysText(p.weekdays)} ${startText(p)}`;
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
