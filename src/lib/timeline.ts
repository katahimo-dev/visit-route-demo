// 予定の画面の時間軸（PRD D58。design.md §4 pages「予定の画面の時間軸」）の位置の計算。
// 分 → px、列の背景（稼働時間帯の外・欠勤）、移動・待ちの区間、ドラッグ中の影の可否。データは書き換えない
import type { Problem, StopTiming } from '../contracts/problem';
import { hhmmToMinutes } from '../domain/time';
import { bestInsertion, scheduleRoute, VISIT_TYPE_RULE_ID } from '../matching';
import { own } from './common';

/** 時間軸の縦の範囲の初期値（0時からの分）：07:00〜20:00 */
export const TL_START = 7 * 60;
export const TL_END = 20 * 60;
/** 1分の高さ（px） */
export const TL_PX_PER_MIN = 1.1;

/** 時刻の区間（0時からの分。start ＜ end） */
export type Span = { start: number; end: number };

/** "HH:mm" の時間帯を分の区間に */
export function spansOf(slots: { start: string; end: string }[]): Span[] {
  return slots.map((s) => ({ start: hhmmToMinutes(s.start), end: hhmmToMinutes(s.end) }));
}

/**
 * 時間軸の縦の範囲：07:00〜20:00 を基本に、spans（稼働時間帯・帯・移動）がはみ出せば1時間単位で広げる。
 * 0〜24時の外へは広げない。数でない値は無視する
 */
export function timeRange(spans: Span[], base: Span = { start: TL_START, end: TL_END }): Span {
  let start = base.start;
  let end = base.end;
  for (const s of spans) {
    if (Number.isFinite(s.start) && s.start < start) start = s.start;
    if (Number.isFinite(s.end) && s.end > end) end = s.end;
  }
  return { start: Math.max(0, Math.floor(start / 60) * 60), end: Math.min(24 * 60, Math.ceil(end / 60) * 60) };
}

/** 1時間ごとの目盛り（範囲の始まりと終わりを含む） */
export function hourMarks(range: Span): number[] {
  const out: number[] = [];
  for (let m = Math.ceil(range.start / 60) * 60; m <= range.end; m += 60) out.push(m);
  return out;
}

/** 時刻 → 範囲の上端からの px（範囲の外は端に寄せる） */
export function toY(minutes: number, range: Span, px = TL_PX_PER_MIN): number {
  const m = Math.min(Math.max(minutes, range.start), range.end);
  return (m - range.start) * px;
}

/** 区間の上端と高さ（px）。範囲の外は切る。高さは minPx 以上 */
export function boxOf(span: Span, range: Span, px = TL_PX_PER_MIN, minPx = 0): { top: number; height: number } {
  const top = toY(span.start, range, px);
  return { top, height: Math.max(minPx, toY(span.end, range, px) - top) };
}

/** a から b を除いた区間（a・b は開始の順でなくてよい。結果は開始の順・長さ0なし） */
export function subtractSpans(a: Span[], b: Span[]): Span[] {
  let cur = a.filter((x) => x.start < x.end).map((x) => ({ ...x }));
  for (const y of b) {
    if (!(y.start < y.end)) continue;
    const next: Span[] = [];
    for (const x of cur) {
      if (y.end <= x.start || x.end <= y.start) {
        next.push(x);
        continue;
      }
      if (x.start < y.start) next.push({ start: x.start, end: y.start });
      if (y.end < x.end) next.push({ start: y.end, end: x.end });
    }
    cur = next;
  }
  return cur.filter((x) => x.start < x.end).sort((x, y) => x.start - y.start);
}

/** 列の背景の区間：off＝稼働時間帯の外・途中の休み（灰）、absent＝欠勤で差し引いた時間（斜線と「欠勤」） */
export type BackgroundSpan = Span & { kind: 'off' | 'absent' };

/**
 * 列の背景。baseSlots は欠勤を差し引く前の稼働時間帯、slots は差し引いたもの（useDayModel の slotsOf）。
 * 範囲のうち baseSlots の外が off、baseSlots のうち slots の外が absent（欠勤の from・to が null でも差で出る）
 */
