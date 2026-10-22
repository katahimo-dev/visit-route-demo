// 月のマスの「休 N」を絞る（PRD D295）と、要対応の札（「要対応 N」）の数え方の純粋関数。データは書き換えない。
// 休みはどの日にも少しはあるので、毎日の「休 2」は目に入らないほうが良い。同じ月の同じ曜日の「ふだん」より多い日だけ見せる
import { weekday } from '../domain/time';
import type { Attention } from './month';

/**
 * 同じ月の同じ曜日の「ふだん」の休みの人数（曜日ごと。0＝日〜6＝土）。
 * 最頻値（同数なら小さい方）。休みが無い日（0人）も数えるので、ふだんが 0 の曜日はどの休みも多いほうに入る。
 * その曜日の日が無ければ 0
 */
export function usualRestByWeekday(days: readonly { date: string; resting: number }[]): number[] {
  const freq: Map<number, number>[] = Array.from({ length: 7 }, () => new Map());
  for (const x of days) {
    const m = freq[weekday(x.date)]!;
    m.set(x.resting, (m.get(x.resting) ?? 0) + 1);
  }
  return freq.map((m) => {
    let best = 0;
    let bestCount = 0;
    for (const [n, c] of m) {
      if (c > bestCount || (c === bestCount && n < best)) {
        best = n;
        bestCount = c;
      }
    }
    return best;
  });
}

/**
 * マスに「休 N」を出すか。ふだんより多い日だけ。希望休のある日（「（希 N）」の理由の文字）は今までどおり出す。過去の日にも同じ決め方を使う
 */
export function showRestMark(x: { resting: number; requested: number; usual: number }): boolean {
  if (x.resting <= 0) return false;
  return x.requested > 0 || x.resting > x.usual;
}

/** 日ごとの要対応の件数（要対応の一覧 attentionList の行の数。右の欄の行と同じ数え方） */
export function attentionCountByDate(list: readonly Pick<Attention, 'date'>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of list) out.set(a.date, (out.get(a.date) ?? 0) + 1);
  return out;
}
