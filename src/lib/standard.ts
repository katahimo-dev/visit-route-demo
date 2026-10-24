// 組み方の標準（標準の週。PRD D350〜D354。ADR-0062）の純粋関数。
// 標準＝繰り返しの担当（usualStaffId）と曜日ごとの標準の開始（usualStarts）。期間の繰り返しの回から差分を出し、
// 「いつから」で繰り返しを書き換える（曜日で担当が違えば曜日ごとに分ける）。データは書き換えず新しい物を返す
import type { DemoData, StandardInfo } from '../contracts/data';
import type { Pattern, PatternUsualStart, Visit } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import { addDays, weekday } from '../domain/time';
import { score } from '../evaluate';
import { occursOn, patternVisitId, timesOn, usualStartOn, visitOf, visitsIn } from '../patterns';
import { own } from './common';
import { activeDayVisits } from './dayPlan';

/** 標準の期間（両端を含む。from は来週の月曜） */
export type StandardPeriod = { from: string; to: string; weeks: number };

type PatternData = Pick<DemoData, 'patterns' | 'clients'>;

/** today に続いている（終わっていない）、利用中の〈利用者さん〉の繰り返し */
const livePatterns = (data: PatternData, today: string): Pattern[] => {
  const active = new Set(data.clients.filter((c) => c.active).map((c) => c.id));
  return data.patterns.filter((p) => active.has(p.clientId) && (p.to === null || p.to >= today));
};

/**
 * 周期の週数：利用中の繰り返しの間隔の最大（毎月の第N週があれば4）。繰り返しが無ければ1。1〜4。
 * reason は画面に出す理由
 */
export function cycleWeeks(data: PatternData, today: string): { weeks: number; reason: string } {
  const live = livePatterns(data, today);
  if (live.length === 0) return { weeks: 1, reason: '繰り返しが無いので1週' };
  if (live.some((p) => p.repeat === 'monthly')) return { weeks: 4, reason: '毎月の第N週の繰り返しがあるので4週' };
  const max = Math.min(4, Math.max(1, ...live.map((p) => p.everyWeeks)));
  if (max === 1) return { weeks: 1, reason: 'どの繰り返しも毎週なので1週' };
  return { weeks: max, reason: `${max === 2 ? '隔週' : `${max}週ごと`}の繰り返しがあるので${max}週` };
}

/** 来週の月曜（今日が月曜なら7日後） */
export function nextMonday(today: string): string {
  const wd = weekday(today);
  return addDays(today, wd === 1 ? 7 : (8 - wd) % 7 || 7);
}

/** 標準の期間：来週の月曜から weeks 週（無ければ周期の週数） */
export function standardPeriod(data: PatternData, today: string, weeks?: number): StandardPeriod {
  const w = Math.min(4, Math.max(1, Math.round(weeks ?? cycleWeeks(data, today).weeks)));
  const from = nextMonday(today);
  return { from, to: addDays(from, 7 * w - 1), weeks: w };
}

