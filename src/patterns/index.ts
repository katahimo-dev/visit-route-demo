// 繰り返し（定期パターン）の回の計算（ADR-0012・ADR-0053）。design.md §4 patterns・§5「訪問の種類と繰り返し」。
// 版2：回は見るときに計算し、変えた回だけを保存する（visitsOn が保存した回と計算した回を合わせる）。
// どれも純粋関数で決定的（乱数・Date.now を使わない。今日は引数）。DemoData は書き換えず、新しい配列を返す。
// 例外を投げない：いない利用者さん・パターンは無視する
import type { Pattern, Visit } from '../contracts/documents';
import type {
  ExpandPattern,
  FindVisit,
  OccursOn,
  PatternInput,
  RemovePattern,
  SplitPattern,
  VisitsIn,
  VisitsOn,
} from '../contracts/patterns';
import { addDays, weekday } from '../domain/time';

const DAY_MS = 86_400_000;

/** a から b までの日数（b − a） */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

const maxDate = (a: string, b: string) => (a > b ? a : b);

/** その日が月の中のその曜日の何回目か（1〜5。ADR-0013） */
export const nthOfMonth = (date: string): number => Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1;

/**
 * その日にパターンの訪問があるか。曜日が weekdays にあり、from ≤ 日 ≤ to（null は無限）、かつ
 * 毎週系（repeat が 'weekly'）なら from を含む週（日曜はじまり）を1週目として (週の番号 − 1) が everyWeeks で割り切れる。
 * 毎月（'monthly'）なら、その日がその曜日の第N回目で N が monthWeeks にある（第5の無い月は作らない。ADR-0013）
 */
export const occursOn: OccursOn = (pattern, date) => {
  if (date < pattern.from) return false;
  if (pattern.to !== null && date > pattern.to) return false;
  if (!pattern.weekdays.includes(weekday(date))) return false;
  if (pattern.repeat === 'monthly') return pattern.monthWeeks.includes(nthOfMonth(date));
  const firstWeekStart = addDays(pattern.from, -weekday(pattern.from));
  const weekIndex = Math.floor(daysBetween(firstWeekStart, date) / 7);
  return weekIndex % pattern.everyWeeks === 0;
};

/** その曜日の開始（早）・開始（遅）：曜日ごとの時刻（dayTimes）があればそれ、無ければ共通の時刻（ADR-0013） */
export function timesOn(
  pattern: Pick<Pattern, 'earliestStart' | 'latestStart' | 'dayTimes'>,
  wd: number,
): { earliestStart: string; latestStart: string } {
  const t = pattern.dayTimes.find((x) => x.weekday === wd);
  return t
    ? { earliestStart: t.earliestStart, latestStart: t.latestStart }
    : { earliestStart: pattern.earliestStart, latestStart: pattern.latestStart };
}

/** 計算した回の ID（元の日とパターン ID から決まる。保存した回も同じ ID） */
export const patternVisitId = (date: string, patternId: string) => `${date}_${patternId}`;

/** パターンの1回分の訪問（計算した回）。担当はパターンの担当、開始は未定（null）、ピンなし */
export function visitOf(pattern: Pattern, date: string): Visit {
  const t = timesOn(pattern, weekday(date));
  return {
    id: patternVisitId(date, pattern.id),
    date,
    clientId: pattern.clientId,
    windowKind: pattern.windowKind,
    earliestStart: t.earliestStart,
    latestStart: t.latestStart,
    durationMinutes: pattern.durationMinutes,
    staffId: pattern.usualStaffId,
    start: null,
    pinned: false,
    cancelled: false,
    note: '',
    typeId: pattern.typeId,
    pattern: { id: pattern.id, date, edited: false },
    cancelKind: null,
  };
}

