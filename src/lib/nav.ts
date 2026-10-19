// メニューの決まり（PRD D102・D132〜D135・D178〜D180。design.md §4 app「スマホのメニュー（2026-10-18）」「メニューの用途ごとの並び」）。
// 左のメニュー・スマホの引き出し・下のタブ・上の帯の画面の名前・コマンドパレットの画面で、並びと今の画面をどれと見るかを1か所で決める
import type { Terms } from '../contracts/documents';
import type { Features } from '../contracts/features';
import { isHrefOn } from './features';
import { SUDDEN_DO } from './sudden';

/** メニューの1項目（アイコンなどは呼ぶ側で足す）。to に `?` を含むものは操作（画面の中の欄を開く）で、今の画面の印を付けない */
export type NavEntry = { to: string; label: string };
/** メニューのグループ（見出しの無いグループはデータだけ） */
export type NavSection<T extends NavEntry = NavEntry> = { title?: string; items: readonly T[] };

/** 下のタブに常に並べる、よく使う画面（ホーム・月・週・日・空き状況。PRD D134・D144。並びはメニューの順） */
export const BOTTOM_TABS: readonly string[] = ['/home', '/month', '/week', '/plan', '/vacancy'];

/** 操作の項目か（URL にクエリを持つ。例：当日の対応の「欠勤・キャンセル」＝ `/plan?date=…&do=absence`。PRD D180） */
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
 * 下のタブで今の画面に当たるタブの URL。比較はタブに無く、その日の案を比べる日の画面の続きなので「日」（PRD D134・D180）
 */
export function activeTabPath(pathname: string): string {
  if (pathname === '/compare') return '/plan';
  return activeNavPath(pathname);
}

/** その下のタブが今の画面か */
export const isActiveTab = (to: string, pathname: string): boolean => activeTabPath(pathname) === to;

/**
 * 上の帯に出す今の画面の名前：グループの見出し＋項目名（例「人の情報・利用者さん一覧」「予定を組む・日」）。
 * 見出しの無いグループ（ホーム）は項目名だけ。メニューに無い画面は null（PRD D132・D179）
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
    if (item) return { group: g.title ?? null, item: item.label };
  }
  return null;
}

/** 下のタブの項目：メニューから BOTTOM_TABS の順に引く（メニューに無い URL は出さない） */
export function bottomTabs<T extends NavEntry>(groups: readonly NavSection<T>[]): T[] {
  const all = groups.flatMap((g) => g.items);
  return BOTTOM_TABS.flatMap((to) => all.find((i) => i.to === to) ?? []);
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

/** 欠勤・キャンセルの欄を今日の日の画面で開く URL（ホームのカードと同じ。PRD D172） */
export const absenceHref = (today: string): string => `/plan?date=${today}&do=${SUDDEN_DO}`;

/**
 * メニューの並び（PRD D178・D179・D210・D213。ADR-0027・0028。D102 の人ごとの並びを置き換え）：やりたいことの順に
 * ホーム／予定を組む（月・週・日・案を比べる）／当日の対応（欠勤・キャンセル）／問い合わせ（空き状況）／
 * 人の情報（〈利用者さん〉一覧・相性・〈スタッフ〉一覧・稼働時間・稼働の見込み）／AI の考え方（条件の重み・訪問の種類・特性の項目）／
 * 管理者（管理者設定・データ）。
 * 人の情報の中は人ごとの順（〈利用者さん〉に付くもの → 〈スタッフ〉に付くもの。ADR-0019 の「誰の何を直すか」でたどれる並びを残す）。
 * 呼び方は terms から引く。URL は変えない。today は欠勤・キャンセルの欄を開く日。
 * features で切った機能の項目は出さない（lib/features の表から引く）。項目の無くなったグループは見出しごと出さない
 */
export function menuSections(
  terms: Pick<Terms, 'client' | 'staff'>,
  today: string,
  features: Features,
): NavSection<MenuItem>[] {
  const all: NavSection<MenuItem>[] = [
    { items: [{ to: '/home', label: 'ホーム', icon: 'home' }] },
    {
      title: '予定を組む',
      items: [
        { to: '/month', label: '月', icon: 'month' },
        { to: '/week', label: '週', icon: 'week' },
        { to: '/plan', label: '日', icon: 'day' },
        { to: '/compare', label: '案を比べる', icon: 'compare' },
      ],
    },
    { title: '当日の対応', items: [{ to: absenceHref(today), label: '欠勤・キャンセル', icon: 'absence' }] },
    { title: '問い合わせ', items: [{ to: '/vacancy', label: '空き状況', icon: 'vacancy' }] },
    {
      title: '人の情報',
      items: [
        { to: '/clients', label: `${terms.client}一覧`, icon: 'clients' },
        { to: '/compat', label: '相性', icon: 'compat' },
        { to: '/staff', label: `${terms.staff}一覧`, icon: 'staff' },
        { to: '/availability', label: '稼働時間', icon: 'hours' },
        { to: '/workload', label: '稼働の見込み', icon: 'workload' },
      ],
    },
    {
      title: 'AI の考え方',
      items: [
        { to: '/rules', label: '条件の重み', icon: 'rules' },
        { to: '/types', label: '訪問の種類', icon: 'types' },
        { to: '/items', label: '特性の項目', icon: 'items' },
      ],
    },
    // 管理者設定（PRD D210。だれでも開ける）とデータ。どちらも土台で切れない
    {
      title: '管理者',
      items: [
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