export function backgroundOf(range: Span, baseSlots: Span[], slots: Span[]): BackgroundSpan[] {
  const off = subtractSpans([range], baseSlots).map((x) => ({ ...x, kind: 'off' as const }));
  const absent = subtractSpans(
    baseSlots.map((x) => ({ start: Math.max(x.start, range.start), end: Math.min(x.end, range.end) })),
    slots,
  ).map((x) => ({ ...x, kind: 'absent' as const }));
  return [...off, ...absent].sort((x, y) => x.start - y.start);
}

/**
 * 帯のあいだの区間：fromHome（最初の訪問へ自宅から）・drive（前の訪問の終わりから移動）・wait（着いてから始めるまで）・
 * toHome（最後の訪問の終わりから自宅まで）。visitId は区間のキー（来る区間は行き先の訪問、toHome は最後の訪問）
 */
export type LegSpan = Span & { kind: 'fromHome' | 'drive' | 'wait' | 'toHome'; visitId: string; minutes: number };

/** 担当の1列の時刻（lenient の scheduleRoute）から移動・待ちの区間。homeMinutes は最後の訪問から自宅まで（無ければ null） */
export function legsOf(stops: StopTiming[], homeMinutes: number | null): LegSpan[] {
  const out: LegSpan[] = [];
  stops.forEach((t, k) => {
    if (t.travelIn > 0) {
      out.push({
        kind: k === 0 ? 'fromHome' : 'drive',
        visitId: t.visitId,
        start: t.arrival - t.travelIn,
        end: t.arrival,
        minutes: t.travelIn,
      });
    }
    if (t.wait > 0) out.push({ kind: 'wait', visitId: t.visitId, start: t.arrival, end: t.start, minutes: t.wait });
  });
  const last = stops.at(-1);
  if (last && homeMinutes !== null) {
    out.push({
      kind: 'toHome',
      visitId: last.visitId,
      start: last.end,
      end: last.end + homeMinutes,
      minutes: homeMinutes,
    });
  }
  return out;
}

/**
 * ドラッグ中の影：訪問をその人へ移したら（今の予定の画面と同じ bestInsertion の位置）、strict で回れるか。
 * 位置は訪問の earliest 〜 latest＋所要（始めてよい幅に作業の長さを足した所）。
 * allowed は可否（必須の条件・相性×など。外れる人は ok も false）。訪問・担当が問題に無ければ null
 */
export function shadowOf(
  problem: Problem,
  routes: Record<string, string[]>,
  visitId: string,
  staffId: string,
): (Span & { ok: boolean; allowed: boolean }) | null {
  const v = problem.visits.findIndex((x) => x.id === visitId);
  const s = problem.staff.findIndex((x) => x.id === staffId);
  if (v < 0 || s < 0) return null;
  const pv = problem.visits[v]!;
  const span = { start: pv.earliest, end: Math.max(pv.latest, pv.earliest) + pv.duration };
  const allowed = problem.allowed[v]?.[s] === true;
  if (!allowed) return { ...span, ok: false, allowed };
  const col = own(bestInsertion(problem, routes, visitId, staffId), staffId) ?? [];
  const index = new Map(problem.visits.map((x, i) => [x.id, i]));
  const seq = col.map((id) => index.get(id)).filter((x): x is number => x !== undefined);
  return { ...span, ok: scheduleRoute(problem, s, seq, 'strict') !== null, allowed };
}

/** 担当が訪問の種類の必要条件で可でないか（「資格✗」の印）。問題に無い・担当がいないなら false */
export function typeUnfitOf(problem: Problem | null, visitId: string, staffId: string | null): boolean {
  if (!problem || !staffId) return false;
  const v = problem.visits.findIndex((x) => x.id === visitId);
  const s = problem.staff.findIndex((x) => x.id === staffId);
  if (v < 0 || s < 0) return false;
  return (problem.reasons[v]?.[s] ?? []).some(
    (r) => r.ruleId === VISIT_TYPE_RULE_ID && r.points === Number.POSITIVE_INFINITY,
  );
}
