// 稼働の見込み（PRD D72。ADR-0015）：予定（確定した割当、無ければ今の案）から、〈スタッフ〉×日ごとの
// 拘束・訪問・移動・待ちの分と、移動の距離・交通費を見込む。実績ではない（記録・勤怠はやらない。PRD §4）。
// 拘束＝最初の訪問の開始〜最後の訪問の終わり（直行直帰：自宅との行き帰りは拘束に入れず、距離・交通費には入れる）。
// 純粋関数（データは書き換えない）
import type { DemoData } from '../contracts/data';
import type { Problem } from '../contracts/problem';
import { NONE } from '../domain/scheduleModel';
import { type CompileInput, compile, scheduleRoute } from '../matching';
import { attempt, own } from './common';
import { monthDates } from './month';
import { type RoutePart, spanParts } from './staffBar';

/** 数える案の元：確定した割当／今の案 */
export type WorkSource = 'confirmed' | 'plan';

/** 〈スタッフ〉のその日の見込み（分。訪問が1件以上ある人だけ） */
export type WorkStat = {
  staffId: string;
  /** 訪問の件数 */
  count: number;
  /** 最初の訪問の開始・最後の訪問の終わり（0時からの分） */
  start: number;
  end: number;
  /** 拘束＝end − start（＝訪問＋移動＋待ち） */
  span: number;
  /** 訪問（所要の合計） */
  visit: number;
  /** 訪問のあいだの移動 */
  travel: number;
  /** 訪問のあいだの待ち（休憩に使える時間） */
  wait: number;
  /** 自宅との行き帰りの移動（拘束に入れない） */
  home: number;
  /** 移動の距離（m。自宅→訪問…→自宅。直線距離からの概算） */
  meters: number;
  /** 交通費（円。距離×単価を四捨五入） */
  fareYen: number;
  /** 拘束が上限を超える */
  over: boolean;
  /** 拘束の内訳（時間軸の上の訪問・移動・待ち。lib/staffBar の spanParts。PRD D77） */
  parts: RoutePart[];
};

export type WorkOptions = { fareYenPerKm: number; spanLimitHours: number };

/** 拘束の上限（分）。0 なら上限なし（null） */
export const spanLimitMinutes = (hours: number): number | null => (hours > 0 ? hours * 60 : null);

/** 拘束が上限を超えるか（上限なしなら false）。拘束は表示と同じく分に丸めてから比べる */
export const isOverSpan = (span: number, limitHours: number): boolean => {
  const limit = spanLimitMinutes(limitHours);
  return limit !== null && Math.round(span) > limit;
};

/** 交通費（円）：距離（m）×単価（円/km）を四捨五入 */
export const fareOf = (meters: number, fareYenPerKm: number): number => Math.round((meters / 1000) * fareYenPerKm);

/**
 * 担当ごとの列から見込みを出す（problem の〈スタッフ〉の順。訪問の無い人・問題に無い人・未割当の列は出さない）。
 * sortByStart なら列を訪問の開始（早）の順に並べ直す（確定した割当は順番を持たないため。印刷と同じ）。時刻は lenient
 */
export function workStats(
  problem: Problem,
  routes: Record<string, readonly string[]>,
  opts: WorkOptions,
  sortByStart = false,
): WorkStat[] {
  const vIndex = new Map(problem.visits.map((v, i) => [v.id, i]));
  const out: WorkStat[] = [];
  problem.staff.forEach((st, s) => {
    const ids = own(routes as Record<string, string[]>, st.id);
    if (!ids || st.id === NONE) return;
    let seq = ids.map((id) => vIndex.get(id)).filter((x): x is number => x !== undefined);
    if (seq.length === 0) return;
    if (sortByStart) seq = [...seq].sort((a, b) => problem.visits[a]!.earliest - problem.visits[b]!.earliest || a - b);
    const t = scheduleRoute(problem, s, seq, 'lenient');
    if (!t || t.stops.length === 0) return;
    const first = t.stops[0]!;
    const last = t.stops.at(-1)!;
    let visit = 0;
    let travel = 0;
    let wait = 0;
    t.stops.forEach((stop, k) => {
      visit += stop.end - stop.start;
      if (k > 0) {
        travel += stop.travelIn;
        wait += stop.wait;
      }
    });
    const span = last.end - first.start;
    out.push({
      staffId: st.id,
      count: t.stops.length,
      start: first.start,
      end: last.end,
      span,
      visit,
      travel,
      wait,
      home: t.travelMinutes - travel,
      meters: t.meters,
      fareYen: fareOf(t.meters, opts.fareYenPerKm),
      over: isOverSpan(span, opts.spanLimitHours),
      parts: spanParts(t.stops),
    });
  });
  return out;
}

/**
 * その日に数える案：確定した割当に、問題にある訪問の担当が1件以上あればそれ（開始（早）の順に並べ直す）、
 * 無ければ今の案、どちらも無ければ null（印刷の担当の決め方と同じ。ADR-0014）
 */
