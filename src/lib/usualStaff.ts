// 〈利用者さん〉のいつもの担当（版2：〈利用者さん〉は担当を持たず、繰り返しの担当が1つだけ。ADR-0053）。純粋関数
import type { Pattern } from '../contracts/documents';

/**
 * 〈利用者さん〉のいつもの担当：その人の繰り返しのうち、today に続いている（終わっていない）もの、無ければいちばん新しく始まったものの担当。
 * 担当のある繰り返しが無ければ null
 */
export function usualStaffOf(
  patterns: readonly Pick<Pattern, 'clientId' | 'usualStaffId' | 'from' | 'to'>[],
  clientId: string,
  today: string,
): string | null {
  return usualStaffMap(patterns, today).get(clientId) ?? null;
}

/** 〈利用者さん〉ID → いつもの担当（usualStaffOf の表。担当のある人だけ） */
export function usualStaffMap(
  patterns: readonly Pick<Pattern, 'clientId' | 'usualStaffId' | 'from' | 'to'>[],
  today: string,
): Map<string, string> {
  const best = new Map<string, { live: boolean; from: string; staffId: string }>();
  for (const p of patterns) {
    if (p.usualStaffId === null) continue;
    const live = p.to === null || p.to >= today;
    const cur = best.get(p.clientId);
    if (!cur || (live && !cur.live) || (live === cur.live && p.from > cur.from)) {
      best.set(p.clientId, { live, from: p.from, staffId: p.usualStaffId });
    }
  }
  return new Map([...best].map(([id, x]) => [id, x.staffId]));
}
