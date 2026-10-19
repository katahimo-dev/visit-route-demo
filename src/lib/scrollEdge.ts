// 横に巻く表の端（PRD D221・D222）：右に続きがあるか、ある列を止めた列のすぐ右に見せる巻き位置。
// DOM を読まない純粋関数（画面は lib/useScrollEdge と各ページ）

/** 横に巻く箱の寸法（Element の scrollLeft・clientWidth・scrollWidth） */
export type ScrollBox = { scrollLeft: number; clientWidth: number; scrollWidth: number };

/** 端とみなす余り（px。小数の丸めで 1px 残ることがある） */
export const EDGE_SLACK = 2;

/** 右にまだ続きがあるか（巻ける幅があり、右の端まで巻いていない） */
export function moreRight(b: ScrollBox, slack = EDGE_SLACK): boolean {
  return b.scrollWidth - b.clientWidth - b.scrollLeft > slack;
}

/**
 * ある列を、左に止めた列（見出しの列など）のすぐ右に見せる scrollLeft。
 * targetLeft・stickyRight は箱の左端からの今の位置（getBoundingClientRect の差）。巻ける範囲（0〜scrollWidth−clientWidth）に収める
 */
export function scrollLeftToShow(b: ScrollBox, targetLeft: number, stickyRight: number, gap = 4): number {
  const max = Math.max(0, b.scrollWidth - b.clientWidth);
  const want = b.scrollLeft + targetLeft - stickyRight - gap;
  return Math.round(Math.min(max, Math.max(0, want)));
}
