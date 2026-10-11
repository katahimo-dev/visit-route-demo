import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { addDays } from '../domain/time';
import { dateText } from '../lib/common';
import AvailabilityPage from '../pages/AvailabilityPage';
import ClientsPage from '../pages/ClientsPage';
import ComparePage from '../pages/ComparePage';
import CompatPage from '../pages/CompatPage';
import DataPage from '../pages/DataPage';
import ItemsPage from '../pages/ItemsPage';
import PlanPage from '../pages/PlanPage';
import RulesPage from '../pages/RulesPage';
import SchedulePage from '../pages/SchedulePage';
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
  const [picked, setPicked] = useState(data.baseDate);
  const date = dates.includes(picked) ? picked : (dates[0] ?? data.baseDate);

  return (
    <DayProvider value={{ date, setDate: setPicked, dates }}>
      <Routes>
        <Route path="/staff-view/:staffId" element={<Guarded element={<StaffViewPage />} />} />
        <Route element={<AdminShell />}>
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/compat" element={<CompatPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/availability" element={<AvailabilityPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="*" element={<Navigate to="/schedule" replace />} />
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
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <strong>{data.org.name}</strong>
          <span className="demo-note">デモ：データはこのブラウザだけに保存。実在の個人情報は入れない</span>
        </div>
        <nav className="top-nav">
          <NavLink to="/schedule">予定</NavLink>
          <NavLink to="/plan">AI案</NavLink>
          <NavLink to="/compare">比較</NavLink>
          <NavLink to="/rules">条件</NavLink>
          <NavLink to="/items">項目</NavLink>
          <NavLink to="/compat">相性</NavLink>
          <NavLink to="/staff">{terms.staff}</NavLink>
          <NavLink to="/clients">{terms.client}</NavLink>
          <NavLink to="/availability">稼働時間</NavLink>
          <NavLink to="/data">データ</NavLink>
        </nav>
        <DateSwitcher />
      </header>
      {saveError && (
        <div className="save-error">
          {saveError} <NavLink to="/data">データを書き出す</NavLink>
        </div>
      )}
      <main className="app-main">
        <Guarded element={<Outlet />} />
      </main>
    </div>
  );
}

/** 日付の切り替え（データの中の日付から選ぶ） */
function DateSwitcher() {
  const { date, setDate, dates } = useDay();
  const i = dates.indexOf(date);
  return (
    <div className="date-switch">
      <button
        type="button"
        className="btn btn-small"
        disabled={i <= 0}
        onClick={() => setDate(dates[i - 1] ?? date)}
        aria-label="前の日"
      >
        ◀
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
        className="btn btn-small"
        disabled={i < 0 || i >= dates.length - 1}
        onClick={() => setDate(dates[i + 1] ?? date)}
        aria-label="次の日"
      >
        ▶
      </button>
    </div>
  );
}
