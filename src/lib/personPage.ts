// 〈利用者さん〉・〈スタッフ〉の全画面（PRD D308〜D312。ADR-0052）の純粋関数：タブ・節の項目・予定のカレンダーの期間と回。
// データは書き換えない（保存は画面の update(fn)。訪問は lib/visitOps 越しに読む）
import type { DemoData } from '../contracts/data';
import type { Absence, Visit } from '../contracts/documents';
import { leaveOn } from '../domain/leaves';
import { addDays, hhmmToMinutes, weekday } from '../domain/time';
import { own, WEEKDAY_LABELS } from './common';
import { addMonths, ymOf } from './month';
import { mdText } from './patternText';
import { assignmentOf, clientVisitsIn, staffVisitsIn } from './visitOps';
import { weekDates, weekStart } from './week';

// ---- ルートとタブ ----

/** 全画面の〈利用者さん〉・〈スタッフ〉の画面のパス（`/clients/:id`・`/staff/:id`）か。一覧（`/clients`）は含めない */
export const personPathKind = (pathname: string): 'client' | 'staff' | null => {
  const m = /^\/(clients|staff)\/[^/]+$/.exec(pathname);
  return m ? (m[1] === 'clients' ? 'client' : 'staff') : null;
};

/** 新しい人の画面の ID（`/clients/new`・`/staff/new`） */
export const NEW_PERSON_ID = 'new';

/** 〈利用者さん〉の画面のタブ（先頭は予定） */
export const CLIENT_TABS = ['schedule', 'basic', 'staffing', 'leaves'] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];
/** 〈スタッフ〉の画面のタブ（先頭は予定） */
export const STAFF_TABS = ['schedule', 'basic', 'hours', 'compat'] as const;
export type StaffTab = (typeof STAFF_TABS)[number];

/** URL の `?tab=` をタブに（知らない値・無ければ先頭の予定） */
export function tabOf<T extends string>(tabs: readonly T[], value: string | null): T {
  return tabs.includes(value as T) ? (value as T) : tabs[0]!;
}

