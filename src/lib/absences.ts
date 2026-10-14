// 予定の画面の急な欠勤（ADR-0011）：欠勤の保存・取り消し、振り直しの元の案、振り直した結果の書き込み・元に戻す。
// どれも純粋関数（データを書き換えず新しい DemoData を返す。画面は update(fn) の中で呼ぶ）
import type { AiPlan, DemoData, ReassignInfo } from '../contracts/data';
import type { Absence } from '../contracts/documents';
import type { Problem, SolveResult } from '../contracts/problem';
import { type ReassignResult, type Routes, STAY_WEIGHT_DEFAULT } from '../contracts/reassign';
import { END_AFTER_START_ERROR, HALF_HOUR_ERROR, isHalfHour, timeText } from '../domain/availability';
import { NONE } from '../domain/scheduleModel';
import { hhmmToMinutes, minutesToHhmm } from '../domain/time';
import { score } from '../evaluate';
import { own } from './common';
import { addRun, findRun } from './runs';

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

/** 欠勤を取り消す。今の案は変えない（差の欄の「元の案に戻す」で戻す。D31） */
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

/** いまの時刻の初期値：当日は現在時刻を5分単位に切り捨て、それ以外の日は空（null＝考えない） */
export function defaultNow(date: string, todayDate: string, nowHhmm: string): string | null {
  if (date !== todayDate) return null;
  const m = hhmmToMinutes(nowHhmm);
  return minutesToHhmm(Math.floor(m / 5) * 5);
}

/**
 * その日の欠勤を除いたデータ（振り直す訪問を決めるときの、元の案の時刻を出す問題を compile する用。
 * targetsOf の base.problem）
 */
export function withoutAbsencesOn<T extends Pick<DemoData, 'absences'>>(data: T, date: string): T {
  return { ...data, absences: data.absences.filter((a) => a.date !== date) };
}

/** 振り直しの元の案 */
export type ReassignBase = { routes: Routes; from: ReassignInfo['from']; pins: Record<string, string> };

/**
 * 振り直しの元の案（D28）：その日の確定した割当（manualPlans[date]。担当のいる訪問が1件以上）があればそれ、無ければ今の案。
 * 確定した割当は、各担当の訪問を今の案の列の順に並べ、今の案のその人の列に無い訪問は開始（earliest）の順に、開始がより遅い訪問の前へ挟む。
 * どちらも問題に無い訪問は除く。どちらも無ければ null
 */
export function baseOf(data: DemoData, date: string, problem: Problem): ReassignBase | null {
  const inProblem = new Map(problem.visits.map((v, i) => [v.id, i]));
  const saved = own(data.manualPlans, date);
  const plan = own(data.aiPlans, date);
  const hasSaved =
    !!saved && Object.entries(saved).some(([k, ids]) => k !== NONE && ids.some((id) => inProblem.has(id)));
  if (saved && hasSaved) {
    const earliest = (id: string) => problem.visits[inProblem.get(id)!]!.earliest;
    const routes: Routes = {};
    for (const [k, ids] of Object.entries(saved)) {
      if (k === NONE) continue;
      const mine = new Set(ids.filter((id) => inProblem.has(id)));
      // 今の案のその人の列にある訪問は今の案の順に
      const list = (plan ? (own(plan.routes, k) ?? []) : []).filter((id) => mine.has(id));
      const inList = new Set(list);
      // 残りは開始（earliest）の順に、開始がより遅い訪問の前へ挟む
      const rest = [...mine]
        .filter((id) => !inList.has(id))
        .sort((a, b) => earliest(a) - earliest(b) || inProblem.get(a)! - inProblem.get(b)!);
      for (const id of rest) {
        const at = list.findIndex((x) => earliest(x) > earliest(id));
        if (at < 0) list.push(id);
        else list.splice(at, 0, id);
      }
      routes[k] = list;
    }
    return { routes, from: 'confirmed', pins: {} };
  }
  if (!plan) return null;
  const routes: Routes = {};
  for (const [k, ids] of Object.entries(plan.routes)) routes[k] = ids.filter((id) => inProblem.has(id));
  const pins = Object.fromEntries(Object.entries(plan.pins).filter(([id]) => inProblem.has(id)));
  return { routes, from: 'plan', pins };
}

/** 振り直しの情報から案B の重みを外す（案A にするとき） */
function withoutAnneal(info: ReassignInfo): ReassignInfo {
  const { stayWeight: _w, ...rest } = info;
  return rest;
}

/**
 * 振り直した結果を今の案にし、記録に「欠勤の振り直し」として1件足す（D30）。
 * routes・generated＝結果、pins＝結果の pins（担当のいるすべての訪問）、reassign＝元の案の情報
 * （元の案・その固定・振り直す前の今の案の generated と runId）。
 * 元の案が今の案で、今の案がすでに振り直しの案なら（続けて振り直す）、元の案の情報は最初のものを引き継ぎ、
 * absenceIds は累積する（差・「元の案に戻す」は最初の元の案に対して）。元の案が確定した割当なら新しく作る。
 * problem は振り直しに使った問題（いまの条件。費用の score を付ける）。createdAt は呼ぶ側が渡す（純粋関数のまま）
 */
