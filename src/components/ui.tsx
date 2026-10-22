import type { LucideIcon } from 'lucide-react';
import { Info, X } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, type RefObject, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { submitHandler } from './FieldError';
import { inertLock, useBodyScrollLock } from './useBodyScrollLock';
import { usePanelFoot, usePanelToastPlace, useVisualViewportFit } from './usePanelFoot';

/**
 * 画面の見出しの型（PRD D236。ADR-0036）：左にアイコン＋題名＋1行の説明、右に主ボタン（塗り）を1つ。
 * 予定の3画面は題名の下に［月｜週｜日］のタブ（リンクのナビ。今の画面は aria-current）。
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
  /** 1行の説明（この画面でやること） */
  lead?: ReactNode;
  /** 右に置く主ボタン（塗りは1つだけ）と状態の印 */
  actions?: ReactNode;
  /** 題名の下に置くタブ（予定の［月｜週｜日］。PRD D59・D237） */
  nav?: ReactNode;
}) {
  return (
    <header className={`page-head${nav ? ' has-tabs' : ''}`}>
      <div className="page-head-row">
        <span className="page-icon" aria-hidden="true">
          <Icon size={20} strokeWidth={2.2} />
        </span>
        <div className="page-title">
          <h1>{title}</h1>
          {lead && <p className="page-lead">{lead}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {nav && <div className="page-tabs">{nav}</div>}
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
  /** 見出し（用語の説明の部品 Term を入れてもよい。PRD D175） */
  label: ReactNode;
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
export const FOCUSABLE =
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
  focusKey,
  onSubmit,
  sheet = false,
}: {
  icon: LucideIcon;
  title: ReactNode;
  /** スマホ（600px 以下）で下から出す欄（ボトムシート。訪問の詳細の欄。PRD D334）。広い画面は今の右の欄 */
  sheet?: boolean;
  /**
   * 欄を開いたまま中身が入れ替わったとき（欠勤・キャンセルの段階など）に変える値。変わったら、`data-return-focus` の付いた
   * 要素（段階の見出し）、無ければ最初の入力欄、それも無ければ欄そのものにフォーカスを移す
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
  /**
   * 確定の操作（保存・閉じる）の帯。内容のすぐ下に置き、中身が長くて巻くときは欄の下に貼り付く（PRD D194〜D196）。
   * 主ボタンを先頭に置く（狭い画面は2つまで横に並べ、3つ以上は主ボタンを1行目に全幅）
   */
  footer?: ReactNode;
  /**
   * 入力の欄なら保存（PRD D251）。渡すと内容と帯を1つの `<form noValidate>` で包み、Enter（textarea は除く）と
   * 帯の type="submit" のボタンで呼ぶ。保存のあと誤りが残れば最初の誤った欄（aria-invalid）へフォーカスを移す
   */
  onSubmit?: () => unknown;
}) {
  const ref = useRef<HTMLElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLElement>(null);
  const footRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const hasFoot = !!footer;
  usePanelFoot(bodyRef, footRef, endRef, hasFoot, onSubmit ? 'form' : 'div');
  useVisualViewportFit(wrapRef);
  const headRef = useRef<HTMLElement>(null);
  usePanelToastPlace(ref, headRef);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const fallbackRef = useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;
  /** 開いたときの値だけを使う */
  const focusPanelRef = useRef(focusPanel);
  // 開いているあいだ裏の画面を巻かない（スマホのメニューの引き出しと重なっても数で数える）
  useBodyScrollLock();
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    // 開いているあいだ裏（body のほかの子：#root・メニューの引き出し）を inert にする（PRD D252。確認ダイアログと同じ
    // 要素ごとに数えるロック）。後から body の直下に出る吹き出し・確認ダイアログ・知らせ（data-inert-keep）は巻き込まない
    const releaseInert = inertLock.lock(
      Array.from(document.body.children).filter(
        (el): el is HTMLElement =>
          el instanceof HTMLElement && el !== wrapRef.current && !el.hasAttribute('data-inert-keep'),
      ),
    );
    const first = focusPanelRef.current ? null : ref.current?.querySelector<HTMLElement>('input, select, textarea');
    if (first) first.focus();
    else ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // 日本語の変換中の Esc は変換の取り消しなので閉じない
      if (e.key === 'Escape' && !e.isComposing) {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current || e.defaultPrevented) return;
      // 欄の中の名前から開いた詳細の吹き出しの中の Tab は、吹き出しに任せる（PRD D200）
      if (document.activeElement?.closest('.detail-popover')) return;
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
    return () => {
      document.removeEventListener('keydown', onKey);
      // inert を外してから戻す（inert の中の要素にはフォーカスできない）
      releaseInert();
      const to = returnRef.current?.();
      if (to) to.focus({ preventScroll: true });
      else if (back?.isConnected) back.focus?.();
      else fallbackRef.current?.()?.focus();
    };
  }, []);
  // 中身が入れ替わったら（開いたときは上で移しているので2回目から）、戻り先の印・最初の入力欄・欄そのものの順で
  const lastFocusKey = useRef(focusKey);
  useEffect(() => {
    if (lastFocusKey.current === focusKey) return;
    lastFocusKey.current = focusKey;
    const first =
      ref.current?.querySelector<HTMLElement>('[data-return-focus]') ??
      ref.current?.querySelector<HTMLElement>('input, select, textarea');
    if (first) first.focus();
    else ref.current?.focus();
  }, [focusKey]);
  const body = (
    <>
      <div className="drawer-content stack">{children}</div>
      {hasFoot && (
        <>
          <footer className="drawer-foot" ref={footRef}>
            {footer}
          </footer>
          <div className="drawer-foot-end" ref={endRef} aria-hidden="true" />
        </>
      )}
    </>
  );
  // 画面の入れ物（動きの transform）の中だと位置がずれるので、body の直下に出す
  return createPortal(
    <div className={`drawer-wrap${sheet ? ' has-sheet' : ''}`} ref={wrapRef}>
      {/* 下から出る欄（スマホ）は外（上の幕）を押すと閉じる（キーボードは Esc・×）。右の欄は今のまま閉じない */}
      <div className="drawer-backdrop" aria-hidden="true" onClick={sheet ? onClose : undefined} />
      <section
        ref={ref}
        className={`drawer ${narrow ? 'is-narrow' : ''}${sheet ? ' is-sheet' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="drawer-head" ref={headRef}>
          <h2 id={titleId}>
            <Icon size={18} strokeWidth={2.2} aria-hidden="true" />
            {title}
          </h2>
          <IconButton icon={X} label="閉じる" onClick={onClose} />
        </header>
        {/* 巻く領域の中に、内容・帯・番兵（帯が貼り付いているかを見る。高さ0）の順に置く */}
        {onSubmit ? (
          <form
            className="drawer-body"
            ref={bodyRef as RefObject<HTMLFormElement>}
            onSubmit={submitHandler(onSubmit)}
            noValidate
          >
            {body}
          </form>
        ) : (
          <div className="drawer-body" ref={bodyRef as RefObject<HTMLDivElement>}>
            {body}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