/** 期間の日付（順に） */
export function periodDates(period: Pick<StandardPeriod, 'from' | 'to'>): string[] {
  const out: string[] = [];
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 差分の注意（ADR-0062） */
export type StandardWarning = 'weekdaySplit' | 'weeksDiffer' | 'outsideWindow' | 'unassigned' | 'notSeen';

export const STANDARD_WARNING_TEXT: Record<StandardWarning, string> = {
  weekdaySplit: '曜日で担当が違うので、曜日ごとに分けます',
  weeksDiffer: '週によって担当が違うので、最初の週の担当にします',
  outsideWindow: '開始が時間の約束の外なので、開始は書きません',
  unassigned: '担当なしの回があります',
  notSeen: '期間に回がありません。今の標準のまま',
};

/** 曜日ごとの標準（担当・開始） */
export type WeekdayStandard = { weekday: number; staffId: string | null; start: string | null };

/** 差分の1行（繰り返し1つ） */
export type StandardRow = {
  patternId: string;
  clientId: string;
  /** 担当（曜日で分けるときの after は先頭の曜日の担当） */
  staff: { before: string | null; after: string | null };
  /** 曜日ごとの開始（変わる曜日だけ） */
  starts: { weekday: number; before: string | null; after: string | null }[];
  /** 曜日ごとの新しい標準（期間に回の無い曜日は今の標準） */
  days: WeekdayStandard[];
  /** 曜日で担当が違う（曜日ごとに分ける） */
  split: boolean;
  warnings: StandardWarning[];
  /** 何か変わるか */
  changed: boolean;
};

/** その曜日の今の標準の開始 */
const usualStartOf = (p: Pattern, wd: number): string | null =>
  (p.usualStarts ?? []).find((x) => x.weekday === wd)?.start ?? null;

/**
 * 標準の差分：期間の繰り返しの回（取り消し・休みでない）から、繰り返しごとに曜日ごとの担当・組んだ開始を読む
 * （同じ曜日は最初の週の回）。期間に回が1つも無い繰り返しは出さない
 */
export function standardDiff(
  data: Pick<DemoData, 'patterns' | 'clients' | 'visits' | 'clientLeaves'>,
  period: Pick<StandardPeriod, 'from' | 'to'>,
): StandardRow[] {
  const byPattern = new Map<string, Visit[]>();
  for (const d of periodDates(period)) {
    for (const v of activeDayVisits(data, d)) {
      if (!v.pattern) continue;
      const list = byPattern.get(v.pattern.id) ?? [];
      list.push(v);
      byPattern.set(v.pattern.id, list);
    }
  }
  const rows: StandardRow[] = [];
  for (const p of data.patterns) {
    const seen = byPattern.get(p.id);
    if (!seen || seen.length === 0) continue;
    const warnings = new Set<StandardWarning>();
    const first = new Map<number, Visit>();
    for (const v of seen) {
      const wd = weekday(v.pattern?.date ?? v.date);
      const f = first.get(wd);
      if (!f) first.set(wd, v);
      else if (f.staffId !== v.staffId) warnings.add('weeksDiffer');
      if (v.staffId === null) warnings.add('unassigned');
    }
    const days: WeekdayStandard[] = [];
    const starts: StandardRow['starts'] = [];
    for (const wd of p.weekdays) {
      const v = first.get(wd);
      const before = usualStartOf(p, wd);
      if (!v) {
        warnings.add('notSeen');
        days.push({ weekday: wd, staffId: p.usualStaffId, start: before });
        continue;
      }
      const t = timesOn(p, wd);
      let after = v.start;
      if (after !== null && (after < t.earliestStart || after > t.latestStart)) {
        warnings.add('outsideWindow');
        after = before;
      }
      days.push({ weekday: wd, staffId: v.staffId, start: after });
      if (after !== before) starts.push({ weekday: wd, before, after });
    }
    const staffSet = new Set(days.map((d) => d.staffId));
    const split = staffSet.size > 1;
    if (split) warnings.add('weekdaySplit');
    const after = days[0]?.staffId ?? p.usualStaffId;
    const changed = split || after !== p.usualStaffId || starts.length > 0;
    rows.push({
      patternId: p.id,
      clientId: p.clientId,
      staff: { before: p.usualStaffId, after },
      starts,
      days,
      split,
      warnings: [...warnings],
      changed,
    });
  }
  return rows;
}

/**
 * 伝えた日のうちいちばん後の日（無ければ null）。伝えた日へ動かした繰り返しの回は、元の日も数える
 * （元の日が「いつから」以降だと、新しい繰り返しが元の日に回を計算して2件になるため）
 */
const lastToldDate = (data: Pick<DemoData, 'snapshots' | 'visits'>): string | null => {
  let last: string | null = null;
  for (const d of Object.keys(data.snapshots)) if (last === null || d > last) last = d;
  for (const v of data.visits) {
    if (!v.pattern || !own(data.snapshots, v.date)) continue;
    if (last === null || v.pattern.date > last) last = v.pattern.date;
  }
  return last;
};

/** 「いつから」に選べるいちばん早い日：今日と、伝えた日の翌日の遅い方（伝えた日の回は変えない） */
export function earliestSince(data: Pick<DemoData, 'snapshots' | 'visits'>, today: string): string {
  const told = lastToldDate(data);
  const next = told === null ? today : addDays(told, 1);
  return next > today ? next : today;
}

/** 「いつから」の既定：期間の最初の日（選べるいちばん早い日より前ならその日） */
export function defaultSince(
  data: Pick<DemoData, 'snapshots' | 'visits'>,
  period: StandardPeriod,
  today: string,
): string {
  const min = earliestSince(data, today);
  return period.from > min ? period.from : min;
}

/** 新しい標準の繰り返し（分けた後のグループごと） */
type PatternGroup = { weekdays: number[]; staffId: string | null };

/** 曜日を担当ごとにまとめる（並びは先頭の曜日の順） */
function groupsOf(days: readonly WeekdayStandard[]): PatternGroup[] {
  const out: PatternGroup[] = [];
  for (const d of days) {
    const g = out.find((x) => x.staffId === d.staffId);
    if (g) g.weekdays.push(d.weekday);
    else out.push({ weekdays: [d.weekday], staffId: d.staffId });
  }
  return out;
}

/** 曜日ごとの標準の開始の並び */
const usualStartsOf = (days: readonly WeekdayStandard[], weekdays: readonly number[]): PatternUsualStart[] =>
  days
    .filter((d) => weekdays.includes(d.weekday) && d.start !== null)
    .map((d) => ({ weekday: d.weekday, start: d.start as string }))
    .sort((a, b) => a.weekday - b.weekday);

/** 一時の変更の1件（ピンでなく、新しい標準と担当か開始が違う保存した回） */
export type TemporaryChange = {
  visitId: string;
  date: string;
  clientId: string;
  now: { staffId: string | null; start: string | null };
  standard: { staffId: string | null; start: string | null };
};

/** 登録で見る保存した回（「いつから」以降・伝えていない日・変わる繰り返しの回）と、その回の新しい標準 */
function touchedVisits(
  data: Pick<DemoData, 'patterns' | 'visits' | 'snapshots'>,
  rows: readonly StandardRow[],
  since: string,
  period: Pick<StandardPeriod, 'from' | 'to'>,
): Touched[] {
  const changed = new Map(rows.filter((r) => r.changed).map((r) => [r.patternId, r]));
  const out: Touched[] = [];
  for (const v of data.visits) {
    if (!v.pattern || v.pattern.date < since || own(data.snapshots, v.date)) continue;
    const row = changed.get(v.pattern.id);
    const pattern = data.patterns.find((p) => p.id === v.pattern?.id);
    if (!row || !pattern) continue;
    const wd = weekday(v.pattern.date);
    const day = row.days.find((d) => d.weekday === wd);
    if (!day) continue;
    // 新しい標準で計算した回の開始（時間の約束の外は null）
    const start = usualStartOn(
      { usualStarts: day.start ? [{ weekday: wd, start: day.start }] : [] },
      wd,
      timesOn(pattern, wd),
    );
    const inPeriod = period.from <= v.pattern.date && v.pattern.date <= period.to;
    out.push({ visit: v, std: { weekday: wd, staffId: day.staffId, start }, pattern, inPeriod });
  }
  return out;
}

/** 登録で見る保存した回 */
type Touched = { visit: Visit; std: WeekdayStandard; pattern: Pattern; inPeriod: boolean };

/** この回だけ日時などを変えた回か（取り消しも） */
const isEdited = (v: Visit) => v.cancelled || (v.pattern?.edited ?? false) || v.date !== v.pattern?.date;

/**
 * 標準と同じ回か（担当と組んだ開始）。期間の中の回は標準の元なので、担当が同じなら開始の違いは見ない
 * （AI が週ごとに少し違う時刻を組むため。違う担当は一時の変更として扱う）
 */
const sameAsStandard = (t: Pick<Touched, 'visit' | 'std' | 'inPeriod'>) =>
  t.visit.staffId === t.std.staffId && (t.inPeriod || (t.visit.start ?? null) === t.std.start);

/**
 * 一時の変更（PRD D351）：「いつから」以降・伝えていない日の、変わる繰り返しの保存した回で、この回だけ変えた回でもピンでもなく、
 * 新しい標準と担当か組んだ開始が違う回。日付・開始の順
 */
export function temporaryChanges(
  data: Pick<DemoData, 'patterns' | 'visits' | 'snapshots'>,
  rows: readonly StandardRow[],
  since: string,
  period: Pick<StandardPeriod, 'from' | 'to'>,
): TemporaryChange[] {
  return touchedVisits(data, rows, since, period)
    .filter((t) => !isEdited(t.visit) && !t.visit.pinned && !sameAsStandard(t))
    .map(({ visit, std }) => ({
      visitId: visit.id,
      date: visit.date,
      clientId: visit.clientId,
      now: { staffId: visit.staffId, start: visit.start },
      standard: { staffId: std.staffId, start: std.start },
    }))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.visitId < b.visitId ? -1 : 1));
}

