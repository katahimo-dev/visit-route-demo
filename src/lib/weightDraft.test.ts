import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Rule } from '../contracts/rules';
import { createDemoData, scorePresetOf, scoreRulesOf } from '../seed';
import { withSeedPlans } from '../seed/plans';
import { leaveTarget } from './leaveGuard';
import {
  applyDraft,
  changeText,
  confirmBody,
  draftChanges,
  draftStaleDays,
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
    expect(d1).toEqual({ wait: { weight: 4, hard: false } });
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
    const draft: WeightDraft = { wait: { weight: 4, hard: false }, continuity: { weight: 5, hard: false } };
    expect(pruneDraft(draft, saved)).toBe(draft);
    expect(pruneDraft(draft, savedWeights([rules[0]!]))).toEqual({ wait: { weight: 4, hard: false } });
    expect(pruneDraft(draft, savedWeights([rule('a', 'wait', 4), rule('b', 'continuity', 2)]))).toEqual({
      continuity: { weight: 5, hard: false },
    });
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
  /** 今日から2日分の案（点数の基準＝標準で作る）。2日目は確定した割当もある */
  const data = (): DemoData => {
    const d = withSeedPlans(createDemoData(TODAY), TODAY, 3);
    const days = Object.keys(d.aiPlans).sort();
    const second = days[1]!;
    return { ...d, manualPlans: { ...d.manualPlans, [second]: d.aiPlans[second] as never } };
  };

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

  it('作った重みが無くなる日を数える（未確定・確定済み）。下書きが無ければ0日', () => {
    const d = data();
    const n = Object.keys(d.aiPlans).filter((x) => x >= TODAY).length;
    expect(draftStaleDays(d, TODAY).days).toEqual([]);
    const saved = savedWeights(scoreRulesOf(d));
    const t = d.rules.find((r) => r.type === 'wait')?.type ?? d.rules[0]!.type;
    const w = saved[t]!.weight === 5 ? 4 : saved[t]!.weight + 1;
    const s = draftStaleDays(applyDraft(d, editDraft({}, saved, t, { weight: w })), TODAY);
    expect(s.days.length).toBe(n);
    expect(s.confirmed).toHaveLength(1);
    expect(s.unconfirmed).toHaveLength(n - 1);
    // 今日より前の日は数えない
    expect(draftStaleDays(applyDraft(d, editDraft({}, saved, t, { weight: w })), '2099-01-01').days).toEqual([]);
  });

  it('確認の本文：変わる条件（前→後）・基準の名前・作り方・影響する日と確定済みは作り直さない', () => {
    const rules = [rule('a', 'wait', 3, false, '待ち')];
    const ch = draftChanges(rules, { wait: { weight: 4, hard: false } });
    const body = confirmBody(ch, '標準', { days: ['x', 'y'], unconfirmed: ['x'], confirmed: ['y'] });
    expect(body).toContain('・待ち：3→4');
    expect(body).toContain('点数の基準のプリセット「標準」の重みになります');
    expect(body).toContain('月のまとめて作る・開いた日の自動作成・作り直しはこの重みで作り');
    expect(body).toContain('2日（未確定 1日・確定済み 1日）');
    expect(body).toContain('確定済みの日は作り直しません');
    expect(confirmBody(ch, '標準', { days: [], unconfirmed: [], confirmed: [] })).toContain(
      '「条件が変わった」になる日はありません',
    );
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
