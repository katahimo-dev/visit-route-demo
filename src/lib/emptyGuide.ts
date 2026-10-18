// 空の画面の「なぜ空か」と次の一手（PRD D176。ADR-0025 追記）。週・稼働の見込み・比較で、案や訪問が無いときに出す文とボタンを
// 決める純粋関数。ボタンは既存の行き先だけ：月の画面のまとめて作る（`?do=batch`。PRD D143）と、日の画面（選んだ日を開く）。
// データは書き換えない

import { ymOf } from './month';
import { mdText } from './patternText';

/** 次の一手のボタン：月の画面のまとめて作る（ym の月）か、日の画面（date の日） */
export type EmptyAction = { label: string; primary: boolean } & (
  | { kind: 'batch'; ym: string }
  | { kind: 'day'; date: string }
);

export type EmptyGuide = {
  /** なぜ空か（見出し） */
  title: string;
  /** 補足の1文 */
  why: string;
  /** 次の一手（先頭が主ボタン） */
  actions: EmptyAction[];
};

/** 月の画面のまとめて作るの URL（lib/progressBand の bandHref と同じ形） */
export const batchHref = (ym: string): string => `/month?ym=${ym}&do=batch`;

const monthText = (ym: string): string => `${Number(ym.slice(5, 7))}月`;

export type PeriodInput = {
  /** 期間の呼び方（「この週」「この月」） */
  period: string;
  /** 期間の日付（昇順） */
  dates: readonly string[];
  /** 今日（日本時間の YYYY-MM-DD） */
  today: string;
  /** 計算に入る訪問（取り消し・休みを除く）がある日（昇順） */
  visitDays: readonly string[];
  /** 今の案か確定した割当がある日 */
  planDays: readonly string[];
};

/**
 * 週・月（稼働の見込み）の空の画面（PRD D176）。案のある日が1日でもあれば空ではない（null）。
 * - 訪問がある日があるのに案が無い：「〈期間〉は案がありません」。今日以降の訪問の日があれば［〈期間〉の案を作る］（その最初の日の月の
 *   まとめて作る）と［〈M/D〉の案を日の画面で作る］。過ぎた期間なら日の画面だけ（まとめて作るは今日より前の日を作らない）
 * - 訪問が無い：「〈期間〉には訪問がありません」。［〈M月〉の訪問と案を作る］（定期パターンから作る。月の画面のまとめて作る）と
 *   ［日の画面で訪問を足す］
 */
export function periodEmptyGuide(input: PeriodInput): EmptyGuide | null {
  const { period, dates, today, visitDays, planDays } = input;
  if (planDays.length > 0 || dates.length === 0) return null;
  const firstFuture = dates.find((d) => d >= today) ?? null;
  if (visitDays.length === 0) {
    const at = firstFuture ?? dates[0]!;
    return {
      title: `${period}には訪問がありません`,
      why: '定期パターンから訪問を作るか、日の画面で訪問を足すと、ここに出ます。',
      actions: [
        ...(firstFuture
          ? [
              {
                kind: 'batch' as const,
                ym: ymOf(firstFuture),
                label: `${monthText(ymOf(firstFuture))}の訪問と案を作る`,
                primary: true,
              },
            ]
          : []),
        { kind: 'day', date: at, label: '日の画面で訪問を足す', primary: !firstFuture },
      ],
    };
  }
  const future = visitDays.filter((d) => d >= today);
  if (future.length === 0) {
    return {
      title: `${period}は案がありません`,
      why: `訪問のある ${visitDays.length}日はもう過ぎています（まとめて作るは今日より前の日を作りません）。日の画面で1日ずつ作れます。`,
      actions: [{ kind: 'day', date: visitDays[0]!, label: `${mdText(visitDays[0]!)}を日の画面で開く`, primary: true }],
    };
  }
  const first = future[0]!;
  return {
    title: `${period}は案がありません`,
    why: `訪問のある ${visitDays.length}日に、まだ案（割当）がありません。月の画面の「まとめて作る」で、${monthText(ymOf(first))}のまだ案の無い日をまとめて作れます。`,
    actions: [
      { kind: 'batch', ym: ymOf(first), label: `${period}の案を作る`, primary: true },
      { kind: 'day', date: first, label: `${mdText(first)}の案を日の画面で作る`, primary: false },
    ],
  };
}

/**
 * 比較の画面の空の画面（PRD D176）：その日の記録（案）が1つも無いとき。
 * 訪問が無い日は［日の画面で訪問を足す］、訪問があれば［日の画面で案を作る］（開くと点数の基準のプリセットで自動で作る。PRD D52）と、
 * 今日以降なら［〈M月〉の案をまとめて作る］
 */
export function compareEmptyGuide(input: { date: string; today: string; visits: number }): EmptyGuide {
  const { date, today, visits } = input;
  if (visits === 0) {
    return {
      title: 'この日には訪問がありません',
      why: '訪問を足して案を作ると、ここで2つの案を比べられます。',
      actions: [{ kind: 'day', date, label: '日の画面で訪問を足す', primary: true }],
    };
  }
  return {
    title: 'この日の案はまだありません',
    why: '日の画面を開くと、点数の基準の考え方で案を自動で作ります。案ができたら、ここでもう1案作って比べられます。',
    actions: [
      { kind: 'day', date, label: '日の画面で案を作る', primary: true },
      ...(date >= today
        ? [
            {
              kind: 'batch' as const,
              ym: ymOf(date),
              label: `${monthText(ymOf(date))}の案をまとめて作る`,
              primary: false,
            },
          ]
        : []),
    ],
  };
}
