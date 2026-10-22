// 月間カレンダー・月まとめ作成（ADR-0012 段階1。design.md §4 pages「月単位の予定」）の画面の純粋関数。
// データは書き換えず、新しい DemoData を返す（書くのは画面の update(fn)）
import type { AiPlan, AiRun, DemoData } from '../contracts/data';
import type { Absence } from '../contracts/documents';
import type { Problem, SolveResult, StopTiming } from '../contracts/problem';
import type { Routes } from '../contracts/reassign';
import { HARDABLE, type Preset, type Rule } from '../contracts/rules';
import { afterLastDay, availabilityOf, type Slot, withoutAbsences } from '../domain/availability';
import { isOnLeave } from '../domain/leaves';
import { NONE } from '../domain/scheduleModel';
import { addDays, hhmmToMinutes, weekday } from '../domain/time';
import { applyPrefPins, type CompileInput, compile, scheduleRoute } from '../matching';
import { applyPatterns } from '../patterns';
import { applyPreset } from '../seed/presets';
import { attempt, own } from './common';
import { isRequestedOff } from './requestedOff';
import { addRun, findRun, problemKey } from './runs';
import { busyParts, type StaffSlot, spansOf, staffSlots } from './staffBar';

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

/** 月の予定が見せている月（`?ym=` が正しければその月、無ければ選んでいる日付の月。MonthPage と同じ決め方） */
export function monthShown(search: string, date: string): string {
  const raw = new URLSearchParams(search).get('ym') ?? '';
  return isYm(raw) ? raw : ymOf(date);
}

/** 月を n か月ずらす */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const i = (y ?? 0) * 12 + ((m ?? 1) - 1) + n;
  const yy = Math.floor(i / 12);
  const mm = i - yy * 12 + 1;
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;
}

/** 月を送ったときに選ぶ日付：その月の1日、ただし今月なら今日（PRD D59） */
export const firstDayOf = (ym: string, today: string): string => (ymOf(today) === ym ? today : `${ym}-01`);

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
  return expandRange(d, days[0]!, days.at(-1)!, today);
}

/**
 * from〜to（両端を含む）の今日以降に、定期パターンから訪問を展開する（expandMonth の範囲を選べる形。週の予定の「この週の案を作る」。
 * PRD D280）。足す訪問が無ければ同じデータを返す
 */
export function expandRange(d: DemoData, from: string, to: string, today: string): { data: DemoData; added: number } {
  const c = expandRangeVisits(d, from, to, today);
  if (c.added === 0) return { data: d, added: 0 };
  return { data: { ...d, visits: c.visits }, added: c.added };
}

/**
 * expandMonth の訪問だけ（読むのは定期パターン・訪問・〈利用者さん〉だけ。案・確定した割当が変わっても結果は同じなので、
 * 画面はこの3つと月・今日で覚えておける。進み具合の帯。PR #38 のレビュー）。足す訪問が無ければ同じ訪問の配列を返す
 */
export function expandMonthVisits(
  d: Pick<DemoData, 'patterns' | 'visits' | 'clients'>,
  ym: string,
  today: string,
): { visits: DemoData['visits']; added: number; addedByDate: ReadonlyMap<string, number> } {
  const days = monthDates(ym);
  return expandRangeVisits(d, days[0]!, days.at(-1)!, today);
}

/**
 * from〜to の expandMonthVisits。addedByDate は日ごとの足す訪問の件数（「未作成」の日。PRD D282。足す訪問の無い日は入れない）
 */
export function expandRangeVisits(
  d: Pick<DemoData, 'patterns' | 'visits' | 'clients'>,
  from: string,
  to: string,
  today: string,
): { visits: DemoData['visits']; added: number; addedByDate: ReadonlyMap<string, number> } {
  const c = applyPatterns(d, { from, to }, today);
  const addedByDate = new Map<string, number>();
  for (const a of c.added) addedByDate.set(a.date, (addedByDate.get(a.date) ?? 0) + 1);
  return { visits: c.visits, added: c.added.length, addedByDate };
}

/** その日の取り消しでなく、〈利用者さん〉の休み（ADR-0013）でもない訪問 */
export function activeVisitsOn(data: Pick<DemoData, 'visits' | 'clientLeaves'>, date: string) {
  return data.visits.filter((v) => v.date === date && !v.cancelled && !isOnLeave(data.clientLeaves, v));
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
 * 記録の prefPins（手直しの記憶で固定した訪問。ADR-0043）は記録のまま当てる（いまの記憶は見ない）。
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
    // 手直しの記憶（ADR-0043）は作ったときに当てた固定（prefPins）のまま当てる（記憶が変わっても「条件が変わった」にしない）
    return problemKey(applyPrefPins(p, run.prefPins).problem) !== run.inputKey;
  } catch {
    return false;
  }
}

