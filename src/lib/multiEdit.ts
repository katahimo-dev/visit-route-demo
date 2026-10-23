// 予定の複数選択の操作（PRD D330。ADR-0054）の純粋関数：選んだ訪問の担当をまとめて替える・時刻をまとめてずらす・まとめて取り消す。
// データは書き換えず、新しい DemoData と当てられなかった訪問を返す（書くのは画面の update(fn)。全体の「元に戻す」で1手戻る）。
// どれも「この回だけ」（繰り返しの回は、その回だけ変えた回になる）
import type { DemoData } from '../contracts/data';
import { hhmmToMinutes, minutesToHhmm } from '../domain/time';
import { findVisit } from '../patterns';
import { applyVisitEdit, assignOnDays, cancelVisitOp, draftOf } from './visitOps';
import { canMoveVisit } from './week';

/** 時刻（HH:mm）を minutes 分ずらす（その日の 00:00〜23:59 を出たら null） */
function addMinutesHhmm(hhmm: string, minutes: number): string | null {
  const m = hhmmToMinutes(hhmm) + minutes;
  return m < 0 || m >= 24 * 60 ? null : minutesToHhmm(m);
}

/** 当てられなかった訪問と理由 */
export type MultiFail = { visitId: string; why: string };
export type MultiResult = { data: DemoData; done: number; failed: MultiFail[] };

/** 動かせる訪問（ある・取り消していない・今日より前でない）と、そうでない訪問の理由 */
function usable(d: DemoData, ids: readonly string[], today: string) {
  const ok: { visitId: string; date: string }[] = [];
  const failed: MultiFail[] = [];
  for (const id of ids) {
    const v = findVisit(d, id);
    if (!v) failed.push({ visitId: id, why: '消された訪問' });
    else if (v.cancelled) failed.push({ visitId: id, why: '取り消した訪問' });
    else if (!canMoveVisit(v.date, today)) failed.push({ visitId: id, why: '今日より前の訪問' });
    else ok.push({ visitId: id, date: v.date });
  }
  return { ok, failed };
}

/** 選んだ訪問の担当をまとめて替える（その日の並びの最も費用の少ない位置に入れてピン。担当できない日は当てない） */
export function assignMany(d: DemoData, ids: readonly string[], staffId: string, today: string): MultiResult {
  const { ok, failed } = usable(d, ids, today);
  const r = assignOnDays(d, ok, staffId);
  const fails = [...failed, ...r.failed.map((f) => ({ visitId: f.visitId, why: f.why }))];
  return { data: r.data, done: ok.length - r.failed.length, failed: fails };
}

/** 選んだ訪問の時刻をまとめてずらす（minutes 分。時間の約束の幅はそのまま。担当はそのまま） */
export function shiftMany(d: DemoData, ids: readonly string[], minutes: number, today: string): MultiResult {
  const { ok, failed } = usable(d, ids, today);
  let data = d;
  let done = 0;
  for (const x of ok) {
    const v = findVisit(data, x.visitId);
    if (!v) continue;
    const f = draftOf(v);
    const earliest = addMinutesHhmm(f.earliestStart, minutes);
    const latest = addMinutesHhmm(f.latestStart, minutes);
    if (earliest === null || latest === null) {
      failed.push({ visitId: x.visitId, why: '日をまたぐ時刻になる' });
      continue;
    }
    const r = applyVisitEdit(
      data,
      { visitId: v.id, draft: { ...f, earliestStart: earliest, latestStart: latest }, scope: 'once' },
      today,
      { visit: '', patterns: ['', ''] },
    );
    if (!r.ok) {
      failed.push({ visitId: x.visitId, why: r.error });
      continue;
    }
    data = r.data;
    done++;
  }
  return { data, done, failed };
}

/**
 * 選んだ訪問をまとめて別の日へ移す（月のその日の回の一覧の「別の日へ」。PRD D343）。時刻・担当はそのまま、日付だけ date へ
 * （担当はその日の並びに入れ直す）。今日より前の日へは移さない。同じ日の訪問は移さない（理由）
 */
export function moveManyToDate(d: DemoData, ids: readonly string[], date: string, today: string): MultiResult {
  const { ok, failed } = usable(d, ids, today);
  if (date < today)
    return { data: d, done: 0, failed: [...failed, ...ok.map((x) => ({ visitId: x.visitId, why: '今日より前の日' }))] };
  let data = d;
  let done = 0;
  for (const x of ok) {
    const v = findVisit(data, x.visitId);
    if (!v) continue;
    if (v.date === date) {
      failed.push({ visitId: x.visitId, why: '同じ日' });
      continue;
    }
    const r = applyVisitEdit(data, { visitId: v.id, draft: { ...draftOf(v), date }, scope: 'once' }, today, {
      visit: '',
      patterns: ['', ''],
    });
    if (!r.ok) {
      failed.push({ visitId: x.visitId, why: r.error });
      continue;
    }
    data = r.data;
    done++;
  }
  return { data, done, failed };
}

/** 選んだ訪問をまとめて取り消す（当日キャンセルではない、ふつうの取り消し） */
export function cancelMany(d: DemoData, ids: readonly string[], today: string): MultiResult {
  const { ok, failed } = usable(d, ids, today);
  let data = d;
  for (const x of ok) data = cancelVisitOp(data, x.visitId, false);
  return { data, done: ok.length, failed };
}

/** 帯の文（「3件を選択」） */
export const selectionText = (n: number): string => `${n}件を選択`;

/** 結果の知らせの文（「3件の担当を替えました（1件は替えられませんでした：その日は働かない）」） */
export function multiResultText(what: string, r: Pick<MultiResult, 'done' | 'failed'>): string {
  const head = `${r.done}件の${what}`;
  if (r.failed.length === 0) return head;
  const whys = [...new Set(r.failed.map((f) => f.why))].join('・');
  return `${head}（${r.failed.length}件はできませんでした：${whys}）`;
}
