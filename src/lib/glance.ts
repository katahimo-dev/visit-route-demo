// 一目で分かる表示の段階（PRD D78〜D81。design.md §4 pages「数字より視覚で分かる表示（小さい4件）」）。
// 空き状況の表・問い合わせの試算の週ごとのマス・今月の準備の積み上げ・〈利用者さん〉の月の日ごとの点の、
// 色と模様の段階を決める純粋関数（データは書き換えない）。模様の言葉は混み具合バー（components/loadBar）にそろえる：
// 0人＝斜線、1人＝点々、2人以上＝緑（多いほど濃い）、案なし＝薄い縦線

import type { VacancyCell, VacancyResult } from '../contracts/vacancy';
import { hhmmToMinutes, weekday } from '../domain/time';
import { verdictOf } from '../vacancy';
import type { ClientDay, MonthProgress } from './month';

// ---- 空き状況の表（D78）----

/** 空き状況のマスの段階：案なし／どの週も0人／0人の週がある／1人／2人／3人／4人以上（どの週でも受けられる人数＝min） */
export type VacancyLevel = 'unknown' | 'none' | 'partial' | 'one' | 'two' | 'three' | 'many';

export function vacancyLevel(cell: Pick<VacancyCell, 'min' | 'weeksOk' | 'weeksTotal'>): VacancyLevel {
  if (cell.weeksTotal === 0) return 'unknown';
  if (cell.min <= 0) return cell.weeksOk > 0 ? 'partial' : 'none';
  if (cell.min === 1) return 'one';
  if (cell.min === 2) return 'two';
  if (cell.min === 3) return 'three';
  return 'many';
}

// ---- 問い合わせの試算の週ごとのマス（D79）----

/** 1日のマス：○＝その行の開始時刻に受けられる人がいる／×＝いない／？＝案が無く数えていない */
export type InquiryDayMark = 'ok' | 'ng' | 'unknown';

export type InquiryDay = {
  date: string;
  mark: InquiryDayMark;
  /** その行の開始時刻（start）にその日受けられる人数（unknown は 0） */
  best: number;
};

/**
 * 曜日の行。start はその曜日の希望の時間帯の中で一番良い開始時刻（0時からの分。時間帯の中に開始時刻が無ければ null）、
 * verdict はその開始時刻の判定（vacancy の verdictOf。要約 inquirySummary と同じ決め方：同じ開始時刻がどの週も受けられれば ok）、
 * days はその開始時刻の日ごとのマス
 */
export type InquiryRow = {
  weekday: number;
  start: number | null;
  verdict: 'ok' | 'partial' | 'ng' | 'unknown';
  days: InquiryDay[];
};

/** 表示の曜日の順（月〜日） */
const ROW_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const VERDICT_RANK = { ok: 3, partial: 2, ng: 1, unknown: 0 } as const;

/**
 * 希望の曜日（空＝全曜日）×週（期間の中のその曜日の日）のマス。希望の開始時刻の範囲 from〜to（両端を含む）の開始時刻ごとの
 * verdictOf のうち一番良いもの（ok＞partial＞ng＞unknown、同じなら受けられる週の多い順・人数の最小の多い順・早い順）を
 * その曜日の開始時刻にし、行の判定とマスはその開始時刻で出す（どこかの時刻に1人いるだけでは ○ にしない＝要約と食い違わない）
 */
export function inquiryRows(
  result: Pick<VacancyResult, 'dates' | 'noPlanDates' | 'cells'>,
  wish: { weekdays: readonly number[]; from: string; to: string },
): InquiryRow[] {
  const lo = hhmmToMinutes(wish.from);
  const hi = hhmmToMinutes(wish.to);
  const noPlan = new Set(result.noPlanDates);
  const wds = wish.weekdays.length > 0 ? ROW_WEEKDAYS.filter((w) => wish.weekdays.includes(w)) : ROW_WEEKDAYS;
  return wds.map((wd) => {
    const cells = result.cells
      .filter((c) => c.weekday === wd && c.start >= lo && c.start <= hi)
      .sort(
        (a, b) =>
          VERDICT_RANK[verdictOf(b)] - VERDICT_RANK[verdictOf(a)] ||
          b.weeksOk - a.weeksOk ||
          b.min - a.min ||
          a.start - b.start,
      );
    const best = cells[0];
    const days = result.dates
      .filter((d) => weekday(d) === wd)
      .map((date): InquiryDay => {
        if (noPlan.has(date) || !best) return { date, mark: 'unknown', best: 0 };
        const n = best.byDate.find((x) => x.date === date)?.staffIds.length ?? 0;
        return { date, mark: n > 0 ? 'ok' : 'ng', best: n };
      });
    return { weekday: wd, start: best?.start ?? null, verdict: best ? verdictOf(best) : 'unknown', days };
  });
}

/** 日のマスの模様の段階（D78 と同じ言葉）：案なし／0人／1人／2人以上 */
export function inquiryDayLevel(x: InquiryDay): 'unknown' | 'none' | 'one' | 'two' {
  if (x.mark === 'unknown') return 'unknown';
  if (x.best <= 0) return 'none';
  return x.best === 1 ? 'one' : 'two';
}

// ---- 今月の準備の積み上げ（D80）----

export type PrepPart = { kind: 'confirmed' | 'planned' | 'none'; days: number };

/** 訪問のある日を 確定済み・案あり（未確定）・案なし に分ける（足すと days。並びは この順、0日の分も出す） */
export function prepParts(p: Pick<MonthProgress, 'days' | 'planned' | 'confirmed'>): PrepPart[] {
  const confirmed = Math.max(0, Math.min(p.confirmed, p.days));
  const planned = Math.max(0, Math.min(p.planned, p.days) - confirmed);
  return [
    { kind: 'confirmed', days: confirmed },
    { kind: 'planned', days: planned },
    { kind: 'none', days: Math.max(0, p.days - confirmed - planned) },
  ];
}

// ---- 〈利用者さん〉の月の日ごとの点（D81）----

/** 日の点：訪問あり／当日キャンセル／取り消し／休み（ADR-0013）／訪問なし */
export type ClientDot = 'visit' | 'sameDay' | 'cancelled' | 'leave' | 'none';

/** その日の点（訪問が1件でもあれば訪問あり。無ければ 当日キャンセル＞取り消し＞休み の順） */
export function clientDot(day: Pick<ClientDay, 'visits'>): ClientDot {
  const v = day.visits;
  if (v.some((x) => !x.cancelled && !x.leave)) return 'visit';
  if (v.some((x) => x.cancelled && x.sameDay)) return 'sameDay';
  if (v.some((x) => x.cancelled)) return 'cancelled';
  if (v.some((x) => x.leave)) return 'leave';
  return 'none';
}
