// 予定（月・週・日）に共通の進み具合の帯（PRD D151〜D155。ADR-0025 追記。design.md §4 pages「進み具合の帯」）の決まり。
// 見ている月の「今月の準備」（lib/month の monthProgress。ホーム・月の画面と同じ数え方）から、帯に出す次の一手を1つ決める純粋関数。
// データは書き換えない
import type { Attention, AttentionKind, MonthProgress } from './month';
import { ymOf } from './month';

/** 帯から月の画面で行う操作（月の画面の ?do=。PRD D143） */
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

/** 手当てが要る要対応（入らない訪問・欠勤の人に残る訪問・条件が変わった）。拘束が上限を超える・欠勤がある日は見るだけ */
const URGENT: readonly AttentionKind[] = ['unassigned', 'absentLeft', 'stale'];

/** 要対応のうち手当てが要る件数 */
export function urgentCount(list: readonly Pick<Attention, 'kind'>[]): number {
  return list.filter((a) => URGENT.includes(a.kind)).length;
}

export type BandInput = {
  /** 見ている月の今日以降の進み具合（monthProgress。月の画面・ホームと同じ数え方） */
  progress: Pick<MonthProgress, 'visits' | 'days' | 'planned' | 'confirmed' | 'unconfirmed' | 'attention'>;
  /** 定期パターンからまだ作っていない訪問の件数（expandMonth の added） */
  canExpand: number;
  /** 訪問を作ったあとの「まだ案の無い日だけ」の対象の日数（batchTargets の 'empty'） */
  emptyTargets: number;
  /** 要対応のうち手当てが要る件数（urgentCount） */
  urgent: number;
};

/**
 * 帯の次の一手（PRD D152）。仕事の順（訪問を作る → 案を作る → 手当て → 確定）で最初に残っているもの：
 * 1. 作っていない訪問がある・まだ案の無い日がある → まとめて作る
 * 2. 手当てが要る要対応（入らない・欠勤の人に残る・条件が変わった）がある → 要対応を見る
 * 3. 確定していない日がある → 確定していない日を見る
 * 4. 見るだけの要対応（拘束が上限を超える・欠勤がある日）が残る → 要対応を見る
 * 5. 何も残っていない → 済み（ボタンなし）。今日以降に訪問も作れる訪問も無ければ「訪問はありません」（ボタンなし）
 */
export function bandNext(input: BandInput): BandNext {
  const { progress: p, canExpand, emptyTargets, urgent } = input;
  if (p.days === 0 && canExpand === 0) return { kind: 'empty', label: '今日以降の訪問はありません', short: '訪問なし' };
  if (canExpand > 0 || emptyTargets > 0) return { kind: 'batch', label: 'まとめて作る', short: '作る' };
  if (urgent > 0) return { kind: 'attention', label: '要対応を見る', short: '要対応' };
  if (p.unconfirmed.length > 0) return { kind: 'unconfirmed', label: '確定していない日を見る', short: '未確定' };
  if (p.attention > 0) return { kind: 'attention', label: '要対応を見る', short: '要対応' };
  return { kind: 'done', label: '準備は済みました', short: '済み' };
}

/** 帯が見る月（PRD D151）：選んでいる日付の月。週の画面も選んでいる日付（週の中の日）の月で、［月｜週｜日］の「月」と同じ月 */
export const bandMonth = (date: string): string => ymOf(date);

/** 帯の数字・ボタンから移る先（月の画面の欄。PRD D153） */
export const bandHref = (ym: string, op: BandOp): string => `/month?ym=${ym}&do=${op}`;

/**
 * 訪問の欄の文：定期パターンからまだ作っていない訪問があれば「未作成 N件」（PRD D282。週の見出し・月のマスの「未作成」と同じ言葉。
 * 前は「あと N件」）
 */
export function visitsText(visits: number, canExpand: number): string {
  return canExpand > 0 ? `${visits}件（未作成 ${canExpand}件）` : `${visits}件`;
}
