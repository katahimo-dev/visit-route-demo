import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FOCUSABLE } from '../components/ui';
import { inertLock, useBodyScrollLock } from '../components/useBodyScrollLock';

/**
 * スマホ（幅860px以下）のメニューの引き出し（PRD D133。design.md §4 app「スマホのメニュー（2026-10-18）」）。
 * 左から出す。body の直下に出し、開いているあいだ後ろの画面（#root）を inert にする。
 * 閉じ方：画面を選ぶ（呼ぶ側が閉じる）・外を押す・Esc・×。閉じたらフォーカスを returnFocus（「メニュー」ボタン、
 * 広い画面へ戻したときは左のメニューの今の項目）へ戻す。開いているあいだは裏の画面を巻かない（useBodyScrollLock）。
 * フォーカスは引き出しの中で回す（Tab・Shift+Tab）
 */
export function NavDrawer({
  id,
  label,
  onClose,
  returnFocus,
  head,
  children,
}: {
  /** 「メニュー」ボタンの aria-controls が指す ID */
  id: string;
  /** 引き出しの名前（読み上げ） */
  label: string;
  onClose: () => void;
  /** 閉じたときにフォーカスを戻す要素（閉じたときに引く） */
  returnFocus: () => HTMLElement | null | undefined;
  /** 上の段（ロゴと事業所の名前） */
  head: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;
  useBodyScrollLock();
  useEffect(() => {
    // 後ろの画面を操作できなくする（読み上げ・Tab・クリック）
    const root = document.getElementById('root');
    const releaseInert = root ? inertLock.lock([root]) : () => {};
    // 開いたら今の画面の項目（無ければ最初の項目）へ
    const first =
      ref.current?.querySelector<HTMLElement>('[aria-current="page"]') ??
      ref.current?.querySelector<HTMLElement>('a[href]');
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const list = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const headEl = list[0];
      const tail = list.at(-1);
      if (!headEl || !tail) {
        e.preventDefault();
        return;
      }
      const at = document.activeElement;
      const inside = at instanceof Node && ref.current.contains(at);
      if (e.shiftKey && (!inside || at === headEl || at === ref.current)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (!inside || at === tail)) {
        e.preventDefault();
        headEl.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      releaseInert();
      returnRef.current()?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div className="nav-drawer-wrap" data-testid="nav-drawer-wrap">
      {/* 外を押すと閉じる（キーボードは Esc・×） */}
      <div className="nav-drawer-backdrop" aria-hidden="true" onClick={onClose} data-testid="nav-drawer-backdrop" />
      <section
        ref={ref}
        id={id}
        className="nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-testid="nav-drawer"
      >
        <div className="nav-drawer-head">
          {head}
          <button type="button" className="icon-btn" aria-label={`${label}を閉じる`} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
