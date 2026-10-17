// 空き状況と問い合わせの試算（ADR-0012 追記。段階3＝PRD D45〜D48）。design.md §4 vacancy・§5「空き状況と問い合わせの試算」。
// どれも純粋関数で決定的（乱数・Date.now を使わない）。DemoData・今の案は読むだけで書き換えない。例外を投げない
import type { DemoData } from '../contracts/data';
import type { Client, Visit } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import type { Routes } from '../contracts/reassign';
import type { Condition, Item, Traits } from '../contracts/rules';
import {
  type DayLoadFn,
  type DayLoadSlot,
  INQUIRY_CLIENT_ID,
  INQUIRY_VISIT_ID,
  type InquirySummary,
  VACANCY_DAY_END_DEFAULT,
  VACANCY_DAY_START_DEFAULT,
  VACANCY_STEP_DEFAULT,
  VACANCY_WEEKS_MAX,
  type VacancyCell,
  type VacancyNoticeFn,
  type VacancyOf,
  type VerdictOf,
} from '../contracts/vacancy';
import { timeText } from '../domain/availability';
import { addDays, hhmmToMinutes, minutesToHhmm, weekday } from '../domain/time';
import { baseOf } from '../lib/absences';
import { WEEKDAY_LABELS } from '../lib/common';
import { compile, matches, scheduleRoute } from '../matching';
import { fitsOf } from '../reassign';

export type {
  DayLoadFilter,
  DayLoadSlot,
  InquiryWish,
  VacancyCell,
  VacancyNoticeInput,
  VacancyNoticeMode,
  VacancyQuery,
  VacancyRange,
  VacancyResult,
  Verdict,
} from '../contracts/vacancy';
export { INQUIRY_CLIENT_ID, INQUIRY_VISIT_ID } from '../contracts/vacancy';

const EPS = 1e-6;

/** 自分のキーだけを読む */
function colOf(routes: Routes, staffId: string): string[] {
  return Object.hasOwn(routes, staffId) ? (routes[staffId] ?? []) : [];
}

/** 列の中の、問題にある訪問の添字 */
function knownOf(problem: Problem, col: string[]): number[] {
  const vIndex = new Map(problem.visits.map((v, i) => [v.id, i]));
  const out: number[] = [];
  for (const id of col) {
    const x = vIndex.get(id);
    if (x !== undefined) out.push(x);
  }
  return out;
}

/**
 * その日の元の案の列（欠勤の baseOf と同じ選び方：確定した割当があればそれ、無ければ今の案）。
 * 問題に訪問が無い日（realVisits＝0）は空の案。訪問があって案も確定も無ければ null
 */
function planOf(data: DemoData, date: string, problem: Problem, realVisits: number): Routes | null {
  if (realVisits === 0) return {};
  return baseOf(data, date, problem)?.routes ?? null;
}

/** 担当に必要な条件（種類の必要条件と query.requirements）をすべて満たすか。項目の無い・相手側でない条件は無視する（compile と同じ） */
function meetsAll(conds: Condition[], items: Map<string, Item>, traits: Traits): boolean {
  return conds.every((c) => {
    const item = items.get(c.itemId);
    if (!item || item.target !== 'staff') return true;
    return matches(c, item, traits[c.itemId]);
  });
}

/** 開始時刻の列（dayStart から step 刻み。終わりが dayEnd を超える時刻は出さない） */
function timesOf(dayStart: string, dayEnd: string, step: number, duration: number): number[] {
  const out: number[] = [];
  if (!(step > 0) || !(duration > 0)) return out;
  const end = hhmmToMinutes(dayEnd);
  for (let t = hhmmToMinutes(dayStart); t + duration <= end + EPS; t += step) out.push(t);
  return out;
}

/** 件数の上限（必須の負担の均等）を超えるか（1件足すと） */
function overCap(problem: Problem, s: number, count: number): boolean {
  const cap = problem.balance?.cap ?? null;
  return cap !== null && count + 1 > cap[s]!;
}

/**
 * 空き状況の表・問い合わせの試算（design.md §4 vacancy の数え方）。
 * 正確（query.place あり）：仮の〈利用者さん〉・訪問を足したデータで日ごとに1回 compile し、開始時刻ごとに仮の訪問の
 * earliest・latest をその時刻にした問題で fitsOf が返す人。目安（place が null）：元の案の lenient の時刻に、
 * [開始 − margin, 終了 ＋ margin) が稼働時間帯に収まり、どの訪問とも重ならない人
 */
