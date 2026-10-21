// メニューの決まり（PRD D132〜D135・D178〜D180・D230〜D232・D273〜D276。ADR-0034・0045。design.md §4 app）。
// 左のメニュー・スマホの引き出し・下のタブ（menuSections）と、上の帯の画面の名前・コマンドパレットの画面（screenSections）で、
// 並びと今の画面をどれと見るかを1か所で決める
import type { Terms } from '../contracts/documents';
import type { Features } from '../contracts/features';
import { isHrefOn } from './features';
import { SUDDEN_DO } from './sudden';

/**
 * メニューの1項目（アイコンなどは呼ぶ側で足す）。to に `?` を含むものは操作（画面の中の欄を開く）で、今の画面の印を付けない。
 * short は下のタブの短い名前（無ければ label。PRD D232）。
 * match はこの項目が受け持つ画面のパス（今の画面の印。無ければ to だけ。PRD D273・D275。予定は月・週・日・比較、設定は設定のタブ）
 */
export type NavEntry = { to: string; label: string; short?: string; match?: readonly string[] };
/** メニューのグループ（見出しの無いグループはデータだけ） */
export type NavSection<T extends NavEntry = NavEntry> = { title?: string; items: readonly T[] };

/** 予定のグループの見出し（画面の一覧のグループ。上の帯では項目名だけを出す。PRD D230） */
export const SCHEDULE_GROUP = '予定';

/** メニューの「予定」が受け持つ画面（月・週・日の予定と、その日の案を比べる。PRD D273） */
export const SCHEDULE_PATHS: readonly string[] = ['/month', '/week', '/plan', '/compare'];
/** メニューの「予定」で開く表示として覚える画面（比較は覚えない） */
export const SCHEDULE_VIEWS: readonly string[] = ['/month', '/week', '/plan'];
/** メニューの「予定」の既定（まだどの表示も開いていないとき）：日の予定（PRD D273） */
export const SCHEDULE_DEFAULT = '/plan';

/** 予定の表示として覚える画面か（古い #/schedule は日の予定） */
export const isScheduleView = (pathname: string): boolean => SCHEDULE_VIEWS.includes(activeNavPath(pathname));

/** 設定のタブ（並び。PRD D275）。メニューは「設定」1項目で、画面の上のタブで切り替える */
export const SETTINGS_TABS: readonly { to: string; label: string }[] = [
  { to: '/rules', label: '条件の重み' },
  { to: '/compat', label: '相性' },
  { to: '/types', label: '訪問の種類' },
  { to: '/items', label: '特性の項目' },
  { to: '/settings', label: '管理者設定' },
  { to: '/data', label: 'データ' },
];
/** 設定のタブの画面か */
export const isSettingsPath = (pathname: string): boolean => SETTINGS_TABS.some((t) => t.to === pathname);

/** 切っていない設定のタブ（切った機能のタブは出さない。訪問の種類・管理者設定・データは土台で残る） */
export const settingsTabs = (features: Features): { to: string; label: string }[] =>
  SETTINGS_TABS.filter((t) => isHrefOn(features, t.to));

/** 下のタブに並べる項目の key（ホーム・予定・欠勤・空き状況。5つ目は「メニュー」のボタン。PRD D274） */
export const BOTTOM_TABS: readonly string[] = ['home', 'schedule', 'absence', 'vacancy'];

/** 操作の項目か（URL にクエリを持つ。例：当日・問い合わせの「欠勤・キャンセルを登録」＝ `/plan?date=…&do=absence`。PRD D180・D231） */
export const isNavAction = (to: string): boolean => to.includes('?');

/** 今の画面に当たる URL のパス。古いリンクの #/schedule は日の予定 */
export function activeNavPath(pathname: string): string {
  if (pathname === '/schedule') return '/plan';
  return pathname;
}

/** そのメニューの項目が今の画面か（操作の項目はいつも false。match があればそのどれか。PRD D273・D275） */
export const isActiveNav = (item: NavEntry, pathname: string): boolean =>
  !isNavAction(item.to) && (item.match ?? [item.to]).includes(activeNavPath(pathname));

/**
 * 上の帯の日付の選択を出す画面（PRD D267）：選んでいる日付で中身が変わる画面だけ。日・週・月の予定・案を比べる・勤務の見込み
 * （日付の月）・勤務時間（シフト）（今日の列の印）。ほかの画面（ホーム・空き状況・一覧・相性・条件・設定・データ）では出さない
 * （日付は覚えたまま。〈利用者さん〉一覧・相性の絞り込みの週は、選んでいる日付の週のまま「N/D からの週」と書く）
 */
export const DATE_PAGES: readonly string[] = ['/plan', '/week', '/month', '/compare', '/workload', '/availability'];

/** 上の帯に日付の選択を出すか（古い #/schedule は日の予定） */
export const showsDateSwitch = (pathname: string): boolean => DATE_PAGES.includes(activeNavPath(pathname));

