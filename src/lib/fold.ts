// チップの欄を畳む決まり（週間の時間軸の〈利用者さん〉。PRD D140。design.md §4 pages「週間の時間軸の〈利用者さん〉の初期値」）

/** 並べた項目の位置（上端の px）。並びの順 */
export type FoldItem = { id: string; top: number };

/** 同じ行と見る上端のずれ（px） */
const ROW_TOLERANCE = 4;

/**
 * 畳んだとき隠す項目：上から rows 行に入らない項目のうち keep（選んでいる人）でないもの。
 * 行は上端の位置で分ける（ずれ ROW_TOLERANCE 以内は同じ行）。行の数え方の基準 firstTop を渡せば、それより上（見出しの行）も1行目に数える
 */
export function foldHidden(
  items: readonly FoldItem[],
  keep: ReadonlySet<string>,
  rows: number,
  firstTop?: number,
): Set<string> {
  const tops: number[] = firstTop === undefined ? [] : [firstTop];
  for (const it of [...items].sort((a, b) => a.top - b.top)) {
    if (!tops.some((t) => Math.abs(t - it.top) <= ROW_TOLERANCE) && !(tops.length > 0 && it.top < tops[0]!))
      tops.push(it.top);
  }
  tops.sort((a, b) => a - b);
  const rowOf = (top: number) => {
    let r = 0;
    for (let i = 0; i < tops.length; i++) if (top >= tops[i]! - ROW_TOLERANCE) r = i;
    return r;
  };
  return new Set(items.filter((it) => rowOf(it.top) >= rows && !keep.has(it.id)).map((it) => it.id));
}