/**
 * 条件の組のキー（PRD D161）：条件の ID・型・重み・必須（必須にできない型は必須にしない）。名前は計算に効かないので入れない
 */
export function ruleSetKey(rules: readonly Rule[]): string {
  return JSON.stringify(rules.map((r) => [r.id, r.type, r.weight, HARDABLE.has(r.type) && r.hard]));
}

/** いまある条件の組のキー（PRD D161） */
export type RuleKeys = {
  /** この日だけ試す重みに各プリセットを当てたもの */
  presets: ReadonlySet<string>;
  /** この日だけ試す重み（条件の重みの画面の重み）そのもの */
  current: string;
};

/** いまある条件の組のキー（PRD D161）：この日だけ試す重みに各プリセットを当てたもの、この日だけ試す重みそのもの */
export function currentRuleKeys(rules: readonly Rule[], presets: readonly Preset[]): RuleKeys {
  return {
    presets: new Set(presets.map((p) => ruleSetKey(applyPreset([...rules], p)))),
    current: ruleSetKey(rules),
  };
}

/**
 * （D43・D161）今の案の元の記録を作った条件（重み・必須）が、いまはもう無いか：
 * - プリセットの重みで作った案（記録の presetId がある＝作ったときにどれかのプリセットと重みが一致した。自動作成・月のまとめて作る・
 *   プリセットのカード）は、この日だけ試す重みに各プリセットを当てたもののどれとも違えば変わった。この日だけ試す重みが古い重みのままでも、
 *   プリセットの重みを変えれば変わったになる（初期状態で標準の重みを変えたとき）
 * - この日だけ試す重みで作った案（presetId が null＝どのプリセットとも一致しなかった）は、それに加えてこの日だけ試す重みとも違えば変わった
 * 作り直しは点数の基準のプリセットで作るので、作り直した案は必ず当てはまる（true が残り続けない）。点数の基準を切り替えただけでは
 * 変わらない（前の基準のプリセットもまだある）。名前は計算に効かないので見ない。記録が無い・欠勤の振り直しの記録は判定しない（false）
 * 機能の入り切り（ADR-0028。PRD D214）は見ない：入り切りで AI案の問題が変わった日は planStale（inputKey）で変わったになる
 * （記録の calcFeatures は記録として書くだけ。使い回し（reusableRun）で同じ記録を返しても変わったが残り続けない）
 */
export function rulesStale(data: Pick<DemoData, 'aiPlans' | 'aiRuns'>, date: string, keys: RuleKeys): boolean {
  const run = planRunOf(data, date);
  if (!run || run.reassign) return false;
  const key = ruleSetKey(run.rules);
  if (keys.presets.has(key)) return false;
  return run.presetId !== null || key !== keys.current;
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
  const withVisits = new Set(
    data.visits
      .filter((v) => !v.cancelled && ymOf(v.date) === ym && !isOnLeave(data.clientLeaves, v))
      .map((v) => v.date),
  );
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
  /** 欠勤（希望休も）の時間と重なる・最終勤務日の後（ADR-0015）なのに、その人に残っている訪問の数（数える案で。ADR-0014） */
  absentLeft?: number;
  /** 拘束が上限を超える〈スタッフ〉の ID（ADR-0015。月のマスの数える案＝今の案、無ければ確定した割当で） */
  overSpan?: readonly string[];
};

export type DayStatus = {
  date: string;
  /** 訪問の件数（取り消しを除く） */
  count: number;
  state: DayState;
  /** 今の案で入らない訪問の件数（案が無ければ 0） */
  unassigned: number;
  /** その日に欠勤がある（希望休も） */
  absence: boolean;
  /** 欠勤（希望休も）の人に残っている訪問の数（ADR-0014。画面が数えて渡す） */
  absentLeft: number;
  /** 拘束が上限を超える〈スタッフ〉の ID（ADR-0015。注意だけで、手当てが必要には数えない） */
  overSpan: readonly string[];
  hundred: number | null;
  hard: number;
  stale: boolean;
  /**
   * 要対応（赤。PRD D228）：入らない訪問がある・必須の違反がある・欠勤の人に訪問が残る。
   * 訪問があって案の無い日は注意（黄）で、ここには入れない（画面が count と state から決める）
   */
  needsCare: boolean;
};

/**
 * 日のマスの状態。確定は予定の画面の「確定済み」と同じ判定（計算に入れる訪問の担当が、確定した割当と今の案で同じ）。
 * 確定した割当だけあって今の案が無い日は「確定済み」
 */
