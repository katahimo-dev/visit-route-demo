// メニューの決まり（PRD D102・D132〜D135・D178〜D180・D230〜D232。ADR-0034。design.md §4 app「スマホのメニュー（2026-10-18）」「メニューの用途ごとの並び」）。
// 左のメニュー・スマホの引き出し・下のタブ・上の帯の画面の名前・コマンドパレットの画面で、並びと今の画面をどれと見るかを1か所で決める
import type { Terms } from '../contracts/documents';
import type { Features } from '../contracts/features';
import { isHrefOn } from './features';
import { SUDDEN_DO } from './sudden';

/**
 * メニューの1項目（アイコンなどは呼ぶ側で足す）。to に `?` を含むものは操作（画面の中の欄を開く）で、今の画面の印を付けない。
 * short は下のタブの短い名前（無ければ label。PRD D232）
 */
export type NavEntry = { to: string; label: string; short?: string };
/** メニューのグループ（見出しの無いグループはデータだけ） */
export type NavSection<T extends NavEntry = NavEntry> = { title?: string; items: readonly T[] };

/** 下のタブに常に並べる、よく使う画面（ホーム・月・週・今日・空き状況。PRD D134・D144・D232。並びはメニューの順） */
export const BOTTOM_TABS: readonly string[] = ['/home', '/month', '/week', '/plan', '/vacancy'];

/** 予定のグループの見出し（上の帯では項目名だけを出す。PRD D230） */
export const SCHEDULE_GROUP = '予定';

/** 操作の項目か（URL にクエリを持つ。例：当日・問い合わせの「欠勤・キャンセルを登録」＝ `/plan?date=…&do=absence`。PRD D180・D231） */
export const isNavAction = (to: string): boolean => to.includes('?');

/**
 * 今の画面に当たるメニューの URL。古いリンクの #/schedule は日。
 * 比較（#/compare）はメニューの「案を比べる」（PRD D180。D102 の「日」と見るのを置き換え）
 */
export function activeNavPath(pathname: string): string {
  if (pathname === '/schedule') return '/plan';
  return pathname;
}

/** そのメニューの項目が今の画面か（操作の項目はいつも false） */
export const isActiveNav = (to: string, pathname: string): boolean =>
  !isNavAction(to) && activeNavPath(pathname) === to;

/**
 * 下のタブで今の画面に当たるタブの URL。比較はタブに無く、その日の案を比べる日の予定の続きなので「今日」のタブ（PRD D134・D180・D232）
 */
export function activeTabPath(pathname: string): string {
  if (pathname === '/compare') return '/plan';
  return activeNavPath(pathname);
}

/** その下のタブが今の画面か */
export const isActiveTab = (to: string, pathname: string): boolean => activeTabPath(pathname) === to;

/**
 * 上の帯に出す今の画面の名前：グループの見出し＋項目名（例「人・利用者さん一覧」）。
 * 見出しの無いグループ（ホーム）と「予定」のグループ（項目名が「月の予定」などで見出しと重なる）は項目名だけ。
 * メニューに無い画面は null（PRD D132・D179・D230）
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
    const item = g.items.find((i) => isActiveNav(i.to, pathname));
    if (item) return { group: g.title && g.title !== SCHEDULE_GROUP ? g.title : null, item: item.label };
  }
  return null;
}

/** 下のタブの項目：メニューから BOTTOM_TABS の順に引く（メニューに無い URL は出さない） */
export function bottomTabs<T extends NavEntry>(groups: readonly NavSection<T>[]): T[] {
  const all = groups.flatMap((g) => g.items);
  return BOTTOM_TABS.flatMap((to) => all.find((i) => i.to === to) ?? []);
}

/** 下のタブの名前：短い名前（ホーム・月・週・今日・空き状況）。無ければメニューの名前（PRD D232） */
export const tabLabel = (item: NavEntry): string => item.short ?? item.label;

/** 今日の日の予定を開く URL（下のタブの「今日」。PRD D232） */
export const todayPlanHref = (today: string): string => `/plan?date=${today}`;

/**
 * 下のタブの行き先：「今日」（日の予定）は今日を選んで開く（`?date=今日`。日の予定が読んで消す）。ほかはメニューと同じ（PRD D232）
 */
export const tabHref = (to: string, today: string): string => (to === '/plan' ? todayPlanHref(today) : to);

