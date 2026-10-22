// 訪問の帯をキーボードで動かす（PRD D333。ADR-0055）の純粋関数：キーを操作に読み替え、訪問を動かした新しい DemoData を返す。
// ↑↓ で15分、←→ で1日、Shift+←→ で隣の担当の列、Enter で訪問の詳細の欄、Delete・Backspace で取り消し（確認は画面）。
// 繰り返しの回は既定で「この回だけ」。動かしたあとに範囲（これ以降／すべて）を選び直せるよう、同じ操作を範囲つきでもう一度当てられる。
// データは書き換えない（書くのは画面の update(fn, 手の名前)。全体の「元に戻す」で1手戻る）
import type { DemoData } from '../contracts/data';
import { addDays, hhmmToMinutes, minutesToHhmm } from '../domain/time';
import { findVisit } from '../patterns';
import { dateText } from './common';
import { applyVisitEdit, draftOf, SCOPE_LABELS, type VisitScope } from './visitOps';

/** 1回のキーで動かす時刻の幅（分） */
export const KEY_STEP_MINUTES = 15;

/** キーで行う操作 */
export type VisitKey =
  | { kind: 'time'; minutes: number }
  | { kind: 'day'; days: number }
  | { kind: 'staff'; step: 1 | -1 }
  | { kind: 'open' }
  | { kind: 'cancel' };

/** 動かす操作（担当は行き先の人に決めたもの） */
export type VisitMove =
  | { kind: 'time'; minutes: number }
  | { kind: 'day'; days: number }
  | { kind: 'staff'; staffId: string };

/**
 * キーを操作に読み替える（当たらなければ null）。Ctrl・⌘・Alt つきは読まない（ブラウザ・全体の元に戻すのキーに任せる）。
 * Shift は ←→ だけ（隣の担当）。↑↓ の Shift は読まない
 */
export function visitKeyOf(e: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): VisitKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case 'ArrowUp':
      return e.shiftKey ? null : { kind: 'time', minutes: -KEY_STEP_MINUTES };
    case 'ArrowDown':
      return e.shiftKey ? null : { kind: 'time', minutes: KEY_STEP_MINUTES };
    case 'ArrowLeft':
      return e.shiftKey ? { kind: 'staff', step: -1 } : { kind: 'day', days: -1 };
    case 'ArrowRight':
      return e.shiftKey ? { kind: 'staff', step: 1 } : { kind: 'day', days: 1 };
    case 'Enter':
      return e.shiftKey ? null : { kind: 'open' };
    case 'Delete':
    case 'Backspace':
      return e.shiftKey ? null : { kind: 'cancel' };
    default:
      return null;
  }
}

/**
 * 隣の担当（並び order の中で今の担当の次・前。端では止まる＝null）。担当なしなら → は先頭、← は null。
 * 今の担当が並びに無ければ先頭（→）か null（←）
 */
export function neighborStaff(order: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (order.length === 0) return null;
  const i = current === null ? -1 : order.indexOf(current);
  if (i < 0) return step === 1 ? order[0]! : null;
  return order[i + step] ?? null;
}

/** 手の名前（全体の「元に戻す」の title・知らせ） */
export function moveLabel(m: VisitMove, staffName: (id: string) => string): string {
  if (m.kind === 'time') return `訪問を${Math.abs(m.minutes)}分${m.minutes > 0 ? '後' : '前'}へ`;
  if (m.kind === 'day') return `訪問を${m.days > 0 ? '次' : '前'}の日へ`;
  return `担当を${staffName(m.staffId)}さんへ`;
}

/** 動かした結果 */
export type KeyMoveResult =
  | {
      ok: true;
      data: DemoData;
      visitId: string;
      date: string;
      start: string;
      staffId: string | null;
      /** 繰り返しの回か（範囲を選び直せる） */
      repeating: boolean;
    }
  | { ok: false; why: string };

/**
 * 訪問を1手動かす（scope は繰り返しの回の範囲。既定は「この回だけ」）。時刻は時間の約束の幅を保ってずらし、日付は担当のまま
 * （その日の並びに入れ直す）、担当は lib/visitOps の applyVisitEdit で選んだ人にしてピン。できなければ理由
 */
export function keyMove(
  d: DemoData,
  visitId: string,
  m: VisitMove,
  today: string,
  scope: VisitScope = 'once',
  ids: { visit: string; patterns: readonly [string, string] } = { visit: '', patterns: ['', ''] },
): KeyMoveResult {
  const v = findVisit(d, visitId);
  if (!v) return { ok: false, why: 'この訪問は見つかりません' };
  if (v.cancelled) return { ok: false, why: '取り消した訪問は動かせません' };
  const f = draftOf(v);
  let draft = f;
  let staff: string | undefined;
  if (m.kind === 'time') {
    const a = hhmmToMinutes(f.earliestStart) + m.minutes;
    const b = hhmmToMinutes(f.latestStart) + m.minutes;
    if (a < 0 || b >= 24 * 60) return { ok: false, why: '日をまたぐ時刻にはできません' };
    draft = { ...f, earliestStart: minutesToHhmm(a), latestStart: minutesToHhmm(b) };
  } else if (m.kind === 'day') {
    draft = { ...f, date: addDays(f.date, m.days) };
  } else {
    staff = m.staffId;
  }
  const r = applyVisitEdit(d, { visitId, draft, staff, scope }, today, ids);
  if (!r.ok) return { ok: false, why: r.error };
  if (r.unchanged) return { ok: false, why: '変わりませんでした' };
  if (r.failed.length > 0) return { ok: false, why: r.failed[0]!.why };
  const after = findVisit(r.data, r.visitId);
  if (!after) return { ok: false, why: '動かせませんでした' };
  return {
    ok: true,
    data: r.data,
    visitId: r.visitId,
    date: after.date,
    start: after.earliestStart,
    staffId: after.staffId,
    repeating: !!v.pattern,
  };
}

/** 動かした先の読み上げの文（「図書館 ふみさん：10/28（水） 09:15・担当 消防さん（この回だけ）」） */
export function movedText(
  r: { date: string; start: string; staffId: string | null; repeating: boolean },
  clientName: string,
  staffName: (id: string) => string,
  scope: VisitScope = 'once',
): string {
  const who = r.staffId ? `担当 ${staffName(r.staffId)}さん` : '担当なし';
  const range = r.repeating ? `（${SCOPE_LABELS[scope]}）` : '';
  return `${clientName}さん：${dateText(r.date)} ${r.start}・${who}${range}`;
}
