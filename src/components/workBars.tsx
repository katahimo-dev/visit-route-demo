// 稼働の見込み（PRD D72。ADR-0015）の横棒。拘束の長さ・時間帯を見せる。
// 次の弾で「訪問・移動・待ち」の3段のバーに差し替える予定なので、見込み（WorkStat）を受け取る部品として分けておく
import type { WorkStat } from '../lib/workload';

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

/** 時間軸の上の拘束の横棒（日ごとの行用）：最初の訪問の開始〜最後の訪問の終わり。range は軸の範囲（分） */
export function SpanBar({ stat, range }: { stat: WorkStat; range: { start: number; end: number } }) {
  const len = Math.max(1, range.end - range.start);
  const left = Math.max(0, (stat.start - range.start) / len);
  const right = Math.min(1, (stat.end - range.start) / len);
  return (
    <span className={`work-bar${stat.over ? ' is-over' : ''}`} aria-hidden="true">
      <span
        className="work-bar-fill"
        style={{ left: `${left * 100}%`, width: `${Math.max(0, right - left) * 100}%` }}
      />
    </span>
  );
}
