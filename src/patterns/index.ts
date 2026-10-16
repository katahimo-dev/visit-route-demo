// 定期パターンの展開（ADR-0012）。design.md §4 patterns・§5「訪問の種類と定期パターン」。
// どれも純粋関数で決定的（乱数・Date.now を使わない。今日は引数）。DemoData は書き換えず、新しい配列を返す。
// 例外を投げない：いない利用者さん・パターンは無視する
import type { Pattern, Visit } from '../contracts/documents';
import type {
  ApplyPatterns,
  DateRange,
  ExpandPattern,
  OccursOn,
  PatternChange,
  PatternInput,
  RemovePattern,
  SplitPattern,
} from '../contracts/patterns';
import { addDays, weekday } from '../domain/time';

const DAY_MS = 86_400_000;

/** a から b までの日数（b − a） */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

const maxDate = (a: string, b: string) => (a > b ? a : b);

/** 訪問の ID（元の日とパターン ID から決まる） */
const patternVisitId = (date: string, patternId: string) => `${date}_${patternId}`;

/** この回だけ変えた訪問か（取り消しも edited として扱う） */
const isEdited = (v: Visit) => v.cancelled || (v.pattern?.edited ?? false);

/** 日付・開始（早）の順（同じなら元の順のまま。sort は安定） */
const byDateStart = (a: Visit, b: Visit) =>
  a.date < b.date
    ? -1
    : a.date > b.date
      ? 1
      : a.earliestStart < b.earliestStart
        ? -1
        : a.earliestStart > b.earliestStart
          ? 1
          : 0;

/**
 * その日にパターンの訪問があるか。曜日が weekdays にあり、from ≤ 日 ≤ to（null は無限）、
 * from を含む週（日曜はじまり）を1週目として (週の番号 − 1) が everyWeeks で割り切れる
 */
export const occursOn: OccursOn = (pattern, date) => {
  if (date < pattern.from) return false;
  if (pattern.to !== null && date > pattern.to) return false;
  if (!pattern.weekdays.includes(weekday(date))) return false;
  const firstWeekStart = addDays(pattern.from, -weekday(pattern.from));
  const weekIndex = Math.floor(daysBetween(firstWeekStart, date) / 7);
  return weekIndex % pattern.everyWeeks === 0;
};

/** パターンの1回分の訪問 */
function visitOf(pattern: Pattern, date: string): Visit {
  return {
    id: patternVisitId(date, pattern.id),
    date,
    clientId: pattern.clientId,
    windowKind: pattern.windowKind,
    earliestStart: pattern.earliestStart,
    latestStart: pattern.latestStart,
    durationMinutes: pattern.durationMinutes,
    staffId: null,
    cancelled: false,
    note: '',
    typeId: pattern.typeId,
    pattern: { id: pattern.id, date, edited: false },
  };
}

/** パターンを range に展開する（利用中かどうか・既存の訪問は見ない）。日付の順 */
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

/** 利用中の利用者さんの ID */
const activeClientIds = (data: PatternInput) => new Set(data.clients.filter((c) => c.active).map((c) => c.id));

/**
 * patterns を range ∩ [today, ∞) に展開し、existing に無い ID だけを日付・開始（早）の順で返す。
 * 利用中でない・いない利用者さんのパターンは展開しない。skipDates の日には作らない
 */
function expandNew(
  patterns: Pattern[],
  data: PatternInput,
  range: DateRange,
  today: string,
  existing: Set<string>,
  skipDates: ReadonlySet<string> = new Set(),
): Visit[] {
  const active = activeClientIds(data);
  const r: DateRange = { from: maxDate(range.from, today), to: range.to };
  if (r.from > r.to) return [];
  const seen = new Set(existing);
  const out: Visit[] = [];
  for (const p of patterns) {
    if (!active.has(p.clientId)) continue;
    for (const v of expandPattern(p, r)) {
      if (seen.has(v.id) || skipDates.has(v.date)) continue;
      seen.add(v.id);
      out.push(v);
    }
  }
  return out.sort(byDateStart);
}

const entry = (v: Visit) => ({ visitId: v.id, date: v.date });

/** 全パターン（利用中の利用者さんだけ）を range ∩ [today, ∞) に展開し、無い ID だけ足す（removed は空） */
export const applyPatterns: ApplyPatterns = (data, range, today) => {
  const added = expandNew(data.patterns, data, range, today, new Set(data.visits.map((v) => v.id)));
  return {
    patterns: data.patterns,
    visits: added.length > 0 ? [...data.visits, ...added] : data.visits,
    added: added.map(entry),
    removed: [],
  };
};

const unchanged = (data: PatternInput): PatternChange => ({
  patterns: data.patterns,
  visits: data.visits,
  added: [],
  removed: [],
});

/**
 * パターンを「いつから」（since）で分けて直す（「以降すべて」）。
 * since が元の from 以前なら同じ ID のまま中身を置き換え（from は元のまま）、
 * そうでなければ元の to を min(元の to, since の前日)（元の to が null なら since の前日）にし、newId で from = since のパターンを足す。
 * max(since, 今日) から元のパターンの訪問の最後の日までの、edited でない（取り消しでもない）訪問を除いて展開し直す。
 * 残した edited の回の元の日（pattern.date。作り直す範囲内）には作らない（取り消しの復活・二重を防ぐ）
 */
export const splitPattern: SplitPattern = (data, patternId, next, since, today, newId) => {
  const original = data.patterns.find((p) => p.id === patternId);
  if (!original) return unchanged(data);

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

  // 作り直す期間：max(since, 今日) 〜 元のパターンの訪問の最後の日
  const own = data.visits.filter((v) => v.pattern?.id === patternId);
  const start = maxDate(since, today);
  const end = own.reduce<string | null>((m, v) => (m === null || v.date > m ? v.date : m), null);
  if (end === null || start > end) return { patterns, visits: data.visits, added: [], removed: [] };

  const removedVisits = own.filter((v) => v.date >= start && v.date <= end && !isEdited(v));
  const removedIds = new Set(removedVisits.map((v) => v.id));
  const kept = data.visits.filter((v) => !removedIds.has(v.id));
  // 残した edited の回の元の日（日付をずらした回も元の日で数える）
  const skip = new Set(
    own.filter((v) => isEdited(v) && v.pattern!.date >= start && v.pattern!.date <= end).map((v) => v.pattern!.date),
  );
  const added = expandNew([rebuilt], data, { from: start, to: end }, today, new Set(kept.map((v) => v.id)), skip);
  return {
    patterns,
    visits: [...kept, ...added],
    added: added.map(entry),
    removed: removedVisits.map(entry),
  };
};

/**
 * パターンを消す。今日以降の edited でない（取り消しでもない）訪問を除き、
 * 今日より前の訪問・edited の訪問は残して pattern を null にする
 */
export const removePattern: RemovePattern = (data, patternId, today) => {
  if (!data.patterns.some((p) => p.id === patternId)) return unchanged(data);
  const removed: Visit[] = [];
  const visits: Visit[] = [];
  for (const v of data.visits) {
    if (v.pattern?.id !== patternId) {
      visits.push(v);
    } else if (v.date >= today && !isEdited(v)) {
      removed.push(v);
    } else {
      visits.push({ ...v, pattern: null });
    }
  }
  return {
    patterns: data.patterns.filter((p) => p.id !== patternId),
    visits,
    added: [],
    removed: removed.map(entry),
  };
};