/** パターンを range に展開する（利用中かどうか・保存した回は見ない）。日付の順 */
export const expandPattern: ExpandPattern = (pattern, range) => {
  const out: Visit[] = [];
  // パターンの期間と重なる部分だけ回す
  const from = maxDate(range.from, pattern.from);
  const to = pattern.to !== null && pattern.to < range.to ? pattern.to : range.to;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (occursOn(pattern, d)) out.push(visitOf(pattern, d));
  }
  return out;
};

// ---- 計算した回と保存した回を合わせる（版2。ADR-0053）----

/** 保存した訪問の索引（日付ごと・ID）。同じ配列なら作り直さない */
type StoredIndex = { byDate: Map<string, Visit[]>; byId: Map<string, Visit> };
const STORED = new WeakMap<readonly Visit[], StoredIndex>();
function storedIndex(visits: readonly Visit[]): StoredIndex {
  let ix = STORED.get(visits);
  if (ix) return ix;
  ix = { byDate: new Map(), byId: new Map() };
  for (const v of visits) {
    ix.byId.set(v.id, v);
    const list = ix.byDate.get(v.date);
    if (list) list.push(v);
    else ix.byDate.set(v.date, [v]);
  }
  STORED.set(visits, ix);
  return ix;
}

/** 計算した回を出すパターン（利用中の〈利用者さん〉のものだけ）。同じ配列なら作り直さない */
const LIVE = new WeakMap<readonly Pattern[], WeakMap<PatternInput['clients'], Pattern[]>>();
function livePatterns(data: PatternInput): Pattern[] {
  let byClients = LIVE.get(data.patterns);
  if (!byClients) {
    byClients = new WeakMap();
    LIVE.set(data.patterns, byClients);
  }
  let out = byClients.get(data.clients);
  if (!out) {
    const active = new Set(data.clients.filter((c) => c.active).map((c) => c.id));
    out = data.patterns.filter((p) => active.has(p.clientId));
    byClients.set(data.clients, out);
  }
  return out;
}

/** 計算した回の覚え（同じパターン・同じ日なら同じオブジェクト。画面の覚え（useMemo）を効かせる。書き換えない） */
const OCCURRENCES = new WeakMap<Pattern, Map<string, Visit>>();
function occurrence(p: Pattern, date: string): Visit {
  let m = OCCURRENCES.get(p);
  if (!m) {
    m = new Map();
    OCCURRENCES.set(p, m);
  }
  let v = m.get(date);
  if (!v) {
    v = visitOf(p, date);
    m.set(date, v);
  }
  return v;
}

