import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarSearch,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  FlaskConical,
  GitCompareArrows,
  HeartHandshake,
  House,
  Layers,
  type LucideIcon,
  Route as RouteIcon,
  SlidersHorizontal,
  Tags,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { addDays, jstDate } from '../domain/time';
import { dateText } from '../lib/common';
import AvailabilityPage from '../pages/AvailabilityPage';
import ClientsPage from '../pages/ClientsPage';
import ComparePage from '../pages/ComparePage';
import CompatPage from '../pages/CompatPage';
import DataPage from '../pages/DataPage';
import ItemsPage from '../pages/ItemsPage';
import MonthPage from '../pages/MonthPage';
import MonthPrintPage from '../pages/MonthPrintPage';
import PlanPage from '../pages/PlanPage';
import RulesPage from '../pages/RulesPage';
import StaffPage from '../pages/StaffPage';
import StaffViewPage from '../pages/StaffViewPage';
import TypesPage from '../pages/TypesPage';
import VacancyPage from '../pages/VacancyPage';
import WeekPage from '../pages/WeekPage';
import { useDemoData } from '../store';
import { DayProvider, useDay } from './day';
import { ErrorBoundary } from './ErrorBoundary';

/** seed は基準日から14日分 */
const DAYS = 14;

/** 画面全体：日付の文脈と、ルート（design.md §4 pages） */
export default function App() {
  const { data } = useDemoData();
  // 最初は今日（データに今日が無ければ基準日）。日がたってから開いても今日から始める。
  // 画面から選んだ日（月間カレンダーの訪問の無い日など）は、データに無い日でも選べる（explicit）
  const [pick, setPick] = useState(() => ({ date: jstDate(Date.now()), explicit: false }));
  const picked = pick.date;
  const setPicked = useCallback((d: string) => setPick({ date: d, explicit: true }), []);
  // データの中の日付（基準日から14日＋訪問のある日。定期パターンから展開した月の訪問も含む）＋画面から選んだ日
  const dates = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < DAYS; i++) set.add(addDays(data.baseDate, i));
    for (const v of data.visits) set.add(v.date);
    if (pick.explicit && /^\d{4}-\d{2}-\d{2}$/.test(pick.date)) set.add(pick.date);
    return [...set].sort();
  }, [data.baseDate, data.visits, pick]);
  const date = dates.includes(picked)
    ? picked
    : dates.includes(data.baseDate)
      ? data.baseDate
      : (dates[0] ?? data.baseDate);

  return (
    <DayProvider value={{ date, setDate: setPicked, dates }}>
      <Routes>
        <Route path="/staff-view/:staffId" element={<Guarded element={<StaffViewPage />} />} />
        {/* 月の予定の印刷（PRD D70）：左のメニューの外（印刷にナビを出さない） */}
        <Route path="/month/print" element={<Guarded element={<MonthPrintPage />} />} />
        <Route element={<AdminShell />}>
          {/* 予定と AI案は1画面（#/plan。ADR-0009）。古いリンクの #/schedule はそこへ */}
          <Route path="/schedule" element={<Navigate to="/plan" replace />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/month" element={<MonthPage />} />
          <Route path="/week" element={<WeekPage />} />
          <Route path="/vacancy" element={<VacancyPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/types" element={<TypesPage />} />
          <Route path="/compat" element={<CompatPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/availability" element={<AvailabilityPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="*" element={<Navigate to="/plan" replace />} />
        </Route>
      </Routes>
    </DayProvider>
  );
}

/** 画面ごとの例外の受け止め（ページを移ると戻る） */
function Guarded({ element }: { element: ReactElement }) {
  const { reset } = useDemoData();
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname} onReset={reset}>
      {element}
    </ErrorBoundary>
  );
}

/** 左のメニュー：予定（月・週・日）・問い合わせ・登録・決まり・その他（PRD D59） */
type NavItem = { to: string; label: string; icon: LucideIcon };

function AdminShell() {
  const { data, saveError } = useDemoData();
  const terms = data.org.terms;
  const { pathname } = useLocation();
  // 画面を移ったら上へ
  // 本体はブロックにする（式本体だと戻り値が後始末として呼ばれる。Brave の scrollTo は値を返し「is not a function」になった）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 画面を移ったときだけ
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  // 動線の整理（PRD D59）：予定（月・週・日）／問い合わせ／登録／決まり／その他。ルートの URL は変えない
  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: '予定',
      items: [
        { to: '/month', label: '月', icon: CalendarRange },
        { to: '/week', label: '週', icon: CalendarClock },
        { to: '/plan', label: '日', icon: CalendarDays },
      ],
    },
    {
      title: '問い合わせ',
      items: [{ to: '/vacancy', label: '空き状況', icon: CalendarSearch }],
    },
    {
      title: '登録',
      items: [
        { to: '/clients', label: terms.client, icon: House },
        { to: '/staff', label: terms.staff, icon: UserRound },
        { to: '/availability', label: '稼働時間', icon: Clock },
      ],
    },
    {
      title: '決まり',
      items: [
        { to: '/rules', label: '条件', icon: SlidersHorizontal },
        { to: '/items', label: '項目', icon: Tags },
        { to: '/types', label: '種類', icon: Layers },
        { to: '/compat', label: '相性', icon: HeartHandshake },
      ],
    },
    {
      title: 'その他',
      items: [
        { to: '/compare', label: '比較', icon: GitCompareArrows },
        { to: '/data', label: 'データ', icon: Database },
      ],
    },
  ];
  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <RouteIcon size={20} strokeWidth={2.4} />
          </span>
          <div className="brand-text">
            <strong>{data.org.name}</strong>
            <span className="demo-badge" title="データはこのブラウザだけに保存。実在の個人情報は入れない">
              <FlaskConical size={12} aria-hidden="true" />
              デモ（ブラウザ内に保存）
            </span>
          </div>
        </div>
        <nav className="nav-groups">
          {groups.map((g) => (
            <div key={g.title} className="nav-group">
              <span className="nav-group-title">{g.title}</span>
              {g.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className="nav-link">
                  <Icon size={18} strokeWidth={2.1} aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="app-body">
        <header className="app-header">
          <DateSwitcher />
        </header>
        {saveError && (
          <div className="save-error">
            <TriangleAlert size={16} aria-hidden="true" />
            {saveError} <NavLink to="/data">データを書き出す</NavLink>
          </div>
        )}
        <main className="app-main">
          <Guarded element={<Outlet />} />
        </main>
      </div>
    </div>
  );
}

/** 日付の切り替え（データの中の日付から選ぶ） */
function DateSwitcher() {
  const { date, setDate, dates } = useDay();
  const i = dates.indexOf(date);
  return (
    <div className="date-switch">
      <CalendarDays size={18} className="date-icon" aria-hidden="true" />
      <button
        type="button"
        className="icon-btn"
        disabled={i <= 0}
        onClick={() => setDate(dates[i - 1] ?? date)}
        aria-label="前の日"
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <select value={date} onChange={(e) => setDate(e.target.value)} aria-label="日付">
        {dates.map((d) => (
          <option key={d} value={d}>
            {dateText(d)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="icon-btn"
        disabled={i < 0 || i >= dates.length - 1}
        onClick={() => setDate(dates[i + 1] ?? date)}
        aria-label="次の日"
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