/**
 * 下のタブを押したとき：今の画面のタブは何もしない（'stay'。押し直して URL のクエリ＝画面の状態を消さない。PRD D133・D134）。
 * ただし「今日」のタブは日の予定を開いていても今日を選ぶ（'replace'。履歴を増やさず移り直す。PRD D232）。ほかは移る（'go'）
 */
export function tabClick(to: string, pathname: string): 'stay' | 'replace' | 'go' {
  if (to !== activeNavPath(pathname)) return 'go';
  return to === '/plan' ? 'replace' : 'stay';
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
/** メニューの項目（アイコンの名前つき） */
export type MenuItem = NavEntry & { icon: NavIcon };

/** 欠勤・キャンセルの欄を今日の日の予定で開く URL（ホームのカードと同じ。PRD D172） */
export const absenceHref = (today: string): string => `/plan?date=${today}&do=${SUDDEN_DO}`;

/**
 * メニューの並び（PRD D178・D179・D210・D213・D230〜D232。ADR-0027・0028・0034。D102 の人ごとの並びを置き換え）：
 * やりたいことの順に5つのグループ
 * ホーム／予定（月の予定・週の予定・日の予定・案を比べる）／当日・問い合わせ（欠勤・キャンセルを登録・空き状況）／
 * 人（〈利用者さん〉一覧・〈スタッフ〉一覧・勤務時間（シフト）・勤務の見込み）／AI の条件（条件の重み・相性）／
 * 設定（訪問の種類・特性の項目・管理者設定・データ）。
 * 項目名は画面の見出しと同じ（D179・D230）。下のタブに出す項目は短い名前（short）も持つ（D232）。
 * 呼び方は terms から引く。URL は変えない。today は欠勤・キャンセルの欄を開く日。
 * features で切った機能の項目は出さない（lib/features の表から引く）。項目の無くなったグループは見出しごと出さない
 * （当日・問い合わせは欠勤・キャンセルと空き状況の両方、AI の条件は条件の重みと相性の両方を切ったとき。設定は消えない）
 */
export function menuSections(
  terms: Pick<Terms, 'client' | 'staff'>,
  today: string,
  features: Features,
): NavSection<MenuItem>[] {
  const all: NavSection<MenuItem>[] = [
    { items: [{ to: '/home', label: 'ホーム', short: 'ホーム', icon: 'home' }] },
    {
      title: SCHEDULE_GROUP,
      items: [
        { to: '/month', label: '月の予定', short: '月', icon: 'month' },
        { to: '/week', label: '週の予定', short: '週', icon: 'week' },
        { to: '/plan', label: '日の予定', short: '今日', icon: 'day' },
        { to: '/compare', label: '案を比べる', icon: 'compare' },
      ],
    },
    {
      title: '当日・問い合わせ',
      items: [
        { to: absenceHref(today), label: '欠勤・キャンセルを登録', icon: 'absence' },
        { to: '/vacancy', label: '空き状況', short: '空き状況', icon: 'vacancy' },
      ],
    },
    {
      title: '人',
      items: [
        { to: '/clients', label: `${terms.client}一覧`, icon: 'clients' },
        { to: '/staff', label: `${terms.staff}一覧`, icon: 'staff' },
        { to: '/availability', label: '勤務時間（シフト）', icon: 'hours' },
        { to: '/workload', label: '勤務の見込み', icon: 'workload' },
      ],
    },
    {
      title: 'AI の条件',
      items: [
        { to: '/rules', label: '条件の重み', icon: 'rules' },
        { to: '/compat', label: '相性', icon: 'compat' },
      ],
    },
    // 設定：訪問の種類・特性の項目と、管理者設定（PRD D210。だれでも開ける）・データ。訪問の種類・管理者設定・データは土台で切れない
    {
      title: '設定',
      items: [
        { to: '/types', label: '訪問の種類', icon: 'types' },
        { to: '/items', label: '特性の項目', icon: 'items' },
        { to: '/settings', label: '管理者設定', icon: 'settings' },
        { to: '/data', label: 'データ', icon: 'data' },
      ],
    },
  ];
  return all.flatMap((g) => {
    const items = g.items.filter((i) => isHrefOn(features, i.to));
    return items.length > 0 ? [{ ...g, items }] : [];
  });
}