export const vacancyOf: VacancyOf = (data, query, range) => {
  const exact = query.place !== null;
  const weeks = Math.max(0, Math.min(VACANCY_WEEKS_MAX, Math.floor(range.weeks)));
  const dates = Array.from({ length: weeks * 7 }, (_, i) => addDays(range.from, i));
  const duration = query.durationMinutes;
  const times = timesOf(query.dayStart, query.dayEnd, query.stepMinutes, duration);
  const items = new Map(data.items.map((it) => [it.id, it]));
  // いない種類は種類なし
  const vType = query.typeId === null ? undefined : data.visitTypes.find((t) => t.id === query.typeId);
  const conds = [...(vType?.requirements ?? []), ...query.requirements];
  const eligible = new Set(data.staff.filter((s) => meetsAll(conds, items, s.traits)).map((s) => s.id));
  // 日ごとの訪問（compile に渡すデータを小さくする）
  const visitsByDate = new Map<string, Visit[]>();
  const wanted = new Set(dates);
  for (const v of data.visits) {
    if (!wanted.has(v.date)) continue;
    const list = visitsByDate.get(v.date);
    if (list) list.push(v);
    else visitsByDate.set(v.date, [v]);
  }
  const inquiryClient: Client | null =
    query.place === null
      ? null
      : {
          id: INQUIRY_CLIENT_ID,
          displayName: '問い合わせ',
          kana: '',
          place: query.place,
          note: '',
          color: 0,
          active: true,
          traits: {},
          requirements: query.requirements,
          preferences: [],
          usualStaffId: null,
          tentative: false,
          entryNote: '',
          keyNote: '',
          parkingNote: '',
          cautionNote: '',
          allowedStaffIds: [],
          stage: 'active',
          referrer: { name: '', contact: '', note: '' },
        };
  const clients = inquiryClient ? [...data.clients, inquiryClient] : data.clients;

  const noPlanDates: string[] = [];
  /** 日付 → 開始時刻ごとの人（times の順） */
  const counted = new Map<string, string[][]>();
  for (const date of dates) {
    const dayVisits = visitsByDate.get(date) ?? [];
    let dayData: DemoData = { ...data, clients, visits: dayVisits };
    if (inquiryClient && times.length > 0) {
      const inquiry: Visit = {
        id: INQUIRY_VISIT_ID,
        date,
        clientId: INQUIRY_CLIENT_ID,
        windowKind: 'window',
        earliestStart: minutesToHhmm(times[0]!),
        latestStart: minutesToHhmm(times.at(-1)!),
        durationMinutes: duration,
        staffId: null,
        cancelled: false,
        note: '',
        typeId: vType?.id ?? null,
        pattern: null,
        cancelKind: null,
      };
      dayData = { ...dayData, visits: [...dayVisits, inquiry] };
    }
    const problem = compile(dayData, date);
    const vi = problem.visits.findIndex((v) => v.id === INQUIRY_VISIT_ID);
    const realVisits = problem.visits.length - (vi >= 0 ? 1 : 0);
    const routes = planOf(dayData, date, problem, realVisits);
    if (routes === null) {
      noPlanDates.push(date);
      continue;
    }
    const perTime = exact
      ? exactOn(problem, routes, vi, times, eligible)
      : estimateOn(problem, routes, times, duration, query.marginMinutes, eligible);
    counted.set(date, perTime);
  }

  const cells: VacancyCell[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const days = dates.filter((d) => weekday(d) === wd && counted.has(d));
    times.forEach((start, k) => {
      const byDate = days.map((date) => ({ date, staffIds: counted.get(date)![k]! }));
      const sizes = byDate.map((x) => x.staffIds.length);
      cells.push({
        weekday: wd,
        start,
        byDate,
        min: sizes.length === 0 ? 0 : Math.min(...sizes),
        weeksOk: sizes.filter((n) => n > 0).length,
        weeksTotal: sizes.length,
      });
    });
  }
  return { exact, dates, noPlanDates, times, cells };
};

