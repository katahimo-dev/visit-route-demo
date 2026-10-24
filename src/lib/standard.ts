// 組み方の標準（標準の週。PRD D350〜D354。ADR-0063）の純粋関数。
// 標準＝繰り返しの担当（usualStaffId）と曜日ごとの標準の開始（usualStarts）。画面では「標準の表」（繰り返し × 曜日のマスに担当と開始）
// として見せ、AI の案（日ごとの割当）からも表を作る。登録は表を受けて「いつから」で繰り返しを書き換える
// （曜日で担当が違えば曜日ごとに分ける）。データは書き換えず新しい物を返す
import type { DemoData, StandardInfo } from '../contracts/data';
import type { Pattern, PatternUsualStart, Visit } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import { addDays, minutesToHhmm, weekday } from '../domain/time';
import { score } from '../evaluate';
import { occursOn, parsePatternVisitId, patternVisitId, timesOn, usualStartOn, visitOf } from '../patterns';
import { own } from './common';
import { ownerOf, startsOf } from './dayPlan';
import { setScorePreset } from './presets';

/** 標準の期間（両端を含む。from は来週の月曜） */
export type StandardPeriod = { from: string; to: string; weeks: number };

type PatternData = Pick<DemoData, 'patterns' | 'clients'>;

/**
 * 標準の表の行にする繰り返し：利用中の〈利用者さん〉の、today 以降に続く（終わっていない）繰り返し。
 * ただし先で終わり、同じ〈利用者さん〉・種類の後に始まる繰り返しがあるもの（「いつから」で分けた前の側）は除き、後の側を行にする
 */
export function standardPatterns(data: PatternData, today: string): Pattern[] {
  const active = new Set(data.clients.filter((c) => c.active).map((c) => c.id));
  const live = data.patterns.filter((p) => active.has(p.clientId) && (p.to === null || p.to >= today));
  return live.filter(
    (p) =>
      p.to === null ||
      !live.some(
        (q) => q.id !== p.id && q.clientId === p.clientId && q.typeId === p.typeId && q.from > (p.to as string),
      ),
  );
}

/**
 * 周期の週数：利用中の繰り返しの間隔の最大（毎月の第N週があれば4）。繰り返しが無ければ1。1〜4。
 * reason は画面に出す理由
 */
