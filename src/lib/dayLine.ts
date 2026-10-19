// 日の画面の1行のまとめの下の「担当ごとの1日」（PRD D84。design.md §4 pages「第5弾」）。
// 担当ごとに、勤務の時間帯（欠勤を差し引いた稼働時間帯）と今の案の 訪問・移動・待ち の区間を1行の横棒にする材料。
// 区間の塗り分けは稼働の見込み（PRD D77。lib/staffBar の spanParts）と同じ言葉で、自宅からの移動も「移動」で足す
// （拘束には入れないが、空いているかを見るため）。純粋関数（データは書き換えない）
import type { Problem } from '../contracts/problem';
import { timeText } from '../domain/availability';
import { minutesToHhmm } from '../domain/time';
import { scheduleRoute } from '../matching';
import { BAR_END, BAR_START } from './barRows';
import { own } from './common';
import { type RoutePart, type Span, spanParts } from './staffBar';

export type DayLine = {
  staffId: string;
  /** 担当の件数 */
  count: number;
  /** 勤務の時間帯（欠勤を差し引いた稼働時間帯。0時からの分） */
  shift: Span[];
  /** 欠勤の時間（欠勤を差し引く前の稼働時間帯のうち、勤務の時間帯に無い分。休みの淡い灰で塗る） */
  rest: Span[];
  /** 時間軸の上の区間（自宅からの移動・訪問・移動・待ち。時刻の順） */
  parts: RoutePart[];
  /** 訪問の区間と訪問ID（時刻の順。横棒の訪問を押してその訪問を選ぶため） */
  visits: (Span & { visitId: string })[];
  /** 分：訪問・移動（自宅からを含む）・待ち */
  visit: number;
  travel: number;
  wait: number;
  /** 分：勤務の時間帯のうち、どの区間にも掛からない時間（空き） */
  free: number;
};

const sum = (xs: readonly Span[]) => xs.reduce((m, x) => m + Math.max(0, x.end - x.start), 0);

/** base から cut を差し引いた区間（時刻の順） */
export function subtractSpans(base: readonly Span[], cut: readonly Span[]): Span[] {
  let out: Span[] = base.map((x) => ({ start: x.start, end: x.end }));
  for (const c of cut) {
    out = out.flatMap((x) => {
      if (c.end <= x.start || c.start >= x.end) return [x];
      return [
        ...(c.start > x.start ? [{ start: x.start, end: c.start }] : []),
        ...(c.end < x.end ? [{ start: c.end, end: x.end }] : []),
      ];
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 勤務の時間帯から区間を差し引いた残り（空き）の長さ（分） */
function freeMinutes(shift: readonly Span[], parts: readonly Span[]): number {
  let total = 0;
  for (const s of shift) {
    // その勤務の時間帯に掛かる区間を始まりの順に重ねて、覆われた分を引く
    const xs = parts
      .map((p) => ({ start: Math.max(s.start, p.start), end: Math.min(s.end, p.end) }))
      .filter((p) => p.end > p.start)
      .sort((a, b) => a.start - b.start);
    let covered = 0;
    let at = s.start;
    for (const p of xs) {
      const a = Math.max(at, p.start);
      if (p.end > a) {
        covered += p.end - a;
        at = p.end;
      }
    }
    total += s.end - s.start - covered;
  }
  return total;
}

/**
 * 担当ごとの1日（staffIds の順。問題にいない人は勤務なし・件数0）。routes は今の案の列（担当 → 訪問ID）。
 * baseOf はその人の欠勤を差し引く前の稼働時間帯（分。無ければ欠勤の時間を出さない）。欠勤の時間に残った訪問は訪問で出す。
 * 時刻は lenient の scheduleRoute（日の画面の時間軸と同じ）
 */
export function dayLines(
  problem: Problem,
  routes: Readonly<Record<string, readonly string[]>>,
  staffIds: readonly string[],
  baseOf?: (staffId: string) => readonly Span[],
): DayLine[] {
  const vIndex = new Map(problem.visits.map((v, i) => [v.id, i]));
  return staffIds.map((sid) => {
    const si = problem.staff.findIndex((x) => x.id === sid);
    const shift = si >= 0 ? problem.staff[si]!.slots.map((x) => ({ start: x.start, end: x.end })) : [];
    const ids = own(routes as Record<string, string[]>, sid) ?? [];
    const seq = ids.map((id) => vIndex.get(id)).filter((x): x is number => x !== undefined);
    const t = si >= 0 && seq.length > 0 ? scheduleRoute(problem, si, seq, 'lenient') : null;
    const stops = t?.stops ?? [];
    const first = stops[0];
    const parts: RoutePart[] = [
      ...(first && first.travelIn > 0
        ? [{ kind: 'travel' as const, start: first.start - first.travelIn, end: first.start }]
        : []),
      ...spanParts(stops),
    ];
    const of = (kind: RoutePart['kind']) => sum(parts.filter((p) => p.kind === kind));
    return {
      staffId: sid,
      count: stops.length,
      shift,
      rest: baseOf ? subtractSpans(baseOf(sid), shift) : [],
      parts,
      visits: stops.map((x) => ({ visitId: x.visitId, start: x.start, end: x.end })),
      visit: of('visit'),
      travel: of('travel'),
      wait: of('wait'),
      free: freeMinutes(shift, parts),
    };
  });
}

/** 横棒の時間軸（分）：8〜20時（3段バーと同じ範囲）。勤務・区間がはみ出せば1時間単位で広げる */
export function dayLineRange(lines: readonly DayLine[]): { start: number; end: number } {
  let start = BAR_START;
  let end = BAR_END;
  for (const x of lines) {
    for (const s of [...x.shift, ...x.rest, ...x.parts]) {
      start = Math.min(start, Math.floor(s.start / 60) * 60);
      end = Math.max(end, Math.ceil(s.end / 60) * 60);
    }
  }
  return { start: Math.max(0, start), end };
}

const clock = (m: number) => timeText(minutesToHhmm(Math.round(m)));
/** 「1時間20分」「40分」 */
const len = (m: number) => {
  const r = Math.round(m);
  const h = Math.floor(r / 60);
  return h > 0 ? `${h}時間${r % 60 > 0 ? `${r % 60}分` : ''}` : `${r}分`;
};

/**
 * title・読み上げの文。例「4件・勤務 8:00〜18:00・訪問 9:00〜15:30（訪問 3時間・移動 40分・待ち 1時間）・空き 5時間」。
 * 勤務の無い人は「勤務なし」、訪問の無い人は「訪問なし」
 */
export function dayLineText(x: DayLine): string {
  const shift =
    x.shift.length > 0 ? `勤務 ${x.shift.map((s) => `${clock(s.start)}〜${clock(s.end)}`).join('、')}` : '勤務なし';
  if (x.count === 0) return `0件・${shift}・訪問なし`;
  const visits = x.parts.filter((p) => p.kind === 'visit');
  const from = Math.min(...visits.map((p) => p.start));
  const to = Math.max(...visits.map((p) => p.end));
  const inner = [
    `訪問 ${len(x.visit)}`,
    `移動 ${len(x.travel)}`,
    ...(x.wait > 0 ? [`空き時間（待ち） ${len(x.wait)}`] : []),
  ].join('・');
  return `${x.count}件・${shift}・訪問 ${clock(from)}〜${clock(to)}（${inner}）・空き ${len(x.free)}`;
}
