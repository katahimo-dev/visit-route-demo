// 月の予定の印刷（PRD D70。ADR-0014）：紙のカレンダーの代わりに、日ごとのマスへ 時刻・〈利用者さん〉・担当 を並べる。
// 担当は訪問の担当（版2）。休み（〈スタッフ〉の希望休・欠勤・勤務なし、〈利用者さん〉の休み）も出す。
// 画面の純粋関数（データは書き換えない）
import type { DemoData } from '../contracts/data';
import type { Problem } from '../contracts/problem';
import { afterLastDay, availabilityOf } from '../domain/availability';
import { isOnLeave } from '../domain/leaves';
import { hhmmToMinutes } from '../domain/time';
import { visitsOn } from '../patterns';
import { own } from './common';
import { dayProblemOf, dayRoutes, startsOf } from './dayPlan';
import { calendarWeeks, shortName, ymOf } from './month';
import { isRequestedOff } from './requestedOff';

/** 印刷の1件（訪問） */
export type PrintEntry = {
  visitId: string;
  /** 開始（分）。案の時刻（lenient）、案に無ければ訪問の開始（早） */
  start: number;
  clientName: string;
  /** 担当（未定・入らないなら null。メールの宛先分け（ADR-0017）に使う） */
  staffId: string | null;
  /** 担当の名前（未定・入らないなら null） */
  staffName: string | null;
  /** 印刷に出す担当の名前（名字。名字が重なる人はフルネーム。staffLabels） */
  staffLabel: string | null;
  /** 種類の色の番号（種類なしは null） */
  typeColor: number | null;
};

/** その日に休む〈スタッフ〉：希望休・欠勤（終日でも時間帯でも）・勤務なし */
export type PrintOff = { staffId: string; name: string; label: string; kind: 'requested' | 'absent' | 'noShift' };

export type PrintDay = {
  date: string;
  /** その月の日か（前後の月の日は空のマス） */
  inMonth: boolean;
  /** 担当の元：確定した日（伝えた）／まだ伝えていない日／訪問が無い */
  source: 'confirmed' | 'plan' | null;
  /** 開始の順 */
  entries: PrintEntry[];
  /**
   * 訪問があるのに担当が決まっていない件数（その日の全体）。〈スタッフ〉で絞った印刷でも「担当なし N件」と出す
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
  | 'snapshots'
>;

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
  const dayVisits = visitsOn(data, date);
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const staffName = new Map(data.staff.map((s) => [s.id, s.name]));
  const labelOf = staffLabels(data.staff);
  const typeColor = new Map(data.visitTypes.map((t) => [t.id, t.color]));
  // 担当と開始の時刻：その日の担当の並びを lenient で並べた時刻（版2：訪問の担当）
  const p: Problem | null = dayVisits.length > 0 ? dayProblemOf(data, date) : null;
  const routes = p ? dayRoutes(data, date, p) : {};
  const ownerOf = new Map<string, string>();
  const startOf = new Map<string, number>();
  for (const [id, x] of p ? startsOf(p, routes) : []) {
    ownerOf.set(id, x.staffId);
    startOf.set(id, x.start);
  }
  const source: PrintDay['source'] =
    p && p.visits.length > 0 ? (own(data.snapshots, date) ? 'confirmed' : 'plan') : null;

  const entries: PrintEntry[] = [];
  const leaves: string[] = [];
  let pending = 0;
  for (const v of dayVisits) {
    if (v.cancelled) continue;
    const c = clientById.get(v.clientId);
    if (!c || !c.active) continue;
    // 計算に入らない訪問（場所が未登録など）は、訪問に書いた担当のまま
    const inProblem = p?.visits.some((x) => x.id === v.id) ?? false;
    const owner = inProblem ? (ownerOf.get(v.id) ?? null) : v.staffId;
    if (isOnLeave(data.clientLeaves, v)) {
      // 休みの訪問は問題に入らないので、訪問に書いた担当で絞る
      if ((staffId === null || (owner ?? v.staffId) === staffId) && !leaves.includes(c.displayName))
        leaves.push(c.displayName);
      continue;
    }
    if (owner === null) pending++;
    if (staffId !== null && owner !== staffId) continue;
    entries.push({
      visitId: v.id,
      start: startOf.get(v.id) ?? hhmmToMinutes(v.start ?? v.earliestStart),
      clientName: c.displayName,
      staffId: owner,
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
      off.push({
        staffId: s.id,
        name: s.name,
        label: labelOf.get(s.id)!,
        kind: mine.every(isRequestedOff) ? 'requested' : 'absent',
      });
    else if (!working) off.push({ staffId: s.id, name: s.name, label: labelOf.get(s.id)!, kind: 'noShift' });
  }
  return { date, inMonth, source, entries, pending, leaves, off };
}

/** 月の印刷の中身（日曜はじまりの週ごと。前後の月の日は空のマス）。週の数は月によって4〜6 */
export function monthPrint(data: PrintInput, ym: string, staffId: string | null): PrintDay[][] {
  return calendarWeeks(ym)
    .filter((week) => week.some((d) => ymOf(d) === ym))
    .map((week) => week.map((d) => printDay(data, d, staffId, ymOf(d) === ym)));
}
