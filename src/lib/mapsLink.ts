// Google マップの経路のリンク（PRD D97〜D101。ADR-0018）：公開の「Maps URLs」
// （https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=…|…&travelmode=…）を組み立てるだけ。
// キー・サーバーは要らず、アプリから Google へは何も送らない（押した人の端末がリンクを開くだけ）。
// URL に入れるのは場所（座標か住所）と移動手段だけ。鍵などの決まりごと・名前は入れない。区間の分数・キロ数は Google から取らない。純粋関数
import type { TravelMode } from '../contracts/codes';
import type { Place } from '../contracts/documents';

/** Maps URLs の経路の入り口（`//` は文字どおり。画面は <a href> で開くだけ） */
export const MAPS_DIR_BASE = 'https://www.google.com/maps/dir/?api=1';

/** 移動手段（TRAVEL_MODES）→ Maps URLs の travelmode（driving・walking・bicycling・transit） */
export const MAPS_TRAVEL_MODE: Record<TravelMode, 'driving' | 'walking' | 'bicycling' | 'transit'> = {
  DRIVE: 'driving',
  BICYCLE: 'bicycling',
  WALK: 'walking',
  TRANSIT: 'transit',
};

/**
 * 1本のリンクに入れる経由地（waypoints）の数の上限。根拠：Maps URLs の説明（Google の公開の文書 developers.google.com/maps/documentation/urls/get-started
 * の Directions action の waypoints）に「経由地の数は開く先で変わり、スマホのブラウザは3件まで、それ以外は9件まで」とある。
 * スマホで Google マップのアプリが入っていればアプリが開く（9件）ので 9 にする（ブラウザで開くと4件目以降が落ちうる。ADR-0018 の見直す条件）。
 * 公共交通（transit）は Google マップが経由地付きの経路を出さないので 0（全行程を区間ごとに分ける）
 */
export const MAPS_MAX_WAYPOINTS = 9;
export const maxWaypointsFor = (mode: TravelMode) => (mode === 'TRANSIT' ? 0 : MAPS_MAX_WAYPOINTS);
/** URL の長さの上限（同じ文書。Maps URLs は 2,048 字まで）。住所の文字の経由地が多く超えるときも分ける */
export const MAPS_URL_LIMIT = 2048;

/** 経路の1地点（label は画面・メールの言葉。URL には入れない） */
export type RouteStop = { label: string; place: Place };

/** 自宅の言葉 */
export const HOME_LABEL = '自宅';

/**
 * 場所を URL の値にする：座標があれば「緯度,経度」（小数6桁まで）、無ければ住所の文字、住所も無ければ null。
 * どちらも encodeURIComponent（「,」は %2C）
 */
export function placeParam(p: Place): string | null {
  if (p.lat !== null && p.lng !== null && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
    return encodeURIComponent(`${Number(p.lat.toFixed(6))},${Number(p.lng.toFixed(6))}`);
  }
  const a = p.address.trim();
  return a === '' ? null : encodeURIComponent(a);
}

/**
 * 経路のリンク。origin が null なら出発地を書かない（押した人の今いる場所から）。
 * 出発地（null 以外）・行き先の場所が無ければ null（リンクを出さない）。経由地のうち場所の無いものは落とす。
 * 経由地は「|」（%7C）でつなぐ
 */
export function directionsHref(o: {
  origin: Place | null;
  destination: Place;
  waypoints?: readonly Place[];
  mode: TravelMode;
}): string | null {
  const dest = placeParam(o.destination);
  if (dest === null) return null;
  const parts = [MAPS_DIR_BASE];
  if (o.origin !== null) {
    const origin = placeParam(o.origin);
    if (origin === null) return null;
    parts.push(`origin=${origin}`);
  }
  parts.push(`destination=${dest}`);
  const ways = (o.waypoints ?? []).map(placeParam).filter((w): w is string => w !== null);
  if (ways.length > 0) parts.push(`waypoints=${ways.join('%7C')}`);
  parts.push(`travelmode=${MAPS_TRAVEL_MODE[o.mode]}`);
  return parts.join('&');
}

/** 1日の地点（自宅→訪問…→自宅）。訪問が無ければ []。自宅の場所が無いときも並べる（リンクを作るときに落とす） */
export function dayStops(home: Place, visits: readonly RouteStop[]): RouteStop[] {
  if (visits.length === 0) return [];
  const h = { label: HOME_LABEL, place: home };
  return [h, ...visits, h];
}

/** 区間（前の地点→この地点）のリンク。どちらかの場所が無ければ href は null */
export type LegLink = { from: string; to: string; href: string | null };

/** 区間ごとのリンク（stops の隣どうし。stops が2つ未満なら []） */
export function legLinks(stops: readonly RouteStop[], mode: TravelMode): LegLink[] {
  return stops.slice(1).map((to, i) => {
    const from = stops[i] as RouteStop;
    return {
      from: from.label,
      to: to.label,
      href: directionsHref({ origin: from.place, destination: to.place, mode }),
    };
  });
}

/** 全行程のリンク（分けたときは「全行程 1/2」）。from・to はその1本の最初と最後の地点の言葉 */
export type TripLink = { label: string; href: string; from: string; to: string };

/**
 * 1日の全行程のリンク。場所の無い地点は飛ばす。経由地が maxWaypointsFor(mode) を超える・URL が MAPS_URL_LIMIT を超えるときは、
 * 前の1本の行き先を次の1本の出発地にして複数本に分ける（「全行程 1/2」）。地点が2つ未満なら []
 */
export function tripLinks(stops: readonly RouteStop[], mode: TravelMode): TripLink[] {
  const ok = stops.filter((s) => placeParam(s.place) !== null);
  if (ok.length < 2) return [];
  const hrefs: { href: string; from: string; to: string }[] = [];
  let i = 0;
  while (i < ok.length - 1) {
    // 経由地の上限から始め、URL が長すぎれば経由地を減らす（経由地0でも長すぎるときはそのまま出す）
    let j = Math.min(ok.length - 1, i + 1 + maxWaypointsFor(mode));
    let href = '';
    for (;;) {
      const origin = ok[i] as RouteStop;
      const dest = ok[j] as RouteStop;
      href =
        directionsHref({
          origin: origin.place,
          destination: dest.place,
          waypoints: ok.slice(i + 1, j).map((s) => s.place),
          mode,
        }) ?? '';
      if (href.length <= MAPS_URL_LIMIT || j === i + 1) break;
      j -= 1;
    }
    hrefs.push({ href, from: (ok[i] as RouteStop).label, to: (ok[j] as RouteStop).label });
    i = j;
  }
  return hrefs.map((h, k) => ({ ...h, label: hrefs.length > 1 ? `全行程 ${k + 1}/${hrefs.length}` : '全行程' }));
}
