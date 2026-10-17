// 月の予定の印刷（PRD D70。ADR-0014）：紙のカレンダーの代わりに、日ごとのマスへ 時刻・〈利用者さん〉・担当 を並べる。
// 担当は確定した割当があればそれ、無ければ今の案。休み（〈スタッフ〉の希望休・欠勤・勤務なし、〈利用者さん〉の休み）も出す。
// 画面の純粋関数（データは書き換えない）
import type { DemoData } from '../contracts/data';
import type { Problem } from '../contracts/problem';
import { afterLastDay, availabilityOf } from '../domain/availability';
import { isOnLeave } from '../domain/leaves';
import { NONE } from '../domain/scheduleModel';
import { hhmmToMinutes } from '../domain/time';
import { compile, scheduleRoute } from '../matching';
import { attempt, own } from './common';
import { calendarWeeks, shortName, ymOf } from './month';
import { isRequestedOff } from './requestedOff';

/** 印刷の1件（訪問） */
export type PrintEntry = {
  visitId: string;
  /** 開始（分）。案の時刻（lenient）、案に無ければ訪問の開始（早） */
  start: number;
  clientName: string;
  /** 担当の名前（未定・入らないなら null） */
  staffName: string | null;
  /** 印刷に出す担当の名前（名字。名字が重なる人はフルネーム。staffLabels） */
  staffLabel: string | null;
  /** 種類の色の番号（種類なしは null） */
  typeColor: number | null;
};

/** その日に休む〈スタッフ〉：希望休・欠勤（終日でも時間帯でも）・勤務なし */
export type PrintOff = { name: string; label: string; kind: 'requested' | 'absent' | 'noShift' };

export type PrintDay = {
  date: string;
  /** その月の日か（前後の月の日は空のマス） */
  inMonth: boolean;
  /** 担当の元：確定した割当／今の案／どちらも無い */
  source: 'confirmed' | 'plan' | null;
  /** 開始の順 */
  entries: PrintEntry[];
  /**
   * 訪問があるのに担当が決まっていない件数（その日の全体）：案も確定も無ければ今ある訪問の全件、あれば担当の無い訪問。
   * 〈スタッフ〉で絞った印刷でも「案なし（訪問 N件）」「未定 N件」と出す
   */
  pending: number;
  /** 休み（ADR-0013）で訪問が無しの〈利用者さん〉の表示名 */
  leaves: string[];
  off: PrintOff[];
};

type PrintInput = Pick<
  DemoData,
  | 'org'
  | 'items'
  | 'rules'
  | 'staff'
  | 'clients'
  | 'compat'
  | 'visits'
  | 'availability'
  | 'absences'
  | 'visitTypes'
  | 'patterns'
  | 'clientLeaves'
  | 'manualPlans'
  | 'aiPlans'
>;

/** 案に、今ある訪問（live）の担当が1件以上あるか（取り消し・休み・休止の〈利用者さん〉の訪問だけなら無い。lib/absences の baseOf と同じ形） */
const hasAssigned = (routes: Record<string, string[]> | undefined, live: ReadonlySet<string>) =>
  !!routes && Object.entries(routes).some(([k, ids]) => k !== NONE && ids.some((id) => live.has(id)));

/** 印刷に出す〈スタッフ〉の名前：名字（最初の語）。利用中の人で名字が重なれば、その人たちはフルネーム */
export function staffLabels(staff: readonly { id: string; name: string; active: boolean }[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const s of staff) if (s.active) count.set(shortName(s.name), (count.get(shortName(s.name)) ?? 0) + 1);
  return new Map(staff.map((s) => [s.id, (count.get(shortName(s.name)) ?? 0) > 1 ? s.name : shortName(s.name)]));
}

/**
 * その日の印刷の中身。staffId を渡すと、その人が担当する訪問・その人の休みだけ（〈利用者さん〉の休みは、
 * 数える案でその人の担当だった訪問の〈利用者さん〉だけ）
 */
