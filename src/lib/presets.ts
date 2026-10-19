// 条件のプリセットの編集（ADR-0008）。データを書き換えるのは store の update(fn) を通した画面だけ。ここは新しい DemoData を返す純粋関数
import type { DemoData } from '../contracts/data';
import { HARDABLE, MAX_PRESETS, type Preset, RULE_TYPES, type Rule } from '../contracts/rules';
import { initialPresets, scoreRulesOf } from '../seed';
import { newId } from './common';

/**
 * AI案を作る条件（ADR-0028。PRD D214）：「条件の重みとプリセット」（rules）が切なら、いまの条件に点数の基準のプリセットの重みを
 * 当てたもの（月まとめ作成と同じ。切ると基準のプリセットだけで作る）。入ならいまの条件そのもの
 */
export function planRulesOf(d: Pick<DemoData, 'rules' | 'presets' | 'scorePresetId'>, rulesOn: boolean): Rule[] {
  return rulesOn ? d.rules : scoreRulesOf(d);
}

/** プリセットの名前の上限（contracts の presetSchema と同じ） */
export const PRESET_NAME_MAX = 20;
export const PRESET_NOTE_MAX = 60;

/**
 * いまの条件の重み・必須からプリセットの重みを作る。型ごとに最初の条件の重み・必須を写す
 * （同じ型の条件が2つ以上あっても、プリセットは型ごとの重みなので最初の1つだけ）。その型の条件が無ければ 重み0
 */
export function weightsFromRules(rules: Rule[]): Preset['weights'] {
  return Object.fromEntries(
    RULE_TYPES.map((t) => {
      const r = rules.find((x) => x.type === t);
      return [t, r ? { weight: r.weight, hard: HARDABLE.has(t) && r.hard } : { weight: 0, hard: false }];
    }),
  ) as Preset['weights'];
}

/** 足せない理由（足せるなら null） */
export function addPresetError(d: DemoData, name: string): string | null {
  const n = name.trim();
  if (n === '') return '名前を入れてください';
  if (n.length > PRESET_NAME_MAX) return `名前は${PRESET_NAME_MAX}文字までです`;
  if (d.presets.length >= MAX_PRESETS) return `プリセットは${MAX_PRESETS}つまでです。使わないものを消してください`;
  return null;
}

/** いまの条件の重みを、新しいプリセットとして最後に足す（足せなければそのまま返す） */
export function addPresetFromRules(d: DemoData, name: string, note = ''): DemoData {
  if (addPresetError(d, name)) return d;
  const used = new Set(d.presets.map((p) => p.id));
  let id = newId('p');
  while (used.has(id)) id = newId('p');
  const preset: Preset = {
    id,
    name: name.trim(),
    note: note.trim().slice(0, PRESET_NOTE_MAX),
    weights: weightsFromRules(d.rules),
  };
  return { ...d, presets: [...d.presets, preset] };
}

/**
 * プリセットを消す（最後の1つは消さない）。点数の基準のプリセットを消したら、基準は残りの先頭に移る（ADR-0010）
 */
export function removePreset(d: DemoData, id: string): DemoData {
  if (d.presets.length <= 1) return d;
  const presets = d.presets.filter((p) => p.id !== id);
  const scorePresetId = presets.some((p) => p.id === d.scorePresetId) ? d.scorePresetId : presets[0]?.id;
  return { ...d, presets, scorePresetId };
}

/** 点数の基準のプリセットを変える（ADR-0010。無い id なら変えない） */
export function setScorePreset(d: DemoData, id: string): DemoData {
  if (!d.presets.some((p) => p.id === id) || d.scorePresetId === id) return d;
  return { ...d, scorePresetId: id };
}

/** プリセットの名前・一言・重みを変える */
export function patchPreset(d: DemoData, id: string, patch: Partial<Omit<Preset, 'id'>>): DemoData {
  return { ...d, presets: d.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

/** 初期の3種に戻す（点数の基準も先頭の「標準」に戻す） */
export function resetPresets(d: DemoData): DemoData {
  const presets = initialPresets();
  return { ...d, presets, scorePresetId: presets[0]?.id };
}
