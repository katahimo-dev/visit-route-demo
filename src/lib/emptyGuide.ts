// 空の画面の「なぜ空か」と次の一手（PRD D176。ADR-0025 追記）。週・稼働の見込み・比較で、案や訪問が無いときに出す文とボタンを
// 決める純粋関数。ボタンは既存の行き先だけ：月の画面のまとめて作る（`?do=batch`。PRD D143）と、日の画面（選んだ日を開く）。
// データは書き換えない

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

export type PeriodInput = {
  /** 期間の呼び方（「この週」「この月」） */
  period: string;
  /** 期間の日付（昇順） */
  dates: readonly string[];
  /** 今日（日本時間の YYYY-MM-DD） */
  today: string;
  /** 計算に入る訪問（取り消し・休みを除く）がある日（昇順） */
  visitDays: readonly string[];
};

/**
 * 週・月（稼働の見込み）の空の画面（PRD D176）。版2（ADR-0053）は繰り返しの回をその場で数えるので、訪問のある日が1日でもあれば
 * 空ではない（null。担当なしの回は要対応として画面に出る）。訪問が無い期間は「〈期間〉には訪問がありません」と［日の予定で訪問を足す］
 */
export function periodEmptyGuide(input: PeriodInput): EmptyGuide | null {
  const { period, dates, today, visitDays } = input;
  if (visitDays.length > 0 || dates.length === 0) return null;
  const at = dates.find((d) => d >= today) ?? dates[0]!;
  return {
    title: `${period}には訪問がありません`,
    why: '繰り返しを足すか、日の予定で訪問を足すと、ここに出ます。',
    actions: [{ kind: 'day', date: at, label: '日の予定で訪問を足す', primary: true }],
  };
}

/** 比較の画面の空の画面（PRD D176）：その日に計算できる訪問が無いとき。［日の予定で訪問を足す］ */
export function compareEmptyGuide(input: { date: string }): EmptyGuide {
  return {
    title: 'この日には訪問がありません',
    why: '訪問を足すと、ここで今の担当と提案を比べられます。',
    actions: [{ kind: 'day', date: input.date, label: '日の予定で訪問を足す', primary: true }],
  };
}
