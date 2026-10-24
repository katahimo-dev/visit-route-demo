import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { MODE_LABEL, modeLead, parseMode, SCHEDULE_MODES } from '../lib/scheduleMode';
import { useDemoData } from '../store';
import { useScheduleMode } from './useScheduleMode';
import { type ScheduleView, ViewSwitch } from './ViewSwitch';

/** 貼り付ける幅（styles.css の .sched-nav の sticky と同じ） */
const STICKY_QUERY = 'screen and (min-width: 861px)';

/** 前・次へ送るボタン */
type Step = { label: string; onClick: () => void; disabled?: boolean };

/** 期間を選ぶ欄（月・週・日の単位の select） */
type Picker = {
  /** 読み上げ名（「月を選ぶ」など） */
  label: string;
  value: string;
  /** 選べる期間（value を含めて渡す） */
  options: readonly { value: string; text: string }[];
  onChange: (value: string) => void;
  testId?: string;
};

/**
 * 予定の上のナビの行（PRD D347・D348。ADR-0060・0061）：日・週・月で同じ1行。
 * 左から［組む｜変更｜確認］（モード）・［今日］［‹］期間 ▾［›］・［月｜週｜日］・右に状態の印と確定のボタン（actions）。
 * 下にモードの1行の説明。URL の ?mode= で開くとそのモードを選ぶ（メニューの項目から）。
 * 送る単位は表示している単位（月は1か月、週は1週、日は1日）。861px 以上は上の帯（--header-h）の下に貼り付く（sticky）。
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
  const ref = useRef<HTMLDivElement>(null);
  const { mode, setMode } = useScheduleMode();
  const { data } = useDemoData();
  const staffTerm = data.org.terms.staff;
  const hasStandard = data.standard !== undefined;
  // ?mode= の付いた URL を開いた・押したら、そのたびに1回そのモードを選ぶ（メニューの同じ項目を押し直しても効くよう、
  // 移るごとの location.key で。描く前に選び、前のモードで一度描かない）
  const [params] = useSearchParams();
  const urlMode = parseMode(params.get('mode'));
  const navKey = useLocation().key;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 移るたび（navKey）に1回だけ当てる
  useLayoutEffect(() => {
    if (urlMode) setMode(urlMode);
  }, [navKey]);
  // 貼り付く行の高さ（--sched-nav-h）を測って出す。広い画面でも中身で2段に折り返すことがある（決め打ちにしない）。
  // 貼り付かない幅（860px 以下）・この行の無い画面では 0（html の scroll-padding-top が使う）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement.style;
    const mq = window.matchMedia(STICKY_QUERY);
    const put = () => {
      if (mq.matches) root.setProperty('--sched-nav-h', `${Math.round(el.getBoundingClientRect().height)}px`);
      else root.removeProperty('--sched-nav-h');
    };
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    mq.addEventListener('change', put);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', put);
      root.removeProperty('--sched-nav-h');
    };
  }, []);
  /** 見ている期間の文（読み上げの見出し・印刷） */
  const period = picker.options.find((o) => o.value === picker.value)?.text ?? picker.value;
  return (
    <div className="sched-nav" ref={ref} data-testid="sched-nav" data-view={current}>
      {/* 見ている期間の見出し（画面では読み上げだけ、印刷では見せる） */}
      <h2 className="sched-nav-period">{period}</h2>
      {/* モード（PRD D348）：仕事の段階で出す操作を絞る */}
      <fieldset className="segmented sched-mode" aria-label="モード" data-testid="mode-switch" data-mode={mode}>
        {SCHEDULE_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={m === mode ? 'is-on' : ''}
            aria-pressed={m === mode}
            title={modeLead(m, staffTerm)}
            onClick={() => setMode(m)}
            data-mode={m}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </fieldset>
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
            {picker.options.map((o) => (
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
      <p className="sched-mode-lead sub" data-testid="mode-lead">
        {modeLead(mode, staffTerm)}
        {/* 組み方の標準を登録していなければ入口を添える（PRD D348・D354。ADR-0062） */}
        {!hasStandard && (
          <>
            {' '}
            <Link to="/standard" className="btn btn-small btn-text" data-testid="mode-standard-link">
              組み方の標準を決める
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
