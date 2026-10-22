// 予定の画面の急な欠勤（ADR-0011・ADR-0053）：欠勤の保存・取り消し、振り直しの元の案、振り直した結果を訪問に書く・元に戻す。
// どれも純粋関数（データを書き換えず新しい DemoData を返す。画面は update(fn) の中で呼ぶ）
import type { DemoData, ReassignInfo } from '../contracts/data';
import type { Absence } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import { type ReassignResult, type Routes, STAY_WEIGHT_DEFAULT } from '../contracts/reassign';
import { END_AFTER_START_ERROR, HALF_HOUR_ERROR, isHalfHour, timeText } from '../domain/availability';
import { hhmmToMinutes, minutesToHhmm } from '../domain/time';
import { visitsOn } from '../patterns';
import { own } from './common';
import { ownerOf, pinsOf, routesOf, writeRoutes } from './dayPlan';

/** その日の欠勤（データの順） */
export function absencesOn(data: Pick<DemoData, 'absences'>, date: string): Absence[] {
  return data.absences.filter((a) => a.date === date);
}

/** 欠勤を保存する。同じ人・同じ日の欠勤（と同じ ID）はその1件を置き換える（1人1日1件） */
export function saveAbsence(d: DemoData, absence: Absence): DemoData {
  const at = d.absences.findIndex(
    (a) => a.id === absence.id || (a.staffId === absence.staffId && a.date === absence.date),
  );
  if (at < 0) return { ...d, absences: [...d.absences, absence] };
  const rest = d.absences.filter(
    (a, i) => i === at || !(a.id === absence.id || (a.staffId === absence.staffId && a.date === absence.date)),
  );
  return { ...d, absences: rest.map((a) => (a === d.absences[at] ? absence : a)) };
}

/** 欠勤を取り消す。担当は変えない（差の欄の「振り直す前に戻す」で戻す。D31） */
export function removeAbsence(d: DemoData, id: string): DemoData {
  return { ...d, absences: d.absences.filter((a) => a.id !== id) };
}

/**
 * 欠勤の表示：「欠勤（終日）」「欠勤 9:00〜12:00」。開始・終了が空（始業から・終業まで）のときは、
 * slots（その日の稼働時間帯）があれば始業・終業の時刻で、無ければ「欠勤 15:00〜」「欠勤 〜11:00」
 */
export function absenceText(a: Pick<Absence, 'from' | 'to'>, slots: { start: string; end: string }[] = []): string {
  if (a.from === null && a.to === null) return '欠勤（終日）';
  const from = a.from ?? slots[0]?.start ?? null;
  const to = a.to ?? slots.at(-1)?.end ?? null;
  return `欠勤 ${from === null ? '' : timeText(from)}〜${to === null ? '' : timeText(to)}`;
}

/** 欠勤の時間帯が正しくなければ理由（終了 ≤ 開始・30分単位でない） */
export function absenceError(a: Pick<Absence, 'from' | 'to'>): string | null {
  const half = (x: string | null) => x === null || isHalfHour(x);
  if (!half(a.from) || !half(a.to)) return HALF_HOUR_ERROR;
  if (a.from !== null && a.to !== null && a.from >= a.to) return END_AFTER_START_ERROR;
  return null;
}

/** 30分単位に丸める（半端な時刻は近いほうへ。2026-10-13 利用者が決定） */
export function roundToHalfHour(hhmm: string): string {
  const m = hhmmToMinutes(hhmm);
  return minutesToHhmm(Math.min(23 * 60 + 30, Math.round(m / 30) * 30));
}

/**
 * その日の欠勤を除いたデータ（振り直す訪問を決めるときの、元の案の時刻を出す問題を compile する用。
 * targetsOf の base.problem）
 */
export function withoutAbsencesOn<T extends Pick<DemoData, 'absences'>>(data: T, date: string): T {
  return { ...data, absences: data.absences.filter((a) => a.date !== date) };
}

/** 振り直しの元の案（今の担当の並びとピン） */
export type ReassignBase = { routes: Routes; pins: Record<string, string> };

/**
 * 振り直しの元の案（D28）：その日の担当の並び（版2：訪問の担当と開始の並び）とピン。問題に無い訪問は除く
 */
export function baseOf(data: DemoData, date: string, problem: Problem): ReassignBase {
  const visits = visitsOn(data, date);
  const inProblem = new Set(problem.visits.map((v) => v.id));
  const pins = Object.fromEntries(Object.entries(pinsOf(visits)).filter(([id]) => inProblem.has(id)));
  return { routes: routesOf(problem, visits), pins };
}

/** 振り直しの情報から案B の重みを外す（案A にするとき） */
function withoutAnneal(info: ReassignInfo): ReassignInfo {
  const { stayWeight: _w, ...rest } = info;
  return rest;
}