/**
 * 新しい繰り返しの開始日：いつから。ただし隔週・3週・4週ごとの繰り返しは、いつから以降で最初に回のある日にする
 * （「開始日を含む週」を1週目に数えるので、回の無い週から始めると周期が1週ずれる）
 */
function anchorFrom(p: Pattern, since: string): string {
  if (p.repeat !== 'weekly' || p.everyWeeks <= 1) return since;
  for (let i = 0; i < 7 * p.everyWeeks; i++) {
    const d = addDays(since, i);
    if (p.to !== null && d > p.to) break;
    if (occursOn(p, d)) return d;
  }
  return since;
}

/** 一時の変更の扱い：ピンを立てて残す・標準に戻す（消す） */
export type TemporaryChoice = 'pin' | 'drop';

/** 登録の結果の数（確認の文・知らせ） */
export type RegisterCounts = { changed: number; split: number; temporary: number };

export function registerCounts(rows: readonly StandardRow[], temporary: readonly TemporaryChange[]): RegisterCounts {
  return {
    changed: rows.filter((r) => r.changed).length,
    split: rows.filter((r) => r.changed && r.split).length,
    temporary: temporary.length,
  };
}

/**
 * 標準として登録する（PRD D351。ADR-0062）。変わる繰り返しを「いつから」で分けて担当・標準の開始を書き換え、曜日で担当が違えば
 * 曜日ごとの繰り返しにする。「いつから」以降の保存した回は、この回だけ変えた回は残し（ID を新しい繰り返しに付け直す）、
 * 標準と同じ回は消し、ピンの回は残し、一時の変更は temp で残す（ピンを立てる）か消す。伝えた日の回は変えない
 * （since は earliestSince より前なら earliestSince にする）。newId は新しい繰り返しの ID（呼ぶたびに別の値）
 */
