import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  FlaskConical,
  GitCompareArrows,
  HeartHandshake,
  House,
  type LucideIcon,
  Route as RouteIcon,
  SlidersHorizontal,
  Tags,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { addDays, jstDate } from '../domain/time';
import { dateText } from '../lib/common';
import AvailabilityPage from '../pages/AvailabilityPage';
import ClientsPage from '../pages/ClientsPage';
import ComparePage from '../pages/ComparePage';
import CompatPage from '../pages/CompatPage';
import DataPage from '../pages/DataPage';
import ItemsPage from '../pages/ItemsPage';
import PlanPage from '../pages/PlanPage';
import RulesPage from '../pages/RulesPage';
import StaffPage from '../pages/StaffPage';
import StaffViewPage from '../pages/StaffViewPage';
import { useDemoData } from '../store';
import { DayProvider, useDay } from './day';
import { ErrorBoundary } from './ErrorBoundary';

/** seed は基準日から14日分 */
const DAYS = 14;

/** 画面全体：日付の文脈と、ルート（design.md §4 pages） */
export default function App() {
  const { data } = useDemoData();
  // データの中の日付（基準日から14日＋訪問のある日）
  const dates = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < DAYS; i++) set.add(addDays(data.baseDate, i));
    for (const v of data.visits) set.add(v.date);
    return [...set].sort();
  }, [data.baseDate, data.visits]);
  // 最初は今日（データに今日が無ければ基準日）。日がたってから開いても今日から始める
  const [picked, setPicked] = useState(() => jstDate(Date.now()));
  const date = dates.includes(picked)
    ? picked
    : dates.includes(data.baseDate)
      ? data.baseDate
      : (dates[0] ?? data.baseDate);

  return (
    <DayProvider value={{ date, setDate: setPicked, dates }}>
      <Routes>
        <Route path="/staff-view/:staffId" element={<Guarded element={<StaffViewPage />} />} />
        <Route element={<AdminShell />}>
          {/* 予定と AI案は1画面（#/plan。ADR-0009）。古いリンクの #/schedule はそこへ */}
          <Route path="/schedule" element={<Navigate to="/plan" replace />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/items" element={<ItemsPage />} />
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

/** 左のメニュー：毎日の作業と、ふだんは触らない設定を分ける */
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
  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: '毎日の作業',
      items: [
        { to: '/plan', label: '予定', icon: CalendarDays },
        { to: '/compare', label: '比較', icon: GitCompareArrows },
      ],
    },
    {
      title: '人と予定',
      items: [
        { to: '/staff', label: terms.staff, icon: UserRound },
        { to: '/clients', label: terms.client, icon: House },
        { to: '/availability', label: '稼働時間', icon: Clock },
      ],
    },
    {
      title: '割当の決まり',
      items: [
        { to: '/rules', label: '条件', icon: SlidersHorizontal },
        { to: '/items', label: '項目', icon: Tags },
        { to: '/compat', label: '相性', icon: HeartHandshake },
      ],
    },
    {
      title: 'その他',
      items: [{ to: '/data', label: 'データ', icon: Database }],
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
