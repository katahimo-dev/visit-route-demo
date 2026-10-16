// 月間カレンダー・月まとめ作成（ADR-0012 段階1。design.md §4 pages「月単位の予定」）の画面の純粋関数。
// データは書き換えず、新しい DemoData を返す（書くのは画面の update(fn)）
import type { AiPlan, AiRun, DemoData } from '../contracts/data';
import type { Problem, SolveResult } from '../contracts/problem';
import type { Rule } from '../contracts/rules';
import { NONE } from '../domain/scheduleModel';
import { addDays, weekday } from '../domain/time';
import { type CompileInput, compile } from '../matching';
import { applyPatterns } from '../patterns';
import { own } from './common';
import { addRun, findRun, problemKey } from './runs';

/** 月まとめ作成の対象：まだ案の無い日だけ／確定していない日をすべて／条件が変わった日 */
export type BatchMode = 'empty' | 'all' | 'stale';

/** 日の状態：案なし／案あり／確定済み／未確定の変更あり */
export type DayState = 'none' | 'plan' | 'confirmed' | 'diff';

const YM = /^(\d{4})-(\d{2})$/;

/** 'YYYY-MM' として正しいか */
export function isYm(ym: string): boolean {
  const m = YM.exec(ym);
  if (!m) return false;
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12;
}

/** 日付（YYYY-MM-DD）の月（YYYY-MM） */
export const ymOf = (date: string): string => date.slice(0, 7);

/** 月を n か月ずらす */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const i = (y ?? 0) * 12 + ((m ?? 1) - 1) + n;
  const yy = Math.floor(i / 12);
  const mm = i - yy * 12 + 1;
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;
}

