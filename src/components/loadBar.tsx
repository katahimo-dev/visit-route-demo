// 日の混み具合バー（PRD D54。3段は D60・区切りは D82＝lib/barRows・見た目は D85）と種類ごとの件数の積み上げバー（D53）。
// 月間カレンダーの日のマスで使う。色だけに頼らない：空き 0人は段いっぱい・1人は2/3・2人以上は1/3の高さ（下にそろえる）、
// 30分ごとの title と、まとめた読み上げの文（loadSummary）を出す
import './barMarks.css';
import './loadBar.css';
import type { VisitType } from '../contracts/documents';
import type { DayLoadSlot } from '../contracts/vacancy';
import { timeText } from '../domain/availability';
import { minutesToHhmm } from '../domain/time';
import {
  BAR_ROWS,
  BAR_STEP,
  type BarEdgeTexts,
  type BarSide,
  barRowsOf,
  inBar,
  loadEdgeTexts,
  rowRuns,
  withEdges,
} from '../lib/barRows';
import { colorOf } from '../lib/colors';

/** 30分の色の段階：働く人がいない／空き 0人／1人／2人以上 */
export type LoadLevel = 'off' | 'none' | 'one' | 'many';

export function loadLevel(x: Pick<DayLoadSlot, 'working' | 'free'>): LoadLevel {
  if (x.working === 0) return 'off';
  if (x.free === 0) return 'none';
  if (x.free === 1) return 'one';
  return 'many';
}

const STEP = BAR_STEP;
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

/** 段の両端の時刻（「8」「12」。読み上げは外のまとめの文で出すので隠す） */
export function RowEdge({ hour }: { hour: number }) {
  return (
    <span className="load-row-edge" aria-hidden="true">
      {hour}
    </span>
  );
}

/**
 * 8時より前・20時以降がある印（PRD D82）。段の端の時刻の代わりに「◀」「▶」の文字（色だけに頼らない）。
 * title に時刻と中身（読み上げはバーのまとめの文に足すので、ここは隠す）
 */
export function EdgeMark({ side, title }: { side: BarSide; title: string }) {
  return (
    <span
      className={`load-row-edge is-mark is-${side}`}
      title={title}
      aria-hidden="true"
      data-testid={`bar-edge-${side}`}
    >
      {side === 'early' ? '◀' : '▶'}
    </span>
  );
}

/** 段の左右の端：8時より前・20時以降の印があればそれ、無ければ時刻 */
function Edge({ hour, side, title }: { hour: number; side: BarSide; title: string | null }) {
  return title ? <EdgeMark side={side} title={title} /> : <RowEdge hour={hour} />;
}

/** 3段バーの30分のマス1つ（level は CSS の is-〈level〉。title はマウスを乗せたときの文） */
export type BarSlot = { start: number; level: string; title: string };

/**
 * 段1つの中身（PRD D85）：同じ状態が続く30分を1本の連続した塗り（.bar-seg。時刻に比例した位置と幅）にまとめて描き、
 * その上に透明な30分のマス（.load-slot。title だけ）を並べる。1時間ごとの区切りは .bar-hours の細い隙間
 */
function RowTrack({ slots, from, to }: { slots: readonly BarSlot[]; from: number; to: number }) {
  return (
    <span className="load-row-slots bar-hours">
      {rowRuns(slots, from, to).map((r) => (
        <span
          key={r.left}
          className={`bar-seg is-${r.level}`}
          style={{ left: `${r.left * 100}%`, width: `${r.width * 100}%` }}
          aria-hidden="true"
        />
      ))}
      {slots.map((x) => (
        <span key={x.start} className={`load-slot is-${x.level}`} title={x.title} />
      ))}
    </span>
  );
}

/**
 * 3段バー（PRD D60・D82・D85。D75〜D77 で〈スタッフ〉の状態にも使う共通の部品）。段ごとに 4時間を1時間ずつ4ブロックにし、
 * 中身は時刻に比例した連続の塗り（30分のマスは title だけ）。左右の端に段の開始・終了の時刻を小さく出す。
 * slots が null なら空の枠と emptyText（title・読み上げ）。読み上げは label（まとめの文）に端の印の文を足したもの。
 * マスの大きさは親の幅に合わせて縮む（月のマス・週の表のマス）。edges：8時より前・20時以降の印の title（無ければ時刻を出す）。
 * cover：3段の上に1枚で重ねる文字（〈スタッフ〉の3段とも休みの日の「休み」。3段が細切れに見えないように）
 */
export function SlotBar({
  slots,
  label,
  emptyText,
  testId,
  edges,
  cover,
}: {
  slots: readonly BarSlot[] | null;
  label: string;
  emptyText: string;
  testId: string;
  edges?: BarEdgeTexts;
  cover?: string;
}) {
  if (slots === null) {
    return (
      <span className="load-bar is-empty" title={emptyText} data-testid={testId}>
        {BAR_ROWS.map(([a, b]) => (
          <span key={a} className="load-row">
            <RowEdge hour={a} />
            <span className="load-row-slots bar-hours" />
            <RowEdge hour={b} />
          </span>
        ))}
        <span className="sr-only">{emptyText}</span>
      </span>
    );
  }
  return (
    <span className="load-bar" data-testid={testId} role="img" aria-label={withEdges(label, edges)}>
      {barRowsOf(slots).map((row, i, rows) => (
        <span key={row.from} className="load-row" data-testid="load-row">
          <Edge hour={row.from} side="early" title={i === 0 ? (edges?.early ?? null) : null} />
          <RowTrack slots={row.slots} from={row.from} to={row.to} />
          <Edge hour={row.to} side="late" title={i === rows.length - 1 ? (edges?.late ?? null) : null} />
        </span>
      ))}
      {cover && (
        <span className="load-bar-cover" aria-hidden="true" data-testid="bar-cover">
          {cover}
        </span>
      )}
    </span>
  );
}

/**
 * 混み具合バー（3段。PRD D60・D82）。マウスを乗せると「14:00〜14:30 空き 3人／働く 7人」、読み上げはまとめの文（loadSummary）。
 * 8時より前・20時以降に働く人がいれば端の印
 */
export function LoadBar({ load }: { load: readonly DayLoadSlot[] | null }) {
  return (
    <SlotBar
      slots={load ? load.map((x) => ({ start: x.start, level: loadLevel(x), title: loadSlotText(x) })) : null}
      label={load ? loadSummary(inBar(load)) : ''}
      emptyText={load ? '' : '案が無いので混み具合を数えていません'}
      testId="load-bar"
      edges={load ? loadEdgeTexts(load) : undefined}
    />
  );
}

/** 凡例の段の見本（3段と両端の時刻、1時間ずつの4ブロック。色は付けない） */
export function LoadRowsSample() {
  return (
    <span className="load-bar is-sample" aria-hidden="true">
      {BAR_ROWS.map(([a, b]) => (
        <span key={a} className="load-row">
          <RowEdge hour={a} />
          <span className="load-row-slots bar-hours" />
          <RowEdge hour={b} />
        </span>
      ))}
    </span>
  );
}

/** 凡例の見本1つ（段と同じ .bar-seg を小さな地に置く。高さ・枠の形も段と同じに見える） */
export function BarSwatch({ level }: { level: string }) {
  return (
    <span className="load-swatch" aria-hidden="true">
      <span className={`bar-seg is-${level}`} style={{ left: 0, right: 0 }} />
    </span>
  );
}

/** 凡例（色と高さの意味：0人は段いっぱい・1人は2/3・2人以上は1/3） */
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
          <BarSwatch level={level} />
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
