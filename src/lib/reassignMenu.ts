// 日の画面の「担当を変える ▾」（PRD D217。ADR-0030）と訪問の詳細の欄（ADR-0051）の担当の候補と項目の文。純粋関数。
// 中身は「受けられる人」と同じ候補（reassign の candidatesFor）と、matching の理由（problem.reasons）だけを使う（新しい採点は足さない）
import type { Problem, Reason } from '../contracts/problem';
import type { ReassignCandidate } from '../contracts/reassign';
import { candidatesFor } from '../reassign';
import { attempt, r0 } from './common';

/** 項目の1行の説明と、押せないときの理由（MenuItem の description・disabled） */
export type ReassignItemText = { description: string; disabled: string | false };

/** 1行に出す重みの違反の数（相性は別に出す） */
const MAX_SOFT = 2;

/** 「〇分ずらせば入る」の文（「受けられる人」（pages/absenceParts の CandidateBox）と「担当を変える ▾」で共通） */
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

/** 担当の候補の1人（「担当を変える ▾」と訪問の詳細の欄で同じ判定。ADR-0030・ADR-0051） */
export type ReassignChoice = {
  staffId: string;
  /** 移動 +N分・時間の約束 ✓✗・相性・いつもの担当など（reassignItemText） */
  description: string;
  /** 選べない理由（必須の条件に合わない） */
  disabled: string | false;
  /** 空き時間に入る */
  fits: boolean;
  /** 今の担当 */
  current: boolean;
};

/**
 * 担当の候補（「担当を変える ▾」と訪問の詳細の欄の1つの判定）：reassign の candidatesFor（routes はこの訪問を除いても除かなくてもよい）の
 * うち shown の人と今の担当を、problem.allowed で選べる人を先に、選べない人は理由（必須の条件）つきで後ろに。訪問が問題に無ければ空
 */
export function reassignChoices(
  problem: Problem,
  routes: Record<string, string[]>,
  visitId: string,
  ownerId: string | null,
  shown: (staffId: string) => boolean,
): ReassignChoice[] {
  const vi = problem.visits.findIndex((v) => v.id === visitId);
  if (vi < 0) return [];
  const list = attempt(() => candidatesFor(problem, routes, visitId)).value ?? [];
  const indexOf = (sid: string) => problem.staff.findIndex((s) => s.id === sid);
  const choices = list
    .filter((c) => c.staffId === ownerId || shown(c.staffId))
    .map((c): ReassignChoice => {
      const si = indexOf(c.staffId);
      const t = reassignItemText(c, problem.reasons[vi]?.[si] ?? [], problem.allowed[vi]?.[si] === true);
      return {
        staffId: c.staffId,
        description: t.description,
        disabled: t.disabled,
        fits: c.fits,
        current: c.staffId === ownerId,
      };
    });
  return [...choices.filter((c) => !c.disabled), ...choices.filter((c) => c.disabled)];
}

/** その日に働く人（稼働時間帯がある・今の列に訪問がある）。訪問の詳細の欄の候補の人（日の予定の列の人と同じ考え方） */
export function workingStaff(problem: Problem, routes: Record<string, string[]>): Set<string> {
  const out = new Set(problem.staff.filter((s) => s.slots.length > 0).map((s) => s.id));
  for (const [sid, ids] of Object.entries(routes)) if (ids.length > 0) out.add(sid);
  return out;
}
