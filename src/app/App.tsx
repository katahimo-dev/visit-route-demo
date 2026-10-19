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
  ListTodo,
  type LucideIcon,
  Menu,
  Route as RouteIcon,
  Search,
  Settings,
  SlidersHorizontal,
  Tags,
  Timer,
  TriangleAlert,
  UserRound,
  UserX,
} from 'lucide-react';
import {
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CommandPalette, IS_MAC } from '../components/CommandPalette';
import { BrokenDataNotice, DataWatch } from '../components/DataNotices';
import { FeatureOffNotice } from '../components/FeatureOffNotice';
import { PersonPopoverProvider } from '../components/PersonPopover';
import { RebuildBand } from '../components/rebuildBand';
import { TourProvider } from '../components/Tour';
import { addDays, jstDate } from '../domain/time';
import { hashPathname, isPaletteShortcut, keepPaletteOn } from '../lib/commandPalette';
import { dateText } from '../lib/common';
import { featureLabel, featureOfLocation, isFeatureOffState, isOn } from '../lib/features';
import {
  bottomTabs,
  isActiveNav,
  isActiveTab,
  type MenuItem,
  menuSections,
  type NavIcon,
  type NavSection,
  navTitleParts,
} from '../lib/nav';
import { showsRebuildBand } from '../lib/rebuildBand';
import AvailabilityPage from '../pages/AvailabilityPage';
import ClientsPage from '../pages/ClientsPage';
import ComparePage from '../pages/ComparePage';
import CompatPage from '../pages/CompatPage';
import DataPage from '../pages/DataPage';
import HomePage from '../pages/HomePage';
import ItemsPage from '../pages/ItemsPage';
import MonthPage from '../pages/MonthPage';
import MonthPrintPage from '../pages/MonthPrintPage';
import PlanPage from '../pages/PlanPage';
import RulesPage from '../pages/RulesPage';
import SettingsPage from '../pages/SettingsPage';
import StaffPage from '../pages/StaffPage';
import StaffViewPage from '../pages/StaffViewPage';
import TypesPage from '../pages/TypesPage';
import VacancyPage from '../pages/VacancyPage';
import WeekPage from '../pages/WeekPage';
import WorkloadPage from '../pages/WorkloadPage';
import { useDemoData } from '../store';
import { DayProvider, useDay } from './day';
import { ErrorBoundary } from './ErrorBoundary';
import { NavDrawer } from './NavDrawer';

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
  // 切った機能の URL（ブックマーク・古いリンク・`?do=`）はホームへ移し、ホームの上で知らせる（PRD D213。ADR-0028）。
  // 管理者設定と土台の画面は表に無いので移さない（戻れなくならない）
  const { pathname, search } = useLocation();
  const needed = featureOfLocation(pathname, search);
  const blocked = needed !== null && !isOn(data.org.features, needed) ? needed : null;

  return (
    <DayProvider value={{ date, setDate: setPicked, dates }}>
      {/* 予定の名前から開く〈スタッフ〉・〈利用者さん〉の詳細（PRD D122〜D126）。吹き出しは画面全体で1つ */}
      <PersonPopoverProvider>
        {/* 控えの知らせ・別のタブの変更の知らせ（PRD D227。トースト） */}
        <DataWatch />
        {blocked ? (
          <Navigate to="/home" replace state={{ featureOff: blocked }} />
        ) : (
          <Routes>
            <Route path="/staff-view/:staffId" element={<Guarded element={<StaffViewPage />} />} />
            {/* 月の予定の印刷（PRD D70）：左のメニューの外（印刷にナビを出さない） */}
            <Route path="/month/print" element={<Guarded element={<MonthPrintPage />} />} />
            <Route element={<AdminShell />}>
              {/* 予定と AI案は1画面（#/plan。ADR-0009）。古いリンクの #/schedule はそこへ */}
              <Route path="/schedule" element={<Navigate to="/plan" replace />} />
              {/* ホーム「今日やること」（PRD D141。ADR-0025）：起動したとき（#/・知らない URL）の画面 */}
              <Route path="/home" element={<HomePage />} />
              <Route path="/plan" element={<PlanPage />} />
              <Route path="/month" element={<MonthPage />} />
              <Route path="/week" element={<WeekPage />} />
              <Route path="/workload" element={<WorkloadPage />} />
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
              {/* 管理者設定（PRD D210。ADR-0028）：機能の入り切り。だれでも開ける・切れない */}
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Route>
          </Routes>
        )}
      </PersonPopoverProvider>
    </DayProvider>
  );
}

