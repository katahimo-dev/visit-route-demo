// 空の画面の「なぜ空か」と次の一手（PRD D176。決まりは lib/emptyGuide）。週・稼働の見込み・比較で使う
import type { LucideIcon } from 'lucide-react';
import { CalendarDays, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { batchHref, type EmptyGuide } from '../lib/emptyGuide';
import { WithIcon } from './ui';

/**
 * guide の見出し・補足・ボタン。担当を組むは担当を組むの画面へのリンク（`#/arrange?ym=`）、
 * 日の画面は onOpenDay（選んでいる日付を変えて日の画面へ）。primary が false なら主ボタンにしない（同じ画面に進み具合の帯の
 * 主ボタンがあるとき。主ボタンは1画面に1つ。PRD D238）
 */
export function EmptyNext({
  guide,
  icon: Icon,
  onOpenDay,
  primary = true,
  compact = false,
  testId,
}: {
  guide: EmptyGuide;
  icon: LucideIcon;
  onOpenDay: (date: string) => void;
  primary?: boolean;
  /** 横1行の帯にする（下に表・時間軸が続く画面。高さを取らない） */
  compact?: boolean;
  testId?: string;
}) {
  return (
    <div className={`empty-next${compact ? ' is-compact' : ''}`} data-testid={testId}>
      <Icon size={compact ? 20 : 28} strokeWidth={1.8} aria-hidden="true" />
      <div className="empty-next-text">
        <strong className="empty-next-title">{guide.title}</strong>
        <p className="sub">{guide.why}</p>
      </div>
      <div className="empty-next-actions">
        {guide.actions.map((a) => {
          const cls = `btn${compact ? ' btn-small' : ''}${primary && a.primary ? ' btn-primary' : ''}`;
          return a.kind === 'batch' ? (
            <Link key={`b-${a.ym}`} className={cls} to={batchHref(a.ym)} data-testid="empty-next-batch">
              <WithIcon icon={Sparkles}>{a.label}</WithIcon>
            </Link>
          ) : (
            <button
              key={`d-${a.date}`}
              type="button"
              className={cls}
              onClick={() => onOpenDay(a.date)}
              data-testid="empty-next-day"
            >
              <WithIcon icon={CalendarDays}>{a.label}</WithIcon>
            </button>
          );
        })}
      </div>
    </div>
  );
}