/** 正確：開始時刻ごとに、仮の訪問の earliest・latest をその時刻にした問題で fitsOf が返す人（増える費用の順） */
function exactOn(problem: Problem, routes: Routes, vi: number, times: number[], eligible: Set<string>): string[][] {
  if (vi < 0) return times.map(() => []);
  // 誰も可にならなければ時刻ごとに数えない
  if (!problem.allowed[vi]!.some((ok, s) => ok && eligible.has(problem.staff[s]!.id))) return times.map(() => []);
  return times.map((t) => {
    const visits = problem.visits.slice();
    visits[vi] = { ...visits[vi]!, earliest: t, latest: t };
    return fitsOf({ ...problem, visits }, routes, INQUIRY_VISIT_ID)
      .map((f) => f.staffId)
      .filter((id) => eligible.has(id));
  });
}

/**
 * 目安：元の案の各列を lenient で時刻にし、[t − margin, t ＋ 所要 ＋ margin) が稼働時間帯の1つに収まり、
 * どの訪問の [開始, 終了) とも重ならない人（問題の staff の順）
 */
function estimateOn(
  problem: Problem,
  routes: Routes,
  times: number[],
  duration: number,
  margin: number,
  eligible: Set<string>,
): string[][] {
  const people = problem.staff.flatMap((st, s) => {
    if (st.slots.length === 0 || !eligible.has(st.id)) return [];
    const known = knownOf(problem, colOf(routes, st.id));
    if (overCap(problem, s, known.length)) return [];
    const t = scheduleRoute(problem, s, known, 'lenient');
    const busy = (t?.stops ?? []).map((x) => ({ start: x.start, end: x.end }));
    return [{ id: st.id, slots: st.slots, busy }];
  });
  return times.map((t) => {
    const a = t - margin;
    const b = t + duration + margin;
    return people
      .filter(
        (p) =>
          p.slots.some((x) => x.start <= a + EPS && b <= x.end + EPS) &&
          p.busy.every((x) => !(a < x.end - EPS && x.start < b - EPS)),
      )
      .map((p) => p.id);
  });
}

/** マスの判定：数えた日が無ければ unknown、すべての日に1人以上なら ok（○）、一部なら partial（△）、無ければ ng（×） */
export const verdictOf: VerdictOf = (cell) => {
  if (cell.weeksTotal === 0) return 'unknown';
  if (cell.weeksOk === cell.weeksTotal) return 'ok';
  if (cell.weeksOk > 0) return 'partial';
  return 'ng';
};

/** 「10/22」 */
const monthDay = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 「10月20日（火）」 */
const longDate = (d: string) =>
  `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日（${WEEKDAY_LABELS[weekday(d)]}）`;
const hm = (t: number) => timeText(minutesToHhmm(t));

/**
 * 試算の要約（design.md §4 vacancy）。希望の曜日（無ければ全曜日）・時間帯（開始時刻 from〜to）の中で、
 * ○ の開始時刻を曜日ごとに連続した範囲にまとめる。○ の曜日が週の回数以上なら対応できる文、足りなければ ○ の曜日と
 * △ の曜日（入らない日付）、どちらも無ければ空きが無い文
 */