/**
 * 上の帯に出す今の画面の名前：グループの見出し＋項目名（例「人・利用者さん一覧」）。groups は画面の一覧（screenSections）。
 * 見出しの無いグループ（ホーム）と「予定」のグループ（項目名が「月の予定」などで見出しと重なる）は項目名だけ。
 * 一覧に無い画面は null（PRD D132・D179・D230・D273）
 */
export function navTitle(groups: readonly NavSection[], pathname: string): string | null {
  const parts = navTitleParts(groups, pathname);
  if (!parts) return null;
  return parts.group ? `${parts.group}・${parts.item}` : parts.item;
}

/**
 * navTitle の見出しと項目名を分けたもの（狭い画面で入りきらないとき、項目名をまとめて次の行へ送るため。PRD D179）
 */
export function navTitleParts(
  groups: readonly NavSection[],
  pathname: string,
): { group: string | null; item: string } | null {
  for (const g of groups) {
    const item = g.items.find((i) => isActiveNav(i, pathname));
    if (item) return { group: g.title && g.title !== SCHEDULE_GROUP ? g.title : null, item: item.label };
  }
  return null;
}

/** 下のタブの項目：メニューから BOTTOM_TABS の順に引く（メニューに無い項目は出さない。PRD D274） */
export function bottomTabs<T extends NavEntry & { key: string }>(groups: readonly NavSection<T>[]): T[] {
  const all = groups.flatMap((g) => g.items);
  return BOTTOM_TABS.flatMap((key) => all.find((i) => i.key === key) ?? []);
}

/** 下のタブの名前：短い名前（ホーム・予定・欠勤・空き状況）。無ければメニューの名前（PRD D274） */
export const tabLabel = (item: NavEntry): string => item.short ?? item.label;

/**
 * 下のタブ・メニューの項目を押したとき：今開いている画面そのものなら何もしない（'stay'。押し直して URL のクエリ＝画面の状態を
 * 消さない。PRD D133・D134）。ほかは移る（'go'。比較から「予定」は覚えた表示へ移る）
 */
export function tabClick(item: NavEntry, pathname: string): 'stay' | 'go' {
  return !isNavAction(item.to) && item.to === activeNavPath(pathname) ? 'stay' : 'go';
}

/** メニューの項目のアイコンの名前（アイコンの部品は App で引く。純粋関数に React を持ち込まない） */
export type NavIcon =
  | 'home'
  | 'month'
  | 'week'
  | 'day'
  | 'compare'
  | 'absence'
  | 'vacancy'
  | 'clients'
  | 'compat'
  | 'staff'
  | 'hours'
  | 'workload'
  | 'rules'
  | 'types'
  | 'items'
  | 'settings'
  | 'data';
/** メニューの項目（アイコンの名前つき）。key は下のタブで引く名前（URL が覚えた表示で変わる項目があるため） */
export type MenuItem = NavEntry & { key: string; icon: NavIcon };

/** 欠勤・キャンセルの欄を今日の日の予定で開く URL（ホームのカードと同じ。PRD D172） */
export const absenceHref = (today: string): string => `/plan?date=${today}&do=${SUDDEN_DO}`;

/** メニューの「予定」「設定」で開く画面（最後に開いた表示・タブ。無ければ既定。PRD D273・D275） */
export type LastViews = { schedule?: string | null; settings?: string | null };

/**
 * メニューの「設定」で開くタブ：最後に開いた設定のタブ（切っていなければ）、無ければ先頭のタブ
 * （すべて入なら条件の重み、基本なら相性。PRD D275）
 */
export function settingsHref(features: Features, last?: string | null): string {
  const tabs = settingsTabs(features);
  if (last && tabs.some((t) => t.to === last)) return last;
  return tabs[0]?.to ?? '/settings';
}

/** メニューの「予定」で開く表示：最後に開いた月・週・日の予定、無ければ日の予定（PRD D273） */
export const scheduleHref = (last?: string | null): string =>
  last && SCHEDULE_VIEWS.includes(last) ? last : SCHEDULE_DEFAULT;

/**
 * メニューの並び（PRD D273〜D275。ADR-0045。D178・D232 の並びを置き換え）：よく使う画面だけの8項目
 * （見出しなし）ホーム・予定／当日・問い合わせ（欠勤・キャンセルを登録・空き状況）／人（〈利用者さん〉一覧・〈スタッフ〉一覧・
 * 勤務時間（シフト））／（見出しなし）設定。
 * 「予定」は月・週・日の予定と比較を受け持ち（今の画面の印）、押すと最後に開いた表示（既定は日の予定）。切り替えは画面の上の［月｜週｜日］。
 * 「設定」は条件の重み・相性・訪問の種類・特性の項目・管理者設定・データを受け持ち、押すと最後に開いたタブ。
 * 勤務の見込みは勤務時間（シフト）の続き（印は勤務時間（シフト））で、勤務時間（シフト）・月の予定の「その他 ▾」から開く。
 * 案を比べるは日の予定の「案を変える ▾」から開く。メニューから外した画面もパレット（screenSections）からは引ける。
 * 下のタブに出す項目は短い名前（short）も持つ。呼び方は terms から引く。URL は変えない。today は欠勤・キャンセルの欄を開く日。
 * features で切った機能の項目は出さない（lib/features の表から引く）。項目の無くなったグループは見出しごと出さない
 */
