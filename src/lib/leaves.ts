// 〈利用者さん〉の休み（入院・ショートステイなど。PRD D65。ADR-0013）の画面の純粋関数。
// データは書き換えず、新しい DemoData を返す（書くのは画面の update(fn)）。
// 休みの期間の訪問は消さない（domain/leaves の leaveOn で「休みのため無し」と派生で扱う）
import type { DemoData } from '../contracts/data';
import type { ClientLeave, Visit } from '../contracts/documents';
import { leaveOn } from '../domain/leaves';
import { NONE } from '../domain/scheduleModel';
import { own } from './common';

/** その〈利用者さん〉の休み（開始日の順。同じなら終了日の順） */
export function leavesOf(data: Pick<DemoData, 'clientLeaves'>, clientId: string): ClientLeave[] {
  return data.clientLeaves
    .filter((l) => l.clientId === clientId)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
}

/** 休みを足す（同じ ID があれば置き換える。並びはそのまま） */
export function saveLeave(d: DemoData, leave: ClientLeave): DemoData {
  const exists = d.clientLeaves.some((l) => l.id === leave.id);
  return {
    ...d,
    clientLeaves: exists ? d.clientLeaves.map((l) => (l.id === leave.id ? leave : l)) : [...d.clientLeaves, leave],
  };
}

/** 休みを消す（訪問・案は変えない。休みの訪問が元に戻る） */
export function removeLeave(d: DemoData, id: string): DemoData {
  return { ...d, clientLeaves: d.clientLeaves.filter((l) => l.id !== id) };
}

/** 休みの期間の、その〈利用者さん〉の取り消しでない訪問（日付・開始（早）の順） */
export function leaveVisits(
  data: Pick<DemoData, 'visits'>,
  leave: Pick<ClientLeave, 'clientId' | 'from' | 'to'>,
): Visit[] {
  return data.visits
    .filter((v) => v.clientId === leave.clientId && !v.cancelled && leave.from <= v.date && v.date <= leave.to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.earliestStart.localeCompare(b.earliestStart));
}

/** その日の休みのため無しの訪問と、その休み（取り消しを除く。開始（早）の順） */
export function leaveVisitsOn(
  data: Pick<DemoData, 'visits' | 'clientLeaves'>,
  date: string,
): { visit: Visit; leave: ClientLeave }[] {
  const out: { visit: Visit; leave: ClientLeave }[] = [];
  for (const v of data.visits) {
    if (v.date !== date || v.cancelled) continue;
    const l = leaveOn(data.clientLeaves, v.clientId, date);
    if (l) out.push({ visit: v, leave: l });
  }
  return out.sort((a, b) => a.visit.earliestStart.localeCompare(b.visit.earliestStart));
}

/**
 * 休みと重なる確定した日（日付の順）：休みの期間で、確定した割当（manualPlans。未割当の列は除く）に
 * その〈利用者さん〉の取り消しでない訪問がある日。休みを入れる・直す前の注意に使う（案は作り直さない）
 */
export function leaveConfirmedDates(
  data: Pick<DemoData, 'visits' | 'manualPlans'>,
  leave: Pick<ClientLeave, 'clientId' | 'from' | 'to'>,
): string[] {
  const byDate = new Map<string, Set<string>>();
  for (const v of leaveVisits(data, leave)) {
    const ids = byDate.get(v.date) ?? new Set<string>();
    ids.add(v.id);
    byDate.set(v.date, ids);
  }
  const out: string[] = [];
  for (const [date, ids] of byDate) {
    const saved = own(data.manualPlans, date);
    if (!saved) continue;
    const hit = Object.entries(saved).some(([k, list]) => k !== NONE && list.some((id) => ids.has(id)));
    if (hit) out.push(date);
  }
  return out.sort();
}

/**
 * 確定するときの確定した割当の列に、その日の休みの訪問を確定済みの持ち主（前の確定した割当の担当）のまま残す（ADR-0013）。
 * 休みを消したときに元の確定に戻るようにする（休みの訪問の手作業の担当 staffId も変えない）。
 * 前の確定した割当に無い休みの訪問は足さない（未割当にもしない）。列の順は今の列の後ろ
 */
export function keepLeaveVisits(
  cols: Record<string, string[]>,
  leaveVisitIds: readonly string[],
  before: Record<string, string[]> | undefined,
): Record<string, string[]> {
  if (!before || leaveVisitIds.length === 0) return cols;
  const owner = new Map<string, string>();
  for (const [k, list] of Object.entries(before)) for (const id of list) owner.set(id, k);
  const out: Record<string, string[]> = { ...cols };
  for (const id of leaveVisitIds) {
    const k = owner.get(id);
    if (k === undefined || k === NONE) continue;
    const list = own(out, k) ?? [];
    if (!list.includes(id)) out[k] = [...list, id];
  }
  return out;
}
