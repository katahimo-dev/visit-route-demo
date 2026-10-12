// 条件のプリセット（ADR-0005）。条件の型ごとに重み・必須を決め、その日の条件（rules）の同じ型に上書きする
import type { Rule, RuleType } from '../contracts/rules';
import { HARDABLE } from '../contracts/rules';

export type Preset = {
  id: string;
  name: string;
  /** 画面に出す一言 */
  note: string;
  weights: Record<RuleType, { weight: number; hard: boolean }>;
};

/** 必要条件は3つとも必須（重みは使わない） */
const REQUIRED = { weight: 0, hard: true };

/** 1つ目が既定（初期の条件と同じ。AI案の自動作成に使う） */
export const PRESETS: readonly Preset[] = [
  {
    id: 'standard',
    name: '標準',
    note: '初期の重み。移動・相性・希望・負担をほどよく',
    weights: {
      clientRequirement: REQUIRED,
      clientPreference: { weight: 3, hard: false },
      staffRequirement: REQUIRED,
      staffPreference: { weight: 2, hard: false },
      compatibility: { weight: 3, hard: false },
      continuity: { weight: 2, hard: false },
      balance: { weight: 3, hard: false },
      wait: { weight: 3, hard: false },
    },
  },
  {
    id: 'travel',
    name: '移動を短く',
    note: '移動と待ちを優先。相性・希望・いつもの担当は軽く',
    weights: {
      clientRequirement: REQUIRED,
      clientPreference: { weight: 1, hard: false },
      staffRequirement: REQUIRED,
      staffPreference: { weight: 1, hard: false },
      compatibility: { weight: 1, hard: false },
      continuity: { weight: 0.5, hard: false },
      balance: { weight: 1, hard: false },
      wait: { weight: 3, hard: false },
    },
  },
  {
    id: 'people',
    name: '人の組み合わせ重視',
    note: '相性・希望・いつもの担当を重く。移動が延びても組み合わせを優先',
    weights: {
      clientRequirement: REQUIRED,
      clientPreference: { weight: 5, hard: false },
      staffRequirement: REQUIRED,
      staffPreference: { weight: 4, hard: false },
      compatibility: { weight: 5, hard: false },
      continuity: { weight: 4, hard: false },
      balance: { weight: 3, hard: false },
      wait: { weight: 2, hard: false },
    },
  },
];

/** 条件にプリセットの重み・必須を当てる（名前・ID・並びは変えない。必須にできない型は必須にしない） */
export function applyPreset(rules: Rule[], preset: Preset): Rule[] {
  return rules.map((r) => {
    const w = preset.weights[r.type];
    return { ...r, weight: w.weight, hard: HARDABLE.has(r.type) && w.hard };
  });
}

/** 条件の重み・必須がそのまま当てはまるプリセット（無ければ null） */
export function presetOf(rules: Rule[]): Preset | null {
  const key = (rs: Rule[]) => JSON.stringify(rs.map((r) => [r.id, r.weight, HARDABLE.has(r.type) && r.hard]));
  return PRESETS.find((p) => key(applyPreset(rules, p)) === key(rules)) ?? null;
}
