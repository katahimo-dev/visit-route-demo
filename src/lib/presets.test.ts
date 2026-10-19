import { describe, expect, it } from 'vitest';
import { MAX_PRESETS } from '../contracts/rules';
import { naivePlan, normalize, score, toHundred } from '../evaluate';
import { compile } from '../matching';
import { applyPreset, createDemoData, INITIAL_PRESETS, presetOf, scorePresetOf, scoreRulesOf } from '../seed';
import {
  addPresetError,
  addPresetFromRules,
  patchPreset,
  planRulesOf,
  removePreset,
  resetPresets,
  setScorePreset,
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

describe('点数の基準（ADR-0010）', () => {
  it('基準のプリセットを消すと、基準は残りの先頭に移る。ほかを消しても変わらない', () => {
    const d = { ...base(), scorePresetId: 'travel' };
    expect(removePreset(d, 'people').scorePresetId).toBe('travel');
    expect(removePreset(d, 'travel').scorePresetId).toBe('standard');
    expect(removePreset({ ...d, scorePresetId: 'standard' }, 'standard').scorePresetId).toBe('travel');
  });

  it('基準を選べる（無い id は変えない）。初期値に戻すと「標準」', () => {
    const d = base();
    expect(setScorePreset(d, 'people').scorePresetId).toBe('people');
    expect(setScorePreset(d, 'nothing')).toBe(d);
    expect(resetPresets({ ...d, scorePresetId: 'people' }).scorePresetId).toBe('standard');
  });

  it('点数の物差しは、プリセットのカードで条件の重みを変えても変わらない。基準を替えると変わる', () => {
    const d = base();
    const date = d.visits[0]!.date;
    const ruler = (x: typeof d) => {
      const p = compile({ ...x, rules: scoreRulesOf(x) }, date);
      const routes = naivePlan(p);
      return {
        scale: normalize(p),
        total: score(p, routes).total,
        hundred: toHundred(score(p, routes).total, normalize(p)),
      };
    };
    const before = ruler(d);
    for (const pr of INITIAL_PRESETS) {
      // プリセットのカード＝その日の条件をプリセットの重みにする
      expect(ruler({ ...d, rules: applyPreset(d.rules, pr) })).toEqual(before);
    }
    // 基準を「人の組み合わせ重視」にすると物差しが変わる
    expect(ruler({ ...d, scorePresetId: 'people' }).scale).not.toEqual(before.scale);
    // 基準と同じ重みの条件なら、いまの条件そのもの
    expect(scoreRulesOf(d)).toEqual(d.rules);
    expect(scorePresetOf(d.presets, 'nothing')?.id).toBe('standard');
    expect(scoreRulesOf({ rules: d.rules, presets: [] })).toBe(d.rules);
  });
});

describe('AI案を作る条件（planRulesOf。ADR-0028。PRD D214）', () => {
  it('条件の重みとプリセットが入ならいまの条件、切なら点数の基準のプリセットの重みを当てたもの（月まとめ作成と同じ）', () => {
    const d0 = base();
    // いまの条件をプリセットと違う重みにする
    const d = { ...d0, rules: d0.rules.map((r, i) => (i === 0 ? { ...r, weight: r.weight + 7 } : r)) };
    expect(planRulesOf(d, true)).toBe(d.rules);
    const off = planRulesOf(d, false);
    expect(off).toEqual(scoreRulesOf(d));
    expect(off).not.toEqual(d.rules);
    expect(presetOf(off, d.presets)?.id).toBe(scorePresetOf(d.presets, d.scorePresetId)!.id);
    // 基準を切り替えると、その基準のプリセットで作る
    const other = d.presets.find((p) => p.id !== scorePresetOf(d.presets, d.scorePresetId)!.id)!;
    const d2 = setScorePreset(d, other.id);
    expect(planRulesOf(d2, false)).toEqual(applyPreset(d.rules, other));
  });
});
