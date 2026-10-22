// 〈利用者さん〉・〈スタッフ〉の全画面（PRD D308〜D312。ADR-0052）で共通の部品：タブ、節（読む ⇄ 直す → 保存・取り消し）、
// 変更があるまま離れるときの確認。データは書き換えない（保存は画面が store の update で）

import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, Pencil, Save, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { ConfirmOptions } from '../lib/confirmDialog';
import { tabSearch } from '../lib/personPage';
import { useConfirm } from './ConfirmDialog';
import { FieldError, type FormErr, submitHandler } from './FieldError';
import { WithIcon } from './ui';
import './personPage.css';

/** タブ1つ */
export type PersonTabDef<T extends string> = { key: T; label: string; icon: LucideIcon; disabled?: string | false };

/**
 * 画面の見出しの下のタブ（予定の［月｜週｜日］・設定のタブと同じリンクのナビ。今のタブは aria-current と太字・下線）。
 * URL の `?tab=`（先頭は書かない）。狭い画面では横に巻き、今のタブを見える所へ。
 * 変更があるまま押したら確かめる（ask。断れば移らない）
 */
export function PersonTabs<T extends string>({
  tabs,
  current,
  ask,
  label,
}: {
  tabs: readonly PersonTabDef<T>[];
  current: T;
  /** 移ってよいか（変更が無ければすぐ true） */
  ask: () => Promise<boolean>;
  label: string;
}) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: タブが変わったときだけ
  useEffect(() => {
    const nav = navRef.current;
    const on = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = Math.max(0, on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2);
  }, [current]);
  const first = tabs[0]!.key;
  return (
    <nav ref={navRef} className="view-switch person-tabs" aria-label={label} data-testid="person-tabs">
      {tabs.map(({ key, label: text, icon: Icon, disabled }) => {
        const on = key === current;
        const to = `${pathname}${tabSearch(search, key, first)}`;
        if (disabled)
          return (
            <span
              key={key}
              className="view-switch-item is-disabled"
              aria-disabled="true"
              title={disabled}
              data-tab={key}
            >
              <Icon size={15} aria-hidden="true" />
              {text}
            </span>
          );
        return (
          <Link
            key={key}
            to={to}
            replace
            className={`view-switch-item${on ? ' is-on' : ''}`}
            aria-current={on ? 'page' : undefined}
            data-tab={key}
            onClick={(e) => {
              if (on) {
                e.preventDefault();
                return;
              }
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              void ask().then((ok) => {
                if (ok) navigate(to, { replace: true });
              });
            }}
          >
            <Icon size={15} aria-hidden="true" />
            {text}
          </Link>
        );
      })}
    </nav>
  );
}

/** 一覧へ戻るリンク（見出しの右。文字のボタン） */
export function BackToList({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="btn btn-text" data-testid="person-back">
      <WithIcon icon={ArrowLeft}>{label}</WithIcon>
    </Link>
  );
}

/**
 * 節（PRD D308）：ふだんは読むだけ（view）で右上に「直す」、直している間は入力欄（children）と「保存」（主）・「取り消し」。
 * Esc は取り消し（onCancel が変更を確かめる）。直すを押すと最初の入力欄へ、保存・取り消しのあとは「直す」へフォーカス
 */
export function EditSection({
  name,
  icon: Icon,
  title,
  editing,
  canEdit = true,
  onEdit,
  onSave,
  onCancel,
  error,
  view,
  children,
  aside,
  editLabel = '直す',
}: {
  /** 節の名前（data-section） */
  name: string;
  icon: LucideIcon;
  title: string;
  editing: boolean;
  /** 直せる（false なら「直す」を出さない） */
  canEdit?: boolean;
  onEdit: () => void;
  onSave: () => unknown;
  onCancel: () => void;
  error: FormErr;
  /** 読むときの中身 */
  view: ReactNode;
  /** 直すときの入力欄 */
  children?: ReactNode;
  /** 見出しの右に置く操作（読むとき） */
  aside?: ReactNode;
  editLabel?: string;
}) {
  const hid = useId();
  const errorId = useId();
  const ref = useRef<HTMLElement>(null);
  const was = useRef(editing);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (editing && !was.current) {
      el.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select, textarea')?.focus();
    } else if (!editing && was.current) {
      // 保存・取り消しのあとは「直す」へ（ほかの所へ移っていれば動かさない）
      const active = document.activeElement;
      if (!active || active === document.body || el.contains(active))
        el.querySelector<HTMLElement>('[data-testid="sec-edit"]')?.focus();
    }
    was.current = editing;
  }, [editing]);
  return (
    <section
      ref={ref}
      className={`card stack person-sec${editing ? ' is-editing' : ''}`}
      aria-labelledby={hid}
      data-testid="person-sec"
      data-section={name}
    >
      <div className="section-title">
        <h2 id={hid}>
          <Icon size={18} strokeWidth={2.2} aria-hidden="true" />
          {title}
        </h2>
        {!editing && (
          <div className="section-aside">
            {aside}
            {canEdit && (
              <button
                type="button"
                className="btn btn-small"
                onClick={onEdit}
                aria-label={`${title}を${editLabel}`}
                data-testid="sec-edit"
              >
                <WithIcon icon={Pencil} size={14}>
                  {editLabel}
                </WithIcon>
              </button>
            )}
          </div>
        )}
      </div>
      {editing ? (
        <form
          className="stack person-sec-form"
          noValidate
          onSubmit={submitHandler(onSave)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            e.preventDefault();
            onCancel();
          }}
          data-testid="sec-form"
        >
          {children}
          <div className="row person-sec-foot">
            <button type="submit" className="btn btn-primary" data-testid="sec-save">
              <WithIcon icon={Save}>保存</WithIcon>
            </button>
            <button type="button" className="btn" onClick={onCancel} data-testid="sec-cancel">
              <WithIcon icon={X}>取り消し</WithIcon>
            </button>
            <FieldError as="span" id={errorId} token={error}>
              {error?.text}
            </FieldError>
          </div>
        </form>
      ) : (
        view
      )}
    </section>
  );
}

/** 変更を捨てて移る前の確認（画面を離れる・タブを替える・別の節を直す） */
export function discardChanges(who: string, what: 'leave' | 'tab' | 'section'): ConfirmOptions {
  const title =
    what === 'leave'
      ? '変更を捨てて移りますか？'
      : what === 'tab'
        ? '変更を捨てて、タブを替えますか？'
        : '変更を捨てて、ほかの節を直しますか？';
  const confirmLabel = what === 'leave' ? '捨てて移る' : what === 'tab' ? '捨ててタブを替える' : '捨てて直す';
  return {
    title,
    body: `${who}の変更を保存していません。`,
    confirmLabel,
    cancelLabel: '編集を続ける',
    tone: 'danger',
  };
}

/** 確かめる関数（変更が無ければ聞かずに true） */
export function useAskDiscard(dirty: boolean, who: string) {
  const confirm = useConfirm();
  return (what: 'leave' | 'tab' | 'section'): Promise<boolean> =>
    dirty ? confirm(discardChanges(who, what)) : Promise.resolve(true);
}
