// 週間（ADR-0012 追記の段階2。PRD D49〜D51。design.md §4 pages「週間（段階2）」）の画面の純粋関数。
// データは書き換えず、新しい DemoData を返す（書くのは画面の update(fn)）。今日・新しい ID・時刻は引数で受け取る
import type { AiPlan, DemoData } from '../contracts/data';
import type { Pattern, Visit } from '../contracts/documents';
import type { PatternChange } from '../contracts/patterns';
import type { Problem } from '../contracts/problem';
import type { Routes } from '../contracts/reassign';
import { availabilityOf, withoutAbsences } from '../domain/availability';
import { NONE } from '../domain/scheduleModel';
import { addDays, hhmmToMinutes, minutesToHhmm, weekday } from '../domain/time';
import { score } from '../evaluate';
import { type CompileInput, compile, scheduleRoute } from '../matching';
import { applyPatterns, splitPattern } from '../patterns';
import { fitsOf, placeVisit } from '../reassign';
import { attempt, byName, own } from './common';
import { addRun, findRun, problemKey } from './runs';

/** 時間軸の縦の範囲（0時からの分）：07:00〜20:00 */
export const DAY_START = 7 * 60;
export const DAY_END = 20 * 60;
/** ドラッグの丸めの刻み（分） */
export const SNAP_MINUTES = 15;

// ---- 週 ----

