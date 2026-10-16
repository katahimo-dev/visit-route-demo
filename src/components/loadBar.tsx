// 日の混み具合バー（PRD D54）と種類ごとの件数の積み上げバー（D53）。月間カレンダーの日のマスで使う。
// 色だけに頼らない：空き 0人は斜線、マスごとの title と、まとめた読み上げの文（loadSummary）を出す
import './loadBar.css';
import type { VisitType } from '../contracts/documents';
import type { DayLoadSlot } from '../contracts/vacancy';
import { timeText } from '../domain/availability';
import { minutesToHhmm } from '../domain/time';
import { colorOf } from '../lib/colors';

/** 30分の色の段階：働く人がいない／空き 0人／1人／2人以上 */
export type LoadLevel = 'off' | 'none' | 'one' | 'many';

export function loadLevel(x: Pick<DayLoadSlot, 'working' | 'free'>): LoadLevel {
  if (x.working === 0) return 'off';
  if (x.free === 0) return 'none';
  if (x.free === 1) return 'one';
  return 'many';
}

const STEP = 30;
const hm = (t: number) => timeText(minutesToHhmm(t));

/** 「14:00〜14:30 空き 3人／働く 7人」 */
export function loadSlotText(x: DayLoadSlot): string {
  const range = `${hm(x.start)}〜${hm(x.start + STEP)}`;
  if (x.working === 0) return `${range} 働く人なし`;
  return `${range} 空き ${x.free}人／働く ${x.working}人`;
}

/** 読み上げのまとめ（空き 0人・1人の時間帯を続けてまとめる。例「空きなし 9:00〜10:30・空き1人 14:00〜15:00」） */
export function loadSummary(load: readonly DayLoadSlot[]): string {
  const parts: string[] = [];
  for (const [level, label] of [
    ['none', '空きなし'],
    ['one', '空き1人'],
  ] as const) {
    const ranges: string[] = [];
    let from: number | null = null;
    let to = 0;
    for (const x of [...load, null]) {
      if (x && loadLevel(x) === level) {
        if (from === null) from = x.start;
        to = x.start + STEP;
        continue;
      }
      if (from !== null) ranges.push(`${hm(from)}〜${hm(to)}`);
      from = null;
    }
    if (ranges.length > 0) parts.push(`${label} ${ranges.join('、')}`);
  }
  return parts.length > 0 ? `混み具合：${parts.join('・')}` : '混み具合：どの時間も空き2人以上か働く人なし';
}

/** 混み具合バー（1本。30分ごとのマス。マウスを乗せると「14:00〜14:30 空き 3人／働く 7人」） */
export function LoadBar({ load }: { load: readonly DayLoadSlot[] | null }) {
  if (load === null) {
    return (
      <span className="load-bar is-empty" title="案が無いので混み具合を数えていません" data-testid="load-bar">
        <span className="sr-only">混み具合：案が無いので数えていません</span>
      </span>
    );
  }
  return (
    <span className="load-bar" data-testid="load-bar" role="img" aria-label={loadSummary(load)}>
      {load.map((x) => (
        <span key={x.start} className={`load-slot is-${loadLevel(x)}`} title={loadSlotText(x)} />
      ))}
    </span>
  );
}

/** 目盛り（9・12・15・18）。from〜to（分）の帯の上の位置 */
export function LoadScale({ from, to, ticks = [9, 12, 15, 18] }: { from: number; to: number; ticks?: number[] }) {
  return (
    <span className="load-scale" aria-hidden="true">
      {ticks.map((h) => (
        <span key={h} className="load-tick" style={{ left: `${((h * 60 - from) / (to - from)) * 100}%` }}>
          {h}
        </span>
      ))}
    </span>
  );
}

/** 凡例（色と斜線の意味） */
export function LoadLegend() {
  const items: [LoadLevel, string][] = [
    ['none', '空き 0人'],
    ['one', '空き 1人'],
    ['many', '空き 2人以上'],
    ['off', '働く人なし'],
  ];
  return (
    <span className="load-legend">
      {items.map(([level, label]) => (
        <span key={level} className="load-legend-item">
          <span className={`load-swatch is-${level}`} aria-hidden="true" />
          {label}
        </span>
      ))}
    </span>
  );
}

/** 種類ごとの件数の積み上げバー（種類の色。種類なしは灰。title と読み上げに内訳） */
export function TypeStack({
  types,
  typeById,
}: {
  types: readonly { typeId: string | null; count: number }[];
  typeById: ReadonlyMap<string, VisitType>;
}) {
  const total = types.reduce((m, x) => m + x.count, 0);
  if (total === 0) return null;
  const nameOf = (id: string | null) => (id === null ? '種類なし' : (typeById.get(id)?.name ?? '種類なし'));
  const text = types.map((x) => `${nameOf(x.typeId)} ${x.count}件`).join('・');
  return (
    <span className="type-stack" title={text} role="img" aria-label={`種類：${text}`} data-testid="type-stack">
      {types.map((x) => {
        const t = x.typeId === null ? undefined : typeById.get(x.typeId);
        return (
          <span
            key={x.typeId ?? '__none'}
            className="type-stack-part"
            style={{ flexGrow: x.count, background: t ? colorOf(t.color) : '#cfc4bb' }}
          />
        );
      })}
    </span>
  );
}