export function menuSections(
  terms: Pick<Terms, 'client' | 'staff'>,
  today: string,
  features: Features,
  last: LastViews = {},
): NavSection<MenuItem>[] {
  const all: NavSection<MenuItem>[] = [
    {
      items: [
        { key: 'home', to: '/home', label: 'ホーム', short: 'ホーム', icon: 'home' },
        {
          key: 'schedule',
          to: scheduleHref(last.schedule),
          label: '予定',
          short: '予定',
          icon: 'day',
          match: SCHEDULE_PATHS,
        },
      ],
    },
    {
      title: '当日・問い合わせ',
      items: [
        { key: 'absence', to: absenceHref(today), label: '欠勤・キャンセルを登録', short: '欠勤', icon: 'absence' },
        { key: 'vacancy', to: '/vacancy', label: '空き状況', short: '空き状況', icon: 'vacancy' },
      ],
    },
    {
      title: '人',
      items: [
        { key: 'clients', to: '/clients', label: `${terms.client}一覧`, icon: 'clients' },
        { key: 'staff', to: '/staff', label: `${terms.staff}一覧`, icon: 'staff' },
        {
          key: 'availability',
          to: '/availability',
          label: '勤務時間（シフト）',
          icon: 'hours',
          // 勤務の見込みは勤務時間（シフト）の続き（メニューから外した。PRD D275）
          match: ['/availability', '/workload'],
        },
      ],
    },
    // 設定：条件の重み・相性・訪問の種類・特性の項目・管理者設定（PRD D210。だれでも開ける）・データを1つにまとめる（タブ。PRD D275）
    {
      items: [
        {
          key: 'settings',
          to: settingsHref(features, last.settings),
          label: '設定',
          icon: 'settings',
          match: settingsTabs(features).map((t) => t.to),
        },
      ],
    },
  ];
  return all.flatMap((g) => {
    const items = g.items.filter((i) => isHrefOn(features, i.to));
    return items.length > 0 ? [{ ...g, items }] : [];
  });
}

/**
 * 画面の一覧（PRD D182・D230・D273・D275）：コマンドパレットの「画面」と上の帯の画面の名前はここから引く。
 * メニューから外した画面（月・週・日の予定・案を比べる・勤務の見込み・設定のタブ）も1つずつ持つ。
 * ホーム／予定（月の予定・週の予定・日の予定・案を比べる）／当日・問い合わせ（空き状況）／人（〈利用者さん〉一覧・〈スタッフ〉一覧・
 * 勤務時間（シフト）・勤務の見込み）／設定（条件の重み・相性・訪問の種類・特性の項目・管理者設定・データ）。
 * 項目名は画面の見出しと同じ。切った機能の画面は出さない
 */
export function screenSections(terms: Pick<Terms, 'client' | 'staff'>, features: Features): NavSection<MenuItem>[] {
  const all: NavSection<MenuItem>[] = [
    { items: [{ key: 'home', to: '/home', label: 'ホーム', icon: 'home' }] },
    {
      title: SCHEDULE_GROUP,
      items: [
        { key: 'month', to: '/month', label: '月の予定', icon: 'month' },
        { key: 'week', to: '/week', label: '週の予定', icon: 'week' },
        { key: 'day', to: '/plan', label: '日の予定', icon: 'day' },
        { key: 'compare', to: '/compare', label: '案を比べる', icon: 'compare' },
      ],
    },
    { title: '当日・問い合わせ', items: [{ key: 'vacancy', to: '/vacancy', label: '空き状況', icon: 'vacancy' }] },
    {
      title: '人',
      items: [
        { key: 'clients', to: '/clients', label: `${terms.client}一覧`, icon: 'clients' },
        { key: 'staff', to: '/staff', label: `${terms.staff}一覧`, icon: 'staff' },
        { key: 'availability', to: '/availability', label: '勤務時間（シフト）', icon: 'hours' },
        { key: 'workload', to: '/workload', label: '勤務の見込み', icon: 'workload' },
      ],
    },
    {
      title: '設定',
      items: [
        { key: 'rules', to: '/rules', label: '条件の重み', icon: 'rules' },
        { key: 'compat', to: '/compat', label: '相性', icon: 'compat' },
        { key: 'types', to: '/types', label: '訪問の種類', icon: 'types' },
        { key: 'items', to: '/items', label: '特性の項目', icon: 'items' },
        { key: 'settings', to: '/settings', label: '管理者設定', icon: 'settings' },
        { key: 'data', to: '/data', label: 'データ', icon: 'data' },
      ],
    },
  ];
  return all.flatMap((g) => {
    const items = g.items.filter((i) => isHrefOn(features, i.to));
    return items.length > 0 ? [{ ...g, items }] : [];
  });
}
