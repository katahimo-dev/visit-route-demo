// 一目で分かる表示の部品（PRD D78〜D81）：段階の凡例、今月の準備の積み上げ、〈利用者さん〉の月の日ごとの点。
// 色だけに頼らない：模様（斜線・点々・縦線）・形（丸・三角・白抜き・四角）と、title・読み上げの文
import './glance.css';
import { WEEKDAY_LABELS } from '../lib/common';
import { type ClientDot, type PrepPart, prepParts } from '../lib/glance';
import type { MonthProgress } from '../lib/month';

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

const PREP_LABEL: Record<PrepPart['kind'], string> = {
  confirmed: '確定済み',
  planned: '案あり（未確定）',
  none: '案なし',
};

/** 今月の準備の積み上げ（D80）：訪問のある日を 確定済み・案あり（未確定）・案なし の日数で横に積む。数字も出す */
export function PrepBar({ progress }: { progress: Pick<MonthProgress, 'days' | 'planned' | 'confirmed'> }) {
  if (progress.days === 0) return null;
  const parts = prepParts(progress);
  const text = parts.map((x) => `${PREP_LABEL[x.kind]} ${x.days}日`).join('・');
  return (
    <div className="prep-bar-wrap" data-testid="prep-bar">
      <span
        className="prep-bar"
        role="img"
        aria-label={`今日以降の訪問のある日 ${progress.days}日：${text}（案あり（未確定）には未確定の変更ありの日も含む）`}
        title={text}
      >
        {parts
          .filter((x) => x.days > 0)
          .map((x) => (
            <span key={x.kind} className={`prep-part is-${x.kind}`} style={{ flexGrow: x.days }} />
          ))}
      </span>
      <span className="glance-legend" aria-hidden="true">
        {parts.map((x) => (
          <span key={x.kind} className="glance-legend-item">
            <span className={`glance-swatch is-${x.kind}`} />
            {PREP_LABEL[x.kind]} {x.days}日
          </span>
        ))}
        <span>（今日以降の訪問のある日。案あり（未確定）には未確定の変更ありの日も含む）</span>
      </span>
    </div>
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
