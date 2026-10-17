// Google マップの経路のリンク（PRD D97〜D101。ADR-0018）
import { describe, expect, it } from 'vitest';
import type { Place } from '../contracts/documents';
import { dayStops, directionsHref, legLinks, MAPS_URL_LIMIT, placeParam, type RouteStop, tripLinks } from './mapsLink';

const at = (lat: number, lng: number, address = ''): Place => ({ address, lat, lng });
const addr = (address: string): Place => ({ address, lat: null, lng: null });
const none: Place = { address: '  ', lat: null, lng: null };
/** URL の値を読む（URLSearchParams でデコード） */
const q = (href: string) => new URL(href).searchParams;

describe('placeParam', () => {
  it('座標があれば「緯度,経度」（小数6桁まで）、無ければ住所、どちらも無ければ null', () => {
    expect(placeParam(at(38.2601234567, 140.87, '仙台'))).toBe('38.260123%2C140.87');
    expect(placeParam(addr(' 仙台市青葉区1-1 '))).toBe(encodeURIComponent('仙台市青葉区1-1'));
    expect(placeParam(none)).toBeNull();
  });
  it('住所の記号（& # ? / |）はエンコードされ、URL を壊さない', () => {
    const href = directionsHref({ origin: null, destination: addr('A&B#1?x=2/3|4'), mode: 'DRIVE' })!;
    expect(q(href).get('destination')).toBe('A&B#1?x=2/3|4');
    expect(q(href).get('travelmode')).toBe('driving');
  });
});

describe('directionsHref', () => {
  it('origin を書かない（今いる場所から）・書く', () => {
    const here = directionsHref({ origin: null, destination: at(38.2, 140.8), mode: 'WALK' })!;
    expect(here.startsWith('https://www.google.com/maps/dir/?api=1&destination=')).toBe(true);
    expect(q(here).get('origin')).toBeNull();
    expect(q(here).get('destination')).toBe('38.2,140.8');
    expect(q(here).get('travelmode')).toBe('walking');
    const from = directionsHref({ origin: addr('仙台駅'), destination: at(38.2, 140.8), mode: 'BICYCLE' })!;
    expect(q(from).get('origin')).toBe('仙台駅');
    expect(q(from).get('travelmode')).toBe('bicycling');
    expect(q(directionsHref({ origin: null, destination: at(1, 2), mode: 'TRANSIT' })!).get('travelmode')).toBe(
      'transit',
    );
  });
  it('出発地・行き先の場所が無ければ null。場所の無い経由地は落とす', () => {
    expect(directionsHref({ origin: none, destination: at(1, 2), mode: 'DRIVE' })).toBeNull();
    expect(directionsHref({ origin: null, destination: none, mode: 'DRIVE' })).toBeNull();
    const h = directionsHref({
      origin: at(1, 2),
      destination: at(3, 4),
      waypoints: [at(5, 6), none, addr('泉区')],
      mode: 'DRIVE',
    })!;
    expect(h).toContain('waypoints=5%2C6%7C');
    expect(q(h).get('waypoints')).toBe('5,6|泉区');
  });
});

const visits = (n: number): RouteStop[] =>
  Array.from({ length: n }, (_, i) => ({ label: `v${i + 1}`, place: at(38 + i / 100, 140) }));

describe('dayStops・legLinks（自宅の扱い）', () => {
  it('自宅→訪問…→自宅。訪問が無ければ []', () => {
    expect(dayStops(at(1, 1), []).length).toBe(0);
    const s = dayStops(at(1, 1), visits(2));
    expect(s.map((x) => x.label)).toEqual(['自宅', 'v1', 'v2', '自宅']);
  });
  it('区間ごと。場所の無い側の区間は href が null', () => {
    const s = dayStops(none, [...visits(1), { label: 'x', place: none }, ...visits(1)]);
    const legs = legLinks(s, 'DRIVE');
    expect(legs.map((l) => `${l.from}→${l.to}`)).toEqual(['自宅→v1', 'v1→x', 'x→v1', 'v1→自宅']);
    expect(legs.map((l) => l.href !== null)).toEqual([false, false, false, false]);
    const ok = legLinks(dayStops(at(1, 1), visits(2)), 'DRIVE');
    expect(ok.every((l) => l.href !== null)).toBe(true);
    expect(q(ok[0]!.href!).get('origin')).toBe('1,1');
    expect(q(ok[0]!.href!).get('destination')).toBe('38,140');
  });
});

describe('tripLinks（全行程・経由地の分割）', () => {
  it('自宅→訪問3件→自宅は1本（経由地3件）', () => {
    const t = tripLinks(dayStops(at(1, 1), visits(3)), 'DRIVE');
    expect(t.length).toBe(1);
    expect(t[0]!.label).toBe('全行程');
    const p = q(t[0]!.href);
    expect(p.get('origin')).toBe('1,1');
    expect(p.get('destination')).toBe('1,1');
    expect(p.get('waypoints')).toBe('38,140|38.01,140|38.02,140');
  });
  it('経由地が9件ちょうどは1本、10件以上は分け、前の行き先が次の出発地', () => {
    expect(tripLinks(dayStops(at(1, 1), visits(9)), 'DRIVE').length).toBe(1);
    const t = tripLinks(dayStops(at(1, 1), visits(10)), 'WALK');
    expect(t.map((x) => x.label)).toEqual(['全行程 1/2', '全行程 2/2']);
    expect(q(t[0]!.href).get('waypoints')!.split('|').length).toBe(9);
    expect(q(t[0]!.href).get('destination')).toBe(q(t[1]!.href).get('origin'));
    expect(t[0]!.from).toBe('自宅');
    expect(t[1]!.to).toBe('自宅');
    expect(q(t[1]!.href).get('travelmode')).toBe('walking');
  });
  it('公共交通は経由地を使わず、区間ごとに分ける', () => {
    const t = tripLinks(dayStops(at(1, 1), visits(2)), 'TRANSIT');
    expect(t.length).toBe(3);
    expect(t.every((x) => q(x.href).get('waypoints') === null)).toBe(true);
  });
  it('自宅の場所が無ければ訪問だけをつなぐ。地点が2つ未満なら []', () => {
    const t = tripLinks(dayStops(none, visits(3)), 'DRIVE');
    expect(t.length).toBe(1);
    expect(t[0]!.from).toBe('v1');
    expect(q(t[0]!.href).get('waypoints')).toBe('38.01,140');
    expect(tripLinks(dayStops(none, visits(1)), 'DRIVE')).toEqual([]);
  });
  it('住所の文字の経由地で長すぎる URL は、2,048字に収まるよう分ける', () => {
    const long = Array.from({ length: 9 }, (_, i) => ({
      label: `a${i}`,
      place: addr(`宮城県仙台市青葉区とても長い架空の町名${i}丁目1番1号 架空マンション101号室`),
    }));
    const t = tripLinks(dayStops(at(1, 1), long), 'DRIVE');
    expect(t.length).toBeGreaterThan(1);
    expect(t.every((x) => x.href.length <= MAPS_URL_LIMIT)).toBe(true);
  });
});
