// 名前から詳細を開く場所を足す（PRD D205〜D209。ADR-0022 追記）ための純粋関数：
// 日の画面の休みの帯の〈利用者さん〉、名簿の読み込みで最終勤務日が入った〈スタッフ〉（稼働の見込みへのリンクは lib/links の workloadHref）
import type { ClientLeave, Staff } from '../contracts/documents';
import { leaveOn } from '../domain/leaves';

/** 休みのため無しの訪問の〈利用者さん〉1人ぶん（name は空ならデータにいない人。note は休みの理由） */
export type LeavePerson = { clientId: string; name: string; note: string };

/**
 * 休みのため無しの訪問から〈利用者さん〉を重ねずに並べる（最初に出た順）。名前はデータに無ければ空、理由は
 * その日の休みのメモ（無ければ空）。日の画面の「〈利用者さん〉の休みのため無し」の帯で使う（PRD D208）
 */
export function leavePeople(
  visits: readonly { clientId: string }[],
  leaves: readonly ClientLeave[],
  date: string,
  nameOf: (clientId: string) => string | undefined,
): LeavePerson[] {
  const seen = new Map<string, LeavePerson>();
  for (const v of visits) {
    if (seen.has(v.clientId)) continue;
    seen.set(v.clientId, {
      clientId: v.clientId,
      name: nameOf(v.clientId) ?? '',
      note: leaveOn(leaves, v.clientId, date)?.note ?? '',
    });
  }
  return [...seen.values()];
}

/** 最終勤務日が入った・変わった〈スタッフ〉1人ぶん */
export type LastDayPerson = { id: string; name: string; lastDay: string };

/**
 * 名簿を読み込む前と後を比べ、最終勤務日が入った・変わった〈スタッフ〉を読み込んだあとの並びで返す（PRD D209）。
 * 足した人も最終勤務日があれば数える（excel の importRoster の lastDaySet と同じ決まり。こちらは ID も返す）
 */
export function lastDayChanged(
  before: readonly Pick<Staff, 'id' | 'lastDay'>[],
  after: readonly Pick<Staff, 'id' | 'name' | 'lastDay'>[],
): LastDayPerson[] {
  const prev = new Map(before.map((s) => [s.id, s.lastDay]));
  const out: LastDayPerson[] = [];
  for (const s of after) {
    if (s.lastDay === null || prev.get(s.id) === s.lastDay) continue;
    out.push({ id: s.id, name: s.name, lastDay: s.lastDay });
  }
  return out;
}