export const inquirySummary: InquirySummary = (result, wish, terms) => {
  const days = wish.weekdays.length > 0 ? [...new Set(wish.weekdays)].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
  const from = hhmmToMinutes(wish.from);
  const to = hhmmToMinutes(wish.to);
  const perWeek = Math.max(1, Math.floor(wish.perWeek));
  const timeIndex = new Map(result.times.map((t, i) => [t, i]));
  const cellsOf = (wd: number) =>
    result.cells.filter((c) => c.weekday === wd && c.start >= from && c.start <= to).sort((a, b) => a.start - b.start);

  /** ○ の開始時刻の連続した範囲（「10:00〜11:30」。1つだけなら「10:00」） */
  const okRanges = (wd: number): string[] => {
    const out: string[] = [];
    let first: number | null = null;
    let last: number | null = null;
    const flush = () => {
      if (first === null || last === null) return;
      out.push(first === last ? hm(first) : `${hm(first)}〜${hm(last)}`);
    };
    for (const c of cellsOf(wd)) {
      if (verdictOf(c) !== 'ok') continue;
      if (last !== null && timeIndex.get(c.start) === (timeIndex.get(last) ?? -2) + 1) {
        last = c.start;
        continue;
      }
      flush();
      first = c.start;
      last = c.start;
    }
    flush();
    return out;
  };

  const ok = days.map((wd) => ({ wd, ranges: okRanges(wd) })).filter((x) => x.ranges.length > 0);
  const okText = () => {
    const same = ok.every((x) => x.ranges.join('、') === ok[0]!.ranges.join('、'));
    return same
      ? `${ok.map((x) => WEEKDAY_LABELS[x.wd]).join('・')}の ${ok[0]!.ranges.join('、')}`
      : ok.map((x) => `${WEEKDAY_LABELS[x.wd]} ${x.ranges.join('、')}`).join('、');
  };
  if (ok.length >= perWeek) {
    return `${okText()} なら、${longDate(wish.startDate)}から週${perWeek}回で対応できます`;
  }

  // △ の曜日：○ の時刻が無く、一部の日だけ入る時刻がある曜日。入る日の最も多い（同じなら早い）時刻と、その時刻に入らない日付
  const okDays = new Set(ok.map((x) => x.wd));
  const partial = days.flatMap((wd) => {
    if (okDays.has(wd)) return [];
    let best: VacancyCell | null = null;
    for (const c of cellsOf(wd)) {
      if (verdictOf(c) !== 'partial') continue;
      if (best === null || c.weeksOk > best.weeksOk) best = c;
    }
    return best ? [{ wd, cell: best }] : [];
  });
  if (ok.length === 0 && partial.length === 0) return 'ご希望の曜日・時間帯では、いまは空きがありません';

  const lines: string[] = [];
  lines.push(
    ok.length > 0
      ? `週${perWeek}回のうち、どの週も対応できるのは ${okText()} だけです`
      : `ご希望の曜日・時間帯では、どの週も対応できる時間はありません`,
  );
  for (const { wd, cell } of partial) {
    const missing = cell.byDate.filter((x) => x.staffIds.length === 0).map((x) => monthDay(x.date));
    lines.push(`${WEEKDAY_LABELS[wd]} ${hm(cell.start)} は ${missing.join('・')} に空いている${terms.staff}がいません`);
  }
  return lines.join('\n');
};

/**
 * 日の混み具合（D54。design.md §4 vacancy）：07:00〜20:00 の30分ごとに、working＝その30分に稼働時間帯（欠勤を除く）が
 * 重なる人、free＝そのうち元の案（確定した割当、無ければ今の案）の訪問の [開始 − 来る移動, 終了) と重ならない人。
 * filter.typeId があれば、その種類の必要条件を満たす人だけを数える（いない種類は種類なし）。
 * 訪問がある日に案が無ければ null（訪問の無い日は空の案として数える）
 */
export const dayLoad: DayLoadFn = (data, date, filter) => {
  // compile はその日の訪問しか読まないので、その日の訪問だけを渡す
  const problem = compile({ ...data, visits: data.visits.filter((v) => v.date === date) }, date);
  const routes = planOf(data, date, problem, problem.visits.length);
  if (routes === null) return null;
  const items = new Map(data.items.map((it) => [it.id, it]));
  const vType = filter.typeId === null ? undefined : data.visitTypes.find((t) => t.id === filter.typeId);
  const conds = vType?.requirements ?? [];
  const traitsOf = new Map(data.staff.map((s) => [s.id, s.traits]));
  const people = problem.staff.flatMap((st, s) => {
    if (st.slots.length === 0) return [];
    if (!meetsAll(conds, items, traitsOf.get(st.id) ?? {})) return [];
    const t = scheduleRoute(problem, s, knownOf(problem, colOf(routes, st.id)), 'lenient');
    const busy = (t?.stops ?? []).map((x) => ({ start: x.start - x.travelIn, end: x.end }));
    return [{ slots: st.slots, busy }];
  });
  const step = VACANCY_STEP_DEFAULT;
  const end = hhmmToMinutes(VACANCY_DAY_END_DEFAULT);
  const out: DayLoadSlot[] = [];
  for (let a = hhmmToMinutes(VACANCY_DAY_START_DEFAULT); a + step <= end; a += step) {
    const b = a + step;
    const overlaps = (x: { start: number; end: number }) => a < x.end - EPS && x.start < b - EPS;
    let working = 0;
    let free = 0;
    for (const p of people) {
      if (!p.slots.some(overlaps)) continue;
      working++;
      if (!p.busy.some(overlaps)) free++;
    }
    out.push({ start: a, working, free });
  }
  return out;
};

