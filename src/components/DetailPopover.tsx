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
 * 吹き出し（role="dialog"。名前は見出し titleId）。閉じ方：Esc（吹き出しの中で押したとき）・外を押す・Tab で外へ出る・
 * ボタンをもう一度押す（呼ぶ側）・閉じるボタン。閉じたらフォーカスを押したボタン（anchorId の要素）に戻す
 * （ボタンが消えていれば戻さない）。開いたら吹き出しへフォーカスを移す（中の文を読める）。
 * ボタンは要素ではなく ID で受け、使うたびに引く（絞り込みで描き直されても古い要素を指さない）
 */
export function DetailPopover({
  id,
  anchorId,
  title,
  titleId,
  onClose,
  children,
  testId,
}: {
  id: string;
  /** 押したボタンの id（位置を合わせ、閉じたらフォーカスを戻す） */
  anchorId: string;
  title: ReactNode;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onClose);
  latest.current = onClose;
  const anchorEl = () => document.getElementById(anchorId);

  // 位置：開いたとき・画面の大きさ・スクロール（表の横スクロールも。吹き出しの中のスクロールは除く）・中身の大きさが変わったとき
  // biome-ignore lint/correctness/useExhaustiveDependencies: anchorEl は anchorId だけで決まる
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const put = () => {
      const a = anchorEl();
      if (!a) return;
      // 中を巻いた位置を保つため maxHeight は外さない。中身の高さは scrollHeight（＋枠の太さ）で取る
      const frame = el.offsetHeight - el.clientHeight;
      const p = popoverPlace(
        a.getBoundingClientRect(),
        { width: el.offsetWidth, height: el.scrollHeight + frame },
        { width: window.innerWidth, height: window.innerHeight },
      );
      el.style.top = `${Math.round(p.top)}px`;
      el.style.left = `${Math.round(p.left)}px`;
      el.style.maxHeight = `${Math.round(p.maxHeight)}px`;
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && el.contains(e.target)) return;
      put();
    };
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    window.addEventListener('resize', put);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', put);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchorId]);

  // フォーカス：開いたら吹き出しへ、閉じたら（外したら）押したボタンへ
  // biome-ignore lint/correctness/useExhaustiveDependencies: anchorEl は anchorId だけで決まる
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    return () => {
      anchorEl()?.focus({ preventScroll: true });
    };
  }, [anchorId]);

  // 外を押す
  // biome-ignore lint/correctness/useExhaustiveDependencies: anchorEl は anchorId だけで決まる
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // ボタンを押したときはボタンの onClick（もう一度押すと閉じる）に任せる
      if (ref.current?.contains(t) || anchorEl()?.contains(t)) return;
      latest.current();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [anchorId]);

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="detail-popover"
      data-testid={testId}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Tab') {
          // 吹き出しの端から Tab で外へ出るときは閉じてボタンへ戻す（吹き出しは body の最後にあり、
          // そのままだとページの外へ出てしまう）
          const list = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
          const at = document.activeElement;
          const out = e.shiftKey ? at === e.currentTarget || at === list[0] : at === list.at(-1);
          if (out) {
            e.preventDefault();
            latest.current();
          }
          return;
        }
        // Esc は吹き出しの中で押したときだけ取る（ほかの欄の Esc を奪わない）
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        latest.current();
      }}
      onBlur={(e) => {
        // Tab などでフォーカスが吹き出しの外へ出たら閉じる（閉じるとボタンへ戻る）。
        // 移り先が無い（ほかのウィンドウへ移った）ときは閉じない。外を押したときは pointerdown で閉じている
        const to = e.relatedTarget;
        // ボタンへ移ったとき（ボタンを押した）は、ボタンの onClick（もう一度押すと閉じる）に任せる
        if (to instanceof Node && !e.currentTarget.contains(to) && !anchorEl()?.contains(to)) latest.current();
      }}
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
