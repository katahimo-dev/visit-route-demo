/**
 * 郵便番号→住所と、住所→位置の検索（PRD D86〜D90。ADR-0016）。外部のサービスを呼ぶ**ただ1か所**。
 * 呼ぶのは画面（住所の入力の部品 AddressField：〈利用者さん〉の編集の欄・空き状況の場所・〈スタッフ〉の自宅。と、まとめて置く）だけで、利用者がボタンを押したときだけ。
 * solver・matching・evaluate・seed・patterns・vacancy・reassign・excel・store からは呼ばない。
 *
 * - 郵便番号：zipcloud（fetch。fetch が投げた（CORS で読めない・通信できない）ときだけ JSONP で呼び直す）
 * - 住所：国土地理院の住所検索（fetch だけ。GeoJSON の Feature の配列。coordinates は [経度, 緯度]）
 * 応答の形は既知の仕様に合わせ、違っていても落とさず badResponse で返す。テストは fetch・JSONP の偽物で行う。
 */

import { normalizePostalCode } from './postalCode';

export const ZIPCLOUD_URL = 'https://zipcloud.ibsnet.co.jp/api/search';
export const GSI_ADDRESS_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch';
/** 1回の呼び出しの時間切れ（ミリ秒） */
export const GEOCODE_TIMEOUT_MS = 8000;
/** 候補として出す数の上限 */
export const MAX_HITS = 5;

/** 失敗の種類：入力が正しくない・見つからない・時間切れ・つながらない・応答の形が違う・止めた */
export type LookupFail = 'invalid' | 'notFound' | 'timeout' | 'network' | 'badResponse' | 'aborted';
export type LookupResult<T> = { ok: true; hits: T[] } | { ok: false; reason: LookupFail };
/** 郵便番号の候補：都道府県＋市区町村＋町名 */
export type PostalHit = { address: string };
/** 住所の候補：見つかった住所の名前と位置 */
export type GeoHit = { title: string; lat: number; lng: number };

