// 予定（月・週・日）に共通の進み具合の帯（PRD D151〜D155。ADR-0025 追記。design.md §4 pages「進み具合の帯」）の決まり。
// 見ている月の「今月の準備」（lib/month の monthProgress。ホーム・月の画面と同じ数え方）から、帯に出す次の一手を1つ決める純粋関数。
// データは書き換えない
import type { Attention, AttentionKind, MonthProgress } from './month';
import { ymOf } from './month';

/** 帯から行う操作：batch＝担当を組むの画面（#/arrange）、attention・unconfirmed＝月の画面の欄（?do=。PRD D143） */
export type BandOp = 'batch' | 'attention' | 'unconfirmed';

/**
 * 帯の次の一手：まとめて作る／要対応を見る／確定していない日を見る／済み（ボタンなし）／今日以降に訪問が無い（ボタンなし）
 */
export type BandNextKind = BandOp | 'done' | 'empty';

export type BandNext = {
  kind: BandNextKind;
  /** ボタン（または済みの知らせ）の文 */
  label: string;
  /** 狭い画面（390px）で使う短い文 */
  short: string;
};

/** 手当てが要る要対応（要対応の訪問）。未連絡の変更・拘束が上限を超える日は見るだけ */
const URGENT: readonly AttentionKind[] = ['care'];

/** 要対応のうち手当てが要る件数 */
export function urgentCount(list: readonly Pick<Attention, 'kind'>[]): number {
  return list.filter((a) => URGENT.includes(a.kind)).length;
}

export type BandInput = {
  /** 見ている月の今日以降の進み具合（monthProgress。月の画面・ホームと同じ数え方） */
  progress: Pick<MonthProgress, 'visits' | 'days' | 'planned' | 'confirmed' | 'unconfirmed' | 'attention'>;
  /** 担当なしの訪問がある日の数（担当を AI で組む日） */
  emptyTargets: number;
  /** 要対応のうち手当てが要る件数（urgentCount） */
  urgent: number;
};

/**
 * 帯の次の一手（PRD D152）。仕事の順（担当を組む → 手当て → 確定）で最初に残っているもの：
 * 1. 担当なしの訪問がある日が2日以上 → 担当を AI で組む
 * 2. 手当てが要る要対応（要対応の訪問）がある → 要対応を見る
 * 3. 確定していない日がある → 確定していない日を見る
 * 4. 見るだけの要対応（未連絡の変更・拘束が上限を超える）が残る → 要対応を見る
 * 5. 何も残っていない → 済み（ボタンなし）。今日以降に訪問が無ければ「訪問はありません」（ボタンなし）
 */
export function bandNext(input: BandInput): BandNext {
  const { progress: p, emptyTargets, urgent } = input;
  if (p.days === 0) return { kind: 'empty', label: '今日以降の訪問はありません', short: '訪問なし' };
  if (emptyTargets >= 2) return { kind: 'batch', label: '担当を AI で組む', short: '組む' };
  if (urgent > 0) return { kind: 'attention', label: '要対応を見る', short: '要対応' };
  if (p.unconfirmed.length > 0) return { kind: 'unconfirmed', label: '確定していない日を見る', short: '未確定' };
  if (p.attention > 0) return { kind: 'attention', label: '要対応を見る', short: '要対応' };
  return { kind: 'done', label: '準備は済みました', short: '済み' };
}

/** 帯が見る月（PRD D151）：選んでいる日付の月。週の画面も選んでいる日付（週の中の日）の月で、［月｜週｜日］の「月」と同じ月 */
export const bandMonth = (date: string): string => ymOf(date);

/** 帯の数字・ボタンから移る先（担当を組むは担当を組むの画面のその月、ほかは月の画面の欄。PRD D153。ADR-0063） */
export const bandHref = (ym: string, op: BandOp): string =>
  op === 'batch' ? `/arrange?ym=${ym}` : `/month?ym=${ym}&do=${op}`;

/** 訪問の欄の文 */
export function visitsText(visits: number): string {
  return `${visits}件`;
}
