// 点数の理由を一言（PRD D173。ADR-0025 追記）：今の案の点を下げているいちばん大きい理由を短い文にする純粋関数。
// 新しい採点は足さない。evaluate の減点の内訳（hundredBreakdown）・採点（score）・条件ごとの達成（achievements）から選ぶだけ
import type { HundredPart, PlanScore, RuleAchievement } from '../contracts/problem';
import type { Rule } from '../contracts/rules';

/** 理由を出さない減点の大きさ（これ未満なら「点を下げている理由」は無いとみなす。点は整数に丸めるので 0.5） */
export const REASON_MIN_POINTS = 0.5;

export type ScoreReason = {
  /** 減点の成分（hundredBreakdown の key） */
  key: HundredPart['key'];
  /** 短い文。例「移動が長め（190分）」「相性△が1件」「入らない訪問 1件」 */
  text: string;
  /** その成分の減点（1件あたり。点数と同じ物差し） */
  points: number;
};

/** 負担の均等の achievements のキー（evaluate の BALANCE_RULE_KEY と同じ値。evaluate を読み込まずに済むよう写す） */
const BALANCE_KEY = 'balance';

/**
 * 「担当の条件」の減点のうち、いちばん効いている条件を一言にする。
 * 条件ごとの外れた件数 ×（重み。無ければ1）が最大の条件。相性は △・× の件数、いつもの担当は別の人の件数
 */
function assignText(achievements: readonly RuleAchievement[], rules: readonly Rule[]): string | null {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  let best: { text: string; size: number } | null = null;
  for (const a of achievements) {
    if (a.unit !== 'visit' || a.ruleId === BALANCE_KEY) continue;
    const rule = ruleById.get(a.ruleId);
    const weight = rule ? Math.max(rule.weight, 0.5) : 1;
    let n: number;
    let text: string;
    if (a.compat) {
      n = a.compat.poor + a.compat.ng;
      const marks = a.compat.ng > 0 ? (a.compat.poor > 0 ? '△・×' : '×') : '△';
      text = `相性${marks}が${n}件`;
    } else {
      n = a.total - a.met;
      text =
        rule?.type === 'continuity'
          ? `いつもの担当でない訪問 ${n}件`
          : `「${rule?.label ?? '条件'}」に合わない訪問 ${n}件`;
    }
    if (n <= 0) continue;
    const size = n * weight;
    if (!best || size > best.size) best = { text, size };
  }
  return best?.text ?? null;
}

/**
 * 点を下げているいちばん大きい理由（PRD D173）。減点の内訳 parts（hundredBreakdown。大きい順）の先頭を、成分ごとの短い文にする：
 * - 入らない訪問 → 「入らない訪問 N件」
 * - 移動 → 「移動が長め（N分）」（N は今の案の移動の合計）
 * - 空き時間（待ち） → 「空き時間（待ち）が長め（N分）」
 * - 担当の条件 → いちばん効いている条件（「相性△が N件」「いつもの担当でない訪問 N件」「「名前」に合わない訪問 N件」。分からなければ「担当の条件に合わない訪問がある」）
 * - 負担の均等 → 「件数の偏り（目安から外れた人 N人）」
 * いちばん大きい減点が REASON_MIN_POINTS 未満（ほぼ理想）なら null。achievements・rules は担当の条件の文にだけ使う
 */
export function scoreReason(
  parts: readonly HundredPart[],
  sc: Pick<PlanScore, 'travelMinutes' | 'waitMinutes' | 'dropped'>,
  achievements: readonly RuleAchievement[] = [],
  rules: readonly Rule[] = [],
): ScoreReason | null {
  let top: HundredPart | null = null;
  for (const p of parts) if (!top || p.points > top.points) top = p;
  if (!top || !(top.points >= REASON_MIN_POINTS)) return null;
  const at = (text: string): ScoreReason => ({ key: top.key, text, points: top.points });
  switch (top.key) {
    case 'dropped':
      return at(`入らない訪問 ${sc.dropped}件`);
    case 'travel':
      return at(`移動が長め（${Math.round(sc.travelMinutes)}分）`);
    case 'wait':
      return at(`空き時間（待ち）が長め（${Math.round(sc.waitMinutes)}分）`);
    case 'assign':
      return at(assignText(achievements, rules) ?? '担当の条件に合わない訪問がある');
    case 'balance': {
      const b = achievements.find((a) => a.ruleId === BALANCE_KEY);
      const out = b ? b.total - b.met : 0;
      return at(out > 0 ? `件数の偏り（目安から外れた人 ${out}人）` : '件数の偏り');
    }
  }
}

/** 読み上げ・title 用の文：「点を下げているいちばんの理由：…」 */
export const scoreReasonLabel = (r: ScoreReason): string => `点を下げているいちばんの理由：${r.text}`;
