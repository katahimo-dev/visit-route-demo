import { describe, expect, it } from 'vitest';
import type { Rule } from '../contracts/rules';
import { createDemoData, scorePresetOf, scoreRulesOf } from '../seed';
import { leaveTarget } from './leaveGuard';
import { setBasisWeight } from './presets';
import {
  applyDraft,
  changeText,
  confirmBody,
  draftChanges,
  editDraft,
  leaveDialog,
  pruneDraft,
  savedWeights,
  type WeightDraft,
  weightText,
  withDraft,
} from './weightDraft';

const TODAY = '2026-10-21';
const rule = (id: string, type: Rule['type'], weight: number, hard = false, label = id): Rule =>
  ({ id, type, label, weight, hard }) as Rule;

describe('下書きの差分（PRD D286）', () => {
  const rules = [rule('a', 'wait', 3, false, '待ち'), rule('b', 'continuity', 2), rule('c', 'wait', 3, false, '待ち2')];
  const saved = savedWeights(rules);

  it('型ごとの保存済みの値は型の最初の条件。必須にできない型は必須にしない', () => {
    expect(saved.wait).toEqual({ weight: 3, hard: false });
    expect(savedWeights([rule('x', 'wait', 1, true)]).wait).toEqual({ weight: 1, hard: false });
    expect(savedWeights([rule('x', 'clientRequirement', 3, true)]).clientRequirement).toEqual({
      weight: 3,
      hard: true,
    });
  });

  it('直すと下書きに入り、保存済みと同じ値に戻すと外れる。条件の無い型は直さない', () => {
    const d1 = editDraft({}, saved, 'wait', { weight: 4 });
    // 触った欄だけ持つ
    expect(d1).toEqual({ wait: { weight: 4 } });
    expect(editDraft(d1, saved, 'wait', { weight: 3 })).toEqual({});
    const none: WeightDraft = {};
    expect(editDraft(none, saved, 'balance', { weight: 1 })).toBe(none);
  });

  it('表に当てると同じ型の条件はどれも下書きの値。変更は型ごとに1件で、名前は表の並び', () => {
    const draft = editDraft({}, saved, 'wait', { weight: 4 });
    expect(withDraft(rules, draft).map((r) => r.weight)).toEqual([4, 2, 4]);
    const ch = draftChanges(rules, draft);
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({
      type: 'wait',
      labels: ['待ち', '待ち2'],
      before: { weight: 3 },
      after: { weight: 4 },
    });
    expect(changeText(ch[0]!)).toBe('3→4');
  });

  it('条件を消して型が無くなった・保存済みと同じになった型は外す。変わらなければ同じオブジェクト', () => {
    const draft: WeightDraft = { wait: { weight: 4 }, continuity: { weight: 5 } };
    expect(pruneDraft(draft, saved)).toBe(draft);
    expect(pruneDraft(draft, savedWeights([rules[0]!]))).toEqual({ wait: { weight: 4 } });
    expect(pruneDraft(draft, savedWeights([rule('a', 'wait', 4), rule('b', 'continuity', 2)]))).toEqual({
      continuity: { weight: 5 },
    });
  });

  it('下書きは触った欄だけを保存済みに重ねる：別のタブで変わった必須を確定で上書きしない', () => {
    const d = createDemoData(TODAY);
    const saved0 = savedWeights(scoreRulesOf(d));
    const t = 'continuity' as const;
    const w = saved0[t]!.weight === 5 ? 4 : saved0[t]!.weight + 1;
    const draft = editDraft({}, saved0, t, { weight: w });
    // 別のタブで必須にした
    const other = setBasisWeight(d, t, { hard: !saved0[t]!.hard });
    const next = applyDraft(other, draft);
    const p = scorePresetOf(next.presets, next.scorePresetId)!;
    expect(p.weights[t]).toEqual({ weight: w, hard: !saved0[t]!.hard });
    // 表にも保存済みの必須で出す
    const shown = withDraft(scoreRulesOf(other), draft).find((r) => r.type === t)!;
    expect(shown.hard).toBe(!saved0[t]!.hard);
    expect(shown.weight).toBe(w);
  });

  it('重みの文：0 は「使わない」、重みを使わない必須は「必須」、バランスの必須は重みも', () => {
    expect(weightText('wait', { weight: 2.5, hard: false })).toBe('2.5');
    expect(weightText('wait', { weight: 0, hard: false })).toBe('0（使わない）');
    expect(weightText('clientRequirement', { weight: 3, hard: true })).toBe('必須');
    expect(weightText('balance', { weight: 3, hard: true })).toBe('3・必須');
    expect(
      changeText({ type: 'clientRequirement', before: { weight: 3, hard: false }, after: { weight: 3, hard: true } }),
    ).toBe('3→必須');
  });
});

describe('確定と影響する日（PRD D286）', () => {
  const data = () => createDemoData(TODAY);

  it('確定すると基準のプリセットのその型が下書きの値になり、試す重みも基準にそろう', () => {
    const d = data();
    const saved = savedWeights(scoreRulesOf(d));
    const t = d.rules[0]!.type;
    const w = saved[t]!.weight === 5 ? 4 : saved[t]!.weight + 1;
    const next = applyDraft(d, editDraft({}, saved, t, { weight: w }));
    expect(scorePresetOf(next.presets, next.scorePresetId)?.weights[t].weight).toBe(w);
    expect(next.rules.filter((r) => r.type === t).every((r) => r.weight === w)).toBe(true);
    expect(applyDraft(d, {})).toBe(d);
  });

  it('確認の本文：変わる条件（前→後）・基準の名前・何に使うか・今の担当は変わらない', () => {
    const rules = [rule('a', 'wait', 3, false, '待ち')];
    const ch = draftChanges(rules, { wait: { weight: 4, hard: false } });
    const body = confirmBody(ch, '標準');
    expect(body).toContain('・待ち：3→4');
    expect(body).toContain('「標準」の重みが変わります');
    expect(body).toContain('AI で組む・点数・要対応の検査に、この重みを使います');
    expect(body).toContain('今の担当は変わりません');
  });

  it('離れるときの確認は〈スタッフ〉の変更を捨てる確認と同じ形（危険の色・「編集を続ける」）', () => {
    expect(leaveDialog(2)).toMatchObject({ confirmLabel: '捨てて移る', cancelLabel: '編集を続ける', tone: 'danger' });
    expect(leaveDialog(2).body).toContain('（2件）');
  });
});

describe('離れる先（leaveTarget。PRD D286）', () => {
  it('アプリの中の別の画面なら移る先、同じ画面・外のリンクは null', () => {
    expect(leaveTarget('#/month?ym=2026-10', '/rules')).toBe('/month?ym=2026-10');
    expect(leaveTarget('#/home', '/rules')).toBe('/home');
    expect(leaveTarget('#/rules#presets', '/rules')).toBeNull();
    expect(leaveTarget('#/rules?x=1', '/rules')).toBeNull();
    expect(leaveTarget('#', '/rules')).toBeNull();
    expect(leaveTarget('https://example.com/', '/rules')).toBeNull();
    expect(leaveTarget('mailto:a@example.com', '/rules')).toBeNull();
    expect(leaveTarget(null, '/rules')).toBeNull();
  });
});
