// 月間カレンダー（ADR-0012。design.md §4 pages「月単位の予定」）の画面の純粋関数。版2（ADR-0053）：日の状態は
// 訪問ごとの「担当あり／担当なし／要対応」と、日ごとの「まだ伝えていない／伝えた／未連絡の変更あり」の2軸。
// データは書き換えない（書くのは画面の update(fn)）
import type { DemoData } from '../contracts/data';
import type { Absence } from '../contracts/documents';
import type { Problem, StopTiming } from '../contracts/problem';
import type { Routes } from '../contracts/reassign';
import { afterLastDay, availabilityOf, type Slot, withoutAbsences } from '../domain/availability';
import { isOnLeave } from '../domain/leaves';
import { addDays, hhmmToMinutes, weekday } from '../domain/time';
import { type CompileInput, scheduleRoute } from '../matching';
import { visitsOn } from '../patterns';
import { own } from './common';
import {
  activeDayVisits,
  changeCount,
  dayProblemOf,
  dayRoutes,
  type ToldState,
  toldChanges,
  toldStateOf,
  type VisitIssue,
  visitIssues,
} from './dayPlan';
import { isRequestedOff } from './requestedOff';
import { busyParts, type StaffSlot, spansOf, staffSlots } from './staffBar';
import { workStats } from './workload';

/** 担当を AI で組む日（月・週の「担当を AI で組む」）：要対応のある日だけ／伝えていない日すべて */
export type BatchMode = 'care' | 'all';

/** 日の状態：まだ伝えていない／伝えた（確定）／伝えたあとに変わった（未連絡の変更あり） */
export type DayState = ToldState;

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

/** その日の取り消しでなく、〈利用者さん〉の休み（ADR-0013）でもない訪問（計算した回を含む） */
export function activeVisitsOn(data: Pick<DemoData, 'visits' | 'patterns' | 'clients' | 'clientLeaves'>, date: string) {
  return activeDayVisits(data, date);
}

export type DayStatus = {
  date: string;
  /** 訪問の件数（取り消し・休みを除く） */
  count: number;
  /** 伝えた状態 */
  state: DayState;
  /** 担当なしの訪問の件数 */
  unassigned: number;
  /** 要対応の訪問（担当なしを含む。訪問ID → 検査の結果） */
  issues: ReadonlyMap<string, VisitIssue[]>;
  /** 要対応の訪問の件数 */
  care: number;
  /** 未連絡の変更の件数（伝えたあとに担当・開始が変わった訪問。伝えていない日は 0） */
  changes: number;
  /** その日に欠勤がある（希望休も） */
  absence: boolean;
  /** 拘束が上限を超える〈スタッフ〉の ID（ADR-0015。注意だけで、要対応には数えない） */
  overSpan: readonly string[];
  /** 要対応（赤）：要対応の訪問がある */
  needsCare: boolean;
};

/**
 * 日の状態（problem を渡すとそれを使う。無ければその日の問題を作る）。要対応は訪問ごとの検査（lib/dayPlan の visitIssues）、
 * 伝えた状態は伝えた内容と今の担当・開始の比べ（toldChanges）
 */
export function dayStatus(
  data: CompileInput & Pick<DemoData, 'snapshots'>,
  date: string,
  problem?: Problem | null,
): DayStatus {
  const p = problem !== undefined ? problem : dayProblemOf(data, date);
  const visits = visitsOn(data, date);
  const count = p ? p.visits.length : activeDayVisits(data, date).length;
  const absence = data.absences.some((a) => a.date === date);
  if (!p) {
    return {
      date,
      count,
      state: own(data.snapshots, date) ? 'told' : 'none',
      unassigned: 0,
      issues: new Map(),
      care: 0,
      changes: 0,
      absence,
      overSpan: [],
      needsCare: false,
    };
  }
  const routes = dayRoutes(data, date, p);
  const issues = visitIssues(p, routes, visits);
  const changes = toldChanges(data, date, p, routes);
  let unassigned = 0;
  for (const list of issues.values()) if (list.some((x) => x.kind === 'unassigned')) unassigned++;
  const overSpan = workStats(p, routes, data.org)
    .filter((x) => x.over)
    .map((x) => x.staffId);
  return {
    date,
    count,
    state: toldStateOf(data, date, changes),
    unassigned,
    issues,
    care: issues.size,
    changes: changeCount(changes),
    absence,
    overSpan,
    needsCare: issues.size > 0,
  };
}

