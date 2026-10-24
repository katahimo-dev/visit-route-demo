import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { type ScheduleView, ViewSwitch } from './ViewSwitch';

/** 前・次へ送るボタン */
type Step = { label: string; onClick: () => void; disabled?: boolean };

/** 期間を選ぶ欄（月・週・日の単位の select） */
type Picker = {
  /** 読み上げ名（「月を選ぶ」など） */
  label: string;
  value: string;
  options: readonly { value: string; text: string }[];
  onChange: (value: string) => void;
  testId?: string;
};

/**
 * 予定の上のナビの行（PRD D347。ADR-0060）：日・週・月で同じ1行。
 * 左から［今日］［‹］期間 ▾［›］・［月｜週｜日］・右に状態の印と確定のボタン（actions）。
 * 送る単位は表示している単位（月は1か月、週は1週、日は1日）。上の帯（--header-h）の下に貼り付く（sticky）。
 * 日の予定の期間の欄は上の帯の日付の選択と同じ `.date-switch`（上の帯の日付の選択は予定の3画面では出さない）
 */
export function ScheduleNav({
  current,
  today,
  prev,
  next,
  picker,
  actions,
}: {
  current: ScheduleView;
  /** 「今日」：今日を含む期間へ。今日を含む期間を見ていれば押せない */
  today: { onClick: () => void; disabled: boolean };
  prev: Step;
  next: Step;
  picker: Picker;
  actions?: ReactNode;
}) {
  const options = picker.options.some((o) => o.value === picker.value)
    ? picker.options
    : [...picker.options, { value: picker.value, text: picker.value }];
  return (
    <div className="sched-nav" data-testid="sched-nav" data-view={current}>
      <div className="sched-nav-move">
        <button
          type="button"
          className="btn btn-small sched-nav-today"
          disabled={today.disabled}
          onClick={today.onClick}
          title={today.disabled ? '今日を含む期間を見ています' : '今日を含む期間へ'}
          data-testid="sched-today"
        >
          今日
        </button>
        <div className={`period-switch${current === 'day' ? ' date-switch' : ''}`}>
          <button
            type="button"
            className="icon-btn"
            aria-label={prev.label}
            disabled={prev.disabled}
            onClick={prev.onClick}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <select
            value={picker.value}
            onChange={(e) => picker.onChange(e.target.value)}
            aria-label={picker.label}
            data-testid={picker.testId}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.text}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-btn"
            aria-label={next.label}
            disabled={next.disabled}
            onClick={next.onClick}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <ViewSwitch current={current} />
      {actions && <div className="sched-nav-actions">{actions}</div>}
    </div>
  );
}
