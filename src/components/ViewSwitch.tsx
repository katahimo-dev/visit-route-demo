import { CalendarClock, CalendarDays, CalendarRange, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDay } from '../app/day';
import { ymOf } from '../lib/month';

/** 予定の3つの画面 */
export type ScheduleView = 'month' | 'week' | 'day';

const VIEWS: { view: ScheduleView; label: string; icon: LucideIcon }[] = [
  { view: 'month', label: '月', icon: CalendarRange },
  { view: 'week', label: '週', icon: CalendarClock },
  { view: 'day', label: '日', icon: CalendarDays },
];

/** 選んでいる日付で開く先：月はその日の月、週はその日を含む週、日はその日 */
export function viewPath(view: ScheduleView, date: string): string {
  if (view === 'month') return `/month?ym=${ymOf(date)}`;
  if (view === 'week') return `/week?d=${date}`;
  return '/plan';
}

/**
 * 予定の共通の切り替え［月｜週｜日］（PRD D59・D237。design.md §4 pages「動線の整理」）。
 * 見出しの題名の下のタブ（PageHeader の nav。role=tablist ではなくリンクのナビ）。
 * 今の画面は aria-current と太字・下線（色だけに頼らない）。押すと選んでいる日付（useDay）で移る
 */
export function ViewSwitch({ current }: { current: ScheduleView }) {
  const { date } = useDay();
  return (
    <nav className="view-switch" aria-label="予定の表示の切り替え" data-testid="view-switch">
      {VIEWS.map(({ view, label, icon: Icon }) => {
        const on = view === current;
        return (
          <Link
            key={view}
            to={viewPath(view, date)}
            className={`view-switch-item${on ? ' is-on' : ''}`}
            aria-current={on ? 'page' : undefined}
            data-view={view}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