/**
 * 担当を AI で組む日（日付の順）：その月・今日以降・計算に入れる訪問がある・伝えていない日のうち、
 * mode が 'care' なら要対応の訪問がある日（statusOf で引く）、'all' なら全部
 */
export function batchTargets(
  data: Pick<DemoData, 'visits' | 'patterns' | 'clients' | 'clientLeaves' | 'snapshots'>,
  dates: readonly string[],
  today: string,
  mode: BatchMode,
  statusOf: (date: string) => DayStatus | undefined,
): string[] {
  return dates.filter((date) => {
    if (date < today || own(data.snapshots, date)) return false;
    if (activeDayVisits(data, date).length === 0) return false;
    if (mode === 'care') return (statusOf(date)?.care ?? 0) > 0;
    return true;
  });
}

/** その日の担当の並び（月・週の集計） */
export type DayPlan = {
  date: string;
  /** いまのデータの問題（作れなければ null） */
  problem: Problem | null;
  /** 担当 → 訪問ID の列（問題にある訪問だけ） */
  routes: Routes;
};

/** その日の担当の並び（problem を渡すとそれを使う） */
export function dayPlanOf(data: CompileInput, date: string, problem?: Problem | null): DayPlan {
  const p = problem !== undefined ? problem : dayProblemOf(data, date);
  return { date, problem: p, routes: p ? dayRoutes(data, date, p) : {} };
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
        visitsOn(data, date)
          .filter((v) => !v.cancelled && isOnLeave(data.clientLeaves, v))
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
   * 30分ごとの状態（PRD D75。lib/staffBar の staffSlots。0:00〜24:00 の48マス。3段に出すのは 8〜20時で外は端の印。PRD D82）
   */
  bar: StaffSlot[];
};

