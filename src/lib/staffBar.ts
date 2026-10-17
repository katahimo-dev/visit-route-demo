// 〈スタッフ〉1人の時間帯ごとの状態（PRD D75〜D77。design.md §4 pages「数字より視覚で分かる表示」）。
// 月の混み具合バー（vacancy の dayLoad。D54・D60）と同じ 07:00〜20:00 の30分ごと・3段（components/loadBar の loadRows）で、
// その人の 訪問・移動・空き（勤務内で空いている）・休み（欠勤・希望休・勤務の無い日・最終勤務日の後）・勤務外 を出す。
// 重なりの数え方は dayLoad と同じ（30分に少しでも重なれば数える。移動は訪問の直前に置く）。そのため、混み具合の
// 「空き N人」は、その30分が「空き」の人の数と一致する。純粋関数（データは書き換えない）
import type { StopTiming } from '../contracts/problem';
import { VACANCY_DAY_END_DEFAULT, VACANCY_DAY_START_DEFAULT, VACANCY_STEP_DEFAULT } from '../contracts/vacancy';
import { timeText } from '../domain/availability';
import { hhmmToMinutes, minutesToHhmm } from '../domain/time';

/** 30分の状態：訪問／移動／空き（勤務内）／休み（欠勤・希望休・勤務の無い日・最終勤務日の後）／勤務外 */
export type StaffSlotState = 'visit' | 'travel' | 'free' | 'rest' | 'outside';

/** 30分1つ（start は0時からの分） */
export type StaffSlot = { start: number; state: StaffSlotState };

/** 時刻の区間（0時からの分。[start, end)） */
export type Span = { start: number; end: number };

/** 1日の時間軸の上の区間の種類：訪問／移動／待ち */
export type RoutePart = Span & { kind: 'visit' | 'travel' | 'wait' };

/** 状態の呼び方（凡例・title・読み上げで同じ言葉を使う） */
export const STAFF_SLOT_LABEL: Record<StaffSlotState, string> = {
  visit: '訪問',
  travel: '移動',
  free: '空き',
  rest: '休み',
  outside: '勤務外',
};

/** 状態の並び（凡例・読み上げの順） */
export const STAFF_SLOT_ORDER: readonly StaffSlotState[] = ['visit', 'travel', 'free', 'rest', 'outside'];

const EPS = 1e-6;
const STEP = VACANCY_STEP_DEFAULT;

/**
 * 訪問と来る移動の区間（dayLoad と同じく、移動は訪問の直前 [開始 − 来る移動, 開始) に置く。最初の訪問の自宅からの移動も入れる。
 * 最後の訪問から自宅へ帰る移動は入れない）
 */
export function busyParts(stops: readonly Pick<StopTiming, 'start' | 'end' | 'travelIn'>[]): RoutePart[] {
  const out: RoutePart[] = [];
  for (const x of stops) {
    if (x.travelIn > EPS) out.push({ kind: 'travel', start: x.start - x.travelIn, end: x.start });
    out.push({ kind: 'visit', start: x.start, end: x.end });
  }
  return out;
}

/**
 * 拘束（最初の訪問の開始〜最後の訪問の終わり）の内訳：訪問・移動・待ち（稼働の見込み。PRD D72・D77）。
 * 訪問のあいだの時間は、移動を次の訪問の直前に置き（busyParts と同じ）、残りを待ちにする。最初の訪問の前の移動（自宅から）は入れない
 */
export function spanParts(stops: readonly Pick<StopTiming, 'start' | 'end' | 'travelIn'>[]): RoutePart[] {
  const out: RoutePart[] = [];
  stops.forEach((x, k) => {
    if (k > 0) {
      const prevEnd = stops[k - 1]!.end;
      const travelFrom = Math.max(prevEnd, x.start - x.travelIn);
      if (travelFrom - prevEnd > EPS) out.push({ kind: 'wait', start: prevEnd, end: travelFrom });
      if (x.start - travelFrom > EPS) out.push({ kind: 'travel', start: travelFrom, end: x.start });
    }
    out.push({ kind: 'visit', start: x.start, end: x.end });
  });
  return out;
}

/**
 * その人のその日の30分ごとの状態（07:00〜20:00。dayLoad と同じ区切り）。
 * shift＝欠勤を差し引いた稼働時間帯、base＝欠勤を差し引く前の稼働時間帯、busy＝busyParts。
 * 決め方（上が先）：訪問が重なる→訪問、移動が重なる→移動、稼働時間帯が重なる→空き、
 * その日の稼働時間帯が無い（勤務の無い日・終日の欠勤・希望休・最終勤務日の後）か欠勤の時間が重なる→休み、ほか→勤務外。
 * 休みの人に残った訪問も「訪問」で出す（休みの日に訪問があると分かる）
 */
export function staffSlots(input: {
  shift: readonly Span[];
  base: readonly Span[];
  busy: readonly RoutePart[];
}): StaffSlot[] {
  const dayRest = input.shift.length === 0;
  const end = hhmmToMinutes(VACANCY_DAY_END_DEFAULT);
  const out: StaffSlot[] = [];
  for (let a = hhmmToMinutes(VACANCY_DAY_START_DEFAULT); a + STEP <= end; a += STEP) {
    const b = a + STEP;
    const overlaps = (x: Span) => a < x.end - EPS && x.start < b - EPS;
    let state: StaffSlotState;
    if (input.busy.some((x) => x.kind === 'visit' && overlaps(x))) state = 'visit';
    else if (input.busy.some((x) => x.kind === 'travel' && overlaps(x))) state = 'travel';
    else if (input.shift.some(overlaps)) state = 'free';
    else if (dayRest || input.base.some(overlaps)) state = 'rest';
    else state = 'outside';
    out.push({ start: a, state });
  }
  return out;
}

/** 'HH:mm' の時間帯を分に */
export const spansOf = (slots: readonly { start: string; end: string }[]): Span[] =>
  slots.map((x) => ({ start: hhmmToMinutes(x.start), end: hhmmToMinutes(x.end) }));

const hm = (t: number) => timeText(minutesToHhmm(t));

/** 「9:00〜9:30 訪問」 */
export function staffSlotText(x: StaffSlot): string {
  return `${hm(x.start)}〜${hm(x.start + STEP)} ${STAFF_SLOT_LABEL[x.state]}`;
}

/**
 * 読み上げのまとめ（状態ごとに続く時間帯をまとめる。勤務外は書かない。
 * 例「訪問 9:00〜11:00、14:00〜15:00・移動 8:30〜9:00・空き 11:00〜14:00」）
 */
export function staffSlotSummary(slots: readonly StaffSlot[]): string {
  const parts: string[] = [];
  for (const state of STAFF_SLOT_ORDER) {
    if (state === 'outside') continue;
    const ranges: string[] = [];
    let from: number | null = null;
    let to = 0;
    for (const x of [...slots, null]) {
      if (x && x.state === state) {
        if (from === null) from = x.start;
        to = x.start + STEP;
        continue;
      }
      if (from !== null) ranges.push(`${hm(from)}〜${hm(to)}`);
      from = null;
    }
    if (ranges.length > 0) parts.push(`${STAFF_SLOT_LABEL[state]} ${ranges.join('、')}`);
  }
  return parts.length > 0 ? parts.join('・') : 'どの時間も勤務外';
}
