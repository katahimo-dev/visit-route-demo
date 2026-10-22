// 訪問の詳細の欄（components/VisitPanel。lib/visitOps の「この回だけ」）の保存する中身を決める純粋関数（ADR-0012・ADR-0051）。検証（visitSchema）は呼ぶ側
import type { Visit } from '../contracts/documents';

/** 欄で決める訪問の中身 */
export type VisitFields = Pick<
  Visit,
  'date' | 'clientId' | 'windowKind' | 'earliestStart' | 'latestStart' | 'durationMinutes' | 'note' | 'typeId'
>;

/**
 * 保存する訪問。直すとき（visit あり）は ID・パターン・担当・ピンを引き継ぎ、取り消しは外す（版2：担当は訪問が持つ）。
 * 日付・時刻を変えたら組んだ開始（start）は外す（呼ぶ側がその日の開始を書き直す）。
 * パターンの訪問で、日付・時刻・所要・種類・取り消し・メモを変えたら「この回だけの変更」（〈利用者さん〉は数えない）
 */
export function savedVisit(visit: Visit | null, f: VisitFields, newVisitId: string): Visit {
  const timeSame =
    !!visit &&
    visit.date === f.date &&
    visit.earliestStart === f.earliestStart &&
    visit.latestStart === f.latestStart &&
    visit.durationMinutes === f.durationMinutes &&
    visit.windowKind === f.windowKind;
  const base = {
    ...f,
    id: visit?.id ?? newVisitId,
    staffId: visit?.staffId ?? null,
    start: timeSame ? (visit?.start ?? null) : null,
    pinned: visit?.pinned ?? false,
    cancelled: false,
    cancelKind: null,
  };
  const ref = visit?.pattern ?? null;
  const changed =
    !!visit &&
    (base.date !== visit.date ||
      base.windowKind !== visit.windowKind ||
      base.earliestStart !== visit.earliestStart ||
      base.latestStart !== visit.latestStart ||
      base.durationMinutes !== visit.durationMinutes ||
      base.typeId !== (visit.typeId ?? null) ||
      base.note !== visit.note ||
      base.cancelled !== visit.cancelled);
  return { ...base, pattern: ref ? { ...ref, edited: ref.edited || changed } : null };
}
