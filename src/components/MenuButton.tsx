import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import './menuButton.css';

/** メニューの項目。disabled に文字を渡すと押せない理由（title）にする */
export type MenuItem = {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  /** 右に小さく出す補足（点数・「作る」など） */
  note?: ReactNode;
  icon?: LucideIcon;
  disabled?: boolean | string;
  /** 今の案など、選んである項目（印を付ける） */
  current?: boolean;
  /** この項目の前に区切りの線を入れる */
  separatorBefore?: boolean;
  /**
   * 名前の下に出す1行の説明（何が変わり、手直し・固定がどうなるか。PRD D156）。押せないときは、代わりに押せない理由を出す。
   * 読み上げは名前と別に aria-describedby で
   */
  description?: ReactNode;
  /** この項目からまとまり（role="group"）を始め、その見出しにする（PRD D156。区切りの線も入れる） */
  group?: string;
  testId?: string;
};

/**
 * 押すと項目の一覧が開くボタン（WAI-ARIA の menu button。予定の画面の「案を変える ▾」。PRD D63）。
 * キーボード：ボタンで Enter・Space・↓ は先頭、↑ は最後の項目へ。一覧の中は ↑↓・Home・End で移り、Enter・Space で選ぶ、
 * Esc で閉じてボタンへ戻る、Tab で閉じる。押せない項目もフォーカスは移る（理由は title と aria-describedby。説明のある項目は
 * 説明の行に理由を出す）。group のある項目からは見出し付きのまとまり（role="group"・aria-label）にする（PRD D156）。
 * 一覧は浮かせて出す（開いても下の画面の高さは変わらない＝ドラッグの位置をずらさない）
 */
export function MenuButton({
  label,
  icon: Icon,
  items,
  disabled = false,
  testId,
  className = '',
}: {
  label: ReactNode;
  icon?: LucideIcon;
  items: MenuItem[];
  disabled?: boolean;
  testId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** 開いたときにフォーカスする項目（'first'・'last'） */
  const focusOnOpen = useRef<'first' | 'last'>('first');
  const btnId = useId();
  const menuId = useId();

  const focusAt = (i: number) => {
    const n = items.length;
    if (n === 0) return;
    itemRefs.current[((i % n) + n) % n]?.focus();
  };
  const openWith = (at: 'first' | 'last') => {
    focusOnOpen.current = at;
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  const listRef = useRef<HTMLDivElement>(null);
  // 一覧が画面の右からはみ出すなら左へずらす（狭い画面。描く前に直す）
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!open || !el) return;
    el.style.left = '';
    const over = el.getBoundingClientRect().right - (window.innerWidth - 8);
    if (over > 0) el.style.left = `${-over}px`;
  }, [open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いたときに1回だけ
  useEffect(() => {
    if (!open) return;
    focusAt(focusOnOpen.current === 'first' ? 0 : items.length - 1);
    // 一覧の外を押したら閉じる（フォーカスは押した先のまま）
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openWith('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openWith('last');
    }
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const at = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusAt(at + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusAt(at - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(items.length - 1);
    } else if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // 右から出る欄（SidePanel）の Esc と重ならないよう、ここで止める
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };
  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  };

  return (
    <div className={`menu-wrap ${className}`} ref={wrapRef}>
      <button
        ref={btnRef}
        id={btnId}
        type="button"
        className="btn menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        data-testid={testId}
        onClick={() => (open ? close(false) : openWith('first'))}
        onKeyDown={onButtonKey}
      >
        <span className="with-icon">
          {Icon && <Icon size={16} strokeWidth={2.2} aria-hidden="true" />}
          {label}
          <ChevronDown size={15} strokeWidth={2.4} aria-hidden="true" className="menu-chevron" />
        </span>
      </button>
      {open && (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          aria-labelledby={btnId}
          className="menu-list"
          data-testid={testId ? `${testId}-list` : undefined}
          onKeyDown={onMenuKey}
        >
          {groupsOf(items).map((g) => {
            const rows = g.items.map(({ item, i }) => {
              const why = typeof item.disabled === 'string' ? item.disabled : undefined;
              const whyId = `${menuId}-why-${item.key}`;
              const labelId = `${menuId}-label-${item.key}`;
              const noteId = `${menuId}-note-${item.key}`;
              const descId = `${menuId}-desc-${item.key}`;
              const ItemIcon = item.icon;
              const hasDesc = item.description !== undefined;
              const hasNote = item.note !== undefined;
              return (
                <div
                  key={item.key}
                  role="none"
                  className={!g.heading && item.separatorBefore && i > 0 ? 'menu-sep' : undefined}
                >
                  <button
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={`menu-item${item.current ? ' is-current' : ''}${hasDesc ? ' has-desc' : ''}`}
                    aria-disabled={item.disabled ? true : undefined}
                    aria-current={item.current ? 'true' : undefined}
                    title={why}
                    aria-labelledby={hasDesc ? `${labelId}${hasNote ? ` ${noteId}` : ''}` : undefined}
                    aria-describedby={hasDesc ? descId : why ? whyId : undefined}
                    data-testid={item.testId}
                    data-key={item.key}
                    onClick={() => choose(item)}
                  >
                    <span className="menu-item-icon" aria-hidden="true">
                      {ItemIcon && <ItemIcon size={15} strokeWidth={2.2} />}
                    </span>
                    <span className="menu-item-main">
                      <span className="menu-item-head">
                        <span id={labelId} className="menu-item-label">
                          {item.label}
                        </span>
                        {hasNote && (
                          <span id={noteId} className="menu-item-note">
                            {item.note}
                          </span>
                        )}
                      </span>
                      {hasDesc && (
                        <span id={descId} className={`menu-item-desc${why ? ' is-why' : ''}`}>
                          {why ?? item.description}
                        </span>
                      )}
                    </span>
                    {why && !hasDesc && (
                      <span id={whyId} hidden>
                        {why}
                      </span>
                    )}
                  </button>
                </div>
              );
            });
            if (!g.heading) return rows;
            return (
              // biome-ignore lint/a11y/useSemanticElements: メニューの中のまとまりは WAI-ARIA の menu の group（fieldset は使わない）
              <div key={`group-${g.items[0]?.item.key}`} role="group" aria-label={g.heading} className="menu-group">
                <div className="menu-heading" aria-hidden="true">
                  {g.heading}
                </div>
                {rows}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 項目を group ごとのまとまりに分ける（group の無い項目は、前のまとまりに続ける。最初のまとまりは見出しなしもある） */
function groupsOf(items: MenuItem[]): { heading?: string; items: { item: MenuItem; i: number }[] }[] {
  const out: { heading?: string; items: { item: MenuItem; i: number }[] }[] = [];
  items.forEach((item, i) => {
    const last = out.at(-1);
    if (!last || item.group !== undefined) out.push({ heading: item.group, items: [{ item, i }] });
    else last.items.push({ item, i });
  });
  return out;
}
