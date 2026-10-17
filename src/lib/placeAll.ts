import type { DemoData } from '../contracts/data';
import type { Client, Place } from '../contracts/documents';
import { byDisplayName, hasLocation } from './common';
import type { GeoHit, LookupFail, LookupOptions, LookupResult, PostalHit } from './geocode';

/**
 * 位置の無い〈利用者さん〉をまとめて地図に置く（PRD D89。ADR-0016）。
 * 1人ずつ順に、外部の検索を呼ぶたびに間隔をあける。結果は1人ごとに onResult で返し、書くのは画面（store の update）
 */

/** 呼ぶたびにあける間隔の既定（ミリ秒） */
export const PLACE_ALL_INTERVAL_MS = 400;

/**
 * まとめて置く対象：位置が無く、段階が「終了」でない〈利用者さん〉（表示名の順）のうち、住所か郵便番号のある人。
 * skipped は住所も郵便番号もない人
 */
export function placeAllTargets(clients: Client[]): { targets: Client[]; skipped: Client[] } {
  const pool = clients.filter((c) => c.stage !== 'ended' && !hasLocation(c.place)).sort(byDisplayName);
  const can = (c: Client) => c.place.address.trim() !== '' || c.place.postalCode !== '';
  return { targets: pool.filter(can), skipped: pool.filter((c) => !can(c)) };
}

/** 探したときの住所・郵便番号（書くときに、いまの値と違えば書かない） */
export type PlaceAllFrom = { address: string; postalCode: string };

export type PlaceAllResult =
  | {
      clientId: string;
      ok: true;
      lat: number;
      lng: number;
      /** 検索に使った住所（住所が空だった人は郵便番号から見つけた住所） */
      address: string;
      /** 国土地理院が返した住所の名前 */
      title: string;
      from: PlaceAllFrom;
    }
  | {
      clientId: string;
      ok: false;
      reason: LookupFail;
      /** どこで失敗したか（郵便番号から住所・住所から位置） */
      step: 'postal' | 'address';
      /** 郵便番号から住所は見つかったが位置が見つからなかったとき、その住所（住所だけ書く）。それ以外は null */
      foundAddress: string | null;
      from: PlaceAllFrom;
    };

export type PlaceAllOptions = {
  search: (address: string, opts: LookupOptions) => Promise<LookupResult<GeoHit>>;
  lookup: (code: string, opts: LookupOptions) => Promise<LookupResult<PostalHit>>;
  /** 間隔をあける（止めたらすぐ戻ってよい） */
  wait: (ms: number, signal?: AbortSignal) => Promise<void>;
  intervalMs?: number;
  signal?: AbortSignal;
  onResult: (r: PlaceAllResult) => void;
};

/** 待つ。signal で止めたらすぐ戻る */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  });
}

/**
 * 順に置く。住所が空の人は先に郵便番号から住所（先頭の候補）を探す。外部を呼ぶたびに intervalMs あける（最初の前はあけない）。
 * signal で止めたら、次の呼び出しから止める（stopped: true）。止めた呼び出しの結果は返さない
 */
export async function placeAll(targets: Client[], opts: PlaceAllOptions): Promise<{ stopped: boolean }> {
  const { signal } = opts;
  const intervalMs = opts.intervalMs ?? PLACE_ALL_INTERVAL_MS;
  let calls = 0;
  const call = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    if (calls > 0) await opts.wait(intervalMs, signal);
    if (signal?.aborted) return null;
    calls += 1;
    const r = await fn();
    return signal?.aborted ? null : r;
  };
  for (const c of targets) {
    if (signal?.aborted) return { stopped: true };
    const from: PlaceAllFrom = { address: c.place.address, postalCode: c.place.postalCode };
    let address = c.place.address.trim();
    let foundAddress: string | null = null;
    if (address === '') {
      const r = await call(() => opts.lookup(c.place.postalCode, { signal }));
      if (r === null) return { stopped: true };
      if (!r.ok) {
        opts.onResult({ clientId: c.id, ok: false, reason: r.reason, step: 'postal', foundAddress: null, from });
        continue;
      }
      address = r.hits[0].address;
      foundAddress = address;
    }
    const g = await call(() => opts.search(address, { signal }));
    if (g === null) return { stopped: true };
    if (!g.ok) {
      opts.onResult({ clientId: c.id, ok: false, reason: g.reason, step: 'address', foundAddress, from });
      continue;
    }
    const hit = g.hits[0];
    opts.onResult({ clientId: c.id, ok: true, lat: hit.lat, lng: hit.lng, address, title: hit.title, from });
  }
  return { stopped: false };
}

/**
 * 見つけた位置・住所を〈利用者さん〉に書く（store の update(fn) に渡す純粋関数）。書くのは、まだ位置が無く、
 * 住所・郵便番号が探したとき（from）のままの人だけ（その間に利用者が直した人は上書きしない）。
 * 住所が空だった人は見つけた住所も書く。lat・lng が null なら住所だけ書く（郵便番号で住所は見つかったが位置が見つからない人）。
 * 変えなければ同じ data を返す
 */
export function withFoundPlace(
  data: DemoData,
  clientId: string,
  from: PlaceAllFrom,
  found: { lat: number | null; lng: number | null; address: string },
): DemoData {
  const c = data.clients.find((x) => x.id === clientId);
  if (!c || hasLocation(c.place)) return data;
  if (c.place.address !== from.address || c.place.postalCode !== from.postalCode) return data;
  const fillAddress = c.place.address.trim() === '' && found.address.trim() !== '';
  const fillPin = found.lat !== null && found.lng !== null;
  if (!fillAddress && !fillPin) return data;
  const place = {
    ...c.place,
    address: fillAddress ? found.address.slice(0, 200) : c.place.address,
    ...(fillPin ? { lat: found.lat, lng: found.lng } : {}),
  };
  return { ...data, clients: data.clients.map((x) => (x.id === clientId ? { ...x, place } : x)) };
}

/**
 * 編集の欄を保存するときの場所（ADR-0016）：欄を開いた後に「まとめて地図に置く」が store に位置・住所を書いていて、
 * 欄ではその項目を触っていない（開いたときのまま）なら、store の値を残す（欄の古い値で消さない）
 */
export function keepStorePlace<T extends Place>(form: T, opened: T, stored: T | undefined): T {
  if (!stored) return form;
  let out = form;
  const pinUntouched = form.lat === opened.lat && form.lng === opened.lng;
  if (pinUntouched && !hasLocation(opened) && hasLocation(stored)) out = { ...out, lat: stored.lat, lng: stored.lng };
  if (form.address === opened.address && stored.address !== opened.address && opened.address.trim() === '')
    out = { ...out, address: stored.address };
  return out;
}
