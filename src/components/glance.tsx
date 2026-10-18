// 一目で分かる表示の部品（PRD D78〜D81）：段階の凡例、〈利用者さん〉の月の日ごとの点。
// （今月の準備の積み上げ PrepBar は進み具合の帯（components/progressBand。PRD D154）にまとめて消した。色の CSS .prep-bar・.prep-part は帯が使う）
// 色だけに頼らない：文字（○△×？・数字）・枠（0人の濃い枠・案なしの破線）・形（丸・三角・白抜き・四角）と、title・読み上げの文。
// 色の言葉は3段バーと同じ components/barMarks.css（PRD D85。柄は使わない）
import './barMarks.css';
import './glance.css';
import { WEEKDAY_LABELS } from '../lib/common';
import type { ClientDot } from '../lib/glance';

/** 段階の凡例（class は lv-〈段階〉） */
export function LevelLegend({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <span className="glance-legend" data-testid="level-legend">
      {items.map(([level, label]) => (
        <span key={level} className="glance-legend-item">
          <span className={`glance-swatch lv-${level}`} aria-hidden="true" />
          {label}
        </span>
      ))}
    </span>
  );
}

export const CLIENT_DOT_LABEL: Record<ClientDot, string> = {
  visit: '訪問あり',
  sameDay: '当日キャンセル',
  cancelled: '取り消し',
  leave: '休み',
  none: '訪問なし',
};
const DOT_ORDER: readonly ClientDot[] = ['visit', 'sameDay', 'cancelled', 'leave', 'none'];

/**
 * 〈利用者さん〉の月の日ごとの点（D81）。weeks はカレンダーの週（日曜はじまり）、ym の月でない日は空ける。
 * 読み上げは種類ごとの日数のまとめ、点ごとに title（「10/3 訪問あり」）
 */
export function ClientDots({
  weeks,
  ym,
  dotOf,
}: {
  weeks: readonly (readonly string[])[];
  ym: string;
  dotOf: (date: string) => ClientDot;
}) {
  const counts = new Map<ClientDot, number>();
  for (const w of weeks) for (const d of w) if (d.startsWith(ym)) counts.set(dotOf(d), (counts.get(dotOf(d)) ?? 0) + 1);
  const summary = DOT_ORDER.filter((k) => (counts.get(k) ?? 0) > 0)
    .map((k) => `${CLIENT_DOT_LABEL[k]} ${counts.get(k)}日`)
    .join('・');
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="client-dots" role="img" aria-label={`日ごと：${summary}`} data-testid="client-dots">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className="client-dots-head" aria-hidden="true">
            {w}
          </span>
        ))}
        {weeks.flat().map((d) => {
          if (!d.startsWith(ym)) return <span key={d} className="client-dot-cell" aria-hidden="true" />;
          const k = dotOf(d);
          return (
            <span
              key={d}
              className="client-dot-cell"
              title={`${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} ${CLIENT_DOT_LABEL[k]}`}
              data-dot={k}
            >
              <span className={`client-dot is-${k}`} aria-hidden="true" />
            </span>
          );
        })}
      </div>
      <span className="glance-legend" aria-hidden="true">
        {DOT_ORDER.map((k) => (
          <span key={k} className="glance-legend-item">
            <span className={`client-dot is-${k}`} />
            {CLIENT_DOT_LABEL[k]}
          </span>
        ))}
      </span>
    </div>
  );
}