export function applyReassign(
  d: DemoData,
  date: string,
  x: {
    problem: Problem;
    result: ReassignResult;
    base: ReassignBase;
    absenceIds: string[];
    now: string | null;
    label: string;
    createdAt: number;
  },
): DemoData {
  const prev = own(d.aiPlans, date);
  const chained = x.base.from === 'plan' ? prev?.reassign : undefined;
  const info: ReassignInfo = chained
    ? {
        ...withoutAnneal(chained),
        method: 'insert',
        insertRoutes: x.result.routes,
        absenceIds: [...new Set([...chained.absenceIds, ...x.absenceIds])],
        now: x.now,
      }
    : {
        method: 'insert',
        insertRoutes: x.result.routes,
        from: x.base.from,
        baseRoutes: x.base.routes,
        basePins: x.base.pins,
        ...(prev ? { baseGenerated: prev.generated } : {}),
        ...(prev?.runId ? { baseRunId: prev.runId } : {}),
        absenceIds: x.absenceIds,
        now: x.now,
      };
  return writeReassign(d, date, {
    problem: x.problem,
    routes: x.result.routes,
    unassigned: x.result.unassigned,
    pins: x.result.pins,
    info,
    seed: d.seed,
    iterations: 0,
    stopped: false,
    label: x.label,
    createdAt: x.createdAt,
  });
}

/** 振り直しの結果を今の案にし、記録に1件足す（applyReassign・chooseReassign で共通） */
function writeReassign(
  d: DemoData,
  date: string,
  x: {
    problem: Problem;
    routes: Routes;
    unassigned: string[];
    pins: Record<string, string>;
    info: ReassignInfo;
    seed: number;
    iterations: number;
    stopped: boolean;
    label: string;
    createdAt: number;
  },
): DemoData {
  const total = score(x.problem, x.routes).total;
  const solved: SolveResult = {
    routes: x.routes,
    unassigned: x.unassigned,
    score: total,
    seed: x.seed,
    iterations: x.iterations,
    stopped: x.stopped,
  };
  const run = {
    rules: d.rules,
    pins: x.pins,
    result: solved,
    createdAt: x.createdAt,
    label: x.label,
    reassign: x.info,
  };
  const added = addRun(d, date, run);
  const plan: AiPlan = {
    date,
    createdAt: x.createdAt,
    seed: x.seed,
    iterations: x.iterations,
    routes: x.routes,
    unassigned: x.unassigned,
    score: total,
    stopped: x.stopped,
    rules: d.rules,
    generated: { routes: x.routes, unassigned: x.unassigned, score: total },
    pins: x.pins,
    runId: findRun(added, date, run)?.id,
    reassign: x.info,
  };
  return { ...added, aiPlans: { ...added.aiPlans, [date]: plan } };
}

/**
 * 案A・案B のどちらかを今の案にする（PRD D34。ADR-0011 追記）。今の案が振り直しの結果のときだけ（無ければそのまま）。
 * 元の案の情報（baseRoutes・basePins・baseGenerated・baseRunId・absenceIds・now・insertRoutes）は引き継ぎ、
 * method（案B なら stayWeight も）を変える。記録に1件足す（同じ結果の記録があれば足さずにそれを指す）。
 * 全訪問を固定（result.pins）。problem はいまの条件の問題（費用の score を付ける。stay を入れない問題）
 */
export function chooseReassign(
  d: DemoData,
  date: string,
  x: {
    problem: Problem;
    result: ReassignResult;
    method: ReassignInfo['method'];
    stayWeight?: number;
    seed: number;
    iterations: number;
    stopped: boolean;
    label: string;
    createdAt: number;
  },
): DemoData {
  const prev = own(d.aiPlans, date)?.reassign;
  if (!prev) return d;
  const info: ReassignInfo =
    x.method === 'anneal'
      ? { ...prev, method: 'anneal', stayWeight: x.stayWeight ?? STAY_WEIGHT_DEFAULT }
      : { ...withoutAnneal(prev), method: 'insert' };
  return writeReassign(d, date, {
    problem: x.problem,
    routes: x.result.routes,
    unassigned: x.result.unassigned,
    pins: x.result.pins,
    info,
    seed: x.seed,
    iterations: x.iterations,
    stopped: x.stopped,
    label: x.label,
    createdAt: x.createdAt,
  });
}

/**
 * 元の案に戻す（D31）：routes・pins を元の案（baseRoutes・basePins）に、generated・runId を振り直す前のもの
 * （baseGenerated・baseRunId。無ければ generated＝元の案、runId は外す）にし、reassign を外す。
 * 続けて振り直したときも最初の元の案へ戻す。今の案が振り直しでなければそのまま
 */
export function revertReassign(d: DemoData, date: string, problem: Problem): DemoData {
  const plan = own(d.aiPlans, date);
  if (!plan?.reassign) return d;
  const ids = new Set(problem.visits.map((v) => v.id));
  const routes: Routes = {};
  for (const [k, list] of Object.entries(plan.reassign.baseRoutes)) routes[k] = list.filter((id) => ids.has(id));
  const placed = new Set(Object.values(routes).flat());
  const unassigned = problem.visits.map((v) => v.id).filter((id) => !placed.has(id));
  const total = score(problem, routes).total;
  const info = plan.reassign;
  const { reassign: _r, runId: _id, ...rest } = plan;
  const next: AiPlan = {
    ...rest,
    routes,
    unassigned,
    score: total,
    generated: info.baseGenerated ?? { routes, unassigned, score: total },
    pins: info.basePins,
    ...(info.baseRunId ? { runId: info.baseRunId } : {}),
  };
  return { ...d, aiPlans: { ...d.aiPlans, [date]: next } };
}
