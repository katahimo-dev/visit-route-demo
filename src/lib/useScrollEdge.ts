// 横に巻く箱の右に続きがあるかを追うフック（PRD D221）。巻く・幅が変わる・中身の大きさが変わるたびに測り直す。
// 判定は lib/scrollEdge の moreRight（純粋関数。テストあり）
import { type RefObject, useEffect, useState } from 'react';
import { moreRight } from './scrollEdge';

export function useScrollEdge(ref: RefObject<HTMLElement | null>): boolean {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(moreRight(el));
    check();
    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      ro?.disconnect();
    };
  }, [ref]);
  return more;
}
