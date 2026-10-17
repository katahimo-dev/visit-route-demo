// Google マップの経路のリンク（PRD D97〜D101。ADR-0018）の画面の部品。リンクは新しいタブで開くだけ
// （target="_blank" rel="noopener noreferrer"）。アプリからは何も送らない。主ボタンにしない（小さな枠のボタンの見た目）
import { Navigation, Route } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TravelMode } from '../contracts/codes';
import type { Place } from '../contracts/documents';
import { directionsHref, HOME_LABEL } from '../lib/mapsLink';
import { WithIcon } from './ui';

/** 開く先の注記（title） */
export const MAPS_TITLE = 'Google マップが新しいタブで開きます（時間・距離は Google マップで確かめてください）';

/** 経路のリンク1つ（href が無ければ何も出さない） */
export function MapsLink({
  href,
  children,
  label,
  icon = Navigation,
  testId,
}: {
  href: string | null;
  children: ReactNode;
  /** 読み上げの名前（どこへの道順か） */
  label?: string;
  icon?: typeof Navigation;
  testId?: string;
}) {
  if (!href) return null;
  return (
    <a
      className="btn btn-small"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={MAPS_TITLE}
      aria-label={label}
      data-testid={testId}
    >
      <WithIcon icon={icon} size={14}>
        {children}
      </WithIcon>
    </a>
  );
}

/**
 * 1件の訪問の経路のリンク（日の画面の訪問の詳細・スタッフ画面。PRD D98・D99）：
 * 「前の場所から」（前の訪問先、1件目は自宅から）と「ここへ道案内」（出発地なし＝今いる場所から）。
 * 訪問先の場所が無ければリンクを出さず、そのことを小さく書く
 */
export function VisitRouteLinks({
  to,
  toName,
  from,
  fromName,
  mode,
  testId = 'visit-route-links',
}: {
  to: Place | undefined;
  toName: string;
  /** 前の場所（前の訪問先か自宅）。無ければ「前の場所から」を出さない */
  from: Place | undefined;
  /** 前の場所の言葉（「自宅」・〈利用者さん〉の名前） */
  fromName: string;
  mode: TravelMode;
  testId?: string;
}) {
  const here = to ? directionsHref({ origin: null, destination: to, mode }) : null;
  const prev = to && from ? directionsHref({ origin: from, destination: to, mode }) : null;
  if (!here) {
    return (
      <p className="sub" data-testid={testId}>
        場所（住所・地図の位置）が未登録のため、道順のリンクはありません。
      </p>
    );
  }
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }} data-testid={testId}>
      <MapsLink href={prev} icon={Route} label={`${fromName}から${toName}への道順`} testId="maps-leg">
        {fromName === HOME_LABEL ? '自宅から' : '前の場所から'}
      </MapsLink>
      <MapsLink href={here} label={`今いる場所から${toName}への道案内`} testId="maps-here">
        ここへ道案内
      </MapsLink>
    </div>
  );
}