/** その月の日付（1日から末日まで） */
export function monthDates(ym: string): string[] {
  const out: string[] = [];
  let d = `${ym}-01`;
  while (ymOf(d) === ym) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/** 日曜はじまりの6週×7日の日付（前後の月の日を含む） */
export function calendarWeeks(ym: string): string[][] {
  const first = `${ym}-01`;
  const start = addDays(first, -weekday(first));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
}

/**
 * その月の今日以降に、定期パターンから訪問を展開する（patterns の applyPatterns。無い ID だけ足す）。
 * 足す訪問が無ければ同じデータを返す。added は足した訪問の件数
 */
export function expandMonth(d: DemoData, ym: string, today: string): { data: DemoData; added: number } {
  const days = monthDates(ym);
  const c = applyPatterns(d, { from: days[0]!, to: days.at(-1)! }, today);
  if (c.added.length === 0) return { data: d, added: 0 };
  return { data: { ...d, visits: c.visits }, added: c.added.length };
}

/** その日の取り消しでない訪問 */
export function activeVisitsOn(data: Pick<DemoData, 'visits'>, date: string) {
  return data.visits.filter((v) => v.date === date && !v.cancelled);
}

/** 今の案に手直し・固定があるか */
export function planEdited(plan: AiPlan): boolean {
  return Object.keys(plan.pins).length > 0 || JSON.stringify(plan.routes) !== JSON.stringify(plan.generated.routes);
}

/** 今の案の元の記録（runId で引く。無ければ undefined） */
export function planRunOf(data: Pick<DemoData, 'aiPlans' | 'aiRuns'>, date: string): AiRun | undefined {
  const plan = own(data.aiPlans, date);
  if (!plan?.runId) return undefined;
  return (own(data.aiRuns, date) ?? []).find((r) => r.id === plan.runId);
}

/**
 * （D43）今の案の元の記録を作ったあとに、その日の問題が変わったか：記録の inputKey と、
 * いまのデータに記録の条件（と固定）を当てた問題のキーが違えば true。
 * 記録が無い・inputKey が無い古い記録・欠勤の振り直しの記録は判定しない（false）。
 * problemOf を渡すと、その条件の問題をそこから引く（画面が作った問題を使い回して compile を省く）
 */
export function planStale(
  input: CompileInput,
  data: Pick<DemoData, 'aiPlans' | 'aiRuns'>,
  date: string,
  problemOf?: (rules: Rule[], pins: Record<string, string>) => Problem | null | undefined,
): boolean {
  const run = planRunOf(data, date);
  if (!run || run.reassign || run.inputKey === undefined) return false;
  try {
    const p =
      problemOf?.(run.rules, run.pins) ??
      compile({ ...input, rules: run.rules }, date, Object.keys(run.pins).length > 0 ? run.pins : undefined);
    return problemKey(p) !== run.inputKey;
  } catch {
    return false;
  }
}

/**
 * 月まとめ作成の対象の日（日付の順）：その月・今日以降・取り消しでない訪問がある・確定した割当（manualPlans）が無い日のうち、
 * mode が 'empty' なら今の案が無い日、'all' なら全部、'stale' なら条件が変わった日（planStale）。
 * staleOf を渡すと条件が変わったかをそれで決める（画面で計算済みのもの）
 */
export function batchTargets(
  data: CompileInput & Pick<DemoData, 'aiPlans' | 'aiRuns' | 'manualPlans'>,
  ym: string,
  today: string,
  mode: BatchMode,
  staleOf: (date: string) => boolean = (date) => planStale(data, data, date),
): string[] {
  const withVisits = new Set(data.visits.filter((v) => !v.cancelled && ymOf(v.date) === ym).map((v) => v.date));
  return monthDates(ym).filter((date) => {
    if (date < today || !withVisits.has(date) || own(data.manualPlans, date)) return false;
    if (mode === 'empty') return !own(data.aiPlans, date);
    if (mode === 'stale') return !!own(data.aiPlans, date) && staleOf(date);
    return true;
  });
}

/** 画面が compile・採点して渡すもの（点数・必須の違反・条件が変わったか・計算に入れる訪問） */
export type DayView = {
  /** 点数（100点満点。点数の基準の物差し）。案が無い・採点できなければ null */
  hundred?: number | null;
  /** 必須の違反の件数 */
  hard?: number;
  /** （D43）条件が変わった */
  stale?: boolean;
  /** 計算に入れる訪問の ID（問題の訪問）。無ければ取り消しでない訪問 */
  visitIds?: readonly string[];
};

export type DayStatus = {
  date: string;
  /** 訪問の件数（取り消しを除く） */
  count: number;
  state: DayState;
  /** 今の案で入らない訪問の件数（案が無ければ 0） */
  unassigned: number;
  /** その日に欠勤がある */
  absence: boolean;
  hundred: number | null;
  hard: number;
  stale: boolean;
  /** 手当てが必要（訪問があって案なし・入らない訪問がある・必須の違反がある） */
  needsCare: boolean;
};

/**
 * 日のマスの状態。確定は予定の画面の「確定済み」と同じ判定（計算に入れる訪問の担当が、確定した割当と今の案で同じ）。
 * 確定した割当だけあって今の案が無い日は「確定済み」
 */
export function dayStatus(
  data: Pick<DemoData, 'visits' | 'aiPlans' | 'manualPlans' | 'absences'>,
  date: string,
  view: DayView = {},
): DayStatus {
  const visits = activeVisitsOn(data, date);
  const ids = view.visitIds ?? visits.map((v) => v.id);
  const plan = own(data.aiPlans, date);
  const saved = own(data.manualPlans, date);
  const ownerOf = (routes: Record<string, string[]>) => {
    const m = new Map<string, string>();
    for (const [s, list] of Object.entries(routes)) if (s !== NONE) for (const id of list) m.set(id, s);
    return m;
  };
  let state: DayState = 'none';
  let unassigned = 0;
  if (plan && ids.length > 0) {
    const ai = ownerOf(plan.routes);
    unassigned = ids.filter((id) => !ai.has(id)).length;
    if (!saved) state = 'plan';
    else {
      const m = ownerOf(saved);
      state = ids.every((id) => (ai.get(id) ?? null) === (m.get(id) ?? null)) ? 'confirmed' : 'diff';
    }
  } else if (saved && ids.length > 0) {
    state = 'confirmed';
  }
  const hard = plan ? (view.hard ?? 0) : 0;
  return {
    date,
    count: visits.length,
    state,
    unassigned,
    absence: data.absences.some((a) => a.date === date),
    hundred: plan ? (view.hundred ?? null) : null,
    hard,
    stale: !!plan && !!view.stale,
    needsCare: visits.length > 0 && (state === 'none' || unassigned > 0 || hard > 0),
  };
}

/**
 * 月まとめ作成で作った案を書く：記録に1件足し（lib/runs の addRun。同じ記録があれば足さない）、今の案
 * （routes・generated＝結果、pins＝{}、rules、runId）にする。onlyEmpty（「まだ案の無い日だけ」）のときに、
 * その日の今の案がすでにあれば今の案は変えず記録だけ足す。確定した割当がある日も今の案は変えない
 */
export function applyDayRun(
  d: DemoData,
  date: string,
  run: { rules: Rule[]; result: SolveResult; createdAt: number; inputKey: string; onlyEmpty: boolean },
): DemoData {
  const x = { rules: run.rules, pins: {}, result: run.result, createdAt: run.createdAt, inputKey: run.inputKey };
  const added = addRun(d, date, x);
  if ((run.onlyEmpty && own(d.aiPlans, date)) || own(d.manualPlans, date)) return added;
  const r = run.result;
  const plan: AiPlan = {
    date,
    createdAt: run.createdAt,
    seed: r.seed,
    iterations: r.iterations,
    routes: r.routes,
    unassigned: r.unassigned,
    score: r.score,
    stopped: r.stopped,
    rules: run.rules,
    generated: { routes: r.routes, unassigned: r.unassigned, score: r.score },
    pins: {},
    runId: findRun(added, date, x)?.id,
  };
  return { ...added, aiPlans: { ...added.aiPlans, [date]: plan } };
}
