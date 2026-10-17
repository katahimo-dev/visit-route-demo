// 〈利用者さん〉の休み（入院・ショートステイなど）の判定（デモ独自。PoC本体には無い。PRD D65。ADR-0013）。
// 「訪問が休みのため無しか」を決めるのはこのファイルだけ（compile・画面で同じ判定）
import type { ClientLeave, Visit } from '../contracts/documents';

/** その日を含む、その〈利用者さん〉の休み（無ければ null。重なっていれば先の1件） */
export function leaveOn(leaves: readonly ClientLeave[], clientId: string, date: string): ClientLeave | null {
  for (const l of leaves) if (l.clientId === clientId && l.from <= date && date <= l.to) return l;
  return null;
}

/** 訪問が〈利用者さん〉の休みの期間に入るか（取り消しかどうかは見ない） */
export function isOnLeave(leaves: readonly ClientLeave[], visit: Pick<Visit, 'clientId' | 'date'>): boolean {
  return leaves.length > 0 && leaveOn(leaves, visit.clientId, visit.date) !== null;
}