/** 選んだ〈スタッフ〉のその日（数えるのはその日の担当の並び） */
export function staffDay(data: CompileInput, day: DayPlan, staffId: string): StaffDay {
  const { date, problem: p } = day;
  const s = data.staff.find((x) => x.id === staffId);
  const override = data.availability.find((a) => a.staffId === staffId && a.date === date);
  const base = s ? availabilityOf(s, date, override).slots : [];
  const absences = data.absences.filter((a) => a.staffId === staffId && a.date === date);
  const slots = absences.length > 0 ? withoutAbsences(base, absences) : base;
  const list = own(day.routes, staffId) ?? [];
  const counts = new Map<string | null, number>();
  const visitById = new Map(visitsOn(data, date).map((v) => [v.id, v]));
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
  return {
    date,
    slots,
    off: base.length === 0,
    absence: absences.at(-1) ?? null,
    requested: absences.length > 0 && absences.every(isRequestedOff),
    retired: !!s && afterLastDay(s, date),
    count: list.length,
    target,
    travel: Math.round(travel),
    minutes,
    types: sortTypes(counts, data.visitTypes),
    bar: staffSlots({
      shift: spansOf(slots),
      base: spansOf(base),
      busy: busyParts(stops),
      planned: true,
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
  /** 担当（null＝担当なし・取り消し・休み） */
  staffId: string | null;
  /** 繰り返しの担当（いつもの担当）でない担当（「代」） */
  substitute: boolean;
  /** この回だけ変えた（パターンの訪問） */
  edited: boolean;
  cancelled: boolean;
  /** 当日キャンセル（取り消しの種類。ADR-0015） */
  sameDay: boolean;
  /** 〈利用者さん〉の休み（ADR-0013）のため無し（取り消しでない訪問だけ。計算に入らない） */
  leave: boolean;
  /** 担当なし */
  unassigned: boolean;
};

export type ClientDay = { date: string; visits: ClientVisitMark[] };

/** 選んだ〈利用者さん〉のその日の訪問（取り消しも含む。開始の順） */
export function clientDay(data: CompileInput, day: DayPlan, clientId: string): ClientDay {
  const { date, problem: p } = day;
  const mine = visitsOn(data, date).filter((v) => v.clientId === clientId);
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
      const usual = pattern?.usualStaffId ?? null;
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
        unassigned: !v.cancelled && !leave && staffId === null,
      };
    })
    .sort((a, b) => a.start - b.start || a.visitId.localeCompare(b.visitId));
  return { date, visits };
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
  /** 担当した人の内訳（多い順。staffId が null＝担当なし） */
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

/** 要対応の種類：要対応の訪問がある・未連絡の変更がある・拘束が上限を超える（ADR-0015） */
export type AttentionKind = 'care' | 'changed' | 'overSpan';
export type Attention = {
  date: string;
  kind: AttentionKind;
  /** 要対応の訪問の件数／未連絡の変更の件数／拘束が上限を超える人数 */
  count: number;
  /** 拘束が上限を超える人の名前（overSpan のとき）・要対応の内訳（care のとき。「担当なし 2」など） */
  names: string[];
  /** 拘束が上限を超える人の id（overSpan のときだけ。稼働の見込みでその人を選んで開く。PRD D201） */
  staffIds?: string[];
};

const KIND_ORDER: Record<AttentionKind, number> = { care: 0, changed: 1, overSpan: 2 };

/** 要対応の内訳（「担当なし 2」「担当が休み 1」。検査の種類の順） */
export function issueBreakdown(issues: ReadonlyMap<string, readonly VisitIssue[]>): string[] {
  const order: VisitIssue['kind'][] = ['unassigned', 'off', 'notAllowed', 'late'];
  const label: Record<VisitIssue['kind'], string> = {
    unassigned: '担当なし',
    off: '担当が休み',
    notAllowed: '条件に合わない',
    late: '時間に間に合わない',
  };
  const count = new Map<VisitIssue['kind'], number>();
  for (const list of issues.values()) {
    const first = order.find((k) => list.some((x) => x.kind === k));
    if (first) count.set(first, (count.get(first) ?? 0) + 1);
  }
  return order.filter((k) => count.has(k)).map((k) => `${label[k]} ${count.get(k)}`);
}

/**
 * 要対応の一覧（今日以降の日。日付の順、同じ日は 要対応の訪問 → 未連絡の変更 → 拘束）。
 * マスの赤（needsCare）はどれも行になるので、マスの札とホーム・進み具合の帯の数がそろう
 */
export function attentionList(
  data: Pick<DemoData, 'staff'>,
  statuses: readonly DayStatus[],
  today: string,
): Attention[] {
  const nameOf = new Map(data.staff.map((s) => [s.id, s.name]));
  const out: Attention[] = [];
  for (const s of statuses) {
    if (s.date < today) continue;
    if (s.care > 0) out.push({ date: s.date, kind: 'care', count: s.care, names: issueBreakdown(s.issues) });
    if (s.changes > 0) out.push({ date: s.date, kind: 'changed', count: s.changes, names: [] });
    // 拘束が上限を超える（ADR-0015）
    if (s.overSpan.length > 0)
      out.push({
        date: s.date,
        kind: 'overSpan',
        count: s.overSpan.length,
        names: s.overSpan.map((id) => nameOf.get(id) ?? '').filter(Boolean),
        staffIds: [...s.overSpan],
      });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));
}

// ---- 今月の準備（進み具合の帯。design.md §4 pages「進み具合の帯」）----

/** 月の「今月の準備」の進み具合（その月の今日以降の日について） */
export type MonthProgress = {
  /** ① 訪問の件数（取り消し・休みを除く） */
  visits: number;
  /** 訪問のある日の数（②③の分母） */
  days: number;
  /** ② 担当が全部入った日の数（要対応の訪問が無い日） */
  planned: number;
  /** ③ 伝えた日の数（未連絡の変更の無い日） */
  confirmed: number;
  /** 伝えていない・未連絡の変更のある日（訪問のある日。日付の順） */
  unconfirmed: string[];
  /** 要対応の件数（attentionList の件数） */
  attention: number;
};

/** 今月の準備：その月の今日以降について。statusOf は日の状態（画面が作ったもの。無ければ dayStatus で作る） */
export function monthProgress(
  data: CompileInput & Pick<DemoData, 'snapshots'>,
  ym: string,
  today: string,
  statusOf?: (date: string) => DayStatus | undefined,
): MonthProgress {
  const statuses: DayStatus[] = [];
  for (const date of monthDates(ym)) {
    if (date < today) continue;
    statuses.push(statusOf?.(date) ?? dayStatus(data, date));
  }
  const withVisits = statuses.filter((s) => s.count > 0);
  return {
    visits: withVisits.reduce((m, s) => m + s.count, 0),
    days: withVisits.length,
    planned: withVisits.filter((s) => s.care === 0).length,
    confirmed: withVisits.filter((s) => s.state === 'told').length,
    unconfirmed: withVisits.filter((s) => s.state !== 'told').map((s) => s.date),
    attention: attentionList(data, statuses, today).length,
  };
}
