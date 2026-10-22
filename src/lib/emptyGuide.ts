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
  /**
   * その場で作る（週の予定の「この週の案を作る」。PRD D280・D282）。canExpand は期間の今日以降の、定期パターンからまだ作っていない
   * 訪問の件数。渡すと、まとめて作るのボタン（月の画面へのリンク）を出さず、見出しの主ボタン（その場で作る）を文で指し、
   * ボタンは日の予定だけにする。訪問の無い期間でも未作成なら「未作成」と書く
   */
  makeHere?: { canExpand: number };
};

/**
 * 週・月（稼働の見込み）の空の画面（PRD D176）。案のある日が1日でもあれば空ではない（null）。
 * - 訪問がある日があるのに案が無い：「〈期間〉は案がありません」。今日以降の訪問の日があれば、その月ごとに［〈M月〉の案をまとめて作る］
 *   （月の画面のまとめて作る。月をまたぐ週は2つ）と［〈M/D〉の案を日の画面で作る］。過ぎた期間なら日の画面だけ（まとめて作るは今日より前の日を作らない）
 * - 訪問が無い：「〈期間〉には訪問がありません」。［〈M月〉の訪問と案を作る］（定期パターンから作る。月の画面のまとめて作る）と
 *   ［日の画面で訪問を足す］
 */
export function periodEmptyGuide(input: PeriodInput): EmptyGuide | null {
  const { period, dates, today, visitDays, planDays, makeHere } = input;
  if (planDays.length > 0 || dates.length === 0) return null;
  const firstFuture = dates.find((d) => d >= today) ?? null;
  if (makeHere) return makeHereGuide(input, makeHere.canExpand, firstFuture);
  if (visitDays.length === 0) {
    const at = firstFuture ?? dates[0]!;
    return {
      title: `${period}には訪問がありません`,
      why: '定期パターンから訪問を作るか、日の予定で訪問を足すと、ここに出ます。',
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
        { kind: 'day', date: at, label: '日の予定で訪問を足す', primary: !firstFuture },
      ],
    };
  }
  const future = visitDays.filter((d) => d >= today);
  if (future.length === 0) {
    return {
      title: `${period}は案がありません`,
      why: `訪問のある ${visitDays.length}日はもう過ぎています。過ぎた日は、日の予定で1日ずつ作れます。`,
      actions: [{ kind: 'day', date: visitDays[0]!, label: `${mdText(visitDays[0]!)}を日の予定で開く`, primary: true }],
    };
  }
  const first = future[0]!;
  // まとめて作るは月ごと（月の画面の欄）。月をまたぐ期間は、今日以降の訪問のある月ごとにボタンを出す（PR #42 のレビュー）
  const months = [...new Set(future.map(ymOf))];
  const across =
    months.length > 1 ? `${months.map(monthText).join('と')}にまたがるので、月ごとにまとめて作ります。` : '';
  return {
    title: `${period}は案がありません`,
    why: `訪問のある ${visitDays.length}日に、まだ案がありません。月の予定の「まとめて作る」で、まとめて作れます。${across}`,
    actions: [
      ...months.map((ym, i) => ({
        kind: 'batch' as const,
        ym,
        label: `${monthText(ym)}の案をまとめて作る`,
        primary: i === 0,
      })),
      { kind: 'day', date: first, label: `${mdText(first)}の案を日の予定で作る`, primary: false },
    ],
  };
}

/** その場で作る期間（週の予定）の空の画面（PRD D280・D282）。過ぎた期間は日の画面だけ（作るのは今日以降の日） */
function makeHereGuide(input: PeriodInput, canExpand: number, firstFuture: string | null): EmptyGuide {
  const { period, dates, today, visitDays } = input;
  // 作るボタンは画面の見出しの主ボタン（［〈期間〉の案を作る］）の1つ。ここには日の予定のボタンだけを置く（同じボタンを重ねない）
  const make = `見出しの［${period}の案を作る］`;
  const future = visitDays.filter((d) => d >= today);
  if (visitDays.length === 0) {
    const at = firstFuture ?? dates[0]!;
    const day = { kind: 'day' as const, date: at, label: '日の予定で訪問を足す', primary: true };
    if (canExpand > 0)
      return {
        title: `${period}の訪問はまだ作っていません（未作成）`,
        why: `定期パターンからまだ訪問を作っていません（${canExpand}件）。${make}で、${period}の今日以降の訪問と案を作ります。`,
        actions: [day],
      };
    return {
      title: `${period}には訪問がありません`,
      why: '定期パターンを足すか、日の予定で訪問を足すと、ここに出ます。',
      actions: [day],
    };
  }
  if (future.length === 0 && canExpand === 0) {
    return {
      title: `${period}は案がありません`,
      why: `訪問のある ${visitDays.length}日はもう過ぎています。過ぎた日は、日の予定で1日ずつ作れます。`,
      actions: [{ kind: 'day', date: visitDays[0]!, label: `${mdText(visitDays[0]!)}を日の予定で開く`, primary: true }],
    };
  }
  const first = future[0] ?? firstFuture ?? dates[0]!;
  return {
    title: `${period}は案がありません`,
    why: `訪問のある ${visitDays.length}日に、まだ案がありません。${canExpand > 0 ? `定期パターンからまだ作っていない訪問も ${canExpand}件あります。` : ''}${make}で、${period}の今日以降の案の無い日を作ります。`,
    actions: [{ kind: 'day', date: first, label: `${mdText(first)}の案を日の予定で作る`, primary: true }],
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
      actions: [{ kind: 'day', date, label: '日の予定で訪問を足す', primary: true }],
    };
  }
  return {
    title: 'この日の案はまだありません',
    why: '日の予定を開くと、案を自動で作ります。案ができたら、ここでもう1案作って比べられます。',
    actions: [
      { kind: 'day', date, label: '日の予定で案を作る', primary: true },
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
