// 〈利用者さん〉の画面の「仮押さえを取り消す」（D47。ADR-0012 追記）の純粋関数。データは書き換えず、新しい DemoData を返す
import type { DemoData } from '../contracts/data';
import { removePattern } from '../patterns';
import { repair } from '../store/repair';

/** その〈利用者さん〉の訪問を伝えた日（確定した日。日付の順・重複なし） */
export function confirmedDatesOf(d: Pick<DemoData, 'snapshots'>, clientId: string): string[] {
  return Object.values(d.snapshots)
    .filter((s) => s.visits.some((v) => v.clientId === clientId))
    .map((s) => s.date)
    .sort();
}

/**
 * 仮押さえを取り消す：その人の定期パターンを removePattern で消し、〈利用者さん〉と、その人の訪問をすべて消す
 * （パターンで消えずに残る今日より前・この回だけ変えた回・単発も）。
 * 〈利用者さん〉は相性（compat）から除く（repair を通す）。伝えた内容に残る訪問は「未連絡の変更」の「外れる」になる
 */
export function cancelTentative(d: DemoData, clientId: string, today: string): DemoData {
  let x = { patterns: d.patterns, visits: d.visits, clients: d.clients };
  for (const p of d.patterns.filter((p) => p.clientId === clientId)) {
    const r = removePattern(x, p.id, today);
    x = { ...x, patterns: r.patterns, visits: r.visits };
  }
  return repair({
    ...d,
    patterns: x.patterns,
    visits: x.visits.filter((v) => v.clientId !== clientId),
    clients: d.clients.filter((c) => c.id !== clientId),
  });
}
