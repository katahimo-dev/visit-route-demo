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
  return kataToHira(text.normalize('NFKC').toLowerCase().replace(/\s+/g, ''));
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
