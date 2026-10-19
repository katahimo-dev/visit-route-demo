// 月の画面の「日ごとの一覧」（PRD D189。ADR-0025 追記。区切り8b）の純粋な部分：
// カレンダーと一覧のどちらを出すか（URL の ?layout= と画面の幅）、一覧の1行（日付・状態・件数・要対応の印）。
// データは書き換えない。画面は pages/MonthPage.tsx
import { weekday } from '../domain/time';
import { WEEKDAY_LABELS } from './common';
import type { DayStatus } from './month';

/** 月の見せ方：カレンダー（7列の表）か日ごとの一覧（縦に1日1行） */
export type MonthLayout = 'calendar' | 'list';

/** はじめを一覧にする幅（カレンダーの表の最小幅 640px が入らない幅。month.css の @media (max-width: 600px) と同じ） */
export const MONTH_LIST_QUERY = '(max-width: 600px)';

/** URL の ?layout= の値 */
export const MONTH_LAYOUT_PARAM = 'layout';

/** 見せ方を決める：URL に書いてあればそれ（押したら必ず書く）、無ければ狭い画面は一覧・広い画面はカレンダー */
export function monthLayoutOf(param: string | null, narrow: boolean): MonthLayout {
  if (param === 'list' || param === 'calendar') return param;
  return narrow ? 'list' : 'calendar';
}

/**
 * 一覧を開いたときに最初に見せる日（PRD D189）：今月を見ているときだけ、選んでいる日がその月ならその日、無ければ今日。
 * ほかの月・行き先（?do=）があるときは null（巻かない）
 */
export function monthListFocusDate(ym: string, date: string, today: string, hasTarget: boolean): string | null {
  if (hasTarget || today.slice(0, 7) !== ym) return null;
  return date.slice(0, 7) === ym ? date : today;
}

/** 日の状態の言葉（カレンダーのマスと同じ） */
export const DAY_STATE_TEXT: Record<DayStatus['state'], string> = {
  none: '案なし',
  plan: '案あり',
  confirmed: '確定済み',
  diff: '未確定の変更あり',
};

/** 一覧の1行 */
export type MonthListRow = {
  date: string;
  /** 「21日（水）」 */
  dayText: string;
  /** 曜日（0＝日〜6＝土） */
  weekday: number;
  isToday: boolean;
  isPast: boolean;
  /** 訪問の件数（取り消しを除く） */
  count: number;
  /** 状態（訪問が無ければ 'empty'） */
  state: DayStatus['state'] | 'empty';
  /** 状態の言葉（訪問が無ければ「訪問なし」） */
  stateText: string;
  /** 要対応（赤い枠と点。今日より前の日は付けない。マスと同じ。PRD D228） */
  care: boolean;
  /** 注意（黄の点線。今日以降で訪問があるのに案が無い。マスと同じ） */
  caution: boolean;
  /** 要対応の印の短い文（入らない・違反・休みの人に・条件が変わった・拘束超）。赤は red、注意は warn */
  flags: readonly { text: string; tone: 'red' | 'warn' }[];
  /** 読み上げの名前（日付・件数・状態・要確認・印・補足） */
  label: string;
};

/**
 * 一覧の1行を作る。印の数え方はカレンダーのマス（DayCell）と同じ。
 * extra は表示の選択（〈スタッフ〉・〈利用者さん〉）や「休みを入れる」の補足の文（行の下に出し、読み上げにも入れる）
 */
export function monthListRow(s: DayStatus, today: string, extra: readonly string[] = []): MonthListRow {
  const d = s.date;
  const wd = weekday(d);
  const isPast = d < today;
  const care = s.needsCare && !isPast;
  const caution = !care && !isPast && s.count > 0 && s.state === 'none';
  const flags: { text: string; tone: 'red' | 'warn' }[] = [];
  if (s.unassigned > 0) flags.push({ text: `入らない ${s.unassigned}件`, tone: 'red' });
  if (s.hard > 0) flags.push({ text: `必須の違反 ${s.hard}件`, tone: 'red' });
  if (s.absentLeft > 0) flags.push({ text: `休みの人に訪問 ${s.absentLeft}件`, tone: 'red' });
  if (s.stale) flags.push({ text: '条件が変わった', tone: 'warn' });
  if (s.overSpan.length > 0) flags.push({ text: `拘束超 ${s.overSpan.length}人`, tone: 'warn' });
  const stateText = s.count > 0 ? DAY_STATE_TEXT[s.state] : '訪問なし';
  const dayText = `${Number(d.slice(8, 10))}日（${WEEKDAY_LABELS[wd]}）`;
  const label = [
    `${Number(d.slice(5, 7))}月${dayText}${d === today ? '・今日' : ''}`,
    ...(s.count > 0 ? [`訪問 ${s.count}件`] : []),
    stateText,
    ...(care ? ['要対応'] : []),
    ...(caution ? ['注意：まだ案が無い'] : []),
    ...flags.map((f) => f.text),
    ...extra,
  ].join('・');
  return {
    date: d,
    dayText,
    weekday: wd,
    isToday: d === today,
    isPast,
    count: s.count,
    state: s.count > 0 ? s.state : 'empty',
    stateText,
    care,
    caution,
    flags,
    label,
  };
}
