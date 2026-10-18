// メニューの決まり（PRD D102・D132〜D135。design.md §4 app「スマホのメニュー（2026-10-18）」）。
// 左のメニュー・スマホの引き出し・下のタブ・上の帯の画面の名前で、今の画面をどれと見るかを1か所で決める

/** メニューの1項目（アイコンなどは呼ぶ側で足す） */
export type NavEntry = { to: string; label: string };
/** メニューのグループ（見出しの無いグループはデータだけ） */
export type NavSection<T extends NavEntry = NavEntry> = { title?: string; items: readonly T[] };

/** 下のタブに常に並べる、よく使う画面（月・週・日・空き状況。PRD D134） */
export const BOTTOM_TABS: readonly string[] = ['/month', '/week', '/plan', '/vacancy'];

/**
 * 今の画面に当たるメニューの URL。比較（#/compare）はメニューに無く、日の画面の続きなので「日」（PRD D102）。
 * 古いリンクの #/schedule も日
 */
export function activeNavPath(pathname: string): string {
  if (pathname === '/compare' || pathname === '/schedule') return '/plan';
  return pathname;
}

/** そのメニューの項目が今の画面か */
export const isActiveNav = (to: string, pathname: string): boolean => activeNavPath(pathname) === to;

/**
 * 上の帯に出す今の画面の名前：グループの見出し＋項目名（例「利用者さん・一覧・編集」「予定・日」）。
 * 見出しの無いグループ（データ）は項目名だけ。メニューに無い画面は null
 */
export function navTitle(groups: readonly NavSection[], pathname: string): string | null {
  const at = activeNavPath(pathname);
  for (const g of groups) {
    const item = g.items.find((i) => i.to === at);
    if (item) return g.title ? `${g.title}・${item.label}` : item.label;
  }
  return null;
}

/** 下のタブの項目：メニューから BOTTOM_TABS の順に引く（メニューに無い URL は出さない） */
export function bottomTabs<T extends NavEntry>(groups: readonly NavSection<T>[]): T[] {
  const all = groups.flatMap((g) => g.items);
  return BOTTOM_TABS.flatMap((to) => all.find((i) => i.to === to) ?? []);
}
