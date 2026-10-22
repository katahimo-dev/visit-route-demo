// ドラッグの落とし先の判定（PRD D341。ADR-0056）の純粋関数：日の予定・週の時間軸・週の表・月のカレンダー・人の予定表のどこへ
// 落としても同じ決まりで「置けるか（置けなければ理由）」「入る／入らない（影の色と理由）」「確定した日（伝えた日）か」「繰り返しの回か
// （範囲は訪問の詳細の欄で選ぶ）」を返す。データは書き換えない（落としたあとに書くのは欄か、日の予定の担当の付け替え）
import type { DemoData } from '../contracts/data';
import { isOnLeave } from '../domain/leaves';
import { hhmmToMinutes, minutesToHhmm } from '../domain/time';
import { findVisit } from '../patterns';
import { own } from './common';
import { draftOf, staffChoices } from './visitOps';
import { canMoveVisit, DAY_END, DAY_START, inDayRange } from './week';

/** 落とし先：日付・開始（null は今の開始のまま）・担当（undefined は変えない）・行の〈利用者さん〉（表の行。違う人の行へは置かない） */
export type DropTarget = {
  date: string;
  start?: number | null;
  staffId?: string | null;
  clientId?: string;
};

/** 判定 */
export type DropVerdict =
  | {
      ok: true;
      /** 今と同じ日時・担当（落としても何もしない） */
      same: boolean;
      date: string;
      start: number;
      /** 担当（undefined は変えない） */
      staffId: string | null | undefined;
      /** 入らない理由（入る人がいない・担当できない人の列）。null は入る。影を赤くして理由を出す（落とすことはできる） */
      warn: string | null;
      /** 変わる日のうち確定（伝えた）した日（変えると未連絡の変更になる） */
      told: string[];
      /** 繰り返しの回（範囲は欄で選ぶ） */
      repeating: boolean;
    }
  | { ok: false; why: string };

const hm = (m: number) => minutesToHhmm(m);

/**
 * 訪問をその落とし先へ動かせるか。fit は落とし先に入れる人の数（数えない・数えられないなら null。0 なら「入らない」）、
 * staffWhy は担当を変えるときの「その人が担当できない理由」（できれば null）
 */
export function dropVerdict(
  d: Pick<DemoData, 'visits' | 'patterns' | 'clients' | 'clientLeaves' | 'snapshots'>,
  visitId: string,
  t: DropTarget,
  today: string,
  opts: { fit?: number | null; staffWhy?: string | null } = {},
): DropVerdict {
  const v = findVisit(d, visitId);
  if (!v) return { ok: false, why: 'この訪問は見つかりません' };
  if (v.cancelled) return { ok: false, why: '取り消した訪問は動かせません' };
  if (isOnLeave(d.clientLeaves, v)) return { ok: false, why: '休みのため無しの訪問は動かせません' };
  if (!canMoveVisit(v.date, today)) return { ok: false, why: '今日より前の訪問は動かせません' };
  if (!canMoveVisit(t.date, today)) return { ok: false, why: '今日より前の日へは動かせません' };
  if (t.clientId !== undefined && t.clientId !== v.clientId)
    return { ok: false, why: 'ほかの人の行へは動かせません（同じ行の別の日へ）' };
  const start = t.start ?? hhmmToMinutes(v.earliestStart);
  if (!inDayRange(start, v.durationMinutes))
    return { ok: false, why: `${hm(DAY_START)}〜${hm(DAY_END)} の中に置いてください` };
  const staffChanges = t.staffId !== undefined && t.staffId !== v.staffId;
  const same = t.date === v.date && start === hhmmToMinutes(v.earliestStart) && !staffChanges;
  const warn = same
    ? null
    : staffChanges && t.staffId !== null && opts.staffWhy
      ? opts.staffWhy
      : opts.fit === 0
        ? '入れる人がいません（落とすと要対応に出ます）'
        : null;
  const told = same ? [] : [...new Set([v.date, t.date])].filter((x) => !!own(d.snapshots, x)).sort();
  return {
    ok: true,
    same,
    date: t.date,
    start,
    staffId: staffChanges ? t.staffId : undefined,
    warn,
    told,
    repeating: !!v.pattern,
  };
}

/**
 * 影の文（「ここへ 9:15・入れる人 3人」「入らない：…」「確定した日（変えると未連絡の変更）」「繰り返しの回（範囲は欄で選ぶ）」）。
 * 置けないときは理由
 */
export function dropShadowText(v: DropVerdict, opts: { fit?: number | null; time?: boolean } = {}): string {
  if (!v.ok) return `置けません：${v.why}`;
  const parts: string[] = [];
  if (opts.time !== false) parts.push(`ここへ（${hm(v.start)}）`);
  if (v.warn) parts.push(`入らない：${v.warn}`);
  else if (opts.fit !== undefined) parts.push(opts.fit === null ? '入れる人 —' : `入れる人 ${opts.fit}人`);
  if (v.told.length > 0) parts.push('確定した日（変えると未連絡の変更）');
  if (v.repeating && !v.same) parts.push('繰り返しの回（範囲は欄で選ぶ）');
  return parts.join('・');
}

/** 影の色の種類：ng＝置けない、warn＝置けるが入らない、ok＝入る */
export const dropTone = (v: DropVerdict): 'ok' | 'warn' | 'ng' => (!v.ok ? 'ng' : v.warn ? 'warn' : 'ok');

/**
 * 担当の行・列へ落とすときの「その人が担当できない理由」（訪問の詳細の欄の候補 staffChoices と同じ。落とす先の日で計算する）。
 * 担当できれば null
 */
export function staffWhyOf(d: DemoData, visitId: string, date: string, staffId: string): string | null {
  const v = findVisit(d, visitId);
  if (!v) return null;
  const c = staffChoices(d, visitId, { ...draftOf(v), date });
  if (c.why) return c.why;
  const x = c.choices.find((y) => y.staffId === staffId);
  if (!x) return 'その日に働かない人です';
  return x.disabled || null;
}
