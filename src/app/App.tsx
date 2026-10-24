import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarSearch,
  ChevronDown,
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
  Users,
  UserX,
} from 'lucide-react';
import {
  Fragment,
  type MouseEvent,
  type ReactElement,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BatchBand, MonthBatchHost } from '../components/batchBand';
import { CommandPalette, IS_MAC } from '../components/CommandPalette';
import { BrokenDataNotice, DataWatch } from '../components/DataNotices';
import { FeatureOffNotice } from '../components/FeatureOffNotice';
import { PersonPopoverProvider } from '../components/PersonPopover';
import { TourProvider } from '../components/Tour';
import { HistoryKeys } from '../components/undo';
import { useScheduleMode } from '../components/useScheduleMode';
import { VisitPanelProvider } from '../components/VisitPanel';
import { addDays, jstDate } from '../domain/time';
import { hashPathname, isPaletteShortcut, keepPaletteOn } from '../lib/commandPalette';
import { dateText } from '../lib/common';
import { featureLabel, featureOfLocation, isFeatureOffState, isOn } from '../lib/features';
import {
  activeNavPath,
  bottomTabs,
  isActiveNav,
  isPeoplePath,
  isScheduleView,
  isSettingsPath,
  type LastViews,
  type MenuItem,
  menuSections,
  NAV_OPEN_DEFAULT,
  type NavIcon,
  type NavSection,
  navTitleParts,
  screenSections,
  showsDateSwitch,
  tabClick,
  tabLabel,
} from '../lib/nav';
import { menuBadges, type ScheduleMode } from '../lib/scheduleMode';
import { NARROW_QUERY } from '../lib/useMedia';
import AvailabilityPage from '../pages/AvailabilityPage';
import ClientPage from '../pages/ClientPage';
import ClientsPage from '../pages/ClientsPage';
import DataPage from '../pages/DataPage';
import HomePage from '../pages/HomePage';
import ItemsPage from '../pages/ItemsPage';
import MonthPrintPage from '../pages/MonthPrintPage';
import RulesPage from '../pages/RulesPage';
import SettingsPage from '../pages/SettingsPage';
import StaffPage from '../pages/StaffPage';
import StaffPersonPage from '../pages/StaffPersonPage';
import StaffViewPage from '../pages/StaffViewPage';
import TypesPage from '../pages/TypesPage';
import WeekPage from '../pages/WeekPage';
import WorkloadPage from '../pages/WorkloadPage';
import { useDemoData } from '../store';
import { DayProvider, useDay } from './day';
import { ErrorBoundary } from './ErrorBoundary';
import { ComparePage, CompatPage, MonthPage, PageLoading, PlanPage, PreloadWhenShown, VacancyPage } from './lazyPages';
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
        {/* 全体の「元に戻す・やり直す」のキー（Ctrl+Z・Ctrl+Shift+Z。PRD D329。ADR-0054） */}
        <HistoryKeys />
        {/* 月まとめ作成の計算を画面の外で続ける（PRD D256・D257。ADR-0042）：store につなぎ、終わったら知らせる */}
        <MonthBatchHost />
        {/* 訪問の詳細の欄（PRD D301〜D304。ADR-0051）：どの画面・コマンドパレットからでも開ける。欄は画面全体で1つ */}
        <VisitPanelProvider>
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
                {/* ホーム（見出しの下に「今日やること」。PRD D141・D230。ADR-0025・0034）：起動したとき（#/・知らない URL）の画面 */}
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
                {/* 〈スタッフ〉・〈利用者さん〉の画面（全画面。PRD D308。ADR-0052）。new は新しい人 */}
                <Route path="/staff/:staffId" element={<StaffPersonPage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/clients/:id" element={<ClientPage />} />
                <Route path="/availability" element={<AvailabilityPage />} />
                <Route path="/data" element={<DataPage />} />
                {/* 管理者設定（PRD D210。ADR-0028）：機能の入り切り。だれでも開ける・切れない */}
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/home" replace />} />
              </Route>
            </Routes>
          )}
        </VisitPanelProvider>
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
  // 〈利用者さん〉・〈スタッフ〉の画面は人が替わっても同じ画面（作り直さない。変更があるまま別の人へ移るときに確かめるため。PRD D308）
  const page = pathname.replace(/^\/(clients|staff)\/[^/]+$/, '/$1/:id');
  return (
    <ErrorBoundary key={page} onReset={reset}>
      {element}
    </ErrorBoundary>
  );
}