/** その日を含む週の月曜（月曜はじまり） */
export function weekStart(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** その日を含む週の日付（月〜日の7日） */
export function weekDates(date: string): string[] {
  const start = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** 15分刻みに丸める（近いほうへ） */
export const snapMinutes = (m: number, step = SNAP_MINUTES): number => Math.round(m / step) * step;

/** 開始 start（分）・所要 duration の訪問が時間軸の範囲（07:00〜20:00）に収まるか */
export const inDayRange = (start: number, duration: number): boolean =>
  start >= DAY_START && start + duration <= DAY_END;

// ---- その日の案と帯 ----

/** 帯の元：今の案／確定した割当／訪問の開始（早）（案なし） */
export type BandSource = 'plan' | 'confirmed' | 'visit';

/** 時間軸の帯1つ（時刻は0時からの分。lenient） */
export type Band = {
  visitId: string;
  date: string;
  /** 担当（null＝未割当・入らない） */
  staffId: string | null;
  start: number;
  end: number;
  source: BandSource;
};

/** その日の今の案（無ければ確定した割当）と帯 */
export type WeekDay = {
  date: string;
  /** いまのデータ・いまの条件の問題（作れなければ null） */
  problem: Problem | null;
  /** 数える案の元。どちらも無ければ null（案なし） */
  source: 'plan' | 'confirmed' | null;
  /** 担当 → 訪問ID の列（問題にある訪問だけ。未割当の列は除く） */
  routes: Routes;
  /** 取り消しでない訪問の帯（開始の順） */
  bands: Band[];
};

type DayInput = CompileInput & Pick<DemoData, 'aiPlans' | 'manualPlans'>;

/**
 * その日の今の案（無ければ確定した割当）の列。今の案は問題に無い訪問を除いた順のまま、
 * 確定した割当は担当ごとに訪問の開始（早）の順に並べる。未割当の列は除く
 */
function routesOf(
  data: DayInput,
  date: string,
  problem: Problem | null,
): { source: WeekDay['source']; routes: Routes } {
  const ids = new Set(problem?.visits.map((v) => v.id) ?? []);
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
  if (plan) return { source: 'plan', routes: keep(plan.routes) };
  const saved = own(data.manualPlans, date);
  if (saved && problem) {
    const earliest = new Map(problem.visits.map((v, i) => [v.id, [v.earliest, i] as const]));
    const routes = keep(saved);
    for (const k of Object.keys(routes)) {
      routes[k] = [...routes[k]!].sort((a, b) => {
        const x = earliest.get(a)!;
        const y = earliest.get(b)!;
        return x[0] - y[0] || x[1] - y[1];
      });
    }
    if (Object.keys(routes).length > 0) return { source: 'confirmed', routes };
  }
  return { source: null, routes: {} };
}

/**
 * その日の帯と数える案。problem を渡すとそれを使う（無ければ compile。作れなければ null で、帯は訪問の開始（早）に置く）。
 * 帯は今の案（無ければ確定した割当）の lenient の開始〜終了。どの列にも無い訪問・問題に無い訪問・担当が問題にいない訪問は
 * 未割当（staffId＝null）で、訪問の開始（早）〜＋所要に置く
 */
export function weekDay(data: DayInput, date: string, problem?: Problem | null): WeekDay {
  const p = problem !== undefined ? problem : attempt(() => compile(data, date)).value;
  const { source, routes } = routesOf(data, date, p);
  const placed = new Map<string, { staffId: string; start: number; end: number }>();
  if (p) {
    const vIndex = new Map(p.visits.map((v, i) => [v.id, i]));
    p.staff.forEach((st, s) => {
      const list = (own(routes, st.id) ?? []).map((id) => vIndex.get(id)!).filter((x) => x !== undefined);
      if (list.length === 0) return;
      const t = scheduleRoute(p, s, list, 'lenient');
      for (const stop of t?.stops ?? []) placed.set(stop.visitId, { staffId: st.id, start: stop.start, end: stop.end });
    });
  }
  const bands: Band[] = data.visits
    .filter((v) => v.date === date && !v.cancelled)
    .map((v): Band => {
      const at = placed.get(v.id);
      if (at && source) return { visitId: v.id, date, staffId: at.staffId, start: at.start, end: at.end, source };
      const start = hhmmToMinutes(v.earliestStart);
      return { visitId: v.id, date, staffId: null, start, end: start + v.durationMinutes, source: source ?? 'visit' };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return { date, problem: p, source, routes, bands };
}

// ---- 重なる帯を横に並べる ----

export type Lane = { lane: number; lanes: number };

/**
 * 同じ時刻に重なる帯を列の中で横に並べる（D49）。重なりのつながり（クラスター）ごとに、開始の順に空いている一番左の
 * レーンへ入れ、クラスターのレーンの数を lanes にする。end と次の start が同じなら重ならない
 */
export function laneLayout(items: readonly { id: string; start: number; end: number }[]): Map<string, Lane> {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const out = new Map<string, Lane>();
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    for (const c of cluster) out.set(c.id, { lane: c.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const it of sorted) {
    if (it.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= it.start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(it.end);
    } else laneEnds[lane] = it.end;
    cluster.push({ id: it.id, lane });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

// ---- 動かす（D50） ----

/** 開始（早）を start に、開始（遅）を同じ幅だけずらした時刻（幅は保つ） */
function shiftedTimes(v: Pick<Visit, 'earliestStart' | 'latestStart'>, start: number) {
  const width = hhmmToMinutes(v.latestStart) - hhmmToMinutes(v.earliestStart);
  return { earliestStart: minutesToHhmm(start), latestStart: minutesToHhmm(start + width) };
}

/** 今日より前の日の訪問・今日より前の日へは動かさない（帯のドラッグ・drop・日付の選択・moveOnce・moveFollowing で共通） */
export const canMoveVisit = (date: string, today: string): boolean => date >= today;

/**
 * 「この回だけ」：訪問の日付と開始（早・遅。幅は保つ）を変え、パターンの訪問なら pattern.edited を true にする。
 * 日付が変わるときは手作業の担当（staffId）を外す（前の日の確定した割当の担当なので）。
 * 訪問が無い・訪問の日か新しい日が今日より前ならそのまま
 */
export function moveOnce(d: DemoData, visitId: string, date: string, start: number, today: string): DemoData {
  const v = d.visits.find((x) => x.id === visitId);
  if (!v || !canMoveVisit(v.date, today) || !canMoveVisit(date, today)) return d;
  const next: Visit = {
    ...v,
    date,
    ...shiftedTimes(v, start),
    staffId: date === v.date ? v.staffId : null,
    pattern: v.pattern ? { ...v.pattern, edited: true } : null,
  };
  return { ...d, visits: d.visits.map((x) => (x.id === visitId ? next : x)) };
}

export type MoveFollowing = {
  data: DemoData;
  change: PatternChange;
  /** 動かした回の新しい訪問の ID（新しい日に無ければ null） */
  movedVisitId: string | null;
};

/**
 * pattern を range に展開し（applyPatterns）、skipDates の日の回は足さない。足した訪問は visits の後ろに付ける
 */
function expandSkipping(
  pattern: Pattern,
  visits: Visit[],
  clients: DemoData['clients'],
  range: { from: string; to: string },
  today: string,
  skipDates: ReadonlySet<string>,
): Pick<PatternChange, 'visits' | 'added'> {
  const r = applyPatterns({ patterns: [pattern], visits, clients }, range, today);
  const added = r.added.filter((a) => !skipDates.has(a.date));
  const keep = new Set(added.map((a) => a.visitId));
  return { visits: [...visits, ...r.visits.slice(visits.length).filter((v) => keep.has(v.id))], added };
}

/**
 * 「以降すべて」：元の日（since）以降の〈曜日〉の回を〈新しい曜日・時刻〉にする（patterns の splitPattern を使う）。
 * 元の日・元の曜日はパターンの元の日（visit.pattern.date）。新しい日が元の日より前なら since は新しい日。
 * 新しい曜日・時刻のパターンの from はドラッグした日（新しい日。隔週などの週の数え始め）。
 * パターンの曜日が1つだけなら、曜日を入れ替え時刻を変えたパターンに分ける（splitPattern 1回。分けたパターンの from を新しい日にして展開し直す）。
 * ほかの曜日もあるなら、ほかの曜日は時刻を変えずに残し（splitPattern で元の曜日を抜く）、新しい曜日・時刻のパターンを
 * newIds[1] で足して展開する（ほかの曜日の時刻を変えない）。
 * 動かす回はいったん除いてから分ける（この回だけ変えてあっても、新しいパターンの回が代わりに入る）。
 * 残した edited・取り消しの回の元の日（max(since, 今日) 以降）には新しいパターンの回を作らない（splitPattern と同じ規則）。
 * パターンの訪問でない・パターンが無い・訪問の日か新しい日が今日より前なら null
 */
export function moveFollowing(
  d: DemoData,
  visitId: string,
  date: string,
  start: number,
  today: string,
  newIds: readonly [string, string],
): MoveFollowing | null {
  const v = d.visits.find((x) => x.id === visitId);
  const p = v?.pattern ? d.patterns.find((x) => x.id === v.pattern!.id) : undefined;
  if (!v?.pattern || !p) return null;
  // 今日より前の訪問は動かさず、残す（今日より前の日へも動かさない）
  if (!canMoveVisit(v.date, today) || !canMoveVisit(date, today)) return null;
  const origDate = v.pattern.date;
  const since = date < origDate ? date : origDate;
  const fromWd = weekday(origDate);
  const toWd = weekday(date);
  const times = shiftedTimes(p, start);
  const { id: _id, from: _from, ...rest } = p;
  // 動かす回は除いてから分ける
  const visits = d.visits.filter((x) => x.id !== visitId);
  const input = { patterns: d.patterns, visits, clients: d.clients };
  const others = p.weekdays.filter((w) => w !== fromWd);
  // 展開し直す範囲の終わり：元のパターンの最後の回を新しい曜日へずらした日（splitPattern は元の最後の回の日までしか作らない）
  const lastOwn = d.visits.filter((x) => x.pattern?.id === p.id).reduce((m, x) => (x.date > m ? x.date : m), date);
  const end = addDays(lastOwn, (toWd - fromWd + 7) % 7);
  // 残した edited・取り消しの回の元の日には作らない
  const first = since > today ? since : today;
  const skip = new Set(
    visits
      .filter((x) => x.pattern?.id === p.id && (x.cancelled || x.pattern.edited) && x.pattern.date >= first)
      .map((x) => x.pattern!.date),
  );
  let change: PatternChange;
  if (others.length === 0) {
    const split = splitPattern(input, p.id, { ...rest, ...times, weekdays: [toWd] }, since, today, newIds[0]);
    const rid = split.patterns.some((x) => x.id === newIds[0]) ? newIds[0] : p.id;
    const rebuilt: Pattern = { ...split.patterns.find((x) => x.id === rid)!, from: date };
    const patterns = split.patterns.map((x) => (x.id === rid ? rebuilt : x));
    // splitPattern が from = since で足した回を除き、from = 新しい日で展開し直す
    const addedIds = new Set(split.added.map((a) => a.visitId));
    const base = split.visits.filter((x) => !addedIds.has(x.id));
    const more = expandSkipping(rebuilt, base, d.clients, { from: since, to: end }, today, skip);
    change = { patterns, visits: more.visits, added: more.added, removed: split.removed };
  } else {
    const split = splitPattern(input, p.id, { ...rest, weekdays: others }, since, today, newIds[0]);
    const moved: Pattern = { ...rest, ...times, id: newIds[1], weekdays: [toWd], from: date };
    const patterns = [...split.patterns];
    // 分けたパターン（無ければ元のパターン）のすぐあとに置く
    const anchor = patterns.findIndex((x) => x.id === newIds[0]);
    patterns.splice((anchor >= 0 ? anchor : patterns.findIndex((x) => x.id === p.id)) + 1, 0, moved);
    const more = expandSkipping(moved, split.visits, d.clients, { from: date, to: end }, today, skip);
    change = { patterns, visits: more.visits, added: [...split.added, ...more.added], removed: split.removed };
  }
  // 動かした回は除いた（新しいパターンの回が代わりに入る）
  change = { ...change, removed: [...change.removed, { visitId, date: v.date }] };
  const data = { ...d, patterns: change.patterns, visits: change.visits };
  const movedId = [newIds[1], newIds[0], p.id]
    .map((pid) => `${date}_${pid}`)
    .find((id) => change.visits.some((x) => x.id === id && !x.cancelled));
  return { data, change, movedVisitId: movedId ?? null };
}

/** 動かしたときに出入りする日（日付の順） */
export function changedDates(change: Pick<PatternChange, 'added' | 'removed'>): string[] {
  return [...new Set([...change.added, ...change.removed].map((x) => x.date))].sort();
}

// ---- 空き時間に入れる ----

export type InsertResult = {
  data: DemoData;
  /** 入れた人（入らない・今の案が無い・訪問が問題に無ければ null。そのとき data は元のまま） */
  staffId: string | null;
};

/** 「空き時間に入れた案」の記録の名前 */
export const INSERT_RUN_LABEL = '空き時間に入れた案';

/**
 * その日の今の案に、訪問を空き時間で入れる（D50）：今の案の条件（plan.rules）と固定でその日の問題を作り、
 * reassign の fitsOf の先頭の人（他の人の担当・順番・開始時刻を変えずに入る、増える費用の一番小さい人）に placeVisit で入れ、
 * 固定する（pins）。今の案の列からいったんその訪問を除いてから入れる。入れた案は記録に1件足し（ラベル「空き時間に入れた案」）、
 * 今の案の元にする（同じ条件・固定・データの問題なので「条件が変わった」にならない）。generated は変えない。
 * createdAt は呼ぶ側が渡す（純粋関数のまま）
 */
export function insertIntoPlan(d: DemoData, date: string, visitId: string, createdAt: number): InsertResult {
  const plan = own(d.aiPlans, date);
  if (!plan) return { data: d, staffId: null };
  const pins = Object.fromEntries(Object.entries(plan.pins).filter(([id]) => id !== visitId));
  const problem = attempt(() =>
    compile({ ...d, rules: plan.rules }, date, Object.keys(pins).length > 0 ? pins : undefined),
  ).value;
  if (!problem || !problem.visits.some((v) => v.id === visitId)) return { data: d, staffId: null };
  const ids = new Set(problem.visits.map((v) => v.id));
  const base: Routes = {};
  for (const [k, list] of Object.entries(plan.routes)) {
    if (k === NONE) continue;
    base[k] = list.filter((id) => id !== visitId && ids.has(id));
  }
  const fit = fitsOf(problem, base, visitId)[0];
  if (!fit) return { data: d, staffId: null };
  const routes = placeVisit(problem, base, visitId, fit.staffId);
  const placed = new Set(Object.values(routes).flat());
  const unassigned = problem.visits.map((v) => v.id).filter((id) => !placed.has(id));
  const nextPins = { ...pins, [visitId]: fit.staffId };
  const total = score(problem, routes).total;
  const keyed = attempt(() => compile({ ...d, rules: plan.rules }, date, nextPins)).value;
  const inputKey = keyed ? problemKey(keyed) : undefined;
  const result = { routes, unassigned, score: total, seed: plan.seed, iterations: 0, stopped: false };
  const x = {
    rules: plan.rules,
    pins: nextPins,
    result,
    createdAt,
    label: INSERT_RUN_LABEL,
    ...(inputKey !== undefined ? { inputKey } : {}),
  };
  const added = addRun(d, date, x);
  const next: AiPlan = {
    ...plan,
    routes,
    unassigned,
    score: total,
    pins: nextPins,
    runId: findRun(added, date, x)?.id ?? plan.runId,
  };
  return { data: { ...added, aiPlans: { ...added.aiPlans, [date]: next } }, staffId: fit.staffId };
}

/**
 * 足した訪問（仮押さえなど）を、今の案がある日だけ insertIntoPlan で空き時間に入れる（日付の順）。
 * inserted は入れた件数、failedDates は今の案があるのに入らなかった日（日付の順・重複なし）
 */
export function insertAllIntoPlans(
  d: DemoData,
  added: readonly { visitId: string; date: string }[],
  createdAt: number,
): { data: DemoData; inserted: number; failedDates: string[] } {
  let data = d;
  let inserted = 0;
  const failed = new Set<string>();
  for (const x of [...added].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (!own(data.aiPlans, x.date)) continue;
    const r = insertIntoPlan(data, x.date, x.visitId, createdAt);
    if (r.staffId) {
      data = r.data;
      inserted++;
    } else failed.add(x.date);
  }
  return { data, inserted, failedDates: [...failed].sort() };
}

// ---- 〈スタッフ〉×曜日の表（D51） ----

export type WeekCell = {
  date: string;
  /** 休み（その日の稼働時間帯が無い） */
  off: boolean;
  /** その日に数える案が無い */
  noPlan: boolean;
  count: number;
  /** 稼働時間（時間。その日の稼働時間帯の長さ。欠勤を差し引く） */
  hours: number;
  /** 移動（分。今の案の列の lenient の移動。自宅へ帰る移動も含む） */
  travel: number;
  /** 種類ごとの件数（種類なしは数えない。種類の並びの順） */
  types: { typeId: string; count: number }[];
};

export type WeekRow = {
  staffId: string;
  cells: WeekCell[];
  total: { count: number; hours: number; travel: number };
  /** 件数の全員の平均との差 */
  diff: number;
  /** 差が平均の30%を超える */
  strong: boolean;
};

export type StaffWeekTable = {
  rows: WeekRow[];
  /** 日ごとの合計（noPlan はその日に数える案が無い） */
  days: { date: string; noPlan: boolean; count: number; hours: number; travel: number }[];
  /** 件数の全員の平均 */
  average: number;
};

/** 差を強調する割合（平均の30%） */
export const STRONG_DIFF_RATIO = 0.3;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 〈スタッフ〉×曜日の表（D51）。行＝稼働中の〈スタッフ〉（名前の順）、列＝days（月〜日）。
 * 数えるのは、その日の今の案（無ければ確定した割当）。案の無い日は noPlan で、件数・移動は 0
 */
export function staffWeekTable(data: CompileInput, days: readonly WeekDay[]): StaffWeekTable {
  const staff = data.staff.filter((s) => s.active).sort(byName);
  const typeOrder = new Map(data.visitTypes.map((t, i) => [t.id, i]));
  const visitById = new Map(data.visits.map((v) => [v.id, v]));
  const rows: WeekRow[] = staff.map((s) => {
    const cells = days.map((day): WeekCell => {
      const override = data.availability.find((a) => a.staffId === s.id && a.date === day.date);
      const absences = data.absences.filter((a) => a.staffId === s.id && a.date === day.date);
      const slots = withoutAbsences(availabilityOf(s, day.date, override).slots, absences);
      const hours = slots.reduce((m, x) => m + hhmmToMinutes(x.end) - hhmmToMinutes(x.start), 0) / 60;
      const list = own(day.routes, s.id) ?? [];
      let travel = 0;
      const p = day.problem;
      if (p && list.length > 0) {
        const si = p.staff.findIndex((x) => x.id === s.id);
        const vIndex = new Map(p.visits.map((v, i) => [v.id, i]));
        const idx = list.map((id) => vIndex.get(id)).filter((x): x is number => x !== undefined);
        if (si >= 0) travel = scheduleRoute(p, si, idx, 'lenient')?.travelMinutes ?? 0;
      }
      const typeCount = new Map<string, number>();
      for (const id of list) {
        const t = visitById.get(id)?.typeId;
        if (t) typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
      }
      const types = [...typeCount]
        .map(([typeId, count]) => ({ typeId, count }))
        .sort((a, b) => (typeOrder.get(a.typeId) ?? 99) - (typeOrder.get(b.typeId) ?? 99));
      return {
        date: day.date,
        off: slots.length === 0,
        noPlan: day.source === null,
        count: list.length,
        hours: round1(hours),
        travel: Math.round(travel),
        types,
      };
    });
    const total = {
      count: cells.reduce((m, c) => m + c.count, 0),
      hours: round1(cells.reduce((m, c) => m + c.hours, 0)),
      travel: cells.reduce((m, c) => m + c.travel, 0),
    };
    return { staffId: s.id, cells, total, diff: 0, strong: false };
  });
  const average = rows.length > 0 ? rows.reduce((m, r) => m + r.total.count, 0) / rows.length : 0;
  for (const r of rows) {
    r.diff = round1(r.total.count - average);
    r.strong = average > 0 && Math.abs(r.total.count - average) > average * STRONG_DIFF_RATIO;
  }
  const dayTotals = days.map((day, i) => ({
    date: day.date,
    noPlan: day.source === null,
    count: rows.reduce((m, r) => m + r.cells[i]!.count, 0),
    hours: round1(rows.reduce((m, r) => m + r.cells[i]!.hours, 0)),
    travel: rows.reduce((m, r) => m + r.cells[i]!.travel, 0),
  }));
  return { rows, days: dayTotals, average: round1(average) };
}
