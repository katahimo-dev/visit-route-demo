import { Database, HeartHandshake, Layers, type LucideIcon, Settings, SlidersHorizontal, Tags } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { settingsTabs } from '../lib/nav';
import { useFeatures } from '../lib/useFeature';

/** タブのアイコン（メニューの前の項目と同じ） */
const ICONS: Record<string, LucideIcon> = {
  '/rules': SlidersHorizontal,
  '/compat': HeartHandshake,
  '/types': Layers,
  '/items': Tags,
  '/settings': Settings,
  '/data': Database,
};

/**
 * 設定のタブ（PRD D275。ADR-0045）：条件の重み・相性・訪問の種類・特性の項目・管理者設定・データ。
 * メニューは「設定」1項目にし、画面の見出しの下のこのタブで切り替える（予定の［月｜週｜日］と同じ形。リンクのナビで、
 * 今の画面は aria-current と太字・下線）。URL は前のまま（`#/rules` など）。切った機能のタブは出さない
 */
export function SettingsTabs() {
  const { pathname } = useLocation();
  const tabs = settingsTabs(useFeatures());
  const navRef = useRef<HTMLElement>(null);
  // 狭い画面でタブが横に巻くとき、今のタブを見える所へ（ページは縦に巻かない）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 画面が変わったときだけ
  useLayoutEffect(() => {
    const nav = navRef.current;
    const on = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = Math.max(0, on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2);
  }, [pathname]);
  return (
    <nav ref={navRef} className="view-switch settings-tabs" aria-label="設定の切り替え" data-testid="settings-tabs">
      {tabs.map(({ to, label }) => {
        const on = to === pathname;
        const Icon = ICONS[to] ?? Settings;
        return (
          <Link
            key={to}
            to={to}
            className={`view-switch-item${on ? ' is-on' : ''}`}
            aria-current={on ? 'page' : undefined}
            data-tab={to.slice(1)}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