/** 左のメニュー（PRD D273〜D275。並びは lib/nav の menuSections） */
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
  people: Users,
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

/**
 * メニューの「予定」「設定」で開く、最後に開いた表示・タブ（PRD D273・D275）。開いている間だけ覚える
 * （画面の状態なので保存しない。AdminShell の外の画面（印刷・〈スタッフ〉のスマホ画面）から戻っても残るよう、モジュールに置く）
 */
const lastViews: LastViews = {};

/** 今の画面が予定の表示・設定のタブ・人のタブなら覚える（同じ値を何度書いても同じ） */
function rememberView(pathname: string): LastViews {
  if (isScheduleView(pathname)) lastViews.schedule = activeNavPath(pathname);
  if (isSettingsPath(pathname)) lastViews.settings = pathname;
  if (isPeoplePath(pathname)) lastViews.people = activeNavPath(pathname);
  return { ...lastViews };
}

function AdminShell() {
  const { data, saveError } = useDemoData();
  /** 選んでいる日付（日付の選択を出さない画面でも覚えたまま。外枠の data-date で読める。PRD D267） */
  const { date: pickedDate } = useDay();
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
  // メニューの並び（PRD D178〜D180・D230〜D232。ADR-0027・0034）：ホーム／予定／当日・問い合わせ／人／AI の条件／設定。
  // ルートの URL は変えない。当日・問い合わせの「欠勤・キャンセルを登録」は今日の日の予定の欄を開く操作（今の画面の印は付けない）
  const today = jstDate(Date.now());
  // 「予定」「設定」は最後に開いた表示・タブを開く（PRD D273・D275）
  const last = rememberView(pathname);
  const lastSchedule = last.schedule;
  const lastSettings = last.settings;
  const lastPeople = last.people;
  // 切った機能の項目は出さない（PRD D213）。下のタブもここから引く
  // 予定のモード（PRD D348）と件数の印（PRD D349。compile しないので軽い）
  const { mode } = useScheduleMode();
  const badges = useMemo(() => menuBadges(data, today), [data, today]);
  const groups = useMemo(
    () =>
      menuSections(
        terms,
        today,
        features,
        { schedule: lastSchedule, settings: lastSettings, people: lastPeople },
        badges,
      ),
    [terms, today, features, lastSchedule, lastSettings, lastPeople, badges],
  );
  // 画面の一覧（メニューから外した画面も1つずつ）：上の帯の名前・パレットの画面（PRD D273・D275）
  const screens = useMemo(() => screenSections(terms, features), [terms, features]);
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
  const screenName = navTitleParts(screens, pathname);
  return (
    // 初回の案内ツアー（PRD D192・D193）：まだ見ていなければ起動したときに中央のカードで出す。データの画面からもう一度開ける
    <TourProvider terms={terms}>
      <div className="app-shell" data-date={pickedDate}>
        <aside ref={sideNavRef} className="side-nav">
          {brand}
          <NavGroups groups={groups} pathname={pathname} mode={mode} />
        </aside>
        <div className="app-body">
          <header ref={headerRef} className="app-header">
            {/* 月まとめ作成の進み具合と［止める］（PRD D256。ほかの画面へ移っても続く。月の予定では画面の中に出す） */}
            <BatchBand />
            {/* スマホだけ：ロゴと今の画面の名前（PRD D132。広い画面では出さない。「メニュー」は下のタブ。PRD D336） */}
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
            {/* 日付の選択は日付で中身が変わる画面だけ（PRD D267） */}
            {showsDateSwitch(pathname) && <DateSwitcher />}
          </header>
          {saveError && (
            <div className="save-error" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              {saveError} <NavLink to="/data">データを書き出す</NavLink>
            </div>
          )}
          <main className="app-main">
            {/* 分けた画面（PRD D248）を読む間。画面を移るときは前の画面のまま待つ（移動は transition）ので、出るのは最初に開いたときだけ */}
            <Suspense fallback={<PageLoading />}>
              <Guarded
                element={
                  <>
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
                    {/* 画面が出たあと（読み込み中の表示のあいだは数えない）に、分けた画面と地図を先に読む */}
                    <PreloadWhenShown />
                  </>
                }
              />
            </Suspense>
          </main>
          {/* スマホだけ：よく使うタブ（ホーム・予定・欠勤）と「探す」「メニュー」（PRD D336。印刷では出さない） */}
          <nav className="bottom-tabs" aria-label="よく使う画面" data-testid="bottom-tabs">
            {bottomTabs(groups).map((item) => {
              const { key, to, icon } = item;
              const Icon = NAV_ICONS[icon];
              // 「予定」は月・週・日の予定と比較で印（PRD D273）。欠勤は操作なので印を付けない
              const on = isActiveNav(item, pathname);
              const click = tabClick(item, pathname);
              return (
                <Link
                  key={key}
                  to={to}
                  className={on ? 'bottom-tab active' : 'bottom-tab'}
                  aria-current={on ? 'page' : undefined}
                  onClick={(e) => {
                    // 今の画面のタブは何もしない（押し直して URL のクエリ＝画面の状態を消さない）
                    if (click === 'stay') e.preventDefault();
                  }}
                  data-testid="bottom-tab"
                  data-tab={key}
                >
                  <Icon size={20} strokeWidth={2.1} aria-hidden="true" />
                  <span>{tabLabel(item)}</span>
                </Link>
              );
            })}
            {/* 「探す」：コマンドパレットを開く（PRD D336。上の帯から下のタブへ移した。空き状況はメニューと探すから） */}
            <button
              type="button"
              className="bottom-tab"
              aria-haspopup="dialog"
              aria-expanded={paletteOpen}
              onClick={openPalette}
              data-testid="bottom-search"
              data-tab="search"
            >
              <Search size={20} strokeWidth={2.1} aria-hidden="true" />
              <span>探す</span>
            </button>
            {/* 「メニュー」：全部の画面の引き出し（PRD D133・D336。上の帯から下のタブの最後へ移した） */}
            <button
              ref={menuBtnRef}
              type="button"
              className="bottom-tab m-menu-btn"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? drawerId : undefined}
              onClick={() => setMenuOpen(true)}
              data-testid="menu-btn"
            >
              <Menu size={20} strokeWidth={2.1} aria-hidden="true" />
              <span>メニュー</span>
            </button>
          </nav>
        </div>
        {paletteOpen && <CommandPalette sections={screens} terms={terms} onClose={() => setPaletteFor(null)} />}
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
              mode={mode}
              onPick={(e, item) => {
                // 今の画面の項目は閉じるだけ（移り直して URL のクエリ＝画面の状態を消さない）
                if (tabClick(item, pathname) === 'stay') e.preventDefault();
                setMenuOpen(false);
              }}
            />
          </NavDrawer>
        )}
      </div>
    </TourProvider>
  );
}