export function printDay(data: PrintInput, date: string, staffId: string | null, inMonth = true): PrintDay {
  const empty: PrintDay = { date, inMonth, source: null, entries: [], pending: 0, leaves: [], off: [] };
  if (!inMonth) return empty;
  const dayVisits = data.visits.filter((v) => v.date === date);
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  // 今ある訪問：取り消し・〈利用者さん〉の休み・休止中の〈利用者さん〉の訪問を除く
  const live = new Set(
    dayVisits
      .filter((v) => !v.cancelled && clientById.get(v.clientId)?.active && !isOnLeave(data.clientLeaves, v))
      .map((v) => v.id),
  );
  const saved = own(data.manualPlans, date);
  const plan = own(data.aiPlans, date);
  const source: PrintDay['source'] = hasAssigned(saved, live) ? 'confirmed' : plan ? 'plan' : null;
  const routes: Record<string, string[]> =
    source === 'confirmed' ? (saved ?? {}) : source === 'plan' ? (plan?.routes ?? {}) : {};
  const ownerOf = new Map<string, string>();
  for (const [sid, ids] of Object.entries(routes)) if (sid !== NONE) for (const id of ids) ownerOf.set(id, sid);
  const staffName = new Map(data.staff.map((s) => [s.id, s.name]));
  const labelOf = staffLabels(data.staff);
  const typeColor = new Map(data.visitTypes.map((t) => [t.id, t.color]));

  // 開始の時刻：その日の問題で、担当ごとの列を lenient で並べた時刻（確定した割当は開始（早）の順に並べる）
  const p: Problem | null =
    dayVisits.length > 0 ? (attempt(() => compile({ ...data, visits: dayVisits }, date)).value ?? null) : null;
  const startOf = new Map<string, number>();
  if (p && source) {
    const vIndex = new Map(p.visits.map((v, i) => [v.id, i]));
    for (const [sid, ids] of Object.entries(routes)) {
      const s = p.staff.findIndex((x) => x.id === sid);
      if (sid === NONE || s < 0) continue;
      let seq = ids.map((id) => vIndex.get(id)).filter((x): x is number => x !== undefined);
      if (source === 'confirmed') seq = [...seq].sort((a, b) => p.visits[a]!.earliest - p.visits[b]!.earliest || a - b);
      for (const st of scheduleRoute(p, s, seq, 'lenient')?.stops ?? []) startOf.set(st.visitId, st.start);
    }
  }

  const entries: PrintEntry[] = [];
  const leaves: string[] = [];
  let pending = 0;
  for (const v of dayVisits) {
    if (v.cancelled) continue;
    const c = clientById.get(v.clientId);
    if (!c || !c.active) continue;
    const owner = ownerOf.get(v.id) ?? null;
    if (isOnLeave(data.clientLeaves, v)) {
      if ((staffId === null || owner === staffId) && !leaves.includes(c.displayName)) leaves.push(c.displayName);
      continue;
    }
    if (owner === null) pending++;
    if (staffId !== null && owner !== staffId) continue;
    entries.push({
      visitId: v.id,
      start: startOf.get(v.id) ?? hhmmToMinutes(v.earliestStart),
      clientName: c.displayName,
      staffName: owner === null ? null : (staffName.get(owner) ?? null),
      staffLabel: owner === null ? null : (labelOf.get(owner) ?? null),
      typeColor: v.typeId === null ? null : (typeColor.get(v.typeId) ?? null),
    });
  }
  entries.sort((a, b) => a.start - b.start || a.clientName.localeCompare(b.clientName, 'ja'));

  const off: PrintOff[] = [];
  for (const s of data.staff) {
    if (!s.active || (staffId !== null && s.id !== staffId)) continue;
    // 最終勤務日の後（ADR-0015）はもういない人なので、休みに出さない
    if (afterLastDay(s, date)) continue;
    const mine = data.absences.filter((a) => a.staffId === s.id && a.date === date);
    const override = data.availability.find((a) => a.staffId === s.id && a.date === date);
    const working = availabilityOf(s, date, override).slots.length > 0;
    if (mine.length > 0 && working)
      off.push({ name: s.name, label: labelOf.get(s.id)!, kind: mine.every(isRequestedOff) ? 'requested' : 'absent' });
    else if (!working) off.push({ name: s.name, label: labelOf.get(s.id)!, kind: 'noShift' });
  }
  return { date, inMonth, source, entries, pending, leaves, off };
}

/** 月の印刷の中身（日曜はじまりの週ごと。前後の月の日は空のマス）。週の数は月によって4〜6 */
export function monthPrint(data: PrintInput, ym: string, staffId: string | null): PrintDay[][] {
  return calendarWeeks(ym)
    .filter((week) => week.some((d) => ymOf(d) === ym))
    .map((week) => week.map((d) => printDay(data, d, staffId, ymOf(d) === ym)));
}
