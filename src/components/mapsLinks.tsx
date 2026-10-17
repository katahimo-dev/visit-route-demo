// Google マップの経路のリンク（PRD D97〜D101。ADR-0018）の画面の部品。リンクは新しいタブで開くだけ
// （target="_blank" rel="noopener noreferrer"）。アプリからは何も送らない。主ボタンにしない（小さな枠のボタンの見た目）
import { Navigation, Route } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TravelMode } from '../contracts/codes';
import type { Place } from '../contracts/documents';
import { BICYCLE_NOTE, directionsHref, HOME_LABEL } from '../lib/mapsLink';
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

/** 読み上げの名前の後ろ（開く先） */
export const MAPS_SR_TAIL = 'Google マップ・新しいタブ';

/** 人の名前の言葉（自宅はそのまま、ほかは「〇〇さん」） */
const who = (name: string) => (name === HOME_LABEL ? HOME_LABEL : `${name}さん`);

/**
 * 1件の訪問の経路のリンク（日の画面の訪問の詳細・スタッフ画面。PRD D98・D100）：
 * 「前の場所から」（前の訪問先、1件目は「自宅から」）と「ここへ道案内」（出発地なし＝今いる場所から）。
 * 訪問先の場所が無ければリンクを出さず、そのことを小さく書く。note はリンクの横の小さな一言（例「今の案（未確定）の順番」）。
 * 自転車のときは「自転車の経路が出ないときは…」を添える。読み上げの名前は見えている文字で始める
 */
export function VisitRouteLinks({
  to,
  toName,
  from,
  fromName,
  mode,
  note,
  testId = 'visit-route-links',
}: {
  to: Place | undefined;
  /** 訪問先の〈利用者さん〉の名前（「さん」なし） */
  toName: string;
  /** 前の場所（前の訪問先か自宅）。無ければ「前の場所から」を出さない */
  from: Place | undefined;
  /** 前の場所の言葉（HOME_LABEL か〈利用者さん〉の名前（「さん」なし）） */
  fromName: string;
  mode: TravelMode;
  note?: string;
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
  const prevText = fromName === HOME_LABEL ? '自宅から' : '前の場所から';
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }} data-testid={testId}>
      <MapsLink
        href={prev}
        icon={Route}
        label={`${prevText}（${who(fromName)}から${who(toName)}へ。${MAPS_SR_TAIL}）`}
        testId="maps-leg"
      >
        {prevText}
      </MapsLink>
      <MapsLink
        href={here}
        label={`ここへ道案内（今いる場所から${who(toName)}へ。${MAPS_SR_TAIL}）`}
        testId="maps-here"
      >
        ここへ道案内
      </MapsLink>
      {note && (
        <span className="sub" data-testid="maps-order-note">
          {note}
        </span>
      )}
      {mode === 'BICYCLE' && (
        <span className="sub" data-testid="maps-bicycle-note">
          {BICYCLE_NOTE}
        </span>
      )}
    </div>
  );
}
