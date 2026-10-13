// 条件のプリセットの初期値（ADR-0005・ADR-0008）。条件の型ごとに重み・必須を決め、その日の条件（rules）の同じ型に上書きする。
// プリセットはデータ（DemoData.presets）に入り、利用者が編集できる。型 Preset は contracts/rules.ts
import type { Preset, Rule } from '../contracts/rules';
import { HARDABLE } from '../contracts/rules';

export type { Preset };

/** 必要条件は3つとも必須（重みは使わない） */
const REQUIRED = { weight: 0, hard: true };

/** 初期のプリセット3種（1つ目は初期の条件と同じ。id は変えない）。データへは initialPresets() で写して入れる */
export const INITIAL_PRESETS: readonly Preset[] = [
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

/** 初期のプリセットの写し（データに入れる。定数を書き換えられないように深く写す） */
export function initialPresets(): Preset[] {
  return INITIAL_PRESETS.map((p) => ({
    ...p,
    weights: Object.fromEntries(Object.entries(p.weights).map(([k, w]) => [k, { ...w }])) as Preset['weights'],
  }));
}

const rulesKey = (rs: Rule[]) => JSON.stringify(rs.map((r) => [r.id, r.weight, HARDABLE.has(r.type) && r.hard]));

/** 条件の重み・必須がそのプリセットとそのまま一致するか */
export function matchesPreset(rules: Rule[], preset: Preset): boolean {
  return rulesKey(applyPreset(rules, preset)) === rulesKey(rules);
}

/** 条件の重み・必須がそのまま当てはまるプリセット（同じ重みが2つあれば先の方。無ければ null） */
export function presetOf(rules: Rule[], presets: readonly Preset[]): Preset | null {
  return presets.find((p) => matchesPreset(rules, p)) ?? null;
}
