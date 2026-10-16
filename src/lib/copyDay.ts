// 予定の画面の「前の週の同じ曜日からコピー」（ADR-0012）の純粋関数。データは書き換えず、足す訪問と確定した割当の列を返す。
// 新しい ID は引数（makeId）で受け取る
import type { DemoData } from '../contracts/data';
import type { Pattern, Visit } from '../contracts/documents';
import type { Cols } from '../domain/scheduleModel';
import { occursOn } from '../patterns';
import { own } from './common';

export type CopyDay = {
  /** 足す訪問（コピー元の順） */
  visits: Visit[];
  /** コピー先の日の確定した割当（コピー元の確定した割当を新しい ID に写したもの） */
  cols: Cols;
};

/** パターンの展開と、時刻（時間の決め方・開始（早・遅））・所要・種類が違うか */
const differsFromPattern = (v: Visit, p: Pattern) =>
  v.windowKind !== p.windowKind ||
  v.earliestStart !== p.earliestStart ||
  v.latestStart !== p.latestStart ||
  v.durationMinutes !== p.durationMinutes ||
  v.typeId !== p.typeId;

/**
 * from の日の取り消しでない訪問を to の日へ写す。
 * コピー元がパターンの訪問で、そのパターンが to の日に回を持つ（occursOn）なら、ID を `${to}_${パターンID}`、
 * pattern を { id, date: to, edited: 時刻・所要・種類が展開と違えば true } にして写す（あとの applyPatterns で二重にしない）。
 * その ID の訪問がすでにあれば写さない（あるものを使う。to の日にあって取り消しでなければ確定した割当の列にも入れる）。
 * それ以外は makeId の新しい ID で、pattern を null（単発）にして写す
 */
export function copyDayVisits(
  d: Pick<DemoData, 'visits' | 'patterns' | 'manualPlans'>,
  from: string,
  to: string,
  makeId: () => string,
): CopyDay {
  const src = d.visits.filter((v) => v.date === from && !v.cancelled);
  const byId = new Map(d.visits.map((v) => [v.id, v]));
  const idMap = new Map<string, string>();
  const visits: Visit[] = [];
  for (const v of src) {
    const p = v.pattern ? d.patterns.find((x) => x.id === v.pattern!.id) : undefined;
    if (p && occursOn(p, to)) {
      const id = `${to}_${p.id}`;
      const existing = byId.get(id);
      if (existing) {
        if (existing.date === to && !existing.cancelled) idMap.set(v.id, id);
        continue;
      }
      const copied: Visit = { ...v, id, date: to, pattern: { id: p.id, date: to, edited: differsFromPattern(v, p) } };
      byId.set(id, copied);
      idMap.set(v.id, id);
      visits.push(copied);
    } else {
      // 写した訪問は単発の訪問にする（コピー先の日がパターンの回ではないため）
      const id = makeId();
      idMap.set(v.id, id);
      visits.push({ ...v, id, date: to, pattern: null });
    }
  }
  const cols: Cols = {};
  for (const [s, ids] of Object.entries(own(d.manualPlans, from) ?? {})) {
    const mapped = ids.map((id) => idMap.get(id)).filter((x): x is string => !!x);
    if (mapped.length > 0) cols[s] = mapped;
  }
  return { visits, cols };
}
