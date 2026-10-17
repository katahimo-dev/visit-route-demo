// 位置の無い〈利用者さん〉をまとめて地図に置く（PRD D89。ADR-0016）。外部には出さず、検索の偽物で確かめる
import { describe, expect, it } from 'vitest';
import type { Client } from '../contracts/documents';
import { client, makeData } from '../matching/fixtures';
import type { GeoHit, LookupResult, PostalHit } from './geocode';
import { type PlaceAllResult, placeAll, placeAllTargets, sleep, withFoundPlace } from './placeAll';

const noPlace = (id: string, address: string, postalCode = '', over: Partial<Client> = {}) =>
  client(id, 0, 0, { displayName: id, place: { address, lat: null, lng: null, postalCode }, ...over });

const geo = (lat: number, lng: number, title = 't'): LookupResult<GeoHit> => ({
  ok: true,
  hits: [{ title, lat, lng }],
});

describe('placeAllTargets（まとめて置く対象）', () => {
  it('位置が無く、終了でない人のうち、住所か郵便番号のある人。無い人は skipped。表示名の順', () => {
    const cs = [
      noPlace('い', '宮城県仙台市'),
      noPlace('あ', '', '9800811'),
      noPlace('う', ''),
      noPlace('え', '宮城県', '', { stage: 'ended', active: false }),
      client('お', 38, 140),
    ];
    const { targets, skipped } = placeAllTargets(cs);
    expect(targets.map((c) => c.id)).toEqual(['あ', 'い']);
    expect(skipped.map((c) => c.id)).toEqual(['う']);
  });
});

describe('placeAll（順に置く）', () => {
  it('1人ずつ順に呼び、呼ぶたびに間隔をあける（最初の前はあけない）。住所が空なら先に郵便番号から住所', async () => {
    const log: string[] = [];
    const results: PlaceAllResult[] = [];
    const r = await placeAll([noPlace('a', '宮城県仙台市青葉区'), noPlace('b', '', '9800811')], {
      search: async (q) => {
        log.push(`search:${q}`);
        return geo(38.26, 140.87, `${q}の位置`);
      },
      lookup: async (code): Promise<LookupResult<PostalHit>> => {
        log.push(`lookup:${code}`);
        return { ok: true, hits: [{ address: '宮城県仙台市青葉区一番町' }, { address: '別の町' }] };
      },
      wait: async (ms) => {
        log.push(`wait:${ms}`);
      },
      intervalMs: 300,
      onResult: (x) => results.push(x),
    });
    expect(r).toEqual({ stopped: false });
    expect(log).toEqual([
      'search:宮城県仙台市青葉区',
      'wait:300',
      'lookup:9800811',
      'wait:300',
      'search:宮城県仙台市青葉区一番町',
    ]);
    expect(results).toEqual([
      {
        clientId: 'a',
        ok: true,
        lat: 38.26,
        lng: 140.87,
        address: '宮城県仙台市青葉区',
        title: '宮城県仙台市青葉区の位置',
      },
      {
        clientId: 'b',
        ok: true,
        lat: 38.26,
        lng: 140.87,
        address: '宮城県仙台市青葉区一番町',
        title: '宮城県仙台市青葉区一番町の位置',
      },
    ]);
  });
  it('失敗した人は理由と段階を返して次へ進む', async () => {
    const results: PlaceAllResult[] = [];
    await placeAll([noPlace('a', '', '0000000'), noPlace('b', 'どこにもない'), noPlace('c', '宮城県')], {
      search: async (q) => (q === 'どこにもない' ? { ok: false, reason: 'notFound' } : geo(38, 140)),
      lookup: async () => ({ ok: false, reason: 'timeout' }),
      wait: async () => {},
      onResult: (x) => results.push(x),
    });
    expect(results.map((x) => (x.ok ? `${x.clientId}:ok` : `${x.clientId}:${x.step}:${x.reason}`))).toEqual([
      'a:postal:timeout',
      'b:address:notFound',
      'c:ok',
    ]);
  });
  it('止めたら次の呼び出しから止める（止めた呼び出しの結果は返さない）', async () => {
    const ctrl = new AbortController();
    const results: PlaceAllResult[] = [];
    let searches = 0;
    const r = await placeAll([noPlace('a', 'A'), noPlace('b', 'B'), noPlace('c', 'C')], {
      search: async () => {
        searches += 1;
        if (searches === 2) ctrl.abort();
        return geo(38, 140);
      },
      lookup: async () => ({ ok: false, reason: 'notFound' }),
      wait: (ms, signal) => sleep(ms, signal),
      intervalMs: 1,
      signal: ctrl.signal,
      onResult: (x) => results.push(x),
    });
    expect(r).toEqual({ stopped: true });
    expect(searches).toBe(2);
    expect(results.map((x) => x.clientId)).toEqual(['a']);
  });
});

describe('sleep', () => {
  it('止めたらすぐ戻る', async () => {
    const ctrl = new AbortController();
    const t = Date.now();
    const p = sleep(10_000, ctrl.signal);
    ctrl.abort();
    await p;
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe('withFoundPlace（見つけた位置を書く）', () => {
  it('まだ位置の無い人だけに書く。住所が空なら見つけた住所も書く', () => {
    const d = makeData();
    d.clients = [noPlace('a', '宮城県仙台市', '9800811'), noPlace('b', '', '9800811'), client('c', 38.1, 140.1)];
    const found = { lat: 38.26, lng: 140.87, address: '宮城県仙台市青葉区一番町' };
    const a = withFoundPlace(d, 'a', found);
    expect(a.clients[0].place).toEqual({ address: '宮城県仙台市', lat: 38.26, lng: 140.87, postalCode: '9800811' });
    const b = withFoundPlace(d, 'b', found);
    expect(b.clients[1].place).toEqual({ ...found, postalCode: '9800811' });
    // 位置のある人・いない人は変えない（同じ data）
    expect(withFoundPlace(d, 'c', found)).toBe(d);
    expect(withFoundPlace(d, 'zz', found)).toBe(d);
  });
});

describe('郵便番号の既定値（ADR-0016）', () => {
  it('郵便番号の無い古いデータは空で読める。7桁でない値は契約に合わない', async () => {
    const { createDemoData } = await import('../seed');
    const { migrate, isImportError } = await import('../store');
    const d = createDemoData('2026-10-13');
    const old = JSON.parse(JSON.stringify(d));
    for (const c of old.clients) delete c.place.postalCode;
    const x = migrate(old);
    expect(isImportError(x)).toBe(false);
    if (!isImportError(x)) expect(x.clients.every((c) => c.place.postalCode === '')).toBe(true);
    const bad = JSON.parse(JSON.stringify(d));
    bad.clients[0].place.postalCode = '980-0811';
    expect(isImportError(migrate(bad))).toBe(true);
  });
});
