// 訪問の帯をキーボードで動かす（PRD D333。ADR-0055）の純粋関数：キーを操作に読み替え、訪問を動かした新しい DemoData を返す。
// ↑↓ で15分、←→ で1日、Shift+←→ で隣の担当の列、Enter で訪問の詳細の欄、Delete・Backspace で取り消し（確認は画面）。
// 繰り返しの回は既定で「この回だけ」。動かしたあとに範囲（これ以降／すべて）を選び直せるよう、同じ操作を範囲つきでもう一度反映できる。
// データは書き換えない（書くのは画面の update(fn, 手の名前)。全体の「元に戻す」で1手戻る）
import type { DemoData } from '../contracts/data';
import { addDays, hhmmToMinutes, minutesToHhmm } from '../domain/time';
import { findVisit, visitsOn } from '../patterns';
import { dateText } from './common';
import { dayProblemOf, routesOf, visitIssues } from './dayPlan';
import { applyVisitEdit, draftOf, SCOPE_LABELS, staffChoices, type VisitScope } from './visitOps';

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
 * 札の入れ物（PRD D342）：時間軸（時刻の位置。↑↓ で時刻）・表（マスに積む。↑↓ で隣の担当の行）・リスト（行。時間軸と同じキー）
 */
export type KeyLayout = 'timeline' | 'table' | 'list';

/**
 * キーを操作に読み替える（当たらなければ null）。Ctrl・⌘・Alt つきは読まない（ブラウザ・全体の元に戻すのキーに任せる）。
 * Shift は ←→ だけ（隣の担当）。↑↓ の Shift は読まない。表（layout が table）は ↑↓ が隣の担当（行が担当なので。時刻はそのまま）
 */
export function visitKeyOf(
  e: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  },
  layout: KeyLayout = 'timeline',
): VisitKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case 'ArrowUp':
      if (e.shiftKey) return null;
      return layout === 'table' ? { kind: 'staff', step: -1 } : { kind: 'time', minutes: -KEY_STEP_MINUTES };
    case 'ArrowDown':
      if (e.shiftKey) return null;
      return layout === 'table' ? { kind: 'staff', step: 1 } : { kind: 'time', minutes: KEY_STEP_MINUTES };
    // 表は担当が行（↑↓）なので Shift+←→ は読まない
    case 'ArrowLeft':
      if (e.shiftKey) return layout === 'table' ? null : { kind: 'staff', step: -1 };
      return { kind: 'day', days: -1 };
    case 'ArrowRight':
      if (e.shiftKey) return layout === 'table' ? null : { kind: 'staff', step: 1 };
      return { kind: 'day', days: 1 };
    case 'Enter':
      return e.shiftKey ? null : { kind: 'open' };
    case 'Delete':
    case 'Backspace':
      return e.shiftKey ? null : { kind: 'cancel' };
    default:
      return null;
  }
}

/** 月のマスのキー（PRD D340）：←→ で前・次の日、↑↓ で前・次の週、Enter でその日の回の一覧、Shift／Ctrl＋Enter でその日をまとめて選ぶ */
export type CellKey = { kind: 'go'; days: number } | { kind: 'open' } | { kind: 'select' };

/** 月のマスのキーを読み替える（当たらなければ null。Alt つき・Shift＋矢印は読まない） */
export function cellKeyOf(e: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): CellKey | null {
  if (e.altKey) return null;
  if (e.key === 'Enter') return e.shiftKey || e.ctrlKey || e.metaKey ? { kind: 'select' } : { kind: 'open' };
  if (e.shiftKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case 'ArrowLeft':
      return { kind: 'go', days: -1 };
    case 'ArrowRight':
      return { kind: 'go', days: 1 };
    case 'ArrowUp':
      return { kind: 'go', days: -7 };
    case 'ArrowDown':
      return { kind: 'go', days: 7 };
    default:
      return null;
  }
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
      /** 変わった日（確定した日が入っていれば確かめる） */
      dates: string[];
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
    dates: r.dates,
  };
}

/**
 * Shift+←→ の行き先（並び order の中で、今の担当からその向きに順に見て、その訪問を担当できる最初の人）。
 * 担当できるかは訪問の詳細の欄と同じ候補（staffChoices。その日に働く人で、必須の条件に合う人）。いなければ理由
 */
export function nextStaffFor(
  d: DemoData,
  visitId: string,
  order: readonly string[],
  step: 1 | -1,
  /** 担当の並びの向き（時間軸は列＝左右、表は行＝上下） */
  axis: 'col' | 'row' = 'col',
): { staffId: string } | { why: string } {
  const v = findVisit(d, visitId);
  const side = axis === 'row' ? (step > 0 ? '下' : '上') : step > 0 ? '右' : '左';
  const line = axis === 'row' ? '担当の行' : '担当の列';
  if (!v) return { why: 'この訪問は見つかりません' };
  const c = staffChoices(d, visitId, draftOf(v));
  const byId = new Map(c.choices.map((x) => [x.staffId, x]));
  let at = v.staffId === null ? -1 : order.indexOf(v.staffId);
  if (at < 0 && step < 0) return { why: `これより${side}に${line}はありません` };
  let skipped = 0;
  for (;;) {
    at += step;
    const sid = order[at];
    if (sid === undefined) break;
    const x = byId.get(sid);
    if (x && !x.disabled && !x.current) return { staffId: sid };
    skipped++;
  }
  return {
    why:
      skipped > 0
        ? `これより${side}に、この訪問を担当できる人がいません（その日に働かない・必須の条件に合わない）`
        : `これより${side}に${line}はありません`,
  };
}

/** 動かした先の要対応（日の予定と同じ訪問ごとの検査。担当が休みの日へ移したときなど）。無ければ空 */
export function issuesAt(d: DemoData, visitId: string, date: string): string[] {
  const visits = visitsOn(d, date);
  if (!visits.some((x) => x.id === visitId)) return [];
  const p = dayProblemOf(d, date);
  if (!p) return [];
  return (visitIssues(p, routesOf(p, visits), visits).get(visitId) ?? []).map((x) => x.label);
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
