import { CornerDownLeft, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDay } from '../app/day';
import type { Terms } from '../contracts/documents';
import { jstDate } from '../domain/time';
import {
  filterPalette,
  isMacPlatform,
  isPaletteShortcut,
  moveActive,
  type PaletteItem,
  paletteActions,
  paletteKindLabel,
  palettePeople,
  paletteScreens,
} from '../lib/commandPalette';
import { trapTarget } from '../lib/confirmDialog';
import type { MenuItem, NavSection } from '../lib/nav';
import { useDemoData } from '../store';
import { FOCUSABLE } from './ui';
import { inertLock, useBodyScrollLock } from './useBodyScrollLock';
import './commandPalette.css';

/** このブラウザが mac か（⌘K と Ctrl+K のどちらで開くか・キーの印） */
export const IS_MAC = typeof navigator !== 'undefined' && isMacPlatform(navigator.platform || navigator.userAgent);

/**
 * コマンドパレット（PRD D181〜D183。ADR-0027）：画面・操作・〈利用者さん〉・〈スタッフ〉の名前を打って絞り込み、選ぶとそこへ移る。
 * body の直下に出し、開いているあいだ body のほかの子を inert にして裏を巻かない（確認ダイアログと同じ。ADR-0026）。
 * 入力欄は combobox、候補は listbox（aria-activedescendant）。↑↓ で選び Enter で開く。Esc・背景・Ctrl+K（mac は ⌘K）で閉じ、
 * フォーカスは開く前の要素へ戻す（移った先で欄が開けばそちらが取る）。データは書き換えない
 */
