// 稼働の見込み（PRD D72。ADR-0015）の横棒。拘束の長さ・時間帯を見せる。
// 日ごとの行の横棒は、拘束の中の訪問・移動・待ちを、〈スタッフ〉の3段バー（components/staffBar）と同じ色・形で塗り分ける
// （PRD D77・D85。訪問＝濃い青、移動＝橙で高さ半分、待ち＝空きと同じ淡い緑に細い枠。1日の時間軸の上の位置が大事なので3段にはしない）
import './barMarks.css';
import './workBars.css';
import { timeText } from '../domain/availability';
import { minutesToHhmm } from '../domain/time';
import type { RoutePart, Span } from '../lib/staffBar';
import type { WorkStat } from '../lib/workload';

/** 内訳の種類 → 3段バーの状態の塗り（待ちは勤務内の空き） */
const PART_LEVEL: Record<RoutePart['kind'], string> = { visit: 'st-visit', travel: 'st-travel', wait: 'st-free' };
const PART_LABEL: Record<RoutePart['kind'], string> = { visit: '訪問', travel: '移動', wait: '待ち' };
const clock = (m: number) => timeText(minutesToHhmm(Math.round(m)));

/** 軸の中の正時（0時からの分）。両端は含まない（1時間の隙間の位置） */
function hoursInside(range: { start: number; end: number }): number[] {
  const out: number[] = [];
  for (let t = Math.floor(range.start / 60) * 60 + 60; t < range.end; t += 60) if (t > range.start) out.push(t);
  return out;
}

/** 横棒の目盛りの最大（時間）。これを超える拘束は端で止める */
export const SPAN_SCALE_HOURS = 12;

/** 拘束の長さの横棒（表のマス用）。上限を超えると斜線と「!」（色だけに頼らない） */
export function SpanMini({ stat, limitHours }: { stat: WorkStat; limitHours: number }) {
  const w = Math.min(1, stat.span / (SPAN_SCALE_HOURS * 60));
  const limit = limitHours > 0 ? Math.min(1, limitHours / SPAN_SCALE_HOURS) : null;
  return (
    <span className={`work-mini${stat.over ? ' is-over' : ''}`} aria-hidden="true">
      <span className="work-mini-fill" style={{ width: `${w * 100}%` }} />
      {limit !== null && <span className="work-mini-limit" style={{ left: `${limit * 100}%` }} />}
    </span>
  );
}

/**
 * 時間軸の上の拘束の横棒（日ごとの行用）：最初の訪問の開始〜最後の訪問の終わりを、訪問・移動・待ちに塗り分ける。
 * range は軸の範囲（分）。上限を超える日は外枠（色に加えて行の「!」と文字。色だけに頼らない）
 */
export function SpanBar({ stat, range }: { stat: WorkStat; range: { start: number; end: number } }) {
  return (
    <PartsBar
      parts={stat.parts}
      range={range}
      frame={{ start: stat.start, end: stat.end }}
      className={stat.over ? 'is-over' : ''}
    />
  );
}

/**
 * 時間軸の上の区間の横棒（稼働の見込みの SpanBar と、日の画面の担当ごとの1日（PRD D84）で共通）。
 * parts を訪問・移動・待ちの塗り（components/barMarks.css の .bar-seg）で描く。shift（勤務の時間帯）があれば、その下地を空きで塗り、
 * rest（欠勤の時間）は休み（勤務外は棒の地の薄い灰）。区間は下地の上に描く（欠勤の時間に残った訪問も訪問で見える）。
 * frame があれば拘束の枠。読み上げは使う側の文で出すので、棒は隠す
 */
export function PartsBar({
  parts,
  range,
  shift,
  rest,
  frame,
  className = '',
}: {
  parts: readonly RoutePart[];
  range: { start: number; end: number };
  shift?: readonly Span[];
  /** 欠勤の時間（休みの淡い灰。PRD D84 のレビュー・D85） */
  rest?: readonly Span[];
  frame?: Span;
  className?: string;
}) {
  const len = Math.max(1, range.end - range.start);
  const pos = (m: number) => Math.min(1, Math.max(0, (m - range.start) / len));
  const at = (x: Span) => {
    const a = pos(x.start);
    const b = pos(x.end);
    return { left: `${a * 100}%`, width: `${Math.max(0, b - a) * 100}%` };
  };
  return (
    <span className={`work-bar ${className}`} aria-hidden="true">
      {shift?.map((x) => (
        <span key={`shift-${x.start}`} className="work-part bar-seg is-st-free" style={at(x)} />
      ))}
      {rest?.map((x) => (
        <span
          key={`rest-${x.start}`}
          className="work-part bar-seg is-st-rest"
          style={at(x)}
          title={`${clock(x.start)}〜${clock(x.end)} 休み（欠勤）`}
        />
      ))}
      {parts.map((x) => (
        <span
          key={`${x.kind}-${x.start}`}
          className={`work-part bar-seg is-${PART_LEVEL[x.kind]}`}
          style={at(x)}
          title={`${clock(x.start)}〜${clock(x.end)} ${PART_LABEL[x.kind]}`}
        />
      ))}
      {/* 1時間ごとの区切り：境界の前後 1px の隙間（3段バーの .bar-hours と同じ。両端には描かない。PRD D85） */}
      {hoursInside(range).map((t) => (
        <span key={`hour-${t}`} className="work-hour" style={{ left: `calc(${pos(t) * 100}% - 1px)` }} />
      ))}
      {frame && <span className="work-bar-frame" style={at(frame)} />}
    </span>
  );
}
