import type { LucideIcon } from 'lucide-react';
import { Info } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * 画面の見出し：アイコン＋題名＋ひとこと。右に主ボタンなどを置く
 * 長い説明は Hint に入れて、ふだんは畳んでおく
 */
export function PageHeader({
  icon: Icon,
  title,
  lead,
  actions,
}: {
  icon: LucideIcon;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
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