/** 振り直したあとのピン：元のピン（担当が同じもの）と、担当が変わった訪問 */
function pinsAfter(base: ReassignBase, routes: Routes): Record<string, string> {
  const before = ownerOf(base.routes);
  const after = ownerOf(routes);
  const out: Record<string, string> = {};
  for (const [id, sid] of Object.entries(base.pins)) if (after.get(id) === sid) out[id] = sid;
  for (const [id, sid] of after) if (before.get(id) !== sid) out[id] = sid;
  return out;
}

/** 振り直しの結果を訪問に書き、振り直しの情報を残す */
function writeReassign(d: DemoData, date: string, problem: Problem, routes: Routes, info: ReassignInfo): DemoData {
  const base: ReassignBase = { routes: info.baseRoutes, pins: info.basePins };
  const written = writeRoutes(d, date, problem, routes, { pins: pinsAfter(base, routes) });
  return { ...written, reassigns: { ...written.reassigns, [date]: info } };
}

/**
 * 振り直した結果（案A）を訪問に書き、振り直しの情報を残す（D30。版2：提案を当てる）。
 * その日がすでに振り直しのあとなら（続けて振り直す）、元の案の情報は最初のものを引き継ぎ、absenceIds は累積する
 * （差・「振り直す前に戻す」は最初の元の案に対して）。ピンは元のピン（担当が同じもの）と担当が変わった訪問。
 * problem は振り直しに使った問題（いまの条件）
 */
export function applyReassign(
  d: DemoData,
  date: string,
  x: { problem: Problem; result: ReassignResult; base: ReassignBase; absenceIds: string[] },
): DemoData {
  const chained = own(d.reassigns, date);
  const info: ReassignInfo = chained
    ? {
        ...withoutAnneal(chained),
        method: 'insert',
        insertRoutes: x.result.routes,
        absenceIds: [...new Set([...chained.absenceIds, ...x.absenceIds])],
      }
    : {
        method: 'insert',
        insertRoutes: x.result.routes,
        baseRoutes: x.base.routes,
        basePins: x.base.pins,
        absenceIds: x.absenceIds,
      };
  return writeReassign(d, date, x.problem, x.result.routes, info);
}

/**
 * 案A・案B のどちらかを当てる（PRD D34。ADR-0011 追記）。その日が振り直しのあとのときだけ（無ければそのまま）。
 * 元の案の情報は引き継ぎ、method（案B なら stayWeight も）を変える
 */
export function chooseReassign(
  d: DemoData,
  date: string,
  x: { problem: Problem; result: ReassignResult; method: ReassignInfo['method']; stayWeight?: number },
): DemoData {
  const prev = own(d.reassigns, date);
  if (!prev) return d;
  const info: ReassignInfo =
    x.method === 'anneal'
      ? { ...prev, method: 'anneal', stayWeight: x.stayWeight ?? STAY_WEIGHT_DEFAULT }
      : { ...withoutAnneal(prev), method: 'insert' };
  return writeReassign(d, date, x.problem, x.result.routes, info);
}

/**
 * 振り直す前に戻す（D31）：担当の並び・ピンを元の案（baseRoutes・basePins）に戻し、振り直しの情報を消す。
 * 続けて振り直したときも最初の元の案へ戻す。その日が振り直しのあとでなければそのまま
 */
export function revertReassign(d: DemoData, date: string, problem: Problem): DemoData {
  const info = own(d.reassigns, date);
  if (!info) return d;
  const ids = new Set(problem.visits.map((v) => v.id));
  const routes: Routes = {};
  for (const [k, list] of Object.entries(info.baseRoutes)) routes[k] = list.filter((id) => ids.has(id));
  // 振り直す前に無かった訪問（あとで足した・担当を当てた訪問）は今の担当・ピンのまま残す（開始の順に足す）
  const inBase = new Set(Object.values(info.baseRoutes).flat());
  const visits = visitsOn(d, date);
  const pins: Record<string, string> = { ...info.basePins };
  const extra: { id: string; staffId: string }[] = [];
  for (const v of visits) {
    if (!ids.has(v.id) || inBase.has(v.id) || !v.staffId) continue;
    extra.push({ id: v.id, staffId: v.staffId });
    if (v.pinned) pins[v.id] = v.staffId;
  }
  if (extra.length > 0) {
    const atOf = new Map(visits.map((v) => [v.id, hhmmToMinutes(v.start ?? v.earliestStart)]));
    const touched = new Set(extra.map((x) => x.staffId));
    for (const x of extra) routes[x.staffId] = [...(routes[x.staffId] ?? []), x.id];
    for (const k of touched) routes[k] = [...routes[k]!].sort((a, b) => (atOf.get(a) ?? 0) - (atOf.get(b) ?? 0));
  }
  const written = writeRoutes(d, date, problem, routes, { pins });
  const { [date]: _gone, ...reassigns } = written.reassigns;
  return { ...written, reassigns };
}
