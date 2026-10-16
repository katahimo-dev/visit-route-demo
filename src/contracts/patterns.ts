/**
 * 定期パターン（patterns）の入出力（design.md §5「訪問の種類と定期パターン」。ADR-0012）。
 * 関数（occursOn・expandPattern・applyPatterns・splitPattern・removePattern）の実装は src/patterns/（下の関数の型で注釈する）。
 * 例外を投げない：いない利用者さん・パターンは無視する。applyPatterns は同じ入力なら同じ結果（訪問の順も）
 */
import type { DemoData } from './data';
import type { Pattern, Visit } from './documents';

export type PatternInput = Pick<DemoData, 'patterns' | 'visits' | 'clients'>;

/** 両端を含む（YYYY-MM-DD） */
export type DateRange = { from: string; to: string };

export type PatternChange = {
  /** 新しいパターンの一覧 */
  patterns: Pattern[];
  /** 新しい訪問の一覧 */
  visits: Visit[];
  added: { visitId: string; date: string }[];
  removed: { visitId: string; date: string }[];
};

/** その日にパターンの訪問があるか */
export type OccursOn = (pattern: Pattern, date: string) => boolean;

/** パターンを range に展開する（利用中かどうか・既存の訪問は見ない） */
export type ExpandPattern = (pattern: Pattern, range: DateRange) => Visit[];

/** 全パターン（利用中の利用者さんだけ）を range ∩ [today, ∞) に展開し、無い ID だけ足す（removed は空） */
export type ApplyPatterns = (data: PatternInput, range: DateRange, today: string) => PatternChange;

/** §4 patterns の「パターンを直す」。patternId が無ければ何もしない（同じデータを返す） */
export type SplitPattern = (
  data: PatternInput,
  patternId: string,
  next: Omit<Pattern, 'id' | 'from'>,
  since: string,
  today: string,
  newId: string,
) => PatternChange;

/** パターンを消す */
export type RemovePattern = (data: PatternInput, patternId: string, today: string) => PatternChange;
