// 「この割当で確定」（ADR-0004・0009）の書き方と、月の「問題の無い日をまとめて確定」（PRD D223）・
// 確定のあとの「次の確定していない日へ」（PRD D224）の純粋関数。データは書き換えず、新しい DemoData を返す（書くのは画面の update(fn)）
import type { DemoData } from '../contracts/data';
import type { Problem } from '../contracts/problem';
import { isOnLeave } from '../domain/leaves';
import { NONE, reconcile } from '../domain/scheduleModel';
import { weekday } from '../domain/time';
import { byName, own, WEEKDAY_LABELS } from './common';
import { keepLeaveVisits } from './leaves';
import type { DayStatus } from './month';
import { mdText } from './patternText';
import { alignRoutes } from './runs';

/** 訪問ID → 担当（未割当の列は除く） */
function ownerOf(routes: Record<string, string[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [s, ids] of Object.entries(routes)) if (s !== NONE) for (const id of ids) out.set(id, s);
  return out;
}

/**
 * その日の今の案で確定する（日の画面の「この割当で確定」と月のまとめて確定で共通）。
 * `manualPlans[date]` と各訪問の `staffId` に今の案を写す。problem はその日の問題（計算に入れる訪問を決める。
 * 訪問の集まりは条件の重みに依らないので、点数の基準の条件で作った問題でもよい）。
 * 計算に入れていない訪問の担当は、確定した割当（無ければ訪問の担当）のまま。
 * 〈利用者さん〉の休み（ADR-0013）の訪問は確定済みの担当のまま残す（`keepLeaveVisits`）。今の案が無ければそのまま返す
 */
export function confirmDay(d: DemoData, date: string, problem: Problem): DemoData {
  const plan = own(d.aiPlans, date);
  if (!plan) return d;
  const dayVisits = d.visits.filter((v) => v.date === date && !v.cancelled);
  /** 計算に入れる候補の訪問（取り消し・休みを除く。日の画面の visits と同じ） */
  const visits = dayVisits.filter((v) => !isOnLeave(d.clientLeaves, v));
  const leaveIds = dayVisits.filter((v) => isOnLeave(d.clientLeaves, v)).map((v) => v.id);
  const visitIds = new Set(visits.map((v) => v.id));
  const inProblem = new Set(problem.visits.map((v) => v.id));
  const aiOwner = ownerOf(alignRoutes(problem, plan.routes));
  const saved = own(d.manualPlans, date);
  // 今までの確定した割当（訪問の担当で補う。日の画面の savedView と同じ）
  const staffIds = [...d.staff].sort(byName).map((s) => s.id);
  const before = ownerOf(reconcile(saved ?? {}, visits, staffIds).cols);
  const next = (id: string): string | null =>
    inProblem.has(id) ? (aiOwner.get(id) ?? null) : (before.get(id) ?? null);
  const fresh: Record<string, string[]> = {};
  for (const v of visits) {
    const o = next(v.id) ?? NONE;
    fresh[o] = [...(own(fresh, o) ?? []), v.id];
  }
  const cols = keepLeaveVisits(fresh, leaveIds, saved);
  return {
    ...d,
    manualPlans: { ...d.manualPlans, [date]: cols },
    visits: d.visits.map((v) => {
      if (v.date !== date || v.cancelled || !visitIds.has(v.id)) return v;
      const o = next(v.id);
      return (v.staffId ?? null) === o ? v : { ...v, staffId: o };
    }),
  };
}

/** まとめて確定の対象と残す日（PRD D223） */
export type BulkConfirm = {
  /** 確定する日（日付の順） */
  targets: string[];
  /** そのうち確定した割当を今の案で置き換える日（未確定の変更あり） */
  redo: string[];
  /** 問題があって残す日（入らない訪問・必須の違反・休みの人に残る訪問） */
  problem: string[];
  /** 案が無くて残す日 */
  noPlan: string[];
};

/**
 * 「確定していない日」（月の右の欄。`monthProgress` の unconfirmed）のうち、今の案があり、入らない訪問・必須の違反・
 * 休み（欠勤・希望休・最終勤務日の後）の人に残る訪問が無い日を確定する。状態は月の画面の日の状態（`useDayStatuses`）から引く
 */
export function bulkConfirmTargets(
  unconfirmed: readonly string[],
  statusOf: (date: string) => DayStatus | undefined,
): BulkConfirm {
  const out: BulkConfirm = { targets: [], redo: [], problem: [], noPlan: [] };
  for (const date of unconfirmed) {
    const s = statusOf(date);
    if (!s || s.count === 0 || s.state === 'confirmed') continue;
    if (s.state === 'none') out.noPlan.push(date);
    else if (s.unassigned > 0 || s.hard > 0 || s.absentLeft > 0) out.problem.push(date);
    else {
      out.targets.push(date);
      if (s.state === 'diff') out.redo.push(date);
    }
  }
  return out;
}

/** 月の右の欄のボタンの文 */
export const bulkConfirmLabel = (n: number): string => `問題の無い日をまとめて確定（${n}日）`;

/** 押せないときの理由（見える文） */
export function bulkConfirmWhy(b: BulkConfirm): string {
  if (b.problem.length > 0)
    return '問題の無い日がありません（問題のある日は要対応で確かめてから、日の画面で確定します）';
  if (b.noPlan.length > 0) return '問題の無い日がありません（案の無い日は、先に案を作ります）';
  return '確定していない日はありません';
}

/** 「10/22（水）」 */
export const dayLabel = (date: string): string => `${mdText(date)}（${WEEKDAY_LABELS[weekday(date)]}）`;

/** 日付を並べる上限（超えたら「…」で略す） */
const LIST_MAX = 7;

/** 「10/22（水）・10/23（木）・… 計 N日」（多ければ先頭の LIST_MAX−1 日と「…」） */
export function datesText(dates: readonly string[]): string {
  const shown = dates.length > LIST_MAX ? dates.slice(0, LIST_MAX - 1) : dates;
  const more = dates.length > shown.length ? '・…' : '';
  return `${shown.map(dayLabel).join('・')}${more} 計 ${dates.length}日`;
}

/** 確認ダイアログの中身（独自の確認。ADR-0026） */
export function bulkConfirmDialog(b: BulkConfirm, staffTerm: string): { title: string; body: string } {
  const lines = [datesText(b.targets), `各訪問の担当が今の案のとおりに書き換わり、${staffTerm}の画面にも出ます。`];
  if (b.redo.length > 0) lines.push(`うち ${b.redo.length}日は、前に確定した割当を今の案で置き換えます。`);
  if (b.problem.length > 0)
    lines.push(`問題のある ${b.problem.length}日は残します（要対応で確認）：${b.problem.map(dayLabel).join('・')}`);
  if (b.noPlan.length > 0) lines.push(`案の無い ${b.noPlan.length}日も残します。`);
  return { title: `問題の無い ${b.targets.length}日を確定しますか？`, body: lines.join('\n') };
}

/** 確定のあとに移る、次の確定していない日（date より後。無ければ null。PRD D224） */
export function nextUnconfirmed(unconfirmed: readonly string[], date: string): string | null {
  return [...unconfirmed].sort().find((d) => d > date) ?? null;
}