/** 知らせを閉じたあと、フォーカスを画面の見出しへ */
function focusHeading() {
  requestAnimationFrame(() => {
    const h = document.querySelector<HTMLElement>('.app-main h1');
    if (!h) return;
    h.tabIndex = -1;
    h.focus();
  });
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

/** 左のメニュー（PRD D178・D179。並びは lib/nav の menuSections） */
type NavItem = MenuItem;

/** メニューの項目のアイコン */
const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  home: ListTodo,
  month: CalendarRange,
  week: CalendarClock,
  day: CalendarDays,
  compare: GitCompareArrows,
  absence: UserX,
  vacancy: CalendarSearch,
  clients: House,
  compat: HeartHandshake,
  staff: UserRound,
  hours: Clock,
  workload: Timer,
  rules: SlidersHorizontal,
  types: Layers,
  items: Tags,
  settings: Settings,
  data: Database,
};

/** スマホのメニューに切り替わる幅（styles.css の @media (max-width: 860px) と同じ。PRD D132） */
const NARROW_QUERY = '(max-width: 860px)';

function AdminShell() {
  const { data, saveError } = useDemoData();
  const terms = data.org.terms;
  const features = data.org.features;
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  /** 切った機能の URL から移ってきたときの、その機能（ホームの上に知らせを出す。PRD D213） */
  const featureOff = pathname === '/home' && isFeatureOffState(location.state) ? location.state.featureOff : null;
  /** スマホの引き出しを開いているか（PRD D133） */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const sideNavRef = useRef<HTMLElement>(null);
  const drawerId = useId();
  /**
   * コマンドパレットを開いた画面のパス（閉じていれば null。PRD D181）。開いたときの URL の hash から決める
   * （画面を移ってすぐ開いたとき、移った先の画面の描画より先に開いても、あとの「画面を移ったら閉じる」で閉じない）
   */
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
  const paletteOpen = paletteFor !== null;
  const openPalette = useCallback(() => setPaletteFor(hashPathname(window.location.hash)), []);
  // Ctrl+K（mac は ⌘K）でコマンドパレットを開く（PRD D181）。入力欄・テキストエリアの中でも開く（入れた文字はそのまま、閉じるとそこへ戻る）。
  // ほかの欄・確認・引き出し（aria-modal）が開いているあいだは開かない（そのときもブラウザの動きは止める）。開いたあとのキーはパレットが受ける
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e, IS_MAC)) return;
      // 開かないときもブラウザの動き（検索欄・アドレスバーへ移る）は止める
      e.preventDefault();
      if (document.querySelector('[aria-modal="true"]')) return;
      openPalette();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette]);
  // 画面を移ったら上へ。引き出しも閉じる（画面を選ぶと閉じる。PRD D133）
  // 本体はブロックにする（式本体だと戻り値が後始末として呼ばれる。Brave の scrollTo は値を返し「is not a function」になった）
  useEffect(() => {
    window.scrollTo(0, 0);
    setMenuOpen(false);
    // 移った先の画面で開き直したパレットは閉じない
    setPaletteFor((p) => keepPaletteOn(p, pathname));
  }, [pathname]);
  // 広い画面へ戻ったら引き出しを閉じる（左のメニューが出るので）
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => {
      if (!mq.matches) setMenuOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  // スマホでは上の帯が2段に折り返すことがあるので、帯の高さ（--header-h。この下に貼り付く要素が使う）を測って出す。
  // 広い画面では styles.css の値（72px）のまま
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const mq = window.matchMedia(NARROW_QUERY);
    const root = document.documentElement.style;
    const put = () => {
      if (mq.matches) root.setProperty('--header-h', `${Math.round(el.getBoundingClientRect().height)}px`);
      else root.removeProperty('--header-h');
    };
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    mq.addEventListener('change', put);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', put);
      root.removeProperty('--header-h');
    };
  }, []);
  // メニューの並び（PRD D178〜D180。ADR-0027）：ホーム／予定を組む／当日の対応／問い合わせ／人の情報／AI の考え方／データ。
  // ルートの URL は変えない。当日の対応の「欠勤・キャンセル」は今日の日の画面の欄を開く操作（今の画面の印は付けない）
  const today = jstDate(Date.now());
  // 切った機能の項目は出さない（PRD D213）。下のタブ・上の帯の名前・パレットの画面もここから引く
  const groups = useMemo(() => menuSections(terms, today, features), [terms, today, features]);
  const brand = (
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
  );
  /** 上の帯の今の画面の名前（スマホ。PRD D132・D179。見出し・項目名） */
  const screenName = navTitleParts(groups, pathname);
  return (
    // 初回の案内ツアー（PRD D192・D193）：まだ見ていなければ起動したときに中央のカードで出す。データの画面からもう一度開ける
    <TourProvider terms={terms}>
      <div className="app-shell">
        <aside ref={sideNavRef} className="side-nav">
          {brand}
          <NavGroups groups={groups} pathname={pathname} />
        </aside>
        <div className="app-body">
          <header ref={headerRef} className="app-header">
            {/* スマホだけ：ロゴと今の画面の名前・「メニュー」ボタン（PRD D132。広い画面では出さない） */}
            <div className="m-head-title">
              <span className="brand-mark" aria-hidden="true">
                <RouteIcon size={18} strokeWidth={2.4} />
              </span>
              <strong className="m-screen-name" data-testid="screen-name">
                {/* 見出しと項目名はそれぞれひとまとまりで折り返す（入りきらなければ項目名を次の行へ。PRD D179） */}
                {screenName ? (
                  <>
                    {screenName.group && <span className="m-screen-group">{screenName.group}・</span>}
                    <span className="m-screen-item">{screenName.item}</span>
                  </>
                ) : (
                  data.org.name
                )}
              </strong>
            </div>
            {/* コマンドパレットを開く（PRD D181。広い画面は「探す・移動」とキーの印、狭い画面は「探す」） */}
            <button
              type="button"
              className="btn btn-small cmdk-open"
              aria-haspopup="dialog"
              aria-expanded={paletteOpen}
              aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'}
              onClick={openPalette}
              data-testid="cmdk-open"
            >
              <Search size={16} aria-hidden="true" />
              <span>
                探す<span className="cmdk-open-more">・移動</span>
              </span>
              <span className="cmdk-open-kbd" aria-hidden="true">
                <kbd>{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
              </span>
            </button>
            <button
              ref={menuBtnRef}
              type="button"
              className="btn btn-small m-menu-btn"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? drawerId : undefined}
              onClick={() => setMenuOpen(true)}
              data-testid="menu-btn"
            >
              <Menu size={18} aria-hidden="true" />
              メニュー
            </button>
            <DateSwitcher />
          </header>
          {saveError && (
            <div className="save-error">
              <TriangleAlert size={16} aria-hidden="true" />
              {saveError} <NavLink to="/data">データを書き出す</NavLink>
            </div>
          )}
          <main className="app-main">
            <Guarded
              element={
                <>
                  {/* 設定の画面：条件が変わった日があれば作り直しの帯（PRD D161。画面ごとに［後で］を戻すので key は画面） */}
                  {showsRebuildBand(pathname) && <RebuildBand key={pathname} rules={pathname === '/rules'} />}
                  {/* 保存していたデータを読めず初期データで開いた知らせ（PRD D227）。閉じたらフォーカスは画面の見出しへ */}
                  <BrokenDataNotice onClose={focusHeading} />
                  {featureOff && (
                    <FeatureOffNotice
                      name={featureLabel(featureOff, terms)}
                      onClose={() => {
                        // 知らせを閉じる（URL はそのまま。state だけ消す）。フォーカスは画面の見出しへ
                        navigate('/home', { replace: true, state: null });
                        focusHeading();
                      }}
                    />
                  )}
                  <Outlet />
                </>
              }
            />
          </main>
          {/* スマホだけ：よく使う5つのタブ（ホーム・月・週・日・空き状況。PRD D134・D144。印刷では出さない） */}
          <nav className="bottom-tabs" aria-label="よく使う画面" data-testid="bottom-tabs">
            {bottomTabs(groups).map(({ to, label, icon }) => {
              const Icon = NAV_ICONS[icon];
              // 比較はタブに無いので「日」（PRD D134・D180）
              const on = isActiveTab(to, pathname);
              return (
                <Link
                  key={to}
                  to={to}
                  className={on ? 'bottom-tab active' : 'bottom-tab'}
                  aria-current={on ? 'page' : undefined}
                  onClick={(e) => {
                    // 今の画面のタブは何もしない（押し直して URL のクエリ＝画面の状態を消さない）
                    if (to === pathname) e.preventDefault();
                  }}
                  data-testid="bottom-tab"
                >
                  <Icon size={20} strokeWidth={2.1} aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        {paletteOpen && <CommandPalette sections={groups} terms={terms} onClose={() => setPaletteFor(null)} />}
        {menuOpen && (
          <NavDrawer
            id={drawerId}
            label="メニュー"
            onClose={() => setMenuOpen(false)}
            // 広い画面へ戻して閉じたときは「メニュー」ボタンが隠れているので、左のメニューの今の項目へ
            returnFocus={() =>
              window.matchMedia(NARROW_QUERY).matches
                ? menuBtnRef.current
                : (sideNavRef.current?.querySelector<HTMLElement>('[aria-current="page"]') ??
                  sideNavRef.current?.querySelector<HTMLElement>('a[href]'))
            }
            head={brand}
          >
            <NavGroups
              groups={groups}
              pathname={pathname}
              onPick={(e, to) => {
                // 今の画面の項目は閉じるだけ（移り直して URL のクエリ＝画面の状態を消さない）
                if (to === pathname) e.preventDefault();
                setMenuOpen(false);
              }}
            />
          </NavDrawer>
        )}
      </div>
    </TourProvider>
  );
}

/** メニューの並び（左のメニューとスマホの引き出しで共通。グループの見出し付きの縦並び） */
function NavGroups({
  groups,
  pathname,
  onPick,
}: {
  groups: readonly NavSection<NavItem>[];
  pathname: string;
  /** 項目を押したとき（引き出しを閉じる。今の画面なら移らない） */
  onPick?: (e: MouseEvent<HTMLAnchorElement>, to: string) => void;
}) {
  return (
    <nav className="nav-groups" aria-label="画面の一覧">
      {groups.map((g) => (
        <div key={g.items[0]!.to} className="nav-group">
          {g.title && <h2 className="nav-group-title">{g.title}</h2>}
          {g.items.map(({ to, label, icon }) => {
            const Icon = NAV_ICONS[icon];
            // 今の画面の印（比較は「案を比べる」。操作の項目（欠勤・キャンセル）には付けない。PRD D180）
            const on = isActiveNav(to, pathname);
            return (
              <Link
                key={to}
                to={to}
                className={on ? 'nav-link active' : 'nav-link'}
                aria-current={on ? 'page' : undefined}
                onClick={(e) => onPick?.(e, to)}
                data-testid="nav-link"
              >
                <Icon size={18} strokeWidth={2.1} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
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