export function registerStandard(
  data: DemoData,
  period: StandardPeriod,
  sinceIn: string,
  today: string,
  opts: { newId: () => string; temp: TemporaryChoice; at: number },
): DemoData {
  const min = earliestSince(data, today);
  const since = sinceIn > min ? sinceIn : min;
  // いつからより前に終わる繰り返しは書き換えない（開始日が終了日より後の繰り返しを作らない）
  const rows = standardDiff(data, period).filter((r) => {
    const p = data.patterns.find((x) => x.id === r.patternId);
    return r.changed && !!p && (p.to === null || p.to >= since);
  });
  if (rows.length === 0) return data;
  let patterns = data.patterns;
  /** 古い繰り返し ID → 曜日 → 新しい繰り返し */
  const moved = new Map<string, Map<number, Pattern>>();
  // 先に回を見る（古い繰り返しで）
  const touched = touchedVisits(data, rows, since, period);
  for (const row of rows) {
    const original = patterns.find((p) => p.id === row.patternId);
    if (!original) continue;
    const groups = groupsOf(row.days);
    const inPlace = since <= original.from;
    const from = inPlace ? original.from : anchorFrom(original, since);
    const made: Pattern[] = groups.map((g, i) => {
      const keepId = inPlace && i === 0;
      return {
        ...original,
        id: keepId ? original.id : opts.newId(),
        from,
        weekdays: [...g.weekdays].sort((a, b) => a - b),
        dayTimes: original.dayTimes.filter((t) => g.weekdays.includes(t.weekday)),
        usualStaffId: g.staffId,
        usualStarts: usualStartsOf(row.days, g.weekdays),
      };
    });
    const byWd = new Map<number, Pattern>();
    for (const p of made) for (const wd of p.weekdays) byWd.set(wd, p);
    moved.set(original.id, byWd);
    const next: Pattern[] = [];
    for (const p of patterns) {
      if (p.id !== original.id) {
        next.push(p);
        continue;
      }
      if (!inPlace) {
        // 終わった繰り返しを後の日で直しても期間を延ばさない
        const dayBefore = addDays(since, -1);
        next.push({ ...original, to: original.to !== null && original.to < dayBefore ? original.to : dayBefore });
      }
      next.push(...made);
    }
    patterns = next;
  }
  const touchedIds = new Set(touched.map((t) => t.visit.id));
  const put: Visit[] = [];
  for (const t of touched) {
    const { visit, std } = t;
    const target = moved.get(visit.pattern?.id ?? '')?.get(std.weekday);
    if (!target || !visit.pattern) continue;
    const id = patternVisitId(visit.pattern.date, target.id);
    if (isEdited(visit)) {
      // この回だけ変えた回は残し、新しい繰り返しの回にする
      put.push(id === visit.id ? visit : { ...visit, id, pattern: { ...visit.pattern, id: target.id } });
      continue;
    }
    if (!visit.pinned && sameAsStandard(t)) continue; // 計算した回と同じになる（ピンは残す）
    if (!visit.pinned && opts.temp === 'drop') continue; // 標準に戻す
    // ピンの回・残す一時の変更：新しい繰り返しの回にして、担当・開始・ピンを残す
    put.push({
      ...visitOf(target, visit.pattern.date),
      staffId: visit.staffId,
      start: visit.start,
      pinned: true,
      note: visit.note,
    });
  }
  const visits = [...data.visits.filter((v) => !touchedIds.has(v.id)), ...put];
  const standard: StandardInfo = {
    at: opts.at,
    presetId: data.scorePresetId ?? data.presets[0]?.id ?? '',
    from: since,
    weeks: period.weeks,
  };
  return { ...data, patterns, visits, standard };
}