/** タブを URL に書く（先頭の予定は書かない）。ほかのクエリ（カレンダーの表示・日付）はそのまま、節の `edit` は消す */
export function tabSearch(search: string, tab: string, first: string): string {
  const q = new URLSearchParams(search);
  if (tab === first) q.delete('tab');
  else q.set('tab', tab);
  q.delete('edit');
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---- 節の編集 ----

/** 節の項目だけを取り出す（節ごとに保存するとき、ほかの節の項目を古い入力で上書きしない） */
export function pickFields<T extends object, K extends keyof T>(x: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = x[k];
  return out;
}

/** 保存した中身に、節の項目だけ入力の値を重ねる */
export function mergeFields<T extends object, K extends keyof T>(saved: T, form: T, keys: readonly K[]): T {
  return { ...saved, ...pickFields(form, keys) };
}

// ---- 予定のカレンダー ----

/** カレンダーの見せ方（週・月） */
export type CalView = 'week' | 'month';
export const calViewOf = (v: string | null): CalView => (v === 'month' ? 'month' : 'week');

/** 月の見せ方の週（月曜はじまり。その月の1日を含む週から末日を含む週まで） */
export function monthWeeksMon(ym: string): string[][] {
  const first = `${ym}-01`;
  const weeks: string[][] = [];
  for (let s = weekStart(first); ymOf(s) <= ym; s = addDays(s, 7)) {
    weeks.push(weekDates(s));
    if (weeks.length > 6) break;
  }
  return weeks;
}

/** 見せる期間の日付（週は月〜日の7日、月は月曜はじまりの週を並べた全部の日） */
export function calDates(view: CalView, anchor: string): string[] {
  return view === 'week' ? weekDates(anchor) : monthWeeksMon(ymOf(anchor)).flat();
}

/** 期間を送る（週は7日、月は1か月。月はその月の1日にする） */
export function shiftAnchor(view: CalView, anchor: string, dir: -1 | 1): string {
  return view === 'week' ? addDays(anchor, dir * 7) : `${addMonths(ymOf(anchor), dir)}-01`;
}

/** 期間の見出し（「10/19（月）〜10/25（日）」「2026年10月」） */
export function calTitle(view: CalView, anchor: string): string {
  if (view === 'month') return `${anchor.slice(0, 4)}年${Number(anchor.slice(5, 7))}月`;
  const d = weekDates(anchor);
  const t = (x: string) => `${mdText(x)}（${WEEKDAY_LABELS[weekday(x)]}）`;
  return `${t(d[0]!)}〜${t(d[6]!)}`;
}

/** カレンダーの回の様子 */
export type CalState = 'assigned' | 'unassigned' | 'noplan' | 'cancelled' | 'sameDay' | 'leave';

/** カレンダーの回1つ */
export type CalItem = {
  visit: Visit;
  /** その日の担当（今の案、無ければ確定した割当） */
  staffId: string | null;
  pinned: boolean;
  state: CalState;
  /** この回だけ変えた（繰り返しの回） */
  edited: boolean;
  /** 0時からの分（開始（早）〜＋所要） */
  start: number;
  end: number;
};

/** 回の様子：取り消し → 休み → 担当あり → 担当なし（案はある）→ 案なし */
function calItemOf(d: Pick<DemoData, 'aiPlans' | 'manualPlans' | 'clientLeaves'>, v: Visit): CalItem {
  const a = assignmentOf(d, v.id, v.date);
  const start = hhmmToMinutes(v.earliestStart);
  const state: CalState = v.cancelled
    ? v.cancelKind === 'sameDay'
      ? 'sameDay'
      : 'cancelled'
    : leaveOn(d.clientLeaves, v.clientId, v.date)
      ? 'leave'
      : a.staffId
        ? 'assigned'
        : a.source
          ? 'unassigned'
          : 'noplan';
  return {
    visit: v,
    staffId: v.cancelled ? null : a.staffId,
    pinned: a.pinned,
    state,
    edited: !!v.pattern?.edited,
    start,
    end: start + v.durationMinutes,
  };
}

/** 〈利用者さん〉のその期間の回（取り消しも。日付・開始の順） */
export function clientCalItems(
  d: Pick<DemoData, 'visits' | 'aiPlans' | 'manualPlans' | 'clientLeaves'>,
  clientId: string,
  from: string,
  to: string,
): CalItem[] {
  return clientVisitsIn(d, clientId, from, to).map((v) => calItemOf(d, v));
}

/** 〈スタッフ〉が担当しているその期間の回（取り消しは出さない。日付・開始の順） */
export function staffCalItems(
  d: Pick<DemoData, 'visits' | 'aiPlans' | 'manualPlans' | 'clientLeaves'>,
  staffId: string,
  from: string,
  to: string,
): CalItem[] {
  return staffVisitsIn(d, staffId, from, to).map((v) => calItemOf(d, v));
}

/** 回を日付ごとに分ける */
export function itemsByDate(items: readonly CalItem[]): Map<string, CalItem[]> {
  const m = new Map<string, CalItem[]>();
  for (const it of items) {
    const list = m.get(it.visit.date);
    if (list) list.push(it);
    else m.set(it.visit.date, [it]);
  }
  return m;
}

/** 回の様子の短い文（カレンダー・日ごとのリストの印） */
export const CAL_STATE_TEXT: Record<CalState, string> = {
  assigned: '',
  unassigned: '担当なし',
  noplan: '案なし',
  cancelled: '取り消し',
  sameDay: '当日キャンセル',
  leave: '休みのため無し',
};

/** 訪問を作ってある最後の日（無ければ null）。この日より後はまだ作っていない（月の予定で作る） */
export function lastMadeDate(visits: readonly Pick<Visit, 'date'>[]): string | null {
  let m: string | null = null;
  for (const v of visits) if (m === null || v.date > m) m = v.date;
  return m;
}

/**
 * 〈スタッフ〉のその期間の欠勤・希望休（日付の順）。希望休は note が「希望休」の終日の欠勤（lib/requestedOff）
 */
export function staffAbsencesIn(d: Pick<DemoData, 'absences'>, staffId: string, from: string, to: string): Absence[] {
  return d.absences
    .filter((a) => a.staffId === staffId && a.date >= from && a.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 空き枠を押した・縦にドラッグした分の範囲から、新しい訪問の開始と所要（短すぎれば既定の所要） */
export function slotOf(a: number, b: number, fallback = 60): { start: number; duration: number } {
  const s = Math.min(a, b);
  const len = Math.abs(b - a);
  return { start: s, duration: len >= 15 ? len : fallback };
}

/** 確定した割当のある日か（カレンダーの日の見出しの印） */
export const confirmedOn = (d: Pick<DemoData, 'manualPlans'>, date: string): boolean => !!own(d.manualPlans, date);

/** 〈利用者さん〉から見た〈スタッフ〉の相性（記号ごと。数えるのは渡した〈スタッフ〉。並びは渡した順） */
export function clientStaffGroups<S extends { id: string }>(
  compat: DemoData['compat'],
  clientId: string,
  staff: readonly S[],
): { great: S[]; good: S[]; poor: S[]; ng: S[] } {
  const out = { great: [] as S[], good: [] as S[], poor: [] as S[], ng: [] as S[] };
  const row = own(compat, clientId);
  for (const s of staff) {
    const l = row ? (own(row, s.id) ?? 0) : 0;
    if (l === 2) out.great.push(s);
    else if (l === 1) out.good.push(s);
    else if (l === -1) out.poor.push(s);
    else if (l === -2) out.ng.push(s);
  }
  return out;
}