export function dayStatus(
  data: Pick<DemoData, 'visits' | 'aiPlans' | 'manualPlans' | 'absences' | 'clientLeaves'>,
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
  const absentLeft = state === 'none' ? 0 : (view.absentLeft ?? 0);
  return {
    date,
    count: visits.length,
    state,
    unassigned,
    absence: data.absences.some((a) => a.date === date),
    absentLeft,
    overSpan: view.overSpan ?? [],
    hundred: plan ? (view.hundred ?? null) : null,
    hard,
    // 計算に入れる訪問が無い日（取り消し・休みだけ）は作り直す対象にならないので数えない（batchTargets と同じ。PR #40 のレビュー）
    stale: !!plan && visits.length > 0 && !!view.stale,
    needsCare: visits.length > 0 && (unassigned > 0 || hard > 0 || absentLeft > 0),
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
  run: {
    rules: Rule[];
    result: SolveResult;
    createdAt: number;
    inputKey: string;
    onlyEmpty: boolean;
    /** 手直しの記憶で固定した訪問（ADR-0043） */
    prefPins?: Record<string, string>;
  },
): DemoData {
  const x = {
    rules: run.rules,
    pins: {},
    result: run.result,
    createdAt: run.createdAt,
    inputKey: run.inputKey,
    prefPins: run.prefPins,
  };
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

// ---- 月間の改定（PRD D53〜D55。design.md §4 pages「月間・週間の改定（2026-10-17）」）----

type MonthInput = CompileInput & Pick<DemoData, 'aiPlans' | 'manualPlans'>;

/** その日の数える案（今の案、無ければ確定した割当）。D55 */
export type DayPlan = {
  date: string;
  /** いまのデータの問題（作れなければ null） */
  problem: Problem | null;
  /** 数える案の元。どちらも無ければ null（案なし） */
  source: 'plan' | 'confirmed' | null;
  /** 担当 → 訪問ID の列（問題にある訪問だけ。未割当の列は除く） */
  routes: Routes;
};

/**
 * その日の数える案：今の案があればその列（問題に無い訪問を除いた順のまま）、無ければ確定した割当
 * （担当ごとに訪問の開始（早）の順）。problem を渡すとそれを使う（無ければその日の訪問だけで compile）
 */
export function dayPlanOf(data: MonthInput, date: string, problem?: Problem | null): DayPlan {
  const p =
    problem !== undefined
      ? problem
      : attempt(() => compile({ ...data, visits: data.visits.filter((v) => v.date === date) }, date)).value;
  const ids = new Map(p?.visits.map((v, i) => [v.id, i]) ?? []);
  const keep = (r: Record<string, string[]>) => {
    const out: Routes = {};
    for (const [k, list] of Object.entries(r)) {
      if (k === NONE) continue;
      const xs = list.filter((id) => ids.has(id));
      if (xs.length > 0) out[k] = xs;
    }
    return out;
  };
  const plan = own(data.aiPlans, date);
  if (plan) return { date, problem: p, source: 'plan', routes: keep(plan.routes) };
  const saved = own(data.manualPlans, date);
  if (saved && p) {
    const routes = keep(saved);
    const order = (id: string) => [p.visits[ids.get(id)!]!.earliest, ids.get(id)!] as const;
    for (const k of Object.keys(routes)) {
      routes[k] = [...routes[k]!].sort((a, b) => {
        const x = order(a);
        const y = order(b);
        return x[0] - y[0] || x[1] - y[1];
      });
    }
    if (Object.keys(routes).length > 0) return { date, problem: p, source: 'confirmed', routes };
  }
  return { date, problem: p, source: null, routes: {} };
}

/** 種類ごとの件数（typeId が null＝種類なし） */
export type TypeCount = { typeId: string | null; count: number };

/** 種類の並び（data.visitTypes の順、種類なし・いない種類は最後） */
function sortTypes(counts: Map<string | null, number>, visitTypes: readonly { id: string }[]): TypeCount[] {
  const order = new Map(visitTypes.map((t, i) => [t.id, i]));
  const rank = (id: string | null) => (id === null ? 1e9 : (order.get(id) ?? 1e8));
  return [...counts].map(([typeId, count]) => ({ typeId, count })).sort((a, b) => rank(a.typeId) - rank(b.typeId));
}

const slotMinutes = (slots: readonly { start: number; end: number }[]) =>
  slots.reduce((m, x) => m + Math.max(0, x.end - x.start), 0);
const toMin = (slots: readonly Slot[]) =>
  slots.map((x) => ({ start: hhmmToMinutes(x.start), end: hhmmToMinutes(x.end) }));
/** 名前の最初の語（「消防 まもる」→「消防」） */
export const shortName = (name: string): string => name.trim().split(/\s+/)[0] || name;

/** 日のマスの印（D53）：種類ごとの件数・休みの人・欠勤の人・その日に始まる／終わる定期パターンのある利用者さん */
export type DayMarks = {
  types: TypeCount[];
  /** 休み（稼働時間帯が無い）の稼働中の〈スタッフ〉の名前 */
  off: string[];
  /** 欠勤のある〈スタッフ〉の名前（希望休だけの人は除く） */
  absent: string[];
  /** 希望休（ADR-0014）の〈スタッフ〉の名前。「休 N」の印に off と合わせて数える */
  requested: string[];
  /**
   * その日に始まる定期パターンのある〈利用者さん〉の表示名。基準日（データの最初の日）以前に始まるもの・
   * 前日も同じ〈利用者さん〉のパターンの期間のもの（「以降すべて」で分けたパターンなど）は除く
   */
  starts: string[];
  /** その日に終わる定期パターンのある〈利用者さん〉の表示名。翌日も同じ〈利用者さん〉のパターンの期間なら除く */
  ends: string[];
  /** その日に休み（ADR-0013）で訪問が無しになる〈利用者さん〉の表示名（取り消しでない訪問がある人だけ） */
  leaves: string[];
  /** その日が最終勤務日（ADR-0015）の〈スタッフ〉の名前。最終勤務日の後の人は off にも数えない */
  lastDays: string[];
};

/** 日のマスの印（取り消しの訪問は数えない。休止中の〈スタッフ〉・〈利用者さん〉は出さない） */
export function dayMarks(
  data: Pick<
    DemoData,
    | 'baseDate'
    | 'visits'
    | 'staff'
    | 'clients'
    | 'availability'
    | 'absences'
    | 'patterns'
    | 'visitTypes'
    | 'clientLeaves'
  >,
  date: string,
): DayMarks {
  const counts = new Map<string | null, number>();
  for (const v of activeVisitsOn(data, date)) counts.set(v.typeId, (counts.get(v.typeId) ?? 0) + 1);
  const dayAbsences = data.absences.filter((a) => a.date === date);
  const absentIds = new Set(dayAbsences.map((a) => a.staffId));
  // 希望休（ADR-0014）：その人のその日の欠勤がすべて希望休
  const requestedIds = new Set(
    [...absentIds].filter((id) => dayAbsences.every((a) => a.staffId !== id || isRequestedOff(a))),
  );
  const off: string[] = [];
  const absent: string[] = [];
  const requested: string[] = [];
  const lastDays: string[] = [];
  for (const s of data.staff) {
    if (!s.active) continue;
    if (s.lastDay === date) lastDays.push(s.name);
    // 最終勤務日の後（ADR-0015）はもういない人なので、休みに数えない
    if (afterLastDay(s, date)) continue;
    const override = data.availability.find((a) => a.staffId === s.id && a.date === date);
    const slots = availabilityOf(s, date, override).slots;
    if (absentIds.has(s.id) && slots.length > 0) (requestedIds.has(s.id) ? requested : absent).push(s.name);
    else if (slots.length === 0) off.push(s.name);
  }
  const clientName = new Map(data.clients.filter((c) => c.active).map((c) => [c.id, c.displayName]));
  const namesOf = (pick: (p: DemoData['patterns'][number]) => boolean) => [
    ...new Set(data.patterns.filter(pick).flatMap((p) => clientName.get(p.clientId) ?? [])),
  ];
  /** その〈利用者さん〉のどれかのパターンの期間に day が入るか */
  const covered = (clientId: string, day: string) =>
    data.patterns.some((p) => p.clientId === clientId && p.from <= day && (p.to === null || day <= p.to));
  const before = addDays(date, -1);
  const after = addDays(date, 1);
  return {
    types: sortTypes(counts, data.visitTypes),
    off,
    absent,
    requested,
    // 基準日（データの最初の日）以前に始まるパターンは数えない（初期データの全パターンが基準日に始まるため）。
    // 前日も同じ〈利用者さん〉のパターンがある（「以降すべて」で分けた・種類を足した）ときも数えない
    starts: namesOf((p) => p.from === date && date > data.baseDate && !covered(p.clientId, before)),
    // 翌日も同じ〈利用者さん〉のパターンがある（「以降すべて」で分けた）ときは数えない
    ends: namesOf((p) => p.to === date && !covered(p.clientId, after)),
    leaves: [
      ...new Set(
        data.visits
          .filter((v) => v.date === date && !v.cancelled && isOnLeave(data.clientLeaves, v))
          .flatMap((v) => clientName.get(v.clientId) ?? []),
      ),
    ],
    lastDays,
  };
}

/** 選んだ〈スタッフ〉の日（D55） */
export type StaffDay = {
  date: string;
  /** 欠勤を差し引いた稼働時間帯 */
  slots: Slot[];
  /** 休み（欠勤の前から稼働時間帯が無い） */
  off: boolean;
  /** その日の欠勤（無ければ null） */
  absence: Absence | null;
  /** その日の欠勤が希望休（ADR-0014） */
  requested: boolean;
  /** 最終勤務日の後（ADR-0015） */
  retired: boolean;
  /** 数える案が無い（訪問がある日だけ true。訪問の無い日は空の案として数える＝vacancy の dayLoad と同じ） */
  noPlan: boolean;
  /** 担当の件数 */
  count: number;
  /**
   * 件数の目安：その日の担当できる訪問の件数を、稼働時間（欠勤を除く）の長さで按分した数（compile の負担の均等と同じ考え方）。
   * 稼働時間が無い・問題が無ければ null
   */
  target: number | null;
  /** 移動の合計（分。自宅へ帰る移動を含む） */
  travel: number;
  /** 稼働時間（分） */
  minutes: number;
  types: TypeCount[];
  /**
   * 30分ごとの状態（PRD D75。lib/staffBar の staffSlots。0:00〜24:00 の48マス。3段に出すのは 8〜20時で外は端の印。PRD D82）。数える案が無い日（noPlan）は勤務内を「案なし」にする
   */
  bar: StaffSlot[];
};

/** 選んだ〈スタッフ〉のその日（数えるのは今の案、無ければ確定した割当） */
export function staffDay(data: CompileInput, day: DayPlan, staffId: string): StaffDay {
  const { date, problem: p } = day;
  const s = data.staff.find((x) => x.id === staffId);
  const override = data.availability.find((a) => a.staffId === staffId && a.date === date);
  const base = s ? availabilityOf(s, date, override).slots : [];
  const absences = data.absences.filter((a) => a.staffId === staffId && a.date === date);
  const slots = absences.length > 0 ? withoutAbsences(base, absences) : base;
  const list = own(day.routes, staffId) ?? [];
  const counts = new Map<string | null, number>();
  const visitById = new Map(data.visits.filter((v) => v.date === date).map((v) => [v.id, v]));
  for (const id of list) {
    const t = visitById.get(id)?.typeId ?? null;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let travel = 0;
  let target: number | null = null;
  let stops: StopTiming[] = [];
  const minutes = slotMinutes(toMin(slots));
  if (p) {
    const si = p.staff.findIndex((x) => x.id === staffId);
    if (si >= 0 && list.length > 0) {
      const vIndex = new Map(p.visits.map((v, i) => [v.id, i]));
      const idx = list.map((id) => vIndex.get(id)).filter((x): x is number => x !== undefined);
      const t = scheduleRoute(p, si, idx, 'lenient');
      travel = t?.travelMinutes ?? 0;
      stops = t?.stops ?? [];
    }
    const total = p.staff.reduce((m, x) => m + slotMinutes(x.slots), 0);
    const mine = si >= 0 ? slotMinutes(p.staff[si]!.slots) : 0;
    if (mine > 0 && total > 0) target = ((p.visits.length - p.infeasible.length) * mine) / total;
  }
  // 問題が作れなかった日（p＝null）は、取り消し・休みでない訪問の件数で見る（週の noPlanOf と同じ）
  const hasVisits = p ? p.visits.length > 0 : activeVisitsOn(data, date).length > 0;
  const noPlan = hasVisits && day.source === null;
  return {
    date,
    slots,
    off: base.length === 0,
    absence: absences.at(-1) ?? null,
    requested: absences.length > 0 && absences.every(isRequestedOff),
    retired: !!s && afterLastDay(s, date),
    noPlan,
    count: list.length,
    target,
    travel: Math.round(travel),
    minutes,
    types: sortTypes(counts, data.visitTypes),
    bar: staffSlots({
      shift: spansOf(slots),
      base: spansOf(base),
      busy: busyParts(stops),
      planned: !noPlan,
    }),
  };
}

/** 選んだ〈スタッフ〉の月の集計（D55） */
export type StaffMonth = {
  count: number;
  /** 稼働時間（分。欠勤を除く） */
  minutes: number;
  /** 移動（分） */
  travel: number;
  /** 稼働時間帯のある日の数 */
  workDays: number;
  /** 欠勤のある日の数（希望休を除く） */
  absenceDays: number;
  /** 希望休の日の数（ADR-0014） */
  requestedDays: number;
  types: TypeCount[];
  /** 資格（〈スタッフ〉の項目「資格」の値） */
  qualifications: string[];
};

/** 選んだ〈スタッフ〉の月の集計（days はその月の日） */
export function staffMonth(data: CompileInput, days: readonly DayPlan[], staffId: string): StaffMonth {
  const counts = new Map<string | null, number>();
  let count = 0;
  let minutes = 0;
  let travel = 0;
  let workDays = 0;
  let absenceDays = 0;
  let requestedDays = 0;
  for (const day of days) {
    const x = staffDay(data, day, staffId);
    count += x.count;
    minutes += x.minutes;
    travel += x.travel;
    if (x.slots.length > 0) workDays++;
    if (x.absence && x.requested) requestedDays++;
    else if (x.absence) absenceDays++;
    for (const t of x.types) counts.set(t.typeId, (counts.get(t.typeId) ?? 0) + t.count);
  }
  const s = data.staff.find((x) => x.id === staffId);
  const item = data.items.find((it) => it.target === 'staff' && it.name === '資格');
  const raw = item && s ? s.traits[item.id] : null;
  const qualifications = Array.isArray(raw) ? raw : typeof raw === 'string' && raw !== '' ? [raw] : [];
  return {
    count,
    minutes,
    travel,
    workDays,
    absenceDays,
    requestedDays,
    types: sortTypes(counts, data.visitTypes),
    qualifications,
  };
}

/** 選んだ〈利用者さん〉の訪問1件（D55） */
export type ClientVisitMark = {
  visitId: string;
  /** 開始（0時からの分）。案の時刻（lenient）、案に無ければ訪問の開始（早） */
  start: number;
  typeId: string | null;
  /** 担当（null＝案なし・入らない・取り消し） */
  staffId: string | null;
  /** いつもの担当（パターンのいつもの担当、無ければ〈利用者さん〉のいつもの担当）でない担当（「代」） */
  substitute: boolean;
  /** この回だけ変えた（パターンの訪問） */
  edited: boolean;
  cancelled: boolean;
  /** 当日キャンセル（取り消しの種類。ADR-0015） */
  sameDay: boolean;
  /** 〈利用者さん〉の休み（ADR-0013）のため無し（取り消しでない訪問だけ。計算に入らない） */
  leave: boolean;
  /** 案があるのに担当がいない（入らない） */
  unassigned: boolean;
};

export type ClientDay = { date: string; noPlan: boolean; visits: ClientVisitMark[] };

/** 選んだ〈利用者さん〉のその日の訪問（取り消しも含む。開始の順） */
export function clientDay(data: CompileInput, day: DayPlan, clientId: string): ClientDay {
  const { date, problem: p } = day;
  const mine = data.visits.filter((v) => v.date === date && v.clientId === clientId);
  const client = data.clients.find((c) => c.id === clientId);
  const patternById = new Map(data.patterns.map((x) => [x.id, x]));
  const placed = new Map<string, { staffId: string; start: number }>();
  if (p && mine.length > 0) {
    const ids = new Set(mine.map((v) => v.id));
    const vIndex = new Map(p.visits.map((v, i) => [v.id, i]));
    p.staff.forEach((st, s) => {
      const list = own(day.routes, st.id) ?? [];
      if (!list.some((id) => ids.has(id))) return;
      const idx = list.map((id) => vIndex.get(id)).filter((x): x is number => x !== undefined);
      const t = scheduleRoute(p, s, idx, 'lenient');
      for (const stop of t?.stops ?? [])
        if (ids.has(stop.visitId)) placed.set(stop.visitId, { staffId: st.id, start: stop.start });
    });
  }
  const visits = mine
    .map((v): ClientVisitMark => {
      const leave = !v.cancelled && isOnLeave(data.clientLeaves, v);
      const at = v.cancelled || leave ? undefined : placed.get(v.id);
      const pattern = v.pattern ? patternById.get(v.pattern.id) : undefined;
      const usual = pattern?.usualStaffId ?? client?.usualStaffId ?? null;
      const staffId = at?.staffId ?? null;
      return {
        visitId: v.id,
        start: at?.start ?? hhmmToMinutes(v.earliestStart),
        typeId: v.typeId,
        staffId,
        substitute: staffId !== null && usual !== null && staffId !== usual,
        edited: v.pattern?.edited ?? false,
        cancelled: v.cancelled,
        sameDay: v.cancelled && v.cancelKind === 'sameDay',
        leave,
        unassigned: !v.cancelled && !leave && staffId === null && day.source !== null,
      };
    })
    .sort((a, b) => a.start - b.start || a.visitId.localeCompare(b.visitId));
  const active = visits.some((v) => !v.cancelled && !v.leave);
  return { date, noPlan: active && day.source === null, visits };
}

/** 選んだ〈利用者さん〉の月の集計（D55） */
export type ClientMonth = {
  /** 予定の回数（取り消しを除く） */
  planned: number;
  /** この回だけ変えた回（取り消しを除く） */
  edited: number;
  /** 取り消した回 */
  cancelled: number;
  /** 取り消した回のうち、当日キャンセル（ADR-0015） */
  sameDay: number;
  /** 休み（ADR-0013）のため無しの回 */
  leave: number;
  /** いつもの担当でない回 */
  substitute: number;
  /** 担当した人の内訳（多い順。staffId が null＝案なし・入らない） */
  byStaff: { staffId: string | null; count: number }[];
};

/** 選んだ〈利用者さん〉の月の集計（days はその月の日） */
export function clientMonth(data: CompileInput, days: readonly DayPlan[], clientId: string): ClientMonth {
  const out: ClientMonth = { planned: 0, edited: 0, cancelled: 0, sameDay: 0, leave: 0, substitute: 0, byStaff: [] };
  const by = new Map<string | null, number>();
  for (const day of days) {
    for (const v of clientDay(data, day, clientId).visits) {
      if (v.cancelled) {
        out.cancelled++;
        if (v.sameDay) out.sameDay++;
        continue;
      }
      if (v.leave) {
        out.leave++;
        continue;
      }
      out.planned++;
      if (v.edited) out.edited++;
      if (v.substitute) out.substitute++;
      by.set(v.staffId, (by.get(v.staffId) ?? 0) + 1);
    }
  }
  const nameOf = new Map(data.staff.map((s) => [s.id, s.name]));
  out.byStaff = [...by]
    .map(([staffId, count]) => ({ staffId, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (a.staffId === null ? 1 : 0) - (b.staffId === null ? 1 : 0) ||
        (nameOf.get(a.staffId ?? '') ?? '').localeCompare(nameOf.get(b.staffId ?? '') ?? '', 'ja'),
    );
  return out;
}

/** 要対応の種類：入らない訪問がある・欠勤の人に訪問が残る（ADR-0014）・条件が変わった・拘束が上限を超える（ADR-0015）・欠勤がある（希望休だけの日は除く） */
export type AttentionKind = 'unassigned' | 'hard' | 'absentLeft' | 'stale' | 'overSpan' | 'absence';
export type Attention = {
  date: string;
  kind: AttentionKind;
  /** 入らない訪問の件数／必須の違反の件数／欠勤の人に残る訪問の件数／欠勤の人数（条件が変わったは 1） */
  count: number;
  /** 欠勤の人の名前（kind が absence のとき）・拘束が上限を超える人の名前（overSpan のとき） */
  names: string[];
  /** 拘束が上限を超える人の id（overSpan のときだけ。稼働の見込みでその人を選んで開く。PRD D201） */
  staffIds?: string[];
};

const KIND_ORDER: Record<AttentionKind, number> = {
  unassigned: 0,
  hard: 1,
  absentLeft: 2,
  stale: 3,
  overSpan: 4,
  absence: 5,
};

/**
 * 欠勤の手当てが済んだ日か（PRD D281。ADR-0046）：確定済みで、入らない訪問・必須の違反・休みの人に残る訪問が無い。
 * 欠勤を登録して振り直し、確定まで済んだ日は、欠勤があっても要対応に数えない（情報「欠勤あり（対応済み）」として残す）
 */
export function absenceHandled(s: Pick<DayStatus, 'state' | 'unassigned' | 'hard' | 'absentLeft'>): boolean {
  return s.state === 'confirmed' && s.unassigned === 0 && s.hard === 0 && s.absentLeft === 0;
}

/** その日の欠勤の人（希望休は除く。同じ人の欠勤が2件でも1人） */
function absentStaffIds(data: Pick<DemoData, 'absences'>, date: string): string[] {
  return [...new Set(data.absences.filter((a) => a.date === date && !isRequestedOff(a)).map((a) => a.staffId))];
}

/** 欠勤あり（対応済み）の日（PRD D281）：今日以降の、欠勤（希望休を除く）があって手当てが済んだ日と欠勤の人の名前（日付の順） */
export type HandledAbsence = { date: string; names: string[] };
export function handledAbsences(
  data: Pick<DemoData, 'absences' | 'staff'>,
  statuses: readonly DayStatus[],
  today: string,
): HandledAbsence[] {
  const nameOf = new Map(data.staff.map((s) => [s.id, s.name]));
  const out: HandledAbsence[] = [];
  for (const s of statuses) {
    if (s.date < today || !s.absence || !absenceHandled(s)) continue;
    const ids = absentStaffIds(data, s.date);
    if (ids.length > 0) out.push({ date: s.date, names: ids.map((id) => nameOf.get(id) ?? '').filter(Boolean) });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 選ばないときの右の欄の「要対応」（D55・D281・D295）：今日以降の日の、入らない訪問がある・必須の違反がある・欠勤の人に訪問が残る・
 * 条件が変わった・拘束が上限を超える（ADR-0015）・欠勤のある日（日付の順、同じ日は 入らない → 必須の違反 → 欠勤の人に残る →
 * 条件が変わった → 拘束 → 欠勤）。マスの赤（needsCare：入らない・必須の違反・休みの人に残る）はどれも行になるので、
 * マスの札「要対応 N」と右の欄の行とホーム・進み具合の帯の数がそろう。
 * 希望休（ADR-0014）は前もって入れる休みなので、それだけでは要対応にしない（訪問が残っていれば「欠勤の人に残る」で出る）。
 * 欠勤があっても手当てが済んだ日（absenceHandled：確定済みで、入らない訪問・必須の違反・休みの人に残る訪問が無い）は
 * 欠勤を数えない（ADR-0046。ホーム・進み具合の帯・月の要対応はこの1つで数えるので同じ数になる）
 */
export function attentionList(
  data: Pick<DemoData, 'absences' | 'staff'>,
  statuses: readonly DayStatus[],
  today: string,
): Attention[] {
  const nameOf = new Map(data.staff.map((s) => [s.id, s.name]));
  const out: Attention[] = [];
  for (const s of statuses) {
    if (s.date < today) continue;
    if (s.unassigned > 0) out.push({ date: s.date, kind: 'unassigned', count: s.unassigned, names: [] });
    if (s.hard > 0) out.push({ date: s.date, kind: 'hard', count: s.hard, names: [] });
    if (s.absentLeft > 0) out.push({ date: s.date, kind: 'absentLeft', count: s.absentLeft, names: [] });
    if (s.stale) out.push({ date: s.date, kind: 'stale', count: 1, names: [] });
    // 拘束が上限を超える（ADR-0015）
    if (s.overSpan.length > 0)
      out.push({
        date: s.date,
        kind: 'overSpan',
        count: s.overSpan.length,
        names: s.overSpan.map((id) => nameOf.get(id) ?? '').filter(Boolean),
        staffIds: [...s.overSpan],
      });
    if (s.absence && !absenceHandled(s)) {
      // 同じ人の欠勤が2件（時間帯が2つ・続けて振り直した）でも1人と数える。希望休は数えない
      const ids = absentStaffIds(data, s.date);
      const names = ids.map((id) => nameOf.get(id) ?? '');
      if (ids.length > 0)
        out.push({ date: s.date, kind: 'absence', count: names.length, names: names.filter(Boolean) });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));
}

// ---- 今月の準備（PRD D59。D151 から進み具合の帯（月・週・日）に出す。design.md §4 pages「動線の整理」「進み具合の帯」）----

/** 月の「今月の準備」の進み具合（その月の今日以降の日について） */
export type MonthProgress = {
  /** ① 訪問の件数（取り消しを除く） */
  visits: number;
  /** 訪問のある日の数（②③の分母） */
  days: number;
  /** ② 案のある日の数（今の案か確定した割当がある日） */
  planned: number;
  /** ③ 確定した日の数（「確定済み」の日。「未確定の変更あり」は数えない） */
  confirmed: number;
  /** 確定していない日（訪問があって「確定済み」でない日。日付の順） */
  unconfirmed: string[];
  /** 要対応の件数（attentionList の件数） */
  attention: number;
};

/**
 * 今月の準備：その月の今日以降について、①訪問の件数 ②案のある日/訪問のある日 ③確定した日/訪問のある日・要対応の件数。
 * staleOf を渡すと条件が変わったかをそれで決める（無ければ「条件が変わった」は数えない）。
 * statusOf を渡すと日の状態をそれから引く（画面が compile・採点して作ったもの。無ければ dayStatus で作る）
 */
export function monthProgress(
  data: Pick<DemoData, 'visits' | 'aiPlans' | 'manualPlans' | 'absences' | 'staff' | 'clientLeaves'>,
  ym: string,
  today: string,
  staleOf?: (date: string) => boolean,
  statusOf?: (date: string) => DayStatus | undefined,
): MonthProgress {
  const statuses: DayStatus[] = [];
  for (const date of monthDates(ym)) {
    if (date < today) continue;
    statuses.push(statusOf?.(date) ?? dayStatus(data, date, { stale: staleOf?.(date) ?? false }));
  }
  const withVisits = statuses.filter((s) => s.count > 0);
  return {
    visits: withVisits.reduce((m, s) => m + s.count, 0),
    days: withVisits.length,
    planned: withVisits.filter((s) => s.state !== 'none').length,
    confirmed: withVisits.filter((s) => s.state === 'confirmed').length,
    unconfirmed: withVisits.filter((s) => s.state !== 'confirmed').map((s) => s.date),
    attention: attentionList(data, statuses, today).length,
  };
}
