import { describe, expect, it } from 'vitest';
import { applyPreset, createDemoData } from '../seed';
import {
  anotherPlanOptions,
  batchDescription,
  compareText,
  createText,
  hasUnpinnedEdits,
  type PlanMenuInput,
  presetDescription,
  resolveText,
  revertText,
} from './planMenu';

const base: PlanMenuInput = {
  hasPlan: true,
  edited: false,
  pinCount: 0,
  unpinned: false,
  busy: false,
  running: false,
  ruleName: '標準',
  runCount: 1,
};

describe('createText（AI にもう一度作らせる）', () => {
  it('案が無ければ「AI に案を作らせる」', () => {
    expect(createText({ ...base, hasPlan: false })).toMatchObject({ label: 'AI に案を作らせる', disabled: false });
  });
  it('手直しがあるときだけ「手直しと固定は消えます」を添える', () => {
    expect(createText(base).description).not.toContain('消えます');
    expect(createText({ ...base, edited: true }).description).toContain('手直しと固定は消えます');
    expect(createText(base).description).toContain('標準');
  });
  it('計算中などは押せない理由をそのまま出す', () => {
    expect(createText({ ...base, busy: '計算中は選べません' }).disabled).toBe('計算中は選べません');
  });
});

describe('resolveText（固定した訪問は残して、ほかを作り直す）', () => {
  it('固定が無くても押せて、戻す先を残すと書く', () => {
    const t = resolveText(base);
    expect(t.label).toBe('固定した訪問は残して、ほかを作り直す');
    expect(t.disabled).toBe(false);
    expect(t.description).toContain('固定がありません');
    expect(t.description).toContain('戻す先');
  });
  it('案が無ければ押せない', () => {
    expect(resolveText({ ...base, hasPlan: false, pinCount: 2 }).disabled).toBe('AI の案がまだありません');
  });
  it('固定があれば件数を説明に出す', () => {
    const t = resolveText({ ...base, pinCount: 2, edited: true });
    expect(t.disabled).toBe(false);
    expect(t.description).toContain('固定した 2件');
    expect(t.description).not.toContain('消えます');
  });
  it('固定していない手直しがあれば「消えます」と書く', () => {
    expect(resolveText({ ...base, unpinned: true, edited: true }).description).toContain(
      '固定していない手直しは消えます',
    );
  });
  it('計算中は押せない', () => {
    expect(resolveText({ ...base, pinCount: 1, busy: '計算中は選べません' }).disabled).toBe('計算中は選べません');
  });
});

describe('hasUnpinnedEdits（固定していない手直し）', () => {
  const gen = { s1: ['a', 'b'], s2: ['c'] };
  it('AI が出したままなら無い', () => {
    expect(hasUnpinnedEdits(gen, gen, {})).toBe(false);
  });
  it('動かして固定した訪問だけなら無い（順番の違いも手直しとしない）', () => {
    expect(hasUnpinnedEdits(gen, { s1: ['b'], s2: ['a', 'c'] }, { a: 's2' })).toBe(false);
    expect(hasUnpinnedEdits(gen, { s1: ['b', 'a'], s2: ['c'] }, {})).toBe(false);
  });
  it('「入らなかった訪問」へ移した（unassign）ならある', () => {
    expect(hasUnpinnedEdits(gen, { s1: ['b'], s2: ['c'] }, {})).toBe(true);
    expect(hasUnpinnedEdits(gen, { s1: ['b'], s2: ['c'], __none: ['a'] }, {})).toBe(true);
  });
  it('動かしてから固定を外した（unpin）ならある', () => {
    expect(hasUnpinnedEdits(gen, { s1: ['b'], s2: ['a', 'c'] }, {})).toBe(true);
  });
  it('固定の担当が今の担当と違えばある', () => {
    expect(hasUnpinnedEdits(gen, { s1: ['b'], s2: ['a', 'c'] }, { a: 's1' })).toBe(true);
  });
  it('AI で入らなかった訪問を手で入れて固定したなら無い', () => {
    expect(hasUnpinnedEdits({ s1: ['a'] }, { s1: ['a', 'x'] }, { x: 's1' })).toBe(false);
  });
});