export function CommandPalette({
  sections,
  terms,
  onClose,
}: {
  /** メニューの並び（画面の候補。メニューと同じ名前・同じ順） */
  sections: readonly NavSection<MenuItem>[];
  terms: Pick<Terms, 'client' | 'staff'>;
  onClose: () => void;
}) {
  const { data } = useDemoData();
  const { setDate } = useDay();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const today = jstDate(Date.now());
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const listId = useId();
  const statusId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  /** 打ったか（件数は打ってから読み上げる。開いたときには読まない） */
  const [typed, setTyped] = useState(false);

  // 候補（人の名前は比べる形にそろえておき、打つたびにそろえ直さない。300人×60人でも打つたびは絞り込むだけ）
  const actions = useMemo(() => paletteActions(today), [today]);
  const screens = useMemo(() => paletteScreens(sections), [sections]);
  const people = useMemo(() => palettePeople(data.clients, data.staff, terms), [data.clients, data.staff, terms]);
  const items = useMemo(() => [...actions, ...screens, ...people], [actions, screens, people]);
  const result = useMemo(() => filterPalette(items, query), [items, query]);
  const flat = result.flat;
  const at = flat.length === 0 ? -1 : Math.min(active, flat.length - 1);
  const optionId = (i: number) => `${listId}-o${i}`;

  useBodyScrollLock();
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseInert = inertLock.lock(
      Array.from(document.body.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && el !== wrapRef.current,
      ),
    );
    inputRef.current?.focus();
    // 捕捉の段で受け、右の欄・引き出しの Esc・Tab（document で受けている）に渡さない
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Escape' && !e.isComposing) || isPaletteShortcut(e, IS_MAC)) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !boxRef.current) return;
      e.stopPropagation();
      const list = [...boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      const now = document.activeElement;
      const to = trapTarget(list.length, now instanceof HTMLElement ? list.indexOf(now) : -1, e.shiftKey);
      if (to === null) return;
      e.preventDefault();
      list[to]?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      releaseInert();
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  // 選んでいる候補を見える所へ
  useEffect(() => {
    if (at < 0) return;
    document.getElementById(optionId(at))?.scrollIntoView({ block: 'nearest' });
  });

  const pick = (it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    if (it.date) setDate(it.date);
    // 今の画面を選んだら閉じるだけ（URL のクエリ＝画面の状態を消さない。メニューと同じ）
    if (it.to === pathname) return;
    navigate(it.to);
  };

  const onType = (v: string) => {
    setQuery(v);
    setActive(0);
    setTyped(true);
  };
  const status = !typed ? '' : flat.length === 0 ? '見つかりません' : `${flat.length}件`;

  let index = -1;
  return createPortal(
    <div ref={wrapRef} className="cmdk-wrap" data-testid="cmdk-wrap">
      {/* 背景を押すと閉じる（キーボードは Esc） */}
      <div className="cmdk-backdrop" aria-hidden="true" onClick={onClose} data-testid="cmdk-backdrop" />
      <div ref={boxRef} className="cmdk" role="dialog" aria-modal="true" aria-label="探す・移動" data-testid="cmdk">
        <div className="cmdk-head">
          <Search size={18} className="cmdk-head-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="cmdk-input"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-activedescendant={at >= 0 ? optionId(at) : undefined}
            aria-autocomplete="list"
            aria-label={`画面・操作・${terms.client}・${terms.staff}の名前で探す`}
            placeholder={`画面・操作・${terms.client}・${terms.staff}の名前`}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(moveActive(at, flat.length, e.key === 'ArrowDown' ? 1 : -1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(flat[at]);
              }
            }}
            data-testid="cmdk-input"
          />
          <button type="button" className="icon-btn cmdk-close" aria-label="閉じる" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div id={listId} className="cmdk-list" role="listbox" aria-label="候補" data-testid="cmdk-list">
          {result.groups.map((g) => {
            const headId = `${listId}-g-${g.kind}`;
            return (
              // biome-ignore lint/a11y/useSemanticElements: listbox の中のまとまり（fieldset は listbox の子にできない）
              <div key={g.kind} role="group" aria-labelledby={headId} className="cmdk-group" data-kind={g.kind}>
                <div id={headId} role="presentation" className="cmdk-group-title">
                  {paletteKindLabel(g.kind, terms)}
                </div>
                {g.items.map((it) => {
                  index++;
                  const i = index;
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: キーボードは入力欄の↑↓・Enter で選ぶ（combobox。フォーカスは入力欄のまま）
                    <div
                      key={it.id}
                      id={optionId(i)}
                      role="option"
                      tabIndex={-1}
                      aria-selected={i === at}
                      className={i === at ? 'cmdk-option is-active' : 'cmdk-option'}
                      // 押してもフォーカスは入力欄のまま
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => {
                        if (i !== at) setActive(i);
                      }}
                      onClick={() => pick(it)}
                      data-testid="cmdk-option"
                      data-kind={it.kind}
                      data-to={it.to}
                    >
                      <span className="cmdk-option-label">{it.label}</span>
                      {it.hint && <span className="cmdk-option-hint">{it.hint}</span>}
                      {i === at && <CornerDownLeft size={14} className="cmdk-option-enter" aria-hidden="true" />}
                    </div>
                  );
                })}
                {g.rest > 0 && (
                  // 読み上げは件数の知らせで足りるので、ここは目で見る補足だけ
                  <div className="cmdk-rest" aria-hidden="true" data-testid="cmdk-rest">
                    ほか {g.rest}人（続けて打つと絞り込めます）
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {flat.length === 0 && (
          <p className="cmdk-empty" data-testid="cmdk-empty">
            見つかりません。画面の名前・操作・{terms.client}のよみ・{terms.staff}の名前で探せます
          </p>
        )}
        <p className="cmdk-foot" aria-hidden="true">
          <kbd>↑</kbd>
          <kbd>↓</kbd> で選ぶ・<kbd>Enter</kbd> で開く・<kbd>Esc</kbd> で閉じる
          {query === '' && (
            <span>
              ・名前を打つと{terms.client}・{terms.staff}も出ます
            </span>
          )}
        </p>
        <p id={statusId} className="sr-only" aria-live="polite" data-testid="cmdk-status">
          {status}
        </p>
      </div>
    </div>,
    document.body,
  );
}
