// 日の予定の「元に戻す」の控え（PRD D218。ADR-0053）。直前の1手だけ、書く前の訪問・振り直しの情報・欠勤を画面の外に控える。
// 日の予定と比較の画面（提案を当てる）で同じ控えを使う。保存しない（読み直すと消える）
import type { DemoData } from '../contracts/data';
import { createValueStore } from './valueStore';

export type DayUndo = {
  /** 手直しした日 */
  date: string;
  /** 書く前（訪問・振り直しの情報・欠勤） */
  before: Pick<DemoData, 'visits' | 'reassigns' | 'absences'>;
  /** 書いたあとの訪問（これと今の訪問が違えば、ほかの操作で変わったので戻さない） */
  after: DemoData['visits'];
  /** 動かした訪問（戻したあと選び直す。提案を当てたときは null） */
  visitId: string | null;
  /** 動かす前の担当 */
  from: string | null;
};

export const dayUndo = createValueStore<DayUndo | null>(null);

/** 控えを作る */
export const undoOf = (
  date: string,
  before: DemoData,
  after: DemoData,
  visitId: string | null = null,
  from: string | null = null,
): DayUndo => ({
  date,
  before: { visits: before.visits, reassigns: before.reassigns, absences: before.absences },
  after: after.visits,
  visitId,
  from,
});

/** 戻したデータ（書いたあとに訪問が変わっていればそのまま） */
export function undoDay(d: DemoData, u: DayUndo): DemoData {
  return d.visits === u.after
    ? { ...d, visits: u.before.visits, reassigns: u.before.reassigns, absences: u.before.absences }
    : d;
}