/** JSONP が足す script 要素のうち使う所だけ（テストで偽物を渡せるように） */
export type JsonpScript = {
  src: string;
  onerror: ((ev: unknown) => void) | null;
  /** 読み込んで実行し終えたとき（応答の関数呼び出しはその前に済む） */
  onload?: ((ev: unknown) => void) | null;
  remove(): void;
};
export type JsonpDoc = {
  createElement(tag: 'script'): JsonpScript;
  head: { appendChild(el: JsonpScript): unknown };
};
export type JsonpWin = Record<string, unknown>;
export type JsonpOptions = { timeoutMs: number; signal?: AbortSignal; doc?: JsonpDoc; win?: JsonpWin };
export type JsonpFn = (url: string, opts: JsonpOptions) => Promise<unknown>;
export type FetchFn = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export type LookupOptions = {
  fetch?: FetchFn;
  jsonp?: JsonpFn;
  /** 既定 8000 */
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** 失敗の理由を運ぶ（このファイルの中だけ）。fetchThrew は fetch そのものが投げた（JSONP へ切り替えてよい） */
class LookupError extends Error {
  constructor(
    readonly reason: LookupFail,
    readonly fetchThrew = false,
  ) {
    super(reason);
  }
}
const fail = <T>(reason: LookupFail): LookupResult<T> => ({ ok: false, reason });
const reasonOf = (e: unknown): LookupFail => (e instanceof LookupError ? e.reason : 'network');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** fetch して JSON を読む。時間切れ・止める・HTTP のエラー・JSON でない を LookupError にする */
async function getJson(url: string, opts: LookupOptions): Promise<unknown> {
  const f: FetchFn = opts.fetch ?? ((u, init) => globalThis.fetch(u, init));
  const timeoutMs = opts.timeoutMs ?? GEOCODE_TIMEOUT_MS;
  if (opts.signal?.aborted) throw new LookupError('aborted');
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const why = (fallback: LookupError) =>
    timedOut ? new LookupError('timeout') : opts.signal?.aborted ? new LookupError('aborted') : fallback;
  try {
    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await f(url, { signal: ctrl.signal });
    } catch {
      throw why(new LookupError('network', true));
    }
    if (!res.ok) throw new LookupError('network');
    try {
      return await res.json();
    } catch {
      throw why(new LookupError('badResponse'));
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

let jsonpSeq = 0;
/** 時間切れ・止めた後のコールバックを捨てずに残しておく長さ（遅れて届いた応答でエラーを出さないため） */
const LATE_KEEP_MS = 60_000;

/**
 * JSONP で呼ぶ：`callback=一意の名前` を付けた script 要素を足し、応答（関数呼び出し）を受け取る。
 * 終わったら（成功・失敗・時間切れ・止める）script 要素を消し、グローバルの関数を片付ける。
 * 時間切れ・止めた後に届いた応答は、何もしない関数で受けて捨てる（しばらくして消す）
 */
export const jsonp: JsonpFn = (url, { timeoutMs, signal, doc, win }) => {
  const d = doc ?? (globalThis.document as unknown as JsonpDoc | undefined);
  const w = win ?? (globalThis as unknown as JsonpWin);
  return new Promise((resolve, reject) => {
    if (!d) {
      reject(new LookupError('network'));
      return;
    }
    if (signal?.aborted) {
      reject(new LookupError('aborted'));
      return;
    }
    jsonpSeq += 1;
    const name = `__vrdJsonp_${jsonpSeq}_${Date.now()}`;
    const script = d.createElement('script');
    let done = false;
    const finish = (ok: boolean, settle: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      script.onerror = null;
      script.onload = null;
      script.remove();
      if (ok) delete w[name];
      else {
        w[name] = () => {
          delete w[name];
        };
        setTimeout(() => {
          delete w[name];
        }, LATE_KEEP_MS);
      }
      settle();
    };
    const onAbort = () => finish(false, () => reject(new LookupError('aborted')));
    const timer = setTimeout(() => finish(false, () => reject(new LookupError('timeout'))), timeoutMs);
    w[name] = (payload: unknown) => finish(true, () => resolve(payload));
    script.onerror = () => finish(false, () => reject(new LookupError('network')));
    // 読み込んで実行し終えたのに応答の関数が呼ばれていない（JSONP でない応答）なら、時間切れを待たずに形の違いで返す
    script.onload = () => finish(false, () => reject(new LookupError('badResponse')));
    signal?.addEventListener('abort', onAbort);
    script.src = `${url}${url.includes('?') ? '&' : '?'}callback=${name}`;
    d.head.appendChild(script);
  });
};

/** zipcloud の応答を読む（{ status, message, results: [{ address1, address2, address3 }] | null }） */
export function parseZipcloud(raw: unknown): LookupResult<PostalHit> {
  if (!isObj(raw)) return fail('badResponse');
  const status = Number(raw.status);
  if (status !== 200) return fail(status === 400 ? 'invalid' : 'badResponse');
  if (raw.results === null || raw.results === undefined) return fail('notFound');
  if (!Array.isArray(raw.results)) return fail('badResponse');
  if (raw.results.length === 0) return fail('notFound');
  const hits: PostalHit[] = [];
  for (const r of raw.results) {
    if (!isObj(r)) continue;
    const parts = [r.address1, r.address2, r.address3];
    if (!parts.every((p) => typeof p === 'string')) continue;
    const address = (parts as string[]).join('').trim();
    if (address !== '' && !hits.some((h) => h.address === address)) hits.push({ address });
  }
  return hits.length === 0 ? fail('badResponse') : { ok: true, hits: hits.slice(0, MAX_HITS) };
}

/** 国土地理院の住所検索の応答を読む（Feature の配列。geometry.coordinates は [経度, 緯度]、properties.title は住所） */
export function parseGsiAddress(raw: unknown): LookupResult<GeoHit> {
  if (!Array.isArray(raw)) return fail('badResponse');
  if (raw.length === 0) return fail('notFound');
  const hits: GeoHit[] = [];
  for (const f of raw) {
    if (!isObj(f) || !isObj(f.geometry)) continue;
    const c = f.geometry.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const [lng, lat] = c;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const title = isObj(f.properties) && typeof f.properties.title === 'string' ? f.properties.title : '';
    hits.push({ title, lat, lng });
  }
  return hits.length === 0 ? fail('badResponse') : { ok: true, hits: hits.slice(0, MAX_HITS) };
}

/**
 * 郵便番号から住所を探す（zipcloud）。fetch を先に試し、fetch が投げたとき（CORS で読めない・通信できない）だけ
 * JSONP で呼び直す。時間切れ・HTTP のエラー・形の違いでは切り替えない。
 * 締め切りは全体で timeoutMs（既定8秒）：JSONP は残りの時間で呼び、残りが無ければ時間切れ
 */
export async function lookupPostalCode(code: string, opts: LookupOptions = {}): Promise<LookupResult<PostalHit>> {
  const c = normalizePostalCode(code);
  if (!c) return fail('invalid');
  const url = `${ZIPCLOUD_URL}?zipcode=${c}`;
  const total = opts.timeoutMs ?? GEOCODE_TIMEOUT_MS;
  const started = Date.now();
  try {
    return parseZipcloud(await getJson(url, { ...opts, timeoutMs: total }));
  } catch (e) {
    if (!(e instanceof LookupError && e.fetchThrew)) return fail(reasonOf(e));
  }
  const left = total - (Date.now() - started);
  if (left <= 0) return fail('timeout');
  try {
    const call = opts.jsonp ?? jsonp;
    return parseZipcloud(await call(url, { timeoutMs: left, signal: opts.signal }));
  } catch (e) {
    return fail(reasonOf(e));
  }
}

/** 住所から位置を探す（国土地理院の住所検索） */
export async function searchAddress(address: string, opts: LookupOptions = {}): Promise<LookupResult<GeoHit>> {
  const q = address.trim();
  if (q === '') return fail('invalid');
  try {
    return parseGsiAddress(await getJson(`${GSI_ADDRESS_URL}?q=${encodeURIComponent(q)}`, opts));
  } catch (e) {
    return fail(reasonOf(e));
  }
}

/** 失敗を利用者向けの短い文に（what：郵便番号の検索か住所の検索か） */
export function lookupMessage(reason: LookupFail, what: 'postal' | 'address'): string {
  const fallback = what === 'postal' ? '住所を手で入れてください' : '地図をクリックして置いてください';
  switch (reason) {
    case 'invalid':
      return what === 'postal'
        ? '郵便番号は7桁の数字で入れてください（ハイフンは有っても無くても構いません）'
        : '住所を入れてください';
    case 'notFound':
      return what === 'postal'
        ? '見つかりませんでした。郵便番号を確かめてください'
        : '見つかりませんでした。住所の書き方（都道府県から）を確かめるか、地図をクリックして置いてください';
    case 'timeout':
      return `時間内に応答がありませんでした（${GEOCODE_TIMEOUT_MS / 1000}秒）。少し待ってもう一度押すか、${fallback}`;
    case 'network':
      return `つながりませんでした。通信の状態を確かめるか、${fallback}`;
    case 'badResponse':
      return `応答の形が想定と違います。${fallback}`;
    case 'aborted':
      return '止めました';
  }
}

/** ボタンの近くに常に出す注記（PRD D90） */
export const EXTERNAL_NOTICE = '押すと、郵便番号・住所を外部のサービス（郵便番号検索・国土地理院）へ送ります';
