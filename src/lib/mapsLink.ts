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
 * スマホのブラウザで開くと4件目以降が黙って抜けるので、既定（スタッフ画面・メール）はスマホのブラウザに合わせて 3（MAPS_MOBILE_WAYPOINTS）。
 * 9（MAPS_MAX_WAYPOINTS）は PC・アプリで開くと分かっている場面のための上限（今は使っていない）
 */
export const MAPS_MOBILE_WAYPOINTS = 3;
export const MAPS_MAX_WAYPOINTS = 9;
/** URL の長さの上限（同じ文書。Maps URLs は 2,048 字まで）。住所の文字の経由地が多く超えるときも分ける */
export const MAPS_URL_LIMIT = 2048;

/** 経路の1地点（label は画面・メールの言葉。URL には入れない。home は自宅） */
export type RouteStop = { label: string; place: Place; home?: boolean };

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
  // 住所の「|」は経由地の区切りとぶつかるので全角にする（まれ）
  const a = p.address.trim().replace(/\|/g, '｜');
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
  const h = { label: HOME_LABEL, place: home, home: true };
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

/** 全行程のリンク（分けたときは「全行程 1/2」）。from・to はその1本の最初と最後の地点の言葉、waypoints はその1本の経由地の数 */
export type TripLink = { label: string; href: string; from: string; to: string; waypoints: number };

/**
 * 1日の全行程のリンク（PRD D99・D101）。場所の無い地点は飛ばし、飛ばした訪問の言葉を skipped に、自宅を飛ばしたら homeSkipped を返す
 * （画面・メールが「場所が未登録のため入っていません」と書く）。経由地が maxWaypoints を超える・URL が MAPS_URL_LIMIT を超えるときは、
 * 前の1本の行き先を次の1本の出発地にして複数本に分ける（「全行程 1/2」）。地点が2つ未満なら links は []。
 * 公共交通は全行程を出さない（links は []。Google マップが経由地付きの経路を出さないので、区間ごとのリンクだけを使う）
 */
export function tripLinks(
  stops: readonly RouteStop[],
  mode: TravelMode,
  maxWaypoints: number = MAPS_MOBILE_WAYPOINTS,
): { links: TripLink[]; skipped: string[]; homeSkipped: boolean } {
  const missing = stops.filter((s) => placeParam(s.place) === null);
  const skipped = [...new Set(missing.filter((s) => !s.home).map((s) => s.label))];
  const homeSkipped = missing.some((s) => s.home);
  const ok = stops.filter((s) => placeParam(s.place) !== null);
  if (mode === 'TRANSIT' || ok.length < 2) return { links: [], skipped, homeSkipped };
  const max = Math.max(0, Math.floor(maxWaypoints));
  const hrefs: Omit<TripLink, 'label'>[] = [];
  let i = 0;
  while (i < ok.length - 1) {
    // 経由地の上限から始め、URL が長すぎれば経由地を減らす（経由地0でも長すぎるときはそのまま出す）
    let j = Math.min(ok.length - 1, i + 1 + max);
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
    hrefs.push({ href, from: (ok[i] as RouteStop).label, to: (ok[j] as RouteStop).label, waypoints: j - i - 1 });
    i = j;
  }
  const links = hrefs.map((h, k) => ({ ...h, label: hrefs.length > 1 ? `全行程 ${k + 1}/${hrefs.length}` : '全行程' }));
  return { links, skipped, homeSkipped };
}

/** 自転車のときの注記（PRD D101。日本では Google マップが自転車の経路を出さないことがある） */
export const BICYCLE_NOTE = '自転車の経路が出ないときは、Google マップで徒歩に切り替えてください。';
