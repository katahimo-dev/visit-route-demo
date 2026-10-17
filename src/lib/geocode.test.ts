// 郵便番号→住所と住所→位置の検索（PRD D86〜D90。ADR-0016）。外部には出さず、fetch・JSONP の偽物で確かめる
import { describe, expect, it } from 'vitest';
import {
  type FetchFn,
  GSI_ADDRESS_URL,
  type JsonpDoc,
  type JsonpScript,
  jsonp,
  lookupMessage,
  lookupPostalCode,
  parseGsiAddress,
  parseZipcloud,
  searchAddress,
  ZIPCLOUD_URL,
} from './geocode';
import { formatPostalCode, normalizePostalCode } from './postalCode';

const ZIP_OK = {
  status: 200,
  message: null,
  results: [{ address1: '宮城県', address2: '仙台市青葉区', address3: '一番町', zipcode: '9800811' }],
};
const GSI_OK = [
  {
    geometry: { coordinates: [140.8716, 38.2601], type: 'Point' },
    type: 'Feature',
    properties: { title: '宮城県仙台市青葉区一番町一丁目' },
  },
  {
    geometry: { coordinates: [140.88, 38.27], type: 'Point' },
    type: 'Feature',
    properties: { title: '宮城県仙台市青葉区一番町二丁目' },
  },
];

/** 偽の fetch：呼ばれた URL を残し、決めた応答を返す */
function fakeFetch(reply: (url: string) => unknown | Promise<unknown>, ok = true) {
  const urls: string[] = [];
  const f: FetchFn = async (url) => {
    urls.push(url);
    const body = await reply(url);
    return { ok, json: async () => body };
  };
  return { f, urls };
}
/** 偽の fetch：応答しない（signal で止まる） */
const hangingFetch: FetchFn = (_url, { signal }) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
/** 偽の fetch：CORS で読めないときと同じく TypeError を投げる */
const corsFetch: FetchFn = async () => {
  throw new TypeError('Failed to fetch');
};

describe('normalizePostalCode（郵便番号の入力を7桁に）', () => {
  it('ハイフン・全角・〒・空白を受ける。空は空、7桁にできなければ null', () => {
    expect(normalizePostalCode('980-0811')).toBe('9800811');
    expect(normalizePostalCode('〒９８０－０８１１')).toBe('9800811');
    expect(normalizePostalCode(' 980 0811 ')).toBe('9800811');
    expect(normalizePostalCode('980ー0811')).toBe('9800811');
    expect(normalizePostalCode('')).toBe('');
    expect(normalizePostalCode('  ')).toBe('');
    expect(normalizePostalCode('980-081')).toBeNull();
    expect(normalizePostalCode('98008111')).toBeNull();
    expect(normalizePostalCode('abc-defg')).toBeNull();
  });
  it('表示は 123-4567', () => {
    expect(formatPostalCode('9800811')).toBe('980-0811');
    expect(formatPostalCode('')).toBe('');
  });
});