/** 畳める項目の開け閉めを覚える所（PRD D349。この端末に残す。左のメニューと引き出しで1つ） */
const NAV_OPEN_KEY = 'visit-route-demo:nav-open';
const navOpenListeners = new Set<() => void>();
/** 覚えた開け閉め（読めなければ空。同じ文字なら同じ物を返す＝描き直さない） */
let navOpenCache: { raw: string | null; value: Record<string, boolean> } = { raw: null, value: {} };
const readNavOpen = (): Record<string, boolean> => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(NAV_OPEN_KEY);
  } catch {
    return navOpenCache.value;
  }
  if (raw === navOpenCache.raw) return navOpenCache.value;
  let value: Record<string, boolean> = {};
  try {
    const v = JSON.parse(raw ?? '{}');
    if (v && typeof v === 'object') value = v;
  } catch {
    // 読めなければ既定
  }
  navOpenCache = { raw, value };
  return value;
};
const writeNavOpen = (key: string, open: boolean) => {
  const next = { ...readNavOpen(), [key]: open };
  try {
    localStorage.setItem(NAV_OPEN_KEY, JSON.stringify(next));
  } catch {
    navOpenCache = { raw: navOpenCache.raw, value: next };
  }
  for (const fn of navOpenListeners) fn();
};
const subscribeNavOpen = (fn: () => void) => {
  navOpenListeners.add(fn);
  return () => navOpenListeners.delete(fn);
};