export function workRoutesOf(
  data: Pick<DemoData, 'manualPlans' | 'aiPlans'>,
  date: string,
  problem: Problem,
): { source: WorkSource; routes: Record<string, string[]> } | null {
  const live = new Set(problem.visits.map((v) => v.id));
  const saved = own(data.manualPlans, date);
  if (saved && Object.entries(saved).some(([k, ids]) => k !== NONE && ids.some((id) => live.has(id))))
    return { source: 'confirmed', routes: saved };
  const plan = own(data.aiPlans, date);
  return plan ? { source: 'plan', routes: plan.routes } : null;
}

export type WorkDay = { date: string; source: WorkSource | null; stats: WorkStat[] };

type WorkInput = CompileInput & Pick<DemoData, 'manualPlans' | 'aiPlans'>;

/** その日の見込み（problem を渡すとそれを使う。無ければその日の訪問だけで compile） */
export function workDayOf(data: WorkInput, date: string, problem?: Problem | null): WorkDay {
  const p =
    problem !== undefined
      ? problem
      : attempt(() => compile({ ...data, visits: data.visits.filter((v) => v.date === date) }, date)).value;
  if (!p) return { date, source: null, stats: [] };
  const r = workRoutesOf(data, date, p);
  if (!r) return { date, source: null, stats: [] };
  return { date, source: r.source, stats: workStats(p, r.routes, data.org, r.source === 'confirmed') };
}

/** 〈スタッフ〉の月の合計 */
export type WorkTotal = {
  staffId: string;
  /** 訪問のある日の数 */
  days: number;
  count: number;
  span: number;
  visit: number;
  travel: number;
  wait: number;
  home: number;
  meters: number;
  fareYen: number;
  /** 拘束の一番長い日の拘束（分） */
  maxSpan: number;
  /** 拘束が上限を超える日の数 */
  overDays: number;
};

const emptyTotal = (staffId: string): WorkTotal => ({
  staffId,
  days: 0,
  count: 0,
  span: 0,
  visit: 0,
  travel: 0,
  wait: 0,
  home: 0,
  meters: 0,
  fareYen: 0,
  maxSpan: 0,
  overDays: 0,
});

/** 月の合計（日ごとの見込みから。交通費は日ごとに四捨五入したものの合計） */
export function workTotals(days: readonly WorkDay[]): Map<string, WorkTotal> {
  const out = new Map<string, WorkTotal>();
  for (const d of days) {
    for (const x of d.stats) {
      const t = out.get(x.staffId) ?? emptyTotal(x.staffId);
      t.days++;
      t.count += x.count;
      t.span += x.span;
      t.visit += x.visit;
      t.travel += x.travel;
      t.wait += x.wait;
      t.home += x.home;
      t.meters += x.meters;
      t.fareYen += x.fareYen;
      t.maxSpan = Math.max(t.maxSpan, x.span);
      if (x.over) t.overDays++;
      out.set(x.staffId, t);
    }
  }
  return out;
}

/** その月（'YYYY-MM'）の日ごとの見込み。problemOf を渡すとその日の問題をそこから引く（画面が作ったものを使い回す） */
export function workMonth(
  data: WorkInput,
  ym: string,
  problemOf?: (date: string) => Problem | null | undefined,
): WorkDay[] {
  const byDate = new Map<string, DemoData['visits']>();
  for (const v of data.visits) {
    const list = byDate.get(v.date);
    if (list) list.push(v);
    else byDate.set(v.date, [v]);
  }
  return monthDates(ym).map((date) => {
    const visits = byDate.get(date) ?? [];
    if (!own(data.manualPlans, date) && !own(data.aiPlans, date)) return { date, source: null, stats: [] };
    if (!visits.some((v) => !v.cancelled)) return { date, source: null, stats: [] };
    const given = problemOf?.(date);
    return workDayOf({ ...data, visits }, date, given === undefined ? undefined : given);
  });
}

/** 分 → 「h:mm」（表・コピー用） */
export function hmText(minutes: number): string {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** 距離（m）→ km（小数1桁） */
export const kmOf = (meters: number): number => Math.round(meters / 100) / 10;

/**
 * 月の表をタブ区切りの文にする（表計算に貼る）。行＝〈スタッフ〉、列＝日（拘束 h:mm。超えるなら末尾に「!」）と月の合計。
 * 交通費は単価が 0 なら出さない
 */
export function workloadTsv(
  days: readonly WorkDay[],
  staff: readonly { id: string; name: string }[],
  opts: WorkOptions,
): string {
  const totals = workTotals(days);
  const fare = opts.fareYenPerKm > 0;
  const head = [
    '名前',
    ...days.map((d) => `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`),
    '日数',
    '拘束',
    '訪問',
    '移動',
    '待ち',
    '距離（km）',
    ...(fare ? ['交通費（円）'] : []),
    '上限超え（日）',
  ];
  const lines = [head.join('\t')];
  for (const s of staff) {
    const t = totals.get(s.id);
    if (!t) continue;
    const cells = days.map((d) => {
      const x = d.stats.find((y) => y.staffId === s.id);
      return x ? `${hmText(x.span)}${x.over ? '!' : ''}` : '';
    });
    lines.push(
      [
        s.name,
        ...cells,
        String(t.days),
        hmText(t.span),
        hmText(t.visit),
        hmText(t.travel),
        hmText(t.wait),
        String(kmOf(t.meters)),
        ...(fare ? [String(t.fareYen)] : []),
        String(t.overDays),
      ].join('\t'),
    );
  }
  return lines.join('\n');
}
