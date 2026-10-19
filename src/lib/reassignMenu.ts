// 日の画面の「担当を変える ▾」（PRD D217。ADR-0030）の項目の文。純粋関数。
// 中身は「受けられる人」と同じ候補（reassign の candidatesFor）と、matching の理由（problem.reasons）だけを使う（新しい採点は足さない）
import type { Reason } from '../contracts/problem';
import type { ReassignCandidate } from '../contracts/reassign';
import { r0 } from './common';

/** 項目の1行の説明と、押せないときの理由（MenuItem の description・disabled） */
export type ReassignItemText = { description: string; disabled: string | false };

/** 1行に出す重みの違反の数（相性は別に出す） */
const MAX_SOFT = 2;

/** ずらせば入る分（「受けられる人」と同じ言い方） */
export function shiftText(m: number): string {
  return m > 0 ? `${m}分遅らせれば入る` : `${-m}分早めれば入る`;
}

/** 移動の増減（+N分・±0分） */
function travelText(n: number): string {
  const r = r0(n);
  return r > 0 ? `移動 +${r}分` : r < 0 ? `移動 −${-r}分` : '移動 ±0分';
}

/**
 * 候補の人の1行の説明：時間（空き時間に入れば「移動 +N分・時間の約束 ✓」、入らなければ「時間の約束 ✗」とずらせば入る分）・
 * 件数の上限・いまの予定の必須の違反・相性の記号・いつもの担当・重みの違反（2つまで）。
 * allowed（problem.allowed）が false の人は押せず、理由に必須で外れる理由（Infinity の理由の名前）を並べる
 */
export function reassignItemText(c: ReassignCandidate, reasons: Reason[], allowed: boolean): ReassignItemText {
  const parts: string[] = [];
  if (c.routeBroken) parts.push('いまの予定に必須の違反あり');
  else if (c.overCap) parts.push('件数の上限を超える');
  else if (c.fits) {
    if (c.addedTravel !== null) parts.push(travelText(c.addedTravel));
    parts.push('時間の約束 ✓');
  } else parts.push(c.shiftMinutes !== null ? `時間の約束 ✗（${shiftText(c.shiftMinutes)}）` : '時間の約束 ✗');
  const compat = reasons.find((r) => r.level !== undefined);
  if (compat) parts.push(compat.label);
  if (reasons.some((r) => r.label === 'いつもの担当')) parts.push('いつもの担当');
  const soft = c.violations.filter((r) => Number.isFinite(r.points) && r.level === undefined).map((r) => r.label);
  parts.push(...soft.slice(0, MAX_SOFT));
  if (allowed) return { description: parts.join('・'), disabled: false };
  const hard = [...new Set(c.violations.filter((r) => !Number.isFinite(r.points)).map((r) => r.label))];
  return {
    description: parts.join('・'),
    disabled: hard.length > 0 ? `必須の条件に合いません（${hard.join('・')}）` : '必須の条件に合いません',
  };
}

/** 今の担当の項目の説明（押しても何もしない） */
export const CURRENT_TEXT = '今の担当です';
/** 「入らなかった訪問へ」の説明（固定も外れる） */
export const NONE_TEXT = '担当なしにします（固定も外れます）';
