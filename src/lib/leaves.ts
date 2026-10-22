// 〈利用者さん〉の休み（入院・ショートステイなど。PRD D65。ADR-0013）の画面の純粋関数。
// データは書き換えず、新しい DemoData を返す（書くのは画面の update(fn)）。
// 休みの期間の訪問は消さない（domain/leaves の leaveOn で「休みのため無し」と派生で扱う）
import type { DemoData } from '../contracts/data';
import type { ClientLeave, Visit } from '../contracts/documents';
import { leaveOn } from '../domain/leaves';
import { addDays } from '../domain/time';
import { visitsIn, visitsOn } from '../patterns';

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
  data: Pick<DemoData, 'visits' | 'patterns' | 'clients'>,
  leave: Pick<ClientLeave, 'clientId' | 'from' | 'to'>,
): Visit[] {
  // 長すぎる期間（入力の途中など）は1年分まで見る
  const to = leave.to < addDays(leave.from, 366) ? leave.to : addDays(leave.from, 366);
  if (leave.from > to) return [];
  return visitsIn(data, { from: leave.from, to })
    .filter((v) => v.clientId === leave.clientId && !v.cancelled)
    .sort((a, b) => a.date.localeCompare(b.date) || a.earliestStart.localeCompare(b.earliestStart));
}

/** その日の休みのため無しの訪問と、その休み（取り消しを除く。開始（早）の順） */
export function leaveVisitsOn(
  data: Pick<DemoData, 'visits' | 'patterns' | 'clients' | 'clientLeaves'>,
  date: string,
): { visit: Visit; leave: ClientLeave }[] {
  const out: { visit: Visit; leave: ClientLeave }[] = [];
  for (const v of visitsOn(data, date)) {
    if (v.cancelled) continue;
    const l = leaveOn(data.clientLeaves, v.clientId, date);
    if (l) out.push({ visit: v, leave: l });
  }
  return out.sort((a, b) => a.visit.earliestStart.localeCompare(b.visit.earliestStart));
}

/**
 * 休みと重なる確定した日（日付の順）：休みの期間で、伝えた内容（snapshots）にその〈利用者さん〉の担当の決まった訪問がある日。
 * 休みを入れる・直す前の注意に使う（休みの訪問は「未連絡の変更」の「外れる」になる）
 */
export function leaveConfirmedDates(
  data: Pick<DemoData, 'snapshots'>,
  leave: Pick<ClientLeave, 'clientId' | 'from' | 'to'>,
): string[] {
  return Object.values(data.snapshots)
    .filter(
      (s) =>
        leave.from <= s.date &&
        s.date <= leave.to &&
        s.visits.some((v) => v.clientId === leave.clientId && v.staffId !== null),
    )
    .map((s) => s.date)
    .sort();
}