/**
 * メニューの並び（左のメニューとスマホの引き出しで共通。グループの見出し付きの縦並び）。
 * 子の項目を持つ項目は ▾ で畳める（PRD D349）。押して変えた開け閉めは覚える。今の画面の親は、その親へ移ったときに開いて見せる
 * （覚えない。同じ親の中で画面を移っても、畳んだら畳んだまま）。
 * 今の画面の印は、開いていれば子に、畳んでいれば親に付ける（予定の子は予定のモードで決める）
 */
function NavGroups({
  groups,
  pathname,
  mode,
  onPick,
}: {
  groups: readonly NavSection<NavItem>[];
  pathname: string;
  mode: ScheduleMode;
  /** 項目を押したとき（引き出しを閉じる。今の画面なら移らない） */
  onPick?: (e: MouseEvent<HTMLAnchorElement>, item: NavItem) => void;
}) {
  const stored = useSyncExternalStore(subscribeNavOpen, readNavOpen, () => navOpenCache.value);
  // 今の画面の親。その親へ移ったときだけ開いて見せる（auto）。押して畳めば auto を外す
  const currentParent = groups.flatMap((g) => g.items).find((i) => i.children?.length && isActiveNav(i, pathname))?.key;
  const [auto, setAuto] = useState(currentParent);
  useEffect(() => {
    setAuto(currentParent);
  }, [currentParent]);
  const isOpen = (key: string) => (key === auto ? true : (stored[key] ?? NAV_OPEN_DEFAULT[key] ?? true));
  const toggle = (key: string, open: boolean) => {
    if (key === auto) setAuto(undefined);
    writeNavOpen(key, !open);
  };
  const link = (item: NavItem, on: boolean, extra = '') => {
    const Icon = NAV_ICONS[item.icon];
    return (
      <Link
        to={item.to}
        className={`nav-link${on ? ' active' : ''}${extra}`}
        aria-current={on ? 'page' : undefined}
        onClick={(e) => onPick?.(e, item)}
        data-testid="nav-link"
        data-key={item.key}
      >
        <Icon size={18} strokeWidth={2.1} aria-hidden="true" />
        <span>{item.label}</span>
        {item.badge && (
          <span className="nav-badge" title={item.badge.label} data-testid="nav-badge">
            <span aria-hidden="true">{item.badge.text}</span>
            <span className="sr-only">{item.badge.label}</span>
          </span>
        )}
      </Link>
    );
  };
  return (
    <nav className="nav-groups" aria-label="画面の一覧">
      {groups.map((g) => (
        <div key={g.items[0]!.key} className="nav-group">
          {g.title && <h2 className="nav-group-title">{g.title}</h2>}
          {g.items.map((item) => {
            // 今の画面の印（「予定」は月・週・日の予定と比較、「設定」は設定のタブ。PRD D273・D275）
            const on = isActiveNav(item, pathname);
            const kids = item.children ?? [];
            if (kids.length === 0) return <Fragment key={item.key}>{link(item, on)}</Fragment>;
            const open = isOpen(item.key);
            const kidOn = kids.map((k) => isActiveNav(k, pathname, mode));
            const subId = `nav-sub-${item.key}`;
            return (
              <div key={item.key} className={`nav-parent${open ? ' is-open' : ''}`} data-parent={item.key}>
                <div className="nav-parent-row">
                  {link(item, on && (!open || !kidOn.includes(true)), on ? ' has-current' : '')}
                  <button
                    type="button"
                    className="nav-toggle"
                    aria-expanded={open}
                    aria-controls={subId}
                    aria-label={`${item.label}の項目`}
                    onClick={() => toggle(item.key, open)}
                    data-testid="nav-toggle"
                  >
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </div>
                <div id={subId} className="nav-sub" hidden={!open}>
                  {open && kids.map((k, n) => <Fragment key={k.key}>{link(k, kidOn[n]!, ' nav-child')}</Fragment>)}
                </div>
              </div>
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
