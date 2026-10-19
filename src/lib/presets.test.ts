import { describe, expect, it } from 'vitest';
import { MAX_PRESETS } from '../contracts/rules';
import { naivePlan, normalize, score, toHundred } from '../evaluate';
import { compile } from '../matching';
import { applyPreset, createDemoData, INITIAL_PRESETS, presetOf, scorePresetOf, scoreRulesOf } from '../seed';
import { withSeedPlans } from '../seed/plans';
import { batchTargets, currentRuleKeys, planRunOf, rulesStale } from './month';
import {
  addPresetError,
  addPresetFromRules,
  patchPreset,
  planRulesOf,
  removePreset,
  resetPresets,
  setBasisWeight,
  setScorePreset,
  weightsFromRules,
  withBasisRules,
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

describe('条件の重みの画面＝点数の基準の重みを直す画面（ADR-0035。PRD D233〜D235）', () => {
  const waitOf = (rules: { type: string; weight: number }[]) => rules.find((r) => r.type === 'wait')!.weight;

  it('型の重みを直すと、基準のプリセットと試す重み（data.rules）の両方が変わる。基準でないプリセットは変えない', () => {
    const d0 = base();
    const d = setBasisWeight(d0, 'wait', { weight: 1 });
    expect(d.presets.find((p) => p.id === 'standard')!.weights.wait).toEqual({ weight: 1, hard: false });
    expect(d.presets.find((p) => p.id === 'travel')).toEqual(d0.presets.find((p) => p.id === 'travel'));
    expect(waitOf(d.rules)).toBe(1);
    // 同じ型の条件はどれも同じ重み。名前・ID・並びはそのまま
    expect(d.rules.map((r) => [r.id, r.label])).toEqual(d0.rules.map((r) => [r.id, r.label]));
    // 必須も同じく基準のプリセットへ
    const h = setBasisWeight(d0, 'clientPreference', { hard: true });
    expect(h.presets[0]!.weights.clientPreference.hard).toBe(true);
    expect(h.rules.find((r) => r.type === 'clientPreference')!.hard).toBe(true);
  });

  it('直した重みが、月のまとめて作る・作り直し（scoreRulesOf）と日の「AI にもう一度作らせる」の既定（planRulesOf）に効く', () => {
    const d = setBasisWeight(base(), 'wait', { weight: 1 });
    expect(waitOf(scoreRulesOf(d))).toBe(1);
    expect(waitOf(planRulesOf(d, true))).toBe(1);
    expect(waitOf(planRulesOf(d, false))).toBe(1);
  });

  it('基準を直すと、試していた重み（どのプリセットとも違う）も基準に戻る', () => {
    const d0 = base();
    const trial = { ...d0, rules: d0.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 4.5 } : r)) };
    expect(presetOf(trial.rules, trial.presets)).toBeNull();
    const d = setBasisWeight(trial, 'balance', { weight: 1 });
    expect(waitOf(d.rules)).toBe(3);
    expect(presetOf(d.rules, d.presets)?.id).toBe('standard');
    // 基準でないプリセットを直しても試す重みは変えない
    expect(patchPreset(trial, 'travel', { weights: { ...trial.presets[1]!.weights } }).rules).toBe(trial.rules);
    // 名前・一言だけなら基準でも試す重みは変えない
    expect(patchPreset(trial, 'standard', { name: '標準2' }).rules).toBe(trial.rules);
  });

  it('基準を替える・基準を消す・初期値に戻すと、試す重みも新しい基準にそろう', () => {
    const d0 = base();
    const switched = setScorePreset(d0, 'travel');
    expect(switched.rules).toEqual(applyPreset(d0.rules, INITIAL_PRESETS[1]!));
    const removed = removePreset(switched, 'travel');
    expect(removed.scorePresetId).toBe('standard');
    expect(removed.rules).toEqual(applyPreset(d0.rules, INITIAL_PRESETS[0]!));
    // 基準でないプリセットを消しても試す重みは変えない
    const trial = { ...d0, rules: d0.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 4.5 } : r)) };
    expect(removePreset(trial, 'people').rules).toBe(trial.rules);
    expect(resetPresets(trial).rules).toEqual(d0.rules);
    // そろっていれば同じものを返す
    expect(withBasisRules(d0)).toBe(d0);
  });

  it('「基準の重みを写して保存」は基準のプリセットの重みを写す（試す重みではない）', () => {
    const d0 = base();
    const trial = { ...d0, rules: d0.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 4.5 } : r)) };
    const fromBasis = addPresetFromRules(trial, '写し', '', 'basis');
    expect(fromBasis.presets.at(-1)!.weights).toEqual(d0.presets[0]!.weights);
    const fromTrial = addPresetFromRules(trial, '試し');
    expect(fromTrial.presets.at(-1)!.weights.wait.weight).toBe(4.5);
  });

  it('自動作成（初期データの案）は直した基準の重みで作り、作った日は月の「条件が変わった日だけ作り直す」の対象になる', () => {
    const d0 = base();
    const date = d0.visits[0]!.date;
    const before = withSeedPlans(d0, date, 1);
    expect(waitOf(planRunOf(before, date)!.rules)).toBe(3);
    // 重みを直したあとに作れば、その重みで作る
    const edited = setBasisWeight(d0, 'wait', { weight: 1 });
    const made = withSeedPlans(edited, date, 1);
    expect(waitOf(planRunOf(made, date)!.rules)).toBe(1);
    expect(planRunOf(made, date)!.presetId).toBe('standard');
    // 古い重みで作った案は、重みを直すと「条件が変わった」になり、月の作り直しの対象になる
    const after = setBasisWeight(before, 'wait', { weight: 1 });
    const keys = currentRuleKeys(after.rules, after.presets);
    expect(rulesStale(after, date, keys)).toBe(true);
    expect(batchTargets(after, date.slice(0, 7), date, 'stale', (x) => rulesStale(after, x, keys))).toContain(date);
  });
});
