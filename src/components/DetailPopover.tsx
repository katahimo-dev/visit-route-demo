// 押すと出る吹き出し（ポップオーバー。PRD D114・D115。ADR-0022）。相性の画面の列の見出し・行の名前で使う。
// マウスを重ねて出すツールチップにはしない。body の直下に浮かせて出し（表の横スクロールで切れない）、画面の端で切れない位置に置く
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './detailPopover.css';

/** 画面の端から空ける幅（px） */
const MARGIN = 8;
/** 押したボタンとのすき間（px） */
const GAP = 4;

/**
 * 吹き出しの位置（純粋関数）：ボタンの下に左端をそろえて出し、右・左の端で切れないよう横にずらす。
 * 下に入りきらず上のほうが広ければ上に出す。入りきらない高さは maxHeight で中を巻く
 */
export function popoverPlace(
  anchor: { top: number; bottom: number; left: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
): { top: number; left: number; maxHeight: number } {
  const left = Math.max(MARGIN, Math.min(anchor.left, view.width - size.width - MARGIN));
  const below = view.height - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  if (size.height <= below || below >= above) {
    const maxHeight = Math.max(80, below);
    return { top: anchor.bottom + GAP, left, maxHeight };
  }
  const maxHeight = Math.max(80, above);
  return { top: Math.max(MARGIN, anchor.top - GAP - Math.min(size.height, maxHeight)), left, maxHeight };
}

/**
 * 吹き出し（role="dialog"。名前は見出し titleId）。閉じ方：Esc・外を押す・ボタンをもう一度押す（呼ぶ側）・閉じるボタン。
 * 閉じたらフォーカスを押したボタン（anchor）に戻す。開いたら吹き出しへフォーカスを移す（中の文を読める）
 */
export function DetailPopover({
  id,
  anchor,
  title,
  titleId,
  onClose,
  children,
  testId,
}: {
  id: string;
  /** 押したボタン（位置を合わせ、閉じたらフォーカスを戻す） */
  anchor: HTMLElement;
  title: ReactNode;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onClose);
  latest.current = onClose;

  // 位置：開いたとき・画面の大きさ・スクロール（表の横スクロールも）・中身の大きさが変わったとき
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const put = () => {
      el.style.maxHeight = '';
      const a = anchor.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const p = popoverPlace(
        a,
        { width: r.width, height: el.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      el.style.top = `${Math.round(p.top)}px`;
      el.style.left = `${Math.round(p.left)}px`;
      el.style.maxHeight = `${Math.round(p.maxHeight)}px`;
    };
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    window.addEventListener('resize', put);
    window.addEventListener('scroll', put, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', put);
      window.removeEventListener('scroll', put, true);
    };
  }, [anchor]);

  // フォーカス：開いたら吹き出しへ、閉じたら（外したら）押したボタンへ
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  // Esc・外を押す
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      latest.current();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // ボタンを押したときはボタンの onClick（もう一度押すと閉じる）に任せる
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      latest.current();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="detail-popover"
      data-testid={testId}
    >
      <div className="detail-popover-head">
        <h3 id={titleId} className="detail-popover-title">
          {title}
        </h3>
        <button
          type="button"
          className="icon-btn tone-plain detail-popover-close"
          aria-label="閉じる"
          title="閉じる（Esc）"
          onClick={() => latest.current()}
        >
          <X size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}
