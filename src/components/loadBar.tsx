// 日の混み具合バー（PRD D54。3段は D60）と種類ごとの件数の積み上げバー（D53）。月間カレンダーの日のマスで使う。
// 色だけに頼らない：空き 0人は斜線・1人は点々、マスごとの title と、まとめた読み上げの文（loadSummary）を出す
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

/** 混み具合バーの段（PRD D60）：午前 07:00〜12:00・昼 12:00〜15:00・夕方 15:00〜20:00（時） */
export const LOAD_ROWS: readonly (readonly [number, number])[] = [
  [7, 12],
  [12, 15],
  [15, 20],
];

/** 30分のマスを段に分ける（開始が段の中のマスだけ。段の外のマスは捨てる） */
export function loadRows<T extends Pick<DayLoadSlot, 'start'>>(
  load: readonly T[],
  rows: readonly (readonly [number, number])[] = LOAD_ROWS,
): { from: number; to: number; slots: T[] }[] {
  return rows.map(([a, b]) => ({
    from: a,
    to: b,
    slots: load.filter((x) => x.start >= a * 60 && x.start < b * 60),
  }));
}

/** 段の両端の時刻（「7」「12」。読み上げは外のまとめの文で出すので隠す） */
function RowEdge({ hour }: { hour: number }) {
  return (
    <span className="load-row-edge" aria-hidden="true">
      {hour}
    </span>
  );
}

/** 3段バーの30分のマス1つ（level は CSS の is-〈level〉。title はマウスを乗せたときの文） */
export type BarSlot = { start: number; level: string; title: string };

/**
 * 3段バー（PRD D60。D75〜D77 で〈スタッフ〉の状態にも使う共通の部品）。段ごとに30分のマスを横いっぱいに並べ、
 * 左右の端に段の開始・終了の時刻を小さく出す。slots が null なら空の枠と emptyText（title・読み上げ）。
 * 読み上げは label（まとめの文）。マスの大きさは親の幅に合わせて縮む（月のマス・週の表のマス）
 */
export function SlotBar({
  slots,
  label,
  emptyText,
  testId,
}: {
  slots: readonly BarSlot[] | null;
  label: string;
  emptyText: string;
  testId: string;
}) {
  if (slots === null) {
    return (
      <span className="load-bar is-empty" title={emptyText} data-testid={testId}>
        {LOAD_ROWS.map(([a, b]) => (
          <span key={a} className="load-row">
            <RowEdge hour={a} />
            <span className="load-row-slots" />
            <RowEdge hour={b} />
          </span>
        ))}
        <span className="sr-only">{emptyText}</span>
      </span>
    );
  }
  return (
    <span className="load-bar" data-testid={testId} role="img" aria-label={label}>
      {loadRows(slots).map((row) => (
        <span key={row.from} className="load-row" data-testid="load-row">
          <RowEdge hour={row.from} />
          <span className="load-row-slots">
            {row.slots.map((x) => (
              <span key={x.start} className={`load-slot is-${x.level}`} title={x.title} />
            ))}
          </span>
          <RowEdge hour={row.to} />
        </span>
      ))}
    </span>
  );
}

/**
 * 混み具合バー（3段。PRD D60）。マウスを乗せると「14:00〜14:30 空き 3人／働く 7人」、読み上げはまとめの文（loadSummary）
 */
export function LoadBar({ load }: { load: readonly DayLoadSlot[] | null }) {
  return (
    <SlotBar
      slots={load ? load.map((x) => ({ start: x.start, level: loadLevel(x), title: loadSlotText(x) })) : null}
      label={load ? loadSummary(load) : ''}
      emptyText={load ? '' : '案が無いので混み具合を数えていません'}
      testId="load-bar"
    />
  );
}

/** 凡例の段の見本（3段と両端の時刻。色は付けない） */
export function LoadRowsSample() {
  return (
    <span className="load-bar is-sample" aria-hidden="true">
      {LOAD_ROWS.map(([a, b]) => (
        <span key={a} className="load-row">
          <RowEdge hour={a} />
          <span className="load-row-slots">
            {Array.from({ length: (b - a) * 2 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 見本のマスは並びが変わらない
              <span key={i} className="load-slot is-sample" />
            ))}
          </span>
          <RowEdge hour={b} />
        </span>
      ))}
    </span>
  );
}

/** 凡例（色と模様の意味：0人は斜線・1人は点々） */
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
