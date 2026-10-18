import type { LucideIcon } from 'lucide-react';
import { Info, X } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * 画面の見出し：アイコン＋題名＋ひとこと。右に主ボタンなどを置く
 * 長い説明は Hint に入れて、ふだんは畳んでおく
 */
export function PageHeader({
  icon: Icon,
  title,
  lead,
  actions,
  nav,
}: {
  icon: LucideIcon;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  /** 見出しの左に置く切り替え（予定の［月｜週｜日］。PRD D59） */
  nav?: ReactNode;
}) {
  return (
    <header className="page-head">
      {nav}
      <span className="page-icon" aria-hidden="true">
        <Icon size={22} strokeWidth={2.2} />
      </span>
      <div className="page-title">
        <h1>{title}</h1>
        {lead && <p className="page-lead">{lead}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** カードの見出し：小さなアイコン＋題名。右に補足や操作 */
export function SectionTitle({
  icon: Icon,
  children,
  aside,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="section-title">
      <h2>
        {Icon && <Icon size={18} strokeWidth={2.2} aria-hidden="true" />}
        {children}
      </h2>
      {aside && <div className="section-aside">{aside}</div>}
    </div>
  );
}

/** 説明文は畳んでおき、ⓘ を押すと開く（情報量を減らす） */
export function Hint({
  children,
  label = '説明',
  ariaLabel,
}: {
  children: ReactNode;
  label?: string;
  /** 同じ画面に「説明」が並ぶときの読み上げ名（例：「相性の説明」） */
  ariaLabel?: string;
}) {
  return (
    <details className="hint">
      <summary aria-label={ariaLabel}>
        <Info size={14} aria-hidden="true" />
        {label}
      </summary>
      <div className="hint-body">{children}</div>
    </details>
  );
}

/** 数字のタイル（合計点・移動など）。tone で良し悪しの色 */
export function Stat({
  icon: Icon,
  label,
  value,
  unit,
  tone = 'plain',
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: 'plain' | 'ok' | 'warn' | 'danger' | 'primary';
  note?: ReactNode;
}) {
  return (
    <div className={`stat tone-${tone}`}>
      <span className="stat-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        <span className="stat-value">
          {value}
          {unit && <small>{unit}</small>}
        </span>
        {note && <span className="stat-note">{note}</span>}
      </div>
    </div>
  );
}

/** アイコンだけのボタン。文字は title と aria-label に入れる */
export function IconButton({
  icon: Icon,
  label,
  tone = 'plain',
  className = '',
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  tone?: 'plain' | 'danger';
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button type="button" className={`icon-btn tone-${tone} ${className}`} title={label} aria-label={label} {...rest}>
      <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}

/** アイコン付きの文字（ボタンの中・チップの中で使う） */
export function WithIcon({
  icon: Icon,
  children,
  size = 16,
}: {
  icon: LucideIcon;
  children?: ReactNode;
  size?: number;
}) {
  return (
    <span className="with-icon">
      <Icon size={size} strokeWidth={2.2} aria-hidden="true" />
      {children}
    </span>
  );
}

/** 何もないときの表示 */
export function Empty({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={28} strokeWidth={1.8} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/** 欄の中で Tab で移れるもの */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * 右から出る編集の欄（一覧が長くても、押した所から探さずに済む）。後ろは暗くし、Esc・×・閉じるボタンで閉じる
 * （未保存の入力を失わないよう、後ろを押しても閉じない）。
 * 開いたら最初の入力欄（無ければ欄そのもの）に移り、Tab は欄の中で回し、閉じたら押したボタンに戻る
 */
export function SidePanel({
  icon: Icon,
  title,
  onClose,
  children,
  footer,
  narrow = false,
  fallbackFocus,
  returnFocus,
  focusPanel = false,
  headActions,
  focusKey,
}: {
  icon: LucideIcon;
  title: ReactNode;
  /** 見出しの右（× の前）に置く操作（閲覧の欄の「編集する」。PRD D128） */
  headActions?: ReactNode;
  /**
   * 欄を開いたまま中身が入れ替わったとき（閲覧 ⇄ 編集。PRD D128）に変える値。変わったら、開いたときと同じく
   * 最初の入力欄（無ければ欄そのもの）にフォーカスを移す
   */
  focusKey?: string;
  /**
   * 閉じたときの戻り先を差し替える（要素を返せば、開く前のボタンではなくそこへ。スクロールはしない＝呼ぶ側が動かす）。
   * null なら今までどおり
   */
  returnFocus?: () => HTMLElement | null | undefined;
  /** 閉じたとき、開く前にフォーカスのあった要素が画面から消えていたら、代わりにフォーカスする要素 */
  fallbackFocus?: () => HTMLElement | null | undefined;
  /** 開いたとき、最初の入力欄でなく欄そのものにフォーカスする（上に読む物があり、入力欄が下の方にある欄） */
  focusPanel?: boolean;
  /** 中身が少ない欄（稼働時間など）は幅を狭くする */
  narrow?: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 下に固定して出す操作（保存・閉じる） */
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const fallbackRef = useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;
  /** 開いたときの値だけを使う */
  const focusPanelRef = useRef(focusPanel);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const first = focusPanelRef.current ? null : ref.current?.querySelector<HTMLElement>('input, select, textarea');
    if (first) first.focus();
    else ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // 日本語の変換中の Esc は変換の取り消しなので閉じない
      if (e.key === 'Escape' && !e.isComposing) {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const list = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      const head = list[0];
      const tail = list.at(-1);
      if (!head || !tail) {
        e.preventDefault();
        return;
      }
      const at = document.activeElement;
      const inside = at instanceof Node && ref.current.contains(at);
      if (e.shiftKey && (!inside || at === head || at === ref.current)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (!inside || at === tail)) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      const to = returnRef.current?.();
      if (to) to.focus({ preventScroll: true });
      else if (back?.isConnected) back.focus?.();
      else fallbackRef.current?.()?.focus();
    };
  }, []);
  // 中身が入れ替わったら（開いたときは上で移しているので2回目から）、最初の入力欄か欄そのものへ
  const lastFocusKey = useRef(focusKey);
  useEffect(() => {
    if (lastFocusKey.current === focusKey) return;
    lastFocusKey.current = focusKey;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea');
    if (first) first.focus();
    else ref.current?.focus();
  }, [focusKey]);
  // 画面の入れ物（動きの transform）の中だと位置がずれるので、body の直下に出す
  return createPortal(
    <div className="drawer-wrap">
      <div className="drawer-backdrop" aria-hidden="true" />
      <section
        ref={ref}
        className={`drawer ${narrow ? 'is-narrow' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="drawer-head">
          <h2 id={titleId}>
            <Icon size={18} strokeWidth={2.2} aria-hidden="true" />
            {title}
          </h2>
          {headActions && <div className="drawer-head-actions">{headActions}</div>}
          <IconButton icon={X} label="閉じる" onClick={onClose} />
        </header>
        <div className="drawer-body stack">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