/** 考え方のカードの数（PRD D350） */
export type ProposalStats = {
  /** 日ごとの点の平均（四捨五入。日が無ければ null） */
  points: number | null;
  /** 移動の合計（分） */
  travelMinutes: number;
  /** 担当なしの件数 */
  unassigned: number;
  /** 人ごとの件数の偏り（最も多い人 − 最も少ない人。期間に働く人で数える） */
  spread: number;
  /** 最も多い人・最も少ない人（title に出す） */
  most: { staffId: string; count: number } | null;
  least: { staffId: string; count: number } | null;
  /** 守れない条件の件数 */
  hard: number;
};

/** 1日の提案（採点の物差しで作った問題・その問題の訪問 ID が並ぶ担当の列） */
export type StandardDay = { date: string; problem: Problem; routes: Record<string, string[]> };

/**
 * 考え方のカードの数（PRD D350）：points は toPoints（点数の基準の物差しで 100点満点にする。画面が渡す）の日ごとの平均
 */
export function proposalStats(
  days: readonly StandardDay[],
  toPoints: (d: StandardDay) => number | null,
): ProposalStats {
  let travel = 0;
  let unassigned = 0;
  let hard = 0;
  const pts: number[] = [];
  const counts = new Map<string, number>();
  for (const d of days) {
    const sc = score(d.problem, d.routes);
    travel += sc.travelMinutes;
    hard += sc.hardViolations.length;
    const placed = new Set<string>();
    for (const s of d.problem.staff) {
      const ids = own(d.routes, s.id) ?? [];
      counts.set(s.id, (counts.get(s.id) ?? 0) + ids.length);
      for (const id of ids) placed.add(id);
    }
    unassigned += d.problem.visits.filter((v) => !placed.has(v.id)).length;
    const p = toPoints(d);
    if (p !== null) pts.push(p);
  }
  let most: ProposalStats['most'] = null;
  let least: ProposalStats['least'] = null;
  for (const [staffId, count] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (!most || count > most.count) most = { staffId, count };
    if (!least || count < least.count) least = { staffId, count };
  }
  return {
    points: pts.length > 0 ? Math.round(pts.reduce((a, b) => a + b, 0) / pts.length) : null,
    travelMinutes: Math.round(travel),
    unassigned,
    spread: most && least ? most.count - least.count : 0,
    most,
    least,
    hard,
  };
}

/** いちばん点の高いカード（同点は前。点の無いカードは除く） */
export function bestIndex(stats: readonly (ProposalStats | null)[]): number {
  let best = -1;
  stats.forEach((s, i) => {
    if (s?.points == null) return;
    const b = best >= 0 ? stats[best]?.points : null;
    if (b == null || s.points > b) best = i;
  });
  return best;
}

/** 期間の訪問の今の数（画面の上の1行。期間に計算に入る繰り返しの回） */
export function periodVisitCount(
  data: Pick<DemoData, 'patterns' | 'clients' | 'visits' | 'clientLeaves'>,
  period: Pick<StandardPeriod, 'from' | 'to'>,
): number {
  return visitsIn(data, period).filter((v) => !v.cancelled && v.pattern !== null).length;
}

/** 組み方の標準を登録したか */
export const hasStandard = (data: Pick<DemoData, 'standard'>): boolean => data.standard !== undefined;