/** 開始時刻の連続した範囲の文（times の並びで隣どうしなら続ける。「14:00〜15:00」、1つだけなら「14:00」） */
function rangesText(starts: readonly number[], times: readonly number[]): string {
  const index = new Map(times.map((t, i) => [t, i]));
  const out: string[] = [];
  let first: number | null = null;
  let last: number | null = null;
  const flush = () => {
    if (first === null || last === null) return;
    out.push(first === last ? hm(first) : `${hm(first)}〜${hm(last)}`);
  };
  for (const t of [...starts].sort((a, b) => a - b)) {
    if (last !== null && index.get(t) === (index.get(last) ?? -2) + 1) {
      last = t;
      continue;
    }
    flush();
    first = t;
    last = t;
  }
  flush();
  return out.join('、');
}

/** 表示の曜日の順（月〜日） */
const NOTICE_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

/**
 * 空き枠の案内文（PRD D67。ADR-0013。design.md §4 vacancy）。
 * 'dates'：期間の中の数えた日（案の無い日を除く）ごとに、1人以上が受けられる開始時刻の連続した範囲（「・10/20（火） 14:00〜15:00」）。
 * 'weekly'：月〜日の順に、どの週も受けられる（○）開始時刻の範囲（「・火 14:00〜15:00」）。
 * 1行目に事業所名と何の案内か、最後に目安である旨。範囲が1つも無ければ空きが無い文
 */
export const vacancyNotice: VacancyNoticeFn = (result, input) => {
  const what = `${input.typeName ? `${input.typeName}（${input.durationMinutes}分）` : `${input.durationMinutes}分`}の訪問`;
  const period = `${monthDay(input.period.from)}〜${monthDay(input.period.to)}`;
  const lines: string[] = [];
  if (input.mode === 'dates') {
    const noPlan = new Set(result.noPlanDates);
    const dates = result.dates.filter((d) => d >= input.period.from && d <= input.period.to && !noPlan.has(d));
    for (const date of dates) {
      const wd = weekday(date);
      const cutoff = input.notBefore?.date === date ? input.notBefore.minutes : null;
      const starts = result.cells
        .filter((c) => c.weekday === wd && c.byDate.some((x) => x.date === date && x.staffIds.length > 0))
        .map((c) => c.start)
        .filter((t) => cutoff === null || t >= cutoff);
      if (starts.length > 0)
        lines.push(`・${monthDay(date)}（${WEEKDAY_LABELS[wd]}） ${rangesText(starts, result.times)}`);
    }
  } else {
    for (const wd of NOTICE_WEEKDAYS) {
      const cells = result.cells.filter((c) => c.weekday === wd && verdictOf(c) === 'ok');
      const starts = cells.map((c) => c.start);
      if (starts.length === 0) continue;
      // 案のある週がその曜日の週の数より少なければ「毎週」と言い切らず「〇週中〇週」と書く
      const weeks = result.dates.filter((d) => weekday(d) === wd).length;
      const counted = cells[0]!.weeksTotal;
      const note = counted < weeks ? `（${weeks}週中${counted}週の予定で確認）` : '';
      lines.push(`・${WEEKDAY_LABELS[wd]} ${rangesText(starts, result.times)}${note}`);
    }
  }
  const head =
    input.mode === 'dates'
      ? `${input.orgName}です。${period}に、${what}をお受けできる開始の時間をご案内します。`
      : `${input.orgName}です。${period}の毎週、続けて${what}をお受けできる開始の時間をご案内します。`;
  if (lines.length === 0) {
    return `${head}\nいまはご案内できる空きがありません。ご希望の曜日・時間があれば、お問い合わせください。`;
  }
  const note = input.exact
    ? '開始の時間の目安です。'
    : '開始の時間の目安です（移動の時間などで変わることがあります）。';
  return [head, ...lines, `${note}新しい${input.terms.client}のご相談は、お気軽にお問い合わせください。`].join('\n');
};
