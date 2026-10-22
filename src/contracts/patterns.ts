/**
 * 繰り返し（定期パターン。patterns）の入出力（design.md §5「訪問の種類と繰り返し」。ADR-0012・ADR-0053）。
 * 版2：繰り返しの回は見るときに計算し（visitsOn・visitsIn）、変えた回だけを DemoData.visits に保存する。
 * 関数の実装は src/patterns/（下の関数の型で注釈する）。
 * 例外を投げない：いない〈利用者さん〉・パターンは無視する。同じ入力なら同じ結果（訪問の順も）
 */
import type { DemoData } from './data';
import type { Pattern, Visit } from './documents';

export type PatternInput = Pick<DemoData, 'patterns' | 'visits' | 'clients'>;

/** 両端を含む（YYYY-MM-DD） */
export type DateRange = { from: string; to: string };

export type PatternChange = {
  /** 新しいパターンの一覧 */
  patterns: Pattern[];
  /** 新しい保存した訪問の一覧 */
  visits: Visit[];
  /** 消した保存した回（作り直す範囲の、この回だけ変えていない回。計算した回に戻る） */
  removed: { visitId: string; date: string }[];
};

/** その日にパターンの回があるか */
export type OccursOn = (pattern: Pattern, date: string) => boolean;

/** パターンを range に展開する（計算した回。利用中かどうか・保存した回は見ない）。担当はパターンの担当 */
export type ExpandPattern = (pattern: Pattern, range: DateRange) => Visit[];

/**
 * その日の訪問：その日の保存した訪問と、利用中の〈利用者さん〉の繰り返しの計算した回（同じ ID の保存した回が無いもの）。
 * 取り消し・休みの訪問も含む。開始（組んだ開始、無ければ開始（早））・ID の順
 */
export type VisitsOn = (data: PatternInput, date: string) => Visit[];

/** range の訪問（日付・開始の順） */
export type VisitsIn = (data: PatternInput, range: DateRange) => Visit[];

/** ID の訪問（保存した回か計算した回）。無ければ null */
export type FindVisit = (data: PatternInput, id: string) => Visit | null;

/**
 * パターンを「いつから」（since）で分けて直す（「これ以降」）。patternId が無ければ何もしない（同じデータを返す）。
 * since が元の from 以前なら同じ ID のまま中身を置き換え、そうでなければ元の to を since の前日にし、newId で from = since のパターンを足す。
 * since は今日より前なら今日にする（今日より前の回は変えない）。since 以降の、元のパターンの保存した回のうち、この回だけ変えていない・
 * 取り消していない・ピンでない回は消す（新しいパターンで計算し直す）。この回だけ変えた・取り消した回は残し、新しいパターンの回として ID を
 * 付け直す（同じ日に計算した回を二重に出さない）。ピンだけの回は新しいパターンの回にして担当とピンを残す
 */
export type SplitPattern = (
  data: PatternInput,
  patternId: string,
  next: Omit<Pattern, 'id' | 'from'>,
  since: string,
  today: string,
  newId: string,
) => PatternChange;

/**
 * パターンを消す。今日以降の、この回だけ変えていない・ピンでない保存した回は消し、今日以降のこの回だけ変えた回・ピンの回は単発の訪問として残す
 * （pattern を null）。開始が今日より前のパターンは消さずに昨日で終わらせる（今日より前の回は計算した回も保存した回もそのまま。
 * 過去の予定を消さない）。開始が今日以降なら、パターンごと消す
 */
export type RemovePattern = (data: PatternInput, patternId: string, today: string) => PatternChange;