export function cycleWeeks(data: PatternData, today: string): { weeks: number; reason: string } {
  const live = standardPatterns(data, today);
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

/** その日を含む週の月曜 */
export const mondayOf = (date: string): string => addDays(date, -((weekday(date) + 6) % 7));

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

/** 標準の表のマス（担当・標準の開始。null は担当なし・開始なし） */
export type StandardCell = { staffId: string | null; start: string | null };
/** 標準の表：繰り返し ID → 曜日（0＝日〜6＝土）→ マス */
export type StandardTable = Record<string, Record<number, StandardCell>>;
/** マスの位置 */
export type CellRef = { patternId: string; weekday: number };
/** 今の標準と違うマス（kind：担当が違う・時刻だけ違う） */
export type CellDiff = CellRef & { kind: 'staff' | 'time' };

/** 表の曜日の並び（月曜はじまり） */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** その曜日の今の標準の開始（時間の約束の外・無ければ null） */
const usualStartOf = (p: Pattern, wd: number): string | null => usualStartOn(p, wd, timesOn(p, wd));

/** 今の標準の表（standardPatterns の繰り返しの、曜日ごとの担当と標準の開始） */
export function currentTable(data: PatternData, today: string): StandardTable {
  const out: StandardTable = {};
  for (const p of standardPatterns(data, today)) {
    const row: Record<number, StandardCell> = {};
    for (const wd of p.weekdays) row[wd] = { staffId: p.usualStaffId, start: usualStartOf(p, wd) };
    out[p.id] = row;
  }
  return out;
}

/** 表のマス（表に無ければ今の標準。どちらにも無ければ null） */
export function cellOf(
  table: StandardTable | null,
  current: StandardTable,
  patternId: string,
  wd: number,
): StandardCell | null {
  const cur = own(current, patternId)?.[wd];
  if (!cur) return null;
  return (table ? own(table, patternId)?.[wd] : undefined) ?? cur;
}

const sameCell = (a: StandardCell, b: StandardCell) => a.staffId === b.staffId && a.start === b.start;

/** 違うマスの数（全部・担当が違う・時刻だけ違う） */
export function diffCounts(diff: readonly CellDiff[]): { all: number; staff: number; time: number } {
  const staff = diff.filter((d) => d.kind === 'staff').length;
  return { all: diff.length, staff, time: diff.length - staff };
}

/** 表のマスを1つ替えた新しい表 */
export function setCell(table: StandardTable, ref: CellRef, cell: StandardCell): StandardTable {
  return { ...table, [ref.patternId]: { ...own(table, ref.patternId), [ref.weekday]: cell } };
}

/**
 * 今の標準と違うマス（今の標準にあるマスだけを見る。表に無いマスは今の標準のまま）。担当が違えば kind は staff、時刻だけなら time。
 * 並びは今の標準の繰り返しの順・曜日の順
 */
export function tableDiff(table: StandardTable, current: StandardTable): CellDiff[] {
  const out: CellDiff[] = [];
  for (const [patternId, row] of Object.entries(current)) {
    for (const [k, cur] of Object.entries(row)) {
      const wd = Number(k);
      const t = own(table, patternId)?.[wd];
      if (t && !sameCell(t, cur))
        out.push({ patternId, weekday: wd, kind: t.staffId !== cur.staffId ? 'staff' : 'time' });
    }
  }
  return out;
}

/**
 * AI の案（日ごとの割当）から標準の表を作る：standardPatterns の繰り返しの回（問題の訪問 ID が計算した回の ID）から、
 * 曜日ごとに最初の回の担当と lenient の開始を取る（担当なしは担当も開始も無し。開始が時間の約束の外なら開始は無し）。
 * 期間に回の無いマスは今の標準のまま
 */
export function tableFromDays(
  data: PatternData,
  days: readonly Pick<StandardDay, 'problem' | 'routes'>[],
  today: string,
): StandardTable {
  const patterns = new Map(standardPatterns(data, today).map((p) => [p.id, p]));
  const out = currentTable(data, today);
  const seen = new Set<string>();
  for (const day of days) {
    const at = startsOf(day.problem, day.routes);
    const owner = ownerOf(day.routes);
    const staffIn = new Set(day.problem.staff.map((s) => s.id));
    for (const pv of day.problem.visits) {
      const ref = parsePatternVisitId(pv.id);
      const p = ref ? patterns.get(ref.patternId) : undefined;
      if (!ref || !p) continue;
      const wd = weekday(ref.date);
      const key = `${p.id}|${wd}`;
      if (seen.has(key) || !p.weekdays.includes(wd)) continue;
      seen.add(key);
      const o = owner.get(pv.id);
      const staffId = o !== undefined && staffIn.has(o) ? o : null;
      const x = at.get(pv.id);
      const t = timesOn(p, wd);
      const clock =
        staffId !== null && x ? minutesToHhmm(Math.min(23 * 60 + 59, Math.max(0, Math.round(x.start)))) : null;
      const start = clock !== null && t.earliestStart <= clock && clock <= t.latestStart ? clock : null;
      out[p.id] = { ...own(out, p.id), [wd]: { staffId, start } };
    }
  }
  return out;
}

/** マスの開始の誤り（空は開始なしで可。HH:mm で、その曜日の時間の約束（開始（早）〜（遅））の中だけ） */
export function startError(p: Pick<Pattern, 'earliestStart' | 'latestStart' | 'dayTimes'>, wd: number, start: string) {
  if (start === '') return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return '時刻は 9:30 のように入れてください';
  const t = timesOn(p, wd);
  if (start < t.earliestStart || start > t.latestStart)
    return t.earliestStart === t.latestStart
      ? `時間の約束（${t.earliestStart}ちょうど）と違います`
      : `時間の約束（${t.earliestStart}〜${t.latestStart}）の外です`;
  return null;
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
export function earliestSince(
  data: Pick<DemoData, 'snapshots' | 'visits'> & Partial<Pick<DemoData, 'patterns'>>,
  today: string,
): string {
  const told = lastToldDate(data);
  let min = told === null ? today : addDays(told, 1);
  if (min < today) min = today;
  // 「いつから」で分けた後の側の繰り返し（前の側が今日以降まで続く）は、その開始日より前に当てられない
  // （表の行は後の側だけなので、前の側の期間の回を書き換えられない。レビュー #92）
  const patterns = data.patterns ?? [];
  for (const p of patterns) {
    const split = patterns.some(
      (q) =>
        q.id !== p.id &&
        q.clientId === p.clientId &&
        q.typeId === p.typeId &&
        q.to !== null &&
        q.to >= today &&
        q.to < p.from,
    );
    if (split && p.from > min) min = p.from;
  }
  return min;
}

/** 「いつから」の既定：来週の月曜（選べるいちばん早い日より前ならその日） */
export function defaultSince(
  data: Pick<DemoData, 'snapshots' | 'visits'> & Partial<Pick<DemoData, 'patterns'>>,
  today: string,
): string {
  const min = earliestSince(data, today);
  const from = nextMonday(today);
  return from > min ? from : min;
}

/** 曜日ごとの新しい標準 */
type WeekdayStandard = { weekday: number } & StandardCell;

/** 新しい標準の繰り返し（分けた後のまとまりごと） */
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

/** 書き換える繰り返し（今の標準と違うマスのある、since 以降に続く繰り返し）と曜日ごとの新しい標準 */
type ChangedRow = { pattern: Pattern; days: WeekdayStandard[] };

function changedRows(data: PatternData, table: StandardTable, since: string, today: string): ChangedRow[] {
  const current = currentTable(data, today);
  const ids = new Set(tableDiff(table, current).map((c) => c.patternId));
  const out: ChangedRow[] = [];
  for (const p of data.patterns) {
    // いつからより前に終わる繰り返しは書き換えない（開始日が終了日より後の繰り返しを作らない）
    if (!ids.has(p.id) || (p.to !== null && p.to < since)) continue;
    const days = p.weekdays.map((wd): WeekdayStandard => {
      const c = cellOf(table, current, p.id, wd) ?? { staffId: p.usualStaffId, start: null };
      return { weekday: wd, ...c };
    });
    out.push({ pattern: p, days });
  }
  return out;
}

/** 登録で見る保存した回（「いつから」以降・伝えていない日・変わる繰り返しの回）と、その回の新しい標準 */
type Touched = { visit: Visit; std: WeekdayStandard };

function touchedVisits(
  data: Pick<DemoData, 'visits' | 'snapshots'>,
  rows: readonly ChangedRow[],
  since: string,
): Touched[] {
  const byId = new Map(rows.map((r) => [r.pattern.id, r]));
  const out: Touched[] = [];
  for (const v of data.visits) {
    if (!v.pattern || v.pattern.date < since || own(data.snapshots, v.date)) continue;
    const row = byId.get(v.pattern.id);
    if (!row) continue;
    const wd = weekday(v.pattern.date);
    const day = row.days.find((d) => d.weekday === wd);
    if (!day) continue;
    // 新しい標準で計算した回の開始（時間の約束の外は null）
    const start = usualStartOn(
      { usualStarts: day.start ? [{ weekday: wd, start: day.start }] : [] },
      wd,
      timesOn(row.pattern, wd),
    );
    out.push({ visit: v, std: { weekday: wd, staffId: day.staffId, start } });
  }
  return out;
}

/** この回だけ日時などを変えた回か（取り消しも） */
const isEdited = (v: Visit) => v.cancelled || (v.pattern?.edited ?? false) || v.date !== v.pattern?.date;

/** 標準と同じ回か（担当と組んだ開始） */
const sameAsStandard = (t: Touched) => t.visit.staffId === t.std.staffId && (t.visit.start ?? null) === t.std.start;

/** since を選べる日にそろえる（earliestSince より前なら earliestSince） */
const clampSince = (data: Pick<DemoData, 'snapshots' | 'visits'>, since: string, today: string) => {
  const min = earliestSince(data, today);
  return since > min ? since : min;
};

/** すでに入っている予定のうち新しい標準と違う1件（ピンでなく、この回だけ変えた回でもない保存した回） */
export type TemporaryChange = {
  visitId: string;
  date: string;
  clientId: string;
  now: StandardCell;
  standard: StandardCell;
};

/**
 * 登録で扱いを選ぶ予定（PRD D351）：「いつから」以降・伝えていない日の、書き換える繰り返しの保存した回で、この回だけ変えた回でも
 * ピンでもなく、新しい標準と担当か組んだ開始が違う回。日付・ID の順
 */
export function temporaryChanges(
  data: Pick<DemoData, 'patterns' | 'clients' | 'visits' | 'snapshots'>,
  table: StandardTable,
  sinceIn: string,
  today: string,
): TemporaryChange[] {
  const since = clampSince(data, sinceIn, today);
  return touchedVisits(data, changedRows(data, table, since, today), since)
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

/** すでに入っている予定で新しい標準と違うものの扱い：標準どおりに入れ替える（消す）・今のまま残す（ピンを立てる） */
export type TemporaryChoice = 'drop' | 'pin';

/**
 * 表を標準として登録する（PRD D351。ADR-0063）。今の標準と違うマスのある繰り返しを「いつから」で分けて担当・標準の開始を書き換え、
 * 曜日で担当が違えば曜日ごとの繰り返しにする。「いつから」以降の保存した回は、この回だけ変えた回は残し（ID を新しい繰り返しに付け直す）、
 * 標準と同じ回は消し、ピンの回は残し、新しい標準と違う回は temp で消す（'drop'）か残す（'pin'。ピンを立てる）。伝えた日の回は変えない
 * （since は earliestSince より前なら earliestSince にする）。newId は新しい繰り返しの ID（呼ぶたびに別の値）。
 * presetId を渡すと、そのプリセットを点数の基準（標準の考え方）にする。違うマスが無ければ同じデータ
 */
export function registerStandard(
  data: DemoData,
  table: StandardTable,
  sinceIn: string,
  today: string,
  opts: { newId: () => string; temp: TemporaryChoice; at: number; presetId?: string | null },
): DemoData {
  const since = clampSince(data, sinceIn, today);
  const rows = changedRows(data, table, since, today);
  if (rows.length === 0) return data;
  let patterns = data.patterns;
  /** 古い繰り返し ID → 曜日 → 新しい繰り返し */
  const moved = new Map<string, Map<number, Pattern>>();
  // 先に回を見る（古い繰り返しで）
  const touched = touchedVisits(data, rows, since);
  for (const row of rows) {
    const original = row.pattern;
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
    if (!visit.pinned && opts.temp === 'drop') continue; // 標準どおりに入れ替える
    // ピンの回・残す回：新しい繰り返しの回にして、担当・開始・ピンを残す
    put.push({
      ...visitOf(target, visit.pattern.date),
      staffId: visit.staffId,
      start: visit.start,
      pinned: true,
      note: visit.note,
    });
  }
  const visits = [...data.visits.filter((v) => !touchedIds.has(v.id)), ...put];
  const presetId =
    opts.presetId && data.presets.some((p) => p.id === opts.presetId)
      ? opts.presetId
      : (data.scorePresetId ?? data.presets[0]?.id ?? '');
  const standard: StandardInfo = { at: opts.at, presetId, from: since, weeks: cycleWeeks(data, today).weeks };
  const out: DemoData = { ...data, patterns, visits, standard };
  return opts.presetId ? setScorePreset(out, presetId) : out;
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

/** 組み方の標準を登録したか */
export const hasStandard = (data: Pick<DemoData, 'standard'>): boolean => data.standard !== undefined;
