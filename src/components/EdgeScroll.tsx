// 横に巻く格子の表の箱（PRD D221）。右に続きがあるあいだ外枠に has-more-right を付け、
// 狭い画面（600px 以下）では右の端を薄くぼかして「続きがある」と示す（styles.css。広い画面の見た目は変えない）。
// ぼかしは巻く箱の外の枠（.scroll-edge）に描くので、中身と一緒に動かない
import { type ReactNode, type RefObject, useRef } from 'react';
import { useScrollEdge } from '../lib/useScrollEdge';

export function EdgeScroll({
  className = 'table-scroll',
  scrollRef,
  children,
}: {
  /** 巻く箱のクラス（既定 table-scroll） */
  className?: string;
  /** 巻く箱を外から使う（はじめの巻き位置など） */
  scrollRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const own = useRef<HTMLDivElement>(null);
  const ref = scrollRef ?? own;
  const more = useScrollEdge(ref);
  return (
    <div className={`scroll-edge${more ? ' has-more-right' : ''}`}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </div>
  );
}
