// 訪問の詳細の欄（components/VisitPanel。lib/visitOps の「この回だけ」）の保存する中身を決める純粋関数（ADR-0012・ADR-0051）。検証（visitSchema）は呼ぶ側
import type { Visit } from '../contracts/documents';

/** 欄で決める訪問の中身 */
export type VisitFields = Pick<
  Visit,
  'date' | 'clientId' | 'windowKind' | 'earliestStart' | 'latestStart' | 'durationMinutes' | 'note' | 'typeId'
>;

/**
 * 保存する訪問。直すとき（visit あり）は ID・パターンを引き継ぎ、取り消しは外す。
 * 日付を変えたら手作業の担当（staffId）を外す（前の日の確定した割当の担当なので。週間の moveOnce と同じ）。
 * パターンの訪問で、日付・時刻・所要・種類・取り消しを変えたら「この回だけの変更」（メモ・〈利用者さん〉は数えない）
 */
export function savedVisit(visit: Visit | null, f: VisitFields, newVisitId: string): Visit {
  const base = {
    ...f,
    id: visit?.id ?? newVisitId,
    staffId: visit && visit.date === f.date ? visit.staffId : null,
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
      base.cancelled !== visit.cancelled);
  return { ...base, pattern: ref ? { ...ref, edited: ref.edited || changed } : null };
}