describe('revertText（AI が出したままに戻す）', () => {
  it('手直し・固定が無ければ押せない', () => {
    expect(revertText(base).disabled).toContain('手直し・固定はありません');
  });
  it('手直しがあれば押せる。計算中は押せない', () => {
    expect(revertText({ ...base, edited: true }).disabled).toBe(false);
    expect(revertText({ ...base, edited: true, running: true }).disabled).toBe('計算中は選べません');
  });
  it('案が無ければ押せない', () => {
    expect(revertText({ ...base, hasPlan: false }).disabled).toBe('AI の案がまだありません');
  });
});

describe('compareText（2つの案を比べる）', () => {
  it('案が1つでも押せて、比較の画面でもう1案作れると書く', () => {
    const t = compareText(base);
    expect(t.disabled).toBe(false);
    expect(t.description).toContain('もう1案');
  });
  it('2件以上なら件数を出す', () => {
    expect(compareText({ ...base, runCount: 3 }).description).toContain('3件');
  });
});

describe('presetDescription', () => {
  const x = { isCurrent: false, making: false, hasRun: false, remake: false, edited: false };
  it('今の案・作っている・まだ無い・作り直す・作ってある', () => {
    expect(presetDescription({ ...x, isCurrent: true })).toBe('今の案です');
    expect(presetDescription({ ...x, making: true })).toContain('作っています');
    expect(presetDescription(x)).toBe('この考え方で作って切り替えます');
    expect(presetDescription({ ...x, hasRun: true, remake: true })).toContain('作り直して');
    expect(presetDescription({ ...x, hasRun: true })).toContain('計算しません');
  });
  it('手直しがあれば消えることを添える（今の案のときは添えない）', () => {
    expect(presetDescription({ ...x, hasRun: true, edited: true })).toContain('手直しと固定は消えます');
    expect(presetDescription({ ...x, isCurrent: true, edited: true })).toBe('今の案です');
  });
});

describe('anotherPlanOptions（もう1案作って比べる。D159）', () => {
  const d = createDemoData('2026-10-12');
  const [standard, travel, people] = d.presets;
  it('今ある案と同じ条件のプリセットは出さない（同じ案になる）', () => {
    const r = anotherPlanOptions(d.presets, applyPreset(d.rules, standard!), applyPreset(d.rules, standard!));
    expect(r.map((o) => o.key)).toEqual([`preset-${travel!.id}`, `preset-${people!.id}`]);
    expect(r[0]).toMatchObject({ kind: 'preset', label: '移動を短くで作る' });
  });
  it('AI が出したままでない案（base が null）なら、どのプリセットも出す', () => {
    expect(anotherPlanOptions(d.presets, null, d.rules)).toHaveLength(d.presets.length);
  });
  it('今の条件がどのプリセットとも違い、今ある案とも違えば「今の条件（重み）で作る」を最後に足す', () => {
    const custom = d.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 0.5 } : r));
    const r = anotherPlanOptions(d.presets, applyPreset(d.rules, standard!), custom);
    expect(r.at(-1)).toMatchObject({ kind: 'rules', key: 'rules' });
    // 今ある案がその条件なら足さない
    const same = anotherPlanOptions(d.presets, custom, custom);
    expect(same.some((o) => o.kind === 'rules')).toBe(false);
    expect(same).toHaveLength(d.presets.length);
  });
  it('プリセットが1つで今ある案と同じ条件なら空（作れない）', () => {
    expect(anotherPlanOptions([standard!], applyPreset(d.rules, standard!), applyPreset(d.rules, standard!))).toEqual(
      [],
    );
  });
});

describe('batchDescription', () => {
  it('今の案があれば変えない・無ければ一番点の高い案を今の案にする', () => {
    expect(batchDescription(true)).toContain('今の案は変えずに');
    expect(batchDescription(false)).toContain('一番点の高い案を今の案にします');
  });
});
