import {
  CalendarCheck,
  Clock,
  Database,
  HeartHandshake,
  House,
  Layers,
  type LucideIcon,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Tags,
  UserRound,
} from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ARRANGE_TABS, activeNavPath, peopleTabs, settingsTabs } from '../lib/nav';
import { useFeatures } from '../lib/useFeature';
import { useDemoData } from '../store';

/** タブのアイコン（メニューの前の項目と同じ。並びは lib/nav の SETTINGS_TABS と同じ） */
const ICONS: Record<string, LucideIcon> = {
  '/arrange': Sparkles,
  '/standard': CalendarCheck,
  '/types': Layers,
  '/items': Tags,
  '/rules': SlidersHorizontal,
  '/settings': Settings,
  '/data': Database,
  '/clients': House,
  '/staff': UserRound,
  '/compat': HeartHandshake,
  '/availability': Clock,
};

/** タブのナビ（設定・人・予定を組むで共通）。狭い画面でタブが横に巻くとき、今のタブを見える所へ（ページは縦に巻かない） */
function TabNav({
  tabs,
  on,
  label,
  testId,
  className,
}: {
  tabs: readonly { to: string; label: string }[];
  on: (to: string) => boolean;
  label: string;
  testId: string;
  className: string;
}) {
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 画面が変わったときだけ
  useLayoutEffect(() => {
    const nav = navRef.current;
    const cur = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !cur || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = Math.max(0, cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2);
  }, [pathname]);
  return (
    <nav ref={navRef} className={`view-switch ${className}`} aria-label={label} data-testid={testId}>
      {tabs.map(({ to, label: text }) => {
        const isOn = on(to);
        const Icon = ICONS[to] ?? Settings;
        return (
          <Link
            key={to}
            to={to}
            className={`view-switch-item${isOn ? ' is-on' : ''}`}
            aria-current={isOn ? 'page' : undefined}
            data-tab={to.slice(1)}
          >
            <Icon size={15} aria-hidden="true" />
            {text}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * 人のタブ（PRD D326。ADR-0054）：〈利用者さん〉・〈スタッフ〉・相性・勤務時間（シフト）。メニューは「人」1項目にし、
 * 画面の見出しの下のこのタブで切り替える（設定のタブと同じ形）。勤務の見込みは勤務時間（シフト）の続き（印は勤務時間（シフト））。
 * URL は前のまま（`#/clients` など）。切った機能のタブは出さない
 */
export function PeopleTabs() {
  const { pathname } = useLocation();
  const { data } = useDemoData();
  const tabs = peopleTabs(data.org.terms, data.org.features);
  const here = activeNavPath(pathname);
  return (
    <TabNav
      tabs={tabs}
      on={(to) => tabs.find((t) => t.to === to)?.match.includes(here) ?? false}
      label="人の切り替え"
      testId="people-tabs"
      className="settings-tabs people-tabs"
    />
  );
}

/**
 * 設定のタブ（PRD D275。ADR-0045）：訪問の種類・特性の項目・条件の重み・管理者設定・データ（相性は「人」の画面）。
 * メニューは「設定」1項目にし、画面の見出しの下のこのタブで切り替える（予定の［月｜週｜日］と同じ形。リンクのナビで、
 * 今の画面は aria-current と太字・下線）。URL は前のまま（`#/rules` など）。切った機能のタブは出さない
 */
export function SettingsTabs() {
  const { pathname } = useLocation();
  const tabs = settingsTabs(useFeatures());
  return (
    <TabNav
      tabs={tabs}
      on={(to) => to === pathname}
      label="設定の切り替え"
      testId="settings-tabs"
      className="settings-tabs"
    />
  );
}

/**
 * 予定を組むのタブ（ADR-0063）：担当を組む・組み方の標準。AI で組む機能はこの2つの画面に集める。
 * 案を比べる（`#/compare`）は担当を組むの続き（印は担当を組む）
 */
export function ArrangeTabs() {
  const { pathname } = useLocation();
  return (
    <TabNav
      tabs={ARRANGE_TABS}
      on={(to) => to === pathname || (to === '/arrange' && pathname === '/compare')}
      label="予定を組むの切り替え"
      testId="arrange-tabs"
      className="settings-tabs arrange-tabs"
    />
  );
}
