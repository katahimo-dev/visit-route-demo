// 稼働の見込み（PRD D72。ADR-0015）の横棒。拘束の長さ・時間帯を見せる。
// 日ごとの行の横棒は、拘束の中の訪問・移動・待ちを、〈スタッフ〉の3段バー（components/staffBar）と同じ色・模様で塗り分ける
// （PRD D77。訪問＝斜線、移動＝点々、待ち＝空きと同じ緑。1日の時間軸の上の位置が大事なので3段にはしない）
import './loadBar.css';
import './workBars.css';
import type { CSSProperties } from 'react';
import { timeText } from '../domain/availability';
import { minutesToHhmm } from '../domain/time';
import type { RoutePart, Span } from '../lib/staffBar';
import type { WorkStat } from '../lib/workload';

/** 内訳の種類 → 3段バーの状態の模様（待ちは勤務内の空き） */
const PART_LEVEL: Record<RoutePart['kind'], string> = { visit: 'st-visit', travel: 'st-travel', wait: 'st-free' };
const PART_LABEL: Record<RoutePart['kind'], string> = { visit: '訪問', travel: '移動', wait: '待ち' };
const clock = (m: number) => timeText(minutesToHhmm(Math.round(m)));

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
 * parts を訪問・移動・待ちの模様で塗る。shift（勤務の時間帯）があれば、その下地を空きの緑で塗る（勤務外は棒の地の薄い灰）。
 * frame があれば拘束の枠。読み上げは使う側の文で出すので、棒は隠す
 */
export function PartsBar({
  parts,
  range,
  shift,
  frame,
  className = '',
}: {
  parts: readonly RoutePart[];
  range: { start: number; end: number };
  shift?: readonly Span[];
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
    <span
      className={`work-bar ${className}`}
      style={{ '--hours': Math.max(1, Math.round(len / 60)) } as CSSProperties}
      aria-hidden="true"
    >
      {shift?.map((x) => (
        <span key={`shift-${x.start}`} className="work-part is-shift" style={at(x)} />
      ))}
      {parts.map((x) => (
        <span
          key={`${x.kind}-${x.start}`}
          className={`work-part is-${PART_LEVEL[x.kind]}`}
          style={at(x)}
          title={`${clock(x.start)}〜${clock(x.end)} ${PART_LABEL[x.kind]}`}
        />
      ))}
      {frame && <span className="work-bar-frame" style={at(frame)} />}
    </span>
  );
}
