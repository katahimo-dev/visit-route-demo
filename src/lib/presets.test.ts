import { describe, expect, it } from 'vitest';
import { MAX_PRESETS } from '../contracts/rules';
import { createDemoData, INITIAL_PRESETS, presetOf } from '../seed';
import {
  addPresetError,
  addPresetFromRules,
  patchPreset,
  removePreset,
  resetPresets,
  weightsFromRules,
} from './presets';

const base = () => createDemoData('2026-10-12');

describe('プリセットの編集（ADR-0008）', () => {
  it('いまの重みを保存すると、その条件がそのプリセットに一致する', () => {
    const d0 = base();
    const rules = d0.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 0.5 } : r));
    const d = addPresetFromRules({ ...d0, rules }, '  待ち軽め ');
    expect(d.presets).toHaveLength(4);
    const p = d.presets[3]!;
    expect(p.name).toBe('待ち軽め');
    expect(p.weights.wait).toEqual({ weight: 0.5, hard: false });
    expect(presetOf(rules, d.presets)?.id).toBe(p.id);
    expect(weightsFromRules([]).compatibility).toEqual({ weight: 0, hard: false });
  });

  it(`足せるのは ${MAX_PRESETS}つまで。名前が空・長すぎるのも足さない`, () => {
    let d = base();
    for (let i = 0; i < 5; i++) d = addPresetFromRules(d, `案${i}`);
    expect(d.presets).toHaveLength(MAX_PRESETS);
    expect(addPresetError(d, 'もう1つ')).toContain('6つまで');
    expect(addPresetFromRules(d, 'もう1つ')).toBe(d);
    expect(addPresetError(base(), ' ')).not.toBeNull();
    expect(addPresetError(base(), 'あ'.repeat(21))).not.toBeNull();
  });

  it('消せる。最後の1つは消せない', () => {
    let d = base();
    d = removePreset(d, 'travel');
    expect(d.presets.map((p) => p.id)).toEqual(['standard', 'people']);
    d = removePreset(removePreset(d, 'standard'), 'people');
    expect(d.presets.map((p) => p.id)).toEqual(['people']);
  });

  it('名前・重みを変え、初期値に戻すと初期の3つ', () => {
    const d0 = base();
    const d = patchPreset(addPresetFromRules(d0, 'x'), 'standard', { name: '変えた' });
    expect(d.presets[0]!.name).toBe('変えた');
    const r = resetPresets(d);
    expect(r.presets).toEqual(INITIAL_PRESETS);
  });
});
