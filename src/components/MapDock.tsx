import { ArrowDownToLine, Map as MapIcon, Maximize2, X } from 'lucide-react';
import { type RefObject, useEffect, useState } from 'react';
import { type MapLine, type MapPoint, RouteMap } from './RouteMap';
import { IconButton } from './ui';

/**
 * 画面の外にある地図を、右下に小さく浮かせて見せる。
 * 元の地図（target）が見えていないときだけ出す。スタッフ・区間・訪問を選ぶと自動で開き、閉じてもボタンで開き直せる
 */
export function MapDock({
  target,
  points,
  lines,
  title,
  focusKey,
}: {
  /** ページの中の地図のカード（見えているあいだは浮かせない） */
  target: RefObject<HTMLElement | null>;
  points: MapPoint[];
  lines: MapLine[];
  title: string;
  /** 選んだもの（スタッフ・区間・訪問）。変わったら閉じていても開く。空文字は何も選んでいない */
  focusKey: string;
}) {
  const [inView, setInView] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e?.isIntersecting ?? true), { threshold: 0.25 });
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, [target]);

  // 何かを選んだら開く（選び直すたびに開き直す）
  useEffect(() => {
    if (focusKey) setOpen(true);
  }, [focusKey]);

  if (inView || lines.length === 0) return null;
  if (!open)
    return (
      <button type="button" className="map-dock-fab" onClick={() => setOpen(true)} aria-label="地図を開く">
        <MapIcon size={18} aria-hidden="true" />
        地図
      </button>
    );
  return (
    <section className="map-dock" aria-label="地図（浮かせた表示）">
      <div className="map-dock-head">
        <MapIcon size={15} aria-hidden="true" />
        <strong className="ellipsis">{title}</strong>
        <IconButton
          icon={ArrowDownToLine}
          label="ページの地図へ移る"
          onClick={() => target.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        />
        <IconButton icon={X} label="地図を閉じる" onClick={() => setOpen(false)} />
      </div>
      <RouteMap points={points} lines={lines} height={260} />
      <span className="map-dock-note sub">
        <Maximize2 size={12} aria-hidden="true" />
        カードを押すと、ここに強調して出ます
      </span>
    </section>
  );
}
