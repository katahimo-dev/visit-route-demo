// 週間の〈利用者さん〉×曜日のマスの3段の帯（PRD D83。区切りは lib/barRows＝混み具合バー・〈スタッフ〉の3段バーと同じ）。
// 訪問をその時刻の位置に種類の色で置き、下に担当の短い名前などを時刻の順に小さく出す。
// 印は形と文字で分ける（色だけにしない）：休み＝淡い灰の無地＋「休」、取り消し＝白抜きの枠＋「取消」「当日取消」、
// 担当なし＝白地に赤い太枠＋「担当なし」、いつもの担当でない＝「代」。
// 1段＝1時間ずつ4ブロック（隙間は帯の下の地にだけ描き、短い帯を割らない。PRD D85）。
// 訪問の帯（段の最初の切れ端）と、段に掛からない訪問の端の「◀」「▶」は、画面が渡すボタン（押す・Enter・ドラッグ）
import './barMarks.css';
import './loadBar.css';
import './clientBar.css';
import { type CSSProperties, Fragment, type ReactNode } from 'react';
import { BAR_ROWS, type BarSide, edgeLabel, placeOnRows } from '../lib/barRows';
import { type ClientItemKind, type ClientWeekItem, clientLanes } from '../lib/week';
import { EdgeMark, RowEdge } from './loadBar';

/** 訪問1件の見た目（kind の印と、帯の色＝種類の色） */
export type ClientBarMark = { kind: ClientItemKind; short: string; text: string; color: string };

/** 画面が描くボタンへ渡す置き場所：style（位置と色）・className（印）。edge は端の「◀」「▶」のとき */
export type ClientBarPlace = { style: CSSProperties; className: string; edge: BarSide | null };

export function ClientDayBar({
  items,
  markOf,
  marksOf,
  timeText,
  renderItem,
}: {
  items: readonly ClientWeekItem[];
  markOf: (it: ClientWeekItem) => ClientBarMark;
  /** 担当の名前のあとに置く帯の印（共通の VisitMarks。要対応・未連絡の変更・ピンなど） */
  marksOf?: (it: ClientWeekItem) => ReactNode;
  /** 「9:00〜10:00」 */
  timeText: (it: ClientWeekItem) => string;
  renderItem: (it: ClientWeekItem, place: ClientBarPlace) => ReactNode;
}) {
  const { pieces, early, late, outside } = placeOnRows(items);
  // 時刻が重なる帯は段の中で上下に分ける。取り消し・休みは下のレーンで、先に描く（本物の訪問を上に）
  const lanes = clientLanes(items);
  const passive = (it: ClientWeekItem) => !!it.cancelled || !!it.leave;
  const ordered = [...pieces].sort((a, b) => Number(passive(b.item)) - Number(passive(a.item)));
  const marks = new Map(items.map((it) => [it.visitId, markOf(it)]));
  const classOf = (it: ClientWeekItem) => `cbar-item is-${marks.get(it.visitId)!.kind}`;
  const colorVar = (it: ClientWeekItem) => ({ '--tc': marks.get(it.visitId)!.color }) as CSSProperties;
  const edgeTitle = (side: BarSide, xs: readonly ClientWeekItem[]) =>
    `${edgeLabel(side)}：${xs.map((it) => `${timeText(it)} ${marks.get(it.visitId)!.text}`).join('、')}`;
  /** 段の端：段に掛からない訪問はボタン、はみ出すだけなら印、無ければ時刻 */
  const edge = (side: BarSide, hour: number) => {
    const out = outside.filter((it) => (side === 'early' ? early : late).includes(it));
    const xs = side === 'early' ? early : late;
    if (out.length > 0) {
      // 段にはみ出すだけの訪問（ボタンは段の中）も、端の title と読み上げに時刻を出す
      const partial = xs.filter((it) => !out.includes(it));
      return (
        <span className={`cbar-edge is-${side}`} title={edgeTitle(side, xs)}>
          {out.map((it) => (
            <Fragment key={it.visitId}>
              {renderItem(it, { style: colorVar(it), className: `${classOf(it)} is-edge`, edge: side })}
            </Fragment>
          ))}
          {partial.length > 0 && <span className="sr-only">{edgeTitle(side, partial)}</span>}
        </span>
      );
    }
    if (xs.length > 0) return <EdgeMark side={side} title={edgeTitle(side, xs)} />;
    return <RowEdge hour={hour} />;
  };
  // 帯の下の短い文字：時刻の順
  const names = items.map((it) => {
    const mk = marks.get(it.visitId)!;
    return { id: it.visitId, kind: mk.kind, short: mk.short, sub: !!it.substitute, item: it };
  });
  return (
    <span className="cbar">
      <span className="load-bar cbar-bar">
        {BAR_ROWS.map(([a, b], row) => (
          <span key={a} className="load-row">
            {row === 0 ? edge('early', a) : <RowEdge hour={a} />}
            <span className="cbar-track bar-hours">
              {ordered
                .filter((p) => p.row === row)
                .map((p) => {
                  const lane = lanes.get(p.item.visitId) ?? { lane: 0, lanes: 1 };
                  const style = {
                    ...colorVar(p.item),
                    left: `${p.left * 100}%`,
                    width: `${p.width * 100}%`,
                    top: `${(lane.lane / lane.lanes) * 100}%`,
                    height: `${100 / lane.lanes}%`,
                    // 重なりの順（CSS の z-index。フォーカス中は CSS で一番上へ）
                    '--cz': passive(p.item) ? 0 : 1,
                  } as CSSProperties;
                  return p.first ? (
                    <Fragment key={p.item.visitId}>
                      {renderItem(p.item, { style, className: classOf(p.item), edge: null })}
                    </Fragment>
                  ) : (
                    // 段をまたぐ訪問の続き（押せない。読み上げは最初の帯で）
                    <span
                      key={`${p.item.visitId}-${row}`}
                      className={`${classOf(p.item)} is-cont`}
                      style={style}
                      aria-hidden="true"
                    />
                  );
                })}
            </span>
            {row === BAR_ROWS.length - 1 ? edge('late', b) : <RowEdge hour={b} />}
          </span>
        ))}
      </span>
      {names.length > 0 && (
        <span className="cbar-names" aria-hidden="true">
          {names.map((n) => (
            <span key={n.id} className={`cbar-name is-${n.kind}`}>
              {n.short}
              {n.sub && <span className="cbar-sub">代</span>}
              {marksOf && n.item && marksOf(n.item)}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/** 凡例（帯の印と下の文字の意味）。見本の帯の色は灰（種類の色は種類ごと）。clientTerm は org.terms.client */
export function ClientBarLegend({ clientTerm }: { clientTerm: string }) {
  const items: [ClientItemKind, string][] = [
    ['visit', '訪問（種類の色。下に担当）'],
    ['unassigned', '担当なし'],
    ['leave', `休（${clientTerm}の休み）`],
    ['cancelled', '取消'],
    ['sameDay', '当日取消'],
  ];
  return (
    <span className="load-legend" data-testid="client-bar-legend">
      {items.map(([kind, label]) => (
        <span key={kind} className="load-legend-item">
          <span
            className={`cbar-swatch cbar-item is-${kind}`}
            style={{ '--tc': '#8c7f74' } as CSSProperties}
            aria-hidden="true"
          />
          {label}
        </span>
      ))}
      <span className="load-legend-item">
        <span className="cbar-sub">代</span>いつもの担当でない
      </span>
    </span>
  );
}