describe('parseZipcloud（郵便番号検索の応答）', () => {
  it('住所＝address1＋address2＋address3。同じ住所は1つ、5件まで', () => {
    expect(parseZipcloud(ZIP_OK)).toEqual({ ok: true, hits: [{ address: '宮城県仙台市青葉区一番町' }] });
    const many = {
      status: 200,
      results: Array.from({ length: 7 }, (_, i) => ({ address1: '県', address2: '市', address3: `町${i}` })),
    };
    const r = parseZipcloud(many);
    expect(r.ok && r.hits.length).toBe(5);
  });
  it('results が null・空なら notFound、status 400 は invalid、形が違えば badResponse', () => {
    expect(parseZipcloud({ status: 200, message: null, results: null })).toEqual({ ok: false, reason: 'notFound' });
    expect(parseZipcloud({ status: 200, results: [] })).toEqual({ ok: false, reason: 'notFound' });
    expect(parseZipcloud({ status: 400, message: '桁数が不正です', results: null })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(parseZipcloud({ status: 500, results: null })).toEqual({ ok: false, reason: 'badResponse' });
    expect(parseZipcloud('<html>')).toEqual({ ok: false, reason: 'badResponse' });
    expect(parseZipcloud(null)).toEqual({ ok: false, reason: 'badResponse' });
    expect(parseZipcloud({ status: 200, results: 'x' })).toEqual({ ok: false, reason: 'badResponse' });
    expect(parseZipcloud({ status: 200, results: [{ address1: 1 }] })).toEqual({ ok: false, reason: 'badResponse' });
  });
});

describe('parseGsiAddress（国土地理院の住所検索の応答）', () => {
  it('coordinates は [経度, 緯度]。title を名前に', () => {
    const r = parseGsiAddress(GSI_OK);
    expect(r).toEqual({
      ok: true,
      hits: [
        { title: '宮城県仙台市青葉区一番町一丁目', lat: 38.2601, lng: 140.8716 },
        { title: '宮城県仙台市青葉区一番町二丁目', lat: 38.27, lng: 140.88 },
      ],
    });
  });
  it('空の配列は notFound。配列でない・座標が数でない・範囲外は badResponse（落ちない）', () => {
    expect(parseGsiAddress([])).toEqual({ ok: false, reason: 'notFound' });
    expect(parseGsiAddress({ features: [] })).toEqual({ ok: false, reason: 'badResponse' });
    expect(parseGsiAddress([{ geometry: { coordinates: ['140', '38'] } }])).toEqual({
      ok: false,
      reason: 'badResponse',
    });
    expect(parseGsiAddress([{ geometry: { coordinates: [200, 95] } }])).toEqual({ ok: false, reason: 'badResponse' });
    expect(parseGsiAddress([null, 1, { geometry: null }])).toEqual({ ok: false, reason: 'badResponse' });
    // 読めない候補は飛ばし、読めるものだけ返す。title が無ければ空
    expect(parseGsiAddress([{ geometry: {} }, { geometry: { coordinates: [140, 38] } }])).toEqual({
      ok: true,
      hits: [{ title: '', lat: 38, lng: 140 }],
    });
  });
});

describe('lookupPostalCode（郵便番号 → 住所）', () => {
  it('fetch で7桁の郵便番号だけを送る', async () => {
    const { f, urls } = fakeFetch(() => ZIP_OK);
    const r = await lookupPostalCode('980-0811', { fetch: f });
    expect(r).toEqual({ ok: true, hits: [{ address: '宮城県仙台市青葉区一番町' }] });
    expect(urls).toEqual([`${ZIPCLOUD_URL}?zipcode=9800811`]);
  });
  it('7桁にできなければ送らずに invalid', async () => {
    const { f, urls } = fakeFetch(() => ZIP_OK);
    expect(await lookupPostalCode('980', { fetch: f })).toEqual({ ok: false, reason: 'invalid' });
    expect(await lookupPostalCode('', { fetch: f })).toEqual({ ok: false, reason: 'invalid' });
    expect(urls).toEqual([]);
  });
  it('fetch が投げた（CORS で読めない）ときだけ JSONP で呼び直す', async () => {
    const calls: string[] = [];
    const r = await lookupPostalCode('9800811', {
      fetch: corsFetch,
      jsonp: async (url) => {
        calls.push(url);
        return ZIP_OK;
      },
    });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([`${ZIPCLOUD_URL}?zipcode=9800811`]);
  });
  it('時間切れ・HTTP のエラー・形の違いでは JSONP へ切り替えない', async () => {
    let jsonpCalls = 0;
    const jp = async () => {
      jsonpCalls += 1;
      return ZIP_OK;
    };
    expect(await lookupPostalCode('9800811', { fetch: hangingFetch, jsonp: jp, timeoutMs: 20 })).toEqual({
      ok: false,
      reason: 'timeout',
    });
    expect(await lookupPostalCode('9800811', { fetch: fakeFetch(() => ZIP_OK, false).f, jsonp: jp })).toEqual({
      ok: false,
      reason: 'network',
    });
    expect(await lookupPostalCode('9800811', { fetch: fakeFetch(() => 'x').f, jsonp: jp })).toEqual({
      ok: false,
      reason: 'badResponse',
    });
    expect(jsonpCalls).toBe(0);
  });
  it('JSONP も失敗したらその理由（時間切れ・つながらない）', async () => {
    const r = await lookupPostalCode('9800811', {
      fetch: corsFetch,
      jsonp: () => jsonp('https://example.invalid/x', { timeoutMs: 10, doc: fakeDoc().doc, win: {} }),
    });
    expect(r).toEqual({ ok: false, reason: 'timeout' });
  });
  it('JSON でない応答は badResponse', async () => {
    const f: FetchFn = async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    expect(await lookupPostalCode('9800811', { fetch: f })).toEqual({ ok: false, reason: 'badResponse' });
  });
  it('止めたら aborted（JSONP へ切り替えない）', async () => {
    const ctrl = new AbortController();
    const p = lookupPostalCode('9800811', { fetch: hangingFetch, signal: ctrl.signal, jsonp: async () => ZIP_OK });
    ctrl.abort();
    expect(await p).toEqual({ ok: false, reason: 'aborted' });
  });
});

describe('searchAddress（住所 → 位置）', () => {
  it('住所を URL に符号化して送り、候補を返す', async () => {
    const { f, urls } = fakeFetch(() => GSI_OK);
    const r = await searchAddress(' 宮城県仙台市青葉区一番町1-1 ', { fetch: f });
    expect(r.ok && r.hits[0]).toEqual({ title: '宮城県仙台市青葉区一番町一丁目', lat: 38.2601, lng: 140.8716 });
    expect(urls).toEqual([`${GSI_ADDRESS_URL}?q=${encodeURIComponent('宮城県仙台市青葉区一番町1-1')}`]);
  });
  it('空の住所は送らない。見つからない・時間切れ・つながらない・形の違いを分ける', async () => {
    const { f, urls } = fakeFetch(() => GSI_OK);
    expect(await searchAddress('  ', { fetch: f })).toEqual({ ok: false, reason: 'invalid' });
    expect(urls).toEqual([]);
    expect(await searchAddress('どこか', { fetch: fakeFetch(() => []).f })).toEqual({ ok: false, reason: 'notFound' });
    expect(await searchAddress('どこか', { fetch: hangingFetch, timeoutMs: 20 })).toEqual({
      ok: false,
      reason: 'timeout',
    });
    expect(await searchAddress('どこか', { fetch: corsFetch })).toEqual({ ok: false, reason: 'network' });
    expect(await searchAddress('どこか', { fetch: fakeFetch(() => ({ a: 1 })).f })).toEqual({
      ok: false,
      reason: 'badResponse',
    });
  });
});

/** 偽の document：足された script を残す。onLoad で応答の呼び出しをまねる */
function fakeDoc() {
  const added: (JsonpScript & { removed: boolean })[] = [];
  const doc: JsonpDoc = {
    createElement: () => {
      const s = {
        src: '',
        onerror: null as JsonpScript['onerror'],
        removed: false,
        remove() {
          s.removed = true;
        },
      };
      return s;
    },
    head: {
      appendChild: (el) => {
        added.push(el as JsonpScript & { removed: boolean });
        return el;
      },
    },
  };
  return { doc, added };
}
const callbackOf = (src: string) => new URL(src).searchParams.get('callback') ?? '';

describe('jsonp（script 要素で呼ぶ）', () => {
  it('callback を足して呼び、応答を返したら script とグローバルの関数を片付ける', async () => {
    const { doc, added } = fakeDoc();
    const win: Record<string, unknown> = {};
    const p = jsonp(`${ZIPCLOUD_URL}?zipcode=9800811`, { timeoutMs: 1000, doc, win });
    expect(added).toHaveLength(1);
    const name = callbackOf(added[0].src);
    expect(name).toMatch(/^__vrdJsonp_\d+_\d+$/);
    expect(added[0].src).toContain('zipcode=9800811&callback=');
    (win[name] as (x: unknown) => void)(ZIP_OK);
    expect(await p).toEqual(ZIP_OK);
    expect(added[0].removed).toBe(true);
    expect(name in win).toBe(false);
  });
  it('呼ぶたびに名前が違う', async () => {
    const { doc, added } = fakeDoc();
    const win: Record<string, unknown> = {};
    const a = jsonp('https://example.invalid/a', { timeoutMs: 1000, doc, win });
    const b = jsonp('https://example.invalid/b', { timeoutMs: 1000, doc, win });
    const [na, nb] = added.map((s) => callbackOf(s.src));
    expect(na).not.toBe(nb);
    (win[na] as (x: unknown) => void)(1);
    (win[nb] as (x: unknown) => void)(2);
    expect([await a, await b]).toEqual([1, 2]);
  });
  it('時間切れ：script を消し、遅れて届いた応答は何もしない関数で受けて捨てる', async () => {
    const { doc, added } = fakeDoc();
    const win: Record<string, unknown> = {};
    const p = jsonp('https://example.invalid/x', { timeoutMs: 10, doc, win });
    const name = callbackOf(added[0].src);
    await expect(p).rejects.toMatchObject({ reason: 'timeout' });
    expect(added[0].removed).toBe(true);
    // 遅れて届いても落ちず、そのとき関数を消す
    expect(() => (win[name] as (x: unknown) => void)(ZIP_OK)).not.toThrow();
    expect(name in win).toBe(false);
  });
  it('読み込めない（onerror）なら network、止めたら aborted。どちらも script を消す', async () => {
    const { doc, added } = fakeDoc();
    const win: Record<string, unknown> = {};
    const p = jsonp('https://example.invalid/x', { timeoutMs: 1000, doc, win });
    added[0].onerror?.({});
    await expect(p).rejects.toMatchObject({ reason: 'network' });
    expect(added[0].removed).toBe(true);
    const ctrl = new AbortController();
    const q = jsonp('https://example.invalid/y', { timeoutMs: 1000, doc, win, signal: ctrl.signal });
    ctrl.abort();
    await expect(q).rejects.toMatchObject({ reason: 'aborted' });
    expect(added[1].removed).toBe(true);
  });
});

describe('lookupMessage（失敗の文）', () => {
  it('どの理由も日本語の文になる', () => {
    for (const r of ['invalid', 'notFound', 'timeout', 'network', 'badResponse', 'aborted'] as const) {
      expect(lookupMessage(r, 'postal')).toMatch(/[ぁ-ん]/);
      expect(lookupMessage(r, 'address')).toMatch(/[ぁ-ん]/);
    }
    expect(lookupMessage('timeout', 'address')).toContain('8秒');
    expect(lookupMessage('notFound', 'address')).toContain('見つかりませんでした');
  });
});