/** 訪問の並び：開始（組んだ開始、無ければ開始（早））・開始（早）・ID の順 */
export function byStart(a: Visit, b: Visit): number {
  const x = a.start ?? a.earliestStart;
  const y = b.start ?? b.earliestStart;
  if (x !== y) return x < y ? -1 : 1;
  if (a.earliestStart !== b.earliestStart) return a.earliestStart < b.earliestStart ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** その日の訪問（保存した回＋計算した回。取り消し・休みも含む。開始の順） */
export const visitsOn: VisitsOn = (data, date) => {
  const ix = storedIndex(data.visits);
  const out = [...(ix.byDate.get(date) ?? [])];
  for (const p of livePatterns(data)) {
    if (!occursOn(p, date)) continue;
    if (ix.byId.has(patternVisitId(date, p.id))) continue;
    out.push(occurrence(p, date));
  }
  return out.sort(byStart);
};

/** range の訪問（日付・開始の順） */
export const visitsIn: VisitsIn = (data, range) => {
  const out: Visit[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(...visitsOn(data, d));
  return out;
};

/** 計算した回の ID を元の日とパターン ID に分ける（形が違えば null） */
export function parsePatternVisitId(id: string): { date: string; patternId: string } | null {
  if (id.length < 12 || id[10] !== '_') return null;
  const date = id.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { date, patternId: id.slice(11) };
}

/** ID の訪問（保存した回か計算した回）。無ければ null */
export const findVisit: FindVisit = (data, id) => {
  const stored = storedIndex(data.visits).byId.get(id);
  if (stored) return stored;
  const parsed = parsePatternVisitId(id);
  if (!parsed) return null;
  const p = livePatterns(data).find((x) => x.id === parsed.patternId);
  return p && occursOn(p, parsed.date) ? occurrence(p, parsed.date) : null;
};

/** 訪問を保存した回に入れる（同じ ID は置き換え、無ければ足す）。元の配列は書き換えない */
export function putVisits(visits: readonly Visit[], put: readonly Visit[]): Visit[] {
  if (put.length === 0) return visits as Visit[];
  const byId = new Map(put.map((v) => [v.id, v]));
  const out: Visit[] = [];
  for (const v of visits) {
    const x = byId.get(v.id);
    if (x) {
      out.push(x);
      byId.delete(v.id);
    } else out.push(v);
  }
  out.push(...byId.values());
  return out;
}

/** この回だけ変えた回か（取り消しも） */
const isEdited = (v: Visit) => v.cancelled || (v.pattern?.edited ?? false);

/**
 * パターンを「いつから」（since）で分けて直す（「これ以降」）。契約の SplitPattern を参照
 */
export const splitPattern: SplitPattern = (data, patternId, next, since, today, newId) => {
  const original = data.patterns.find((p) => p.id === patternId);
  if (!original) return { patterns: data.patterns, visits: data.visits, removed: [] };

  let patterns: Pattern[];
  let rebuilt: Pattern;
  if (since <= original.from) {
    rebuilt = { ...next, id: original.id, from: original.from };
    patterns = data.patterns.map((p) => (p.id === patternId ? rebuilt : p));
  } else {
    rebuilt = { ...next, id: newId, from: since };
    // 終わったパターンを後の日で直しても期間を延ばさない
    const dayBefore = addDays(since, -1);
    const cut: Pattern = { ...original, to: original.to !== null && original.to < dayBefore ? original.to : dayBefore };
    patterns = [];
    for (const p of data.patterns) {
      if (p.id === patternId) patterns.push(cut, rebuilt);
      else patterns.push(p);
    }
  }
  const start = maxDate(since, today);
  const removed: { visitId: string; date: string }[] = [];
  const visits: Visit[] = [];
  for (const v of data.visits) {
    if (v.pattern?.id !== patternId || v.pattern.date < start) {
      visits.push(v);
      continue;
    }
    if (!isEdited(v)) {
      removed.push({ visitId: v.id, date: v.date });
      continue;
    }
    // この回だけ変えた回は残し、新しいパターンの回にする（同じ ID なら変えない）
    visits.push(
      rebuilt.id === patternId
        ? v
        : { ...v, id: patternVisitId(v.pattern.date, rebuilt.id), pattern: { ...v.pattern, id: rebuilt.id } },
    );
  }
  return { patterns, visits, removed };
};

/**
 * パターンを消す。契約の RemovePattern を参照
 */
export const removePattern: RemovePattern = (data, patternId, today) => {
  const target = data.patterns.find((p) => p.id === patternId);
  if (!target) return { patterns: data.patterns, visits: data.visits, removed: [] };
  // 開始が今日より前なら、昨日で終わらせて残す（今日より前の回を消さない）
  const keep = target.from < today;
  const yesterday = addDays(today, -1);
  const removed: { visitId: string; date: string }[] = [];
  const visits: Visit[] = [];
  for (const v of data.visits) {
    if (v.pattern?.id !== patternId || (keep && v.pattern.date < today)) {
      visits.push(v);
    } else if (!isEdited(v)) {
      removed.push({ visitId: v.id, date: v.date });
    } else {
      visits.push({ ...v, pattern: null });
    }
  }
  const patterns = keep
    ? data.patterns.map((p) =>
        p.id === patternId ? { ...p, to: p.to !== null && p.to < yesterday ? p.to : yesterday } : p,
      )
    : data.patterns.filter((p) => p.id !== patternId);
  return { patterns, visits, removed };
};
