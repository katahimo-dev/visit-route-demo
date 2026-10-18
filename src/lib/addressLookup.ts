/**
 * 住所の入力の部品（components/placeLookup の AddressField。PRD D86〜D88・D90・D118〜D121。ADR-0016）の純粋なロジック。
 * 郵便番号の欄の確かめ・ボタンを押せない理由・見つけた住所の当て方・状態の知らせ・候補の並びを決める。
 * 外部は呼ばない（呼ぶのは lib/geocode だけ）。〈利用者さん〉・空き状況の場所・〈スタッフ〉の自宅で共通に使う
 */
import type { Place } from '../contracts/documents';
import { type GeoHit, type LookupFail, lookupMessage, type PostalHit } from './geocode';
import { normalizePostalCode } from './postalCode';

/** 探している検索（郵便番号から住所／住所から位置）。null は探していない */
export type LookupBusy = 'postal' | 'address' | null;
/** 状態の知らせ（探している・できた・失敗）。null は何も出さない */
export type LookupStatus = { kind: 'busy' | 'ok' | 'error'; text: string } | null;
/** 候補のボタン1つ（on は今入っているもの） */
export type CandidateItem = { key: string; text: string; on: boolean };

export const POSTAL_FORMAT_MESSAGE = '郵便番号は7桁の数字で入れてください';

/** 「住所を探す」を押せない理由（押せるなら null） */
export function postalBlockReason(postalText: string, busy: LookupBusy): string | null {
  if (busy) return '探しています';
  const postal = normalizePostalCode(postalText);
  if (postal === '') return '郵便番号を入れてください';
  if (postal === null) return POSTAL_FORMAT_MESSAGE;
  return null;
}

/** 「地図に置く」を押せない理由（押せるなら null） */
export function addressBlockReason(address: string, busy: LookupBusy): string | null {
  if (busy) return '探しています';
  return address.trim() === '' ? '住所を入れてください' : null;
}

/** 郵便番号の欄に、7桁にできない値が入っている（空は正しい） */
export const postalInputError = (postalText: string): boolean =>
  postalText.trim() !== '' && normalizePostalCode(postalText) === null;

/** 探しているあいだの知らせ */
export const busyStatus = (what: 'postal' | 'address'): LookupStatus => ({
  kind: 'busy',
  text: what === 'postal' ? '住所を探しています…' : '位置を探しています…',
});

/** 失敗の知らせ（文は lib/geocode の lookupMessage） */
export const failStatus = (reason: LookupFail, what: 'postal' | 'address'): LookupStatus => ({
  kind: 'error',
  text: lookupMessage(reason, what),
});

/** 住所を差し替えたが、ピンは前の位置のまま残すときに足す知らせ（PRD D119） */
export const PIN_KEPT_NOTE = '位置は前のままです。『住所から置き直す』を押してください';

/**
 * 見つけた住所の当て方：いまの住所が見つけた住所で始まるなら（番地まで書いてあれば）そのまま、
 * そうでなければ見つけた住所で置き換える。hasPin（もうピンがある）なら、ピンは消さずに残し、知らせに置き直しを促す一言を足す
 */
export type AddressApply =
  | { replace: false; status: LookupStatus }
  | { replace: true; address: string; status: LookupStatus };
export function applyFoundAddress(current: string, found: string, hasPin = false): AddressApply {
  if (current.trim().startsWith(found)) {
    return { replace: false, status: { kind: 'ok', text: `住所は「${found}」で始まっているので、そのままにしました` } };
  }
  return {
    replace: true,
    address: found,
    status: {
      kind: 'ok',
      text: `住所に「${found}」を入れました。番地を続けて書いてください${hasPin ? `。${PIN_KEPT_NOTE}` : ''}`,
    },
  };
}

/**
 * 検索の応答を使ってよいか：送ったときの値（郵便番号は7桁、住所は前後の空白を除いたもの）と、いまの欄の値が同じときだけ。
 * 待っている間に欄を書き換えたら、古い応答は捨てる
 */
export const sameQuery = (what: 'postal' | 'address', sent: string, now: string): boolean =>
  what === 'postal' ? normalizePostalCode(now) === sent : now.trim() === sent;

/**
 * ピンを置いたときの住所（空き状況の見出しに使う。PRD D119）：位置が変わったら新しい住所、変わらなければ前のまま。
 * 住所を打ったり郵便番号から差し替えたりしても、置き直すまでは変えない
 */
export const pinnedAddressAfter = (prev: Place & { pinnedAddress: string }, next: Place): string =>
  next.lat !== prev.lat || next.lng !== prev.lng ? (next.lat === null ? '' : next.address) : prev.pinnedAddress;

/** 「元に戻す」の先：最初に置き換える前の住所を残す（候補を選び直しても上書きしない） */
export const nextUndoAddress = (prev: string | null, before: string): string => (prev !== null ? prev : before);

/** 「住所を元に戻す」を出すか（戻す先が空なら出さない） */
export const canUndoAddress = (undo: string | null): undo is string => undo !== null && undo.trim() !== '';

/** ピンを置いたときの知らせ */
export const pinStatus = (hit: GeoHit): LookupStatus => ({
  kind: 'ok',
  text: `地図に置きました${hit.title ? `（${hit.title}）` : ''}。ずれていれば「位置を消す」を押してから地図をクリックしてください`,
});

/** 知らせの見た目の class */
export const statusClass = (status: LookupStatus): string =>
  `place-status${status?.kind === 'error' ? ' is-error' : status?.kind === 'ok' ? ' is-ok' : ''}`;

/** 郵便番号のほかの候補（いまの住所がその住所で始まるものを選んでいる扱い） */
export const postalCandidates = (hits: PostalHit[], address: string): CandidateItem[] =>
  hits.map((h) => ({ key: h.address, text: h.address, on: address.startsWith(h.address) }));

/** 住所のほかの候補（いまの位置と同じものを選んでいる扱い。名前が無ければ緯度・経度） */
export const geoCandidates = (hits: GeoHit[], value: Place): CandidateItem[] =>
  hits.map((h, i) => ({
    key: `${i}`,
    text: h.title || `${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}`,
    on: value.lat === h.lat && value.lng === h.lng,
  }));

/** 場所の型から住所・位置だけを取り出す（郵便番号など、契約の Place に無いものを落とす） */
export const toPlace = (p: Place): Place => ({ address: p.address, lat: p.lat, lng: p.lng });
