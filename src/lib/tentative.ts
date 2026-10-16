// 〈利用者さん〉の画面の「仮押さえを取り消す」（D47。ADR-0012 追記）の純粋関数。データは書き換えず、新しい DemoData を返す
import type { DemoData } from '../contracts/data';
import { removePattern } from '../patterns';
import { repair } from '../store/repair';
import { own } from './common';

/** その〈利用者さん〉の訪問がある、確定した割当（manualPlans）のある日（日付の順・重複なし） */
export function confirmedDatesOf(d: Pick<DemoData, 'visits' | 'manualPlans'>, clientId: string): string[] {
  const dates = new Set(
    d.visits.filter((v) => v.clientId === clientId && !!own(d.manualPlans, v.date)).map((v) => v.date),
  );
  return [...dates].sort();
}

/**
 * 仮押さえを取り消す：その人の定期パターンを removePattern で消し、〈利用者さん〉と、その人の訪問をすべて消す
 * （パターンで消えずに残る今日より前・この回だけ変えた回・単発も）。
 * 消した訪問の ID は、store の repair と同じ規則で今の案（routes・generated・pins・reassign の base 系）・記録・
 * 確定した割当から除き、〈利用者さん〉は相性（compat）から除く（repair を通す）
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
