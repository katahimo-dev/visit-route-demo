// 〈利用者さん〉の検索（PRD D61。design.md §4 pages「混み具合バーの3段・〈利用者さん〉の検索・週間の上限」）。
// 表示名・よみの部分一致。ひらがな・カタカナ・全角半角・大文字小文字・空白の違いを問わない
import type { Client } from '../contracts/documents';

/** カタカナ（ァ〜ヶ・ヽヾ）をひらがなに */
function kataToHira(text: string): string {
  return text.replace(/[ァ-ヶヽヾ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * 比べるための形にそろえる：NFKC（全角英数→半角、半角カナ→全角カナ、全角空白→半角）→ 小文字 → 空白を除く → カタカナをひらがなに。
 * 例：「ﾄｼｮｶﾝ　フミ」→「としょかんふみ」
 */
export function normalizeKana(text: string): string {
  // ハイフン・各種マイナス・ダッシュ（NFKC で残るもの）は長音「ー」にそろえる
  return kataToHira(
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[-‐‑‒–—―−－ｰ]/g, 'ー'),
  );
}

/** 近道のまとめて選ぶボタンの文。N は足す人数（すでに選んでいる人は数えない） */
export function chooseAllLabel(toAdd: number): string {
  return `あと${toAdd}人を選ぶ`;
}

/** 表示名かよみに query が含まれるか（query が空なら true） */
export function matchClient(client: Pick<Client, 'displayName' | 'kana'>, query: string): boolean {
  const q = normalizeKana(query);
  if (q === '') return true;
  return normalizeKana(client.displayName).includes(q) || normalizeKana(client.kana).includes(q);
}

/** 先頭から一致するか（候補の並びで前に出す） */
export function matchClientPrefix(client: Pick<Client, 'displayName' | 'kana'>, query: string): boolean {
  const q = normalizeKana(query);
  if (q === '') return false;
  return normalizeKana(client.displayName).startsWith(q) || normalizeKana(client.kana).startsWith(q);
}

/**
 * 候補を絞る：一致する人を、先頭から一致する人 → それ以外の順に（同じ組の中は渡した順のまま）。
 * limit を超えた分は数だけ返す
 */
export function searchClients<T extends Pick<Client, 'displayName' | 'kana'>>(
  clients: readonly T[],
  query: string,
  limit: number,
): { list: T[]; rest: number } {
  const hit = clients.filter((c) => matchClient(c, query));
  const head = hit.filter((c) => matchClientPrefix(c, query));
  const tail = hit.filter((c) => !matchClientPrefix(c, query));
  const all = [...head, ...tail];
  return { list: all.slice(0, limit), rest: Math.max(0, all.length - limit) };
}

/**
 * 近道「〈スタッフ〉が担当する人」の表（〈スタッフ〉の ID → 〈利用者さん〉の ID）。
 * pairs は案の担当（〈スタッフ〉の ID と、その人が担当する訪問の〈利用者さん〉の ID。未知の訪問は undefined で飛ばす）、
 * それに各〈利用者さん〉のいつもの担当を足す
 */
export function staffClientMap(
  pairs: Iterable<readonly [string, string | undefined]>,
  clients: readonly Pick<Client, 'id' | 'usualStaffId'>[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (sid: string, cid: string | undefined) => {
    if (cid === undefined) return;
    const set = out.get(sid) ?? new Set<string>();
    set.add(cid);
    out.set(sid, set);
  };
  for (const [sid, cid] of pairs) add(sid, cid);
  for (const c of clients) if (c.usualStaffId) add(c.usualStaffId, c.id);
  return out;
}

/**
 * 近道「〈スタッフ〉が担当する人」で最初に選んでおく〈スタッフ〉：担当する人（候補の中で数えた人数）が1人以上いる最初の人。
 * だれもいなければ先頭（〈スタッフ〉がいなければ ''）。
 * 名前の順の先頭の人が、案もいつもの担当も無い人だと、近道を開いたとたんに候補が0人になるため
 */
export function defaultStaffOf(staff: readonly { id: string }[], countOf: (staffId: string) => number): string {
  return (staff.find((s) => countOf(s.id) > 0) ?? staff[0])?.id ?? '';
}

/** ids のうち、候補（clients）にいる人の数 */
export function countAmong(ids: ReadonlySet<string>, clients: readonly { id: string }[]): number {
  return clients.reduce((n, c) => n + (ids.has(c.id) ? 1 : 0), 0);
}
