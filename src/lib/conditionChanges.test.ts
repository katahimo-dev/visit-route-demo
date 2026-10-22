import { describe, expect, it } from 'vitest';
import type { AiRun, DemoData } from '../contracts/data';
import { createDemoData, scorePresetOf } from '../seed';
import {
  applyRevert,
  baseAtText,
  changeLine,
  changesToggleText,
  conditionChanges,
  madeWeightsChange,
  revertAll,
  revertBody,
  revertById,
} from './conditionChanges';
import { setBasisWeight } from './presets';

const TODAY = '2026-10-21';
const base = () => createDemoData(TODAY);
const basisOf = (d: DemoData) => scorePresetOf(d.presets, d.scorePresetId)!;
const lines = (b: DemoData, n: DemoData) => conditionChanges(b, n).map(changeLine);

describe('conditionChanges（PRD D290）', () => {
  it('同じなら空', () => {
    const d = base();
    expect(conditionChanges(d, d)).toEqual([]);
    expect(conditionChanges(d, structuredClone(d))).toEqual([]);
  });

  it('条件の重み（基準のプリセット）：型ごとに 前→今。試す重みが基準にそろっていれば試す重みは出さない。戻すと基準も試す重みも戻る', () => {
    const d = base();
    const n = setBasisWeight(d, 'wait', { weight: 1 });
    const cs = conditionChanges(d, n);
    expect(cs.map((c) => c.kind)).toEqual(['weights']);
    expect(changeLine(cs[0]!)).toBe('条件の重み：空き時間（待ち） 3→1');
    const back = applyRevert(n, cs[0]!);
    expect(basisOf(back).weights.wait.weight).toBe(3);
    expect(back.rules.find((r) => r.type === 'wait')?.weight).toBe(3);
    expect(conditionChanges(d, back)).toEqual([]);
  });

  it('必須の入り切りも書く', () => {
    const d = base();
    const n = setBasisWeight(d, 'continuity', { hard: true });
    expect(lines(d, n)).toEqual(['条件の重み：いつもの担当 必須でない→必須']);
  });

  it('この日だけ試す重みが基準と違えば「この日だけ試す重み」', () => {
    const d = base();
    const n = { ...d, rules: d.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 5 } : r)) };
    const cs = conditionChanges(d, n);
    expect(cs.map((c) => c.kind)).toEqual(['trial']);
    expect(cs[0]!.text).toMatch(/→5/);
    expect(conditionChanges(d, applyRevert(n, cs[0]!))).toEqual([]);
  });

  it('点数の基準の切り替え・プリセットの追加と消去', () => {
    const d = base();
    const other = d.presets[1]!;
    const n1 = { ...d, scorePresetId: other.id };
    expect(lines(d, n1)).toContain(`点数の基準：「標準」→「${other.name}」`);
    const added = { ...d, presets: [...d.presets, { ...other, id: 'p-x', name: '足した' }] };
    const c2 = conditionChanges(d, added);
    expect(c2.map(changeLine)).toEqual(['プリセット：「足した」を追加']);
    // 足した・消したものは一覧に出すが戻さない（PRD D291）
    expect(c2[0]!.revert).toBeNull();
    expect(applyRevert(added, c2[0]!)).toBe(added);
    const removed = { ...d, presets: d.presets.filter((p) => p.id !== other.id) };
    const c3 = conditionChanges(d, removed);
    expect(c3.map(changeLine)).toEqual([`プリセット：「${other.name}」を消した`]);
    expect(c3[0]!.revert).toBeNull();
  });

  it('機能の入り切り：「相性を切」。戻すと入り切りだけ戻る', () => {
    const d = base();
    const n = { ...d, org: { ...d.org, features: { compat: false }, spanLimitHours: 9 } };
    const cs = conditionChanges(d, n);
    expect(cs.map(changeLine)).toEqual(['機能：相性を切', '事業所の設定：拘束の上限 10→9時間']);
    const back = applyRevert(n, cs[0]!);
    expect(back.org.features).toEqual({});
    expect(back.org.spanLimitHours).toBe(9);
  });

  it('相性：組の数と先頭の組（〈利用者さん〉と〈スタッフ〉の名前）。戻すと相性の表が戻る', () => {
    const d = base();
    const c = d.clients[0]!;
    const s = d.staff[0]!;
    const was = d.compat[c.id]?.[s.id] ?? 0;
    const to = was === -2 ? 2 : -2;
    const n = { ...d, compat: { ...d.compat, [c.id]: { ...(d.compat[c.id] ?? {}), [s.id]: to } } } as DemoData;
    const cs = conditionChanges(d, n);
    expect(cs).toHaveLength(1);
    expect(cs[0]!.kind).toBe('compat');
    expect(cs[0]!.text).toContain(`1組（${c.displayName}さんと${s.name}さん`);
    expect(conditionChanges(d, applyRevert(n, cs[0]!))).toEqual([]);
  });

  it('〈スタッフ〉：人ごとに変わった所（勤務時間）・足した人・消した人。呼び方は org.terms', () => {
    const d = base();
    const s = d.staff[0]!;
    const n: DemoData = {
      ...d,
      org: { ...d.org, terms: { ...d.org.terms, staff: 'ヘルパー' } },
      staff: [{ ...s, shiftEnd: '15:00' }, ...d.staff.slice(1)],
    };
    const cs = conditionChanges(d, n).filter((c) => c.kind === 'staff');
    expect(cs.map(changeLine)).toEqual([`ヘルパー：${s.name}さんの勤務時間`]);
    const back = applyRevert(n, cs[0]!);
    expect(back.staff[0]).toEqual(s);
    const added: DemoData = { ...d, staff: [...d.staff, { ...s, id: 's-new', name: '新人' }] };
    const ca = conditionChanges(d, added);
    expect(ca.map(changeLine)).toEqual([`${d.org.terms.staff}：新人さんを追加`]);
    expect(ca[0]!.revert).toBeNull();
    expect(applyRevert(added, ca[0]!)).toBe(added);
    const removed: DemoData = { ...d, staff: d.staff.slice(1) };
    const cr = conditionChanges(d, removed);
    expect(cr.map(changeLine)).toEqual([`${d.org.terms.staff}：${s.name}さんを消した`]);
    expect(cr[0]!.revert).toBeNull();
  });

  it('人の属性を戻すと、消えた項目・選択肢を指す特性の値は残さない。いない人を指すいつもの担当は repair で空', () => {
    const d = base();
    const multi = { id: 'i-m', name: '資格', target: 'staff' as const, kind: 'multi' as const, options: ['A', 'B'] };
    const gone = { id: 'i-g', name: '消す', target: 'staff' as const, kind: 'flag' as const, options: [] };
    const d0: DemoData = { ...d, items: [...d.items, multi, gone] };
    const s = d0.staff[0]!;
    const before: DemoData = {
      ...d0,
      staff: [{ ...s, traits: { ...s.traits, 'i-m': ['A', 'B'], 'i-g': true } }, ...d0.staff.slice(1)],
    };
    // 今：特性の値を直し、項目「消す」を消し、資格の選択肢 B を消した
    const now: DemoData = {
      ...before,
      items: [...d.items, { ...multi, options: ['A'] }],
      staff: [{ ...s, traits: { ...s.traits, 'i-m': [] }, shiftEnd: '15:00' }, ...d0.staff.slice(1)],
    };
    const c = conditionChanges(before, now).find((x) => x.kind === 'staff')!;
    const back = applyRevert(now, c);
    expect(back.staff[0]!.shiftEnd).toBe(s.shiftEnd);
    expect(back.staff[0]!.traits['i-m']).toEqual(['A']);
    expect('i-g' in back.staff[0]!.traits).toBe(false);
    // いつもの担当：控えの担当がもういなければ空
    const cl = d.clients[0]!;
    const gone2 = d.staff[1]!;
    const b2: DemoData = { ...d, clients: [{ ...cl, usualStaffId: gone2.id }, ...d.clients.slice(1)] };
    const n2: DemoData = {
      ...b2,
      staff: d.staff.filter((x) => x.id !== gone2.id),
      clients: [{ ...cl, usualStaffId: null, note: 'x' }, ...d.clients.slice(1)],
    };
    const c2 = conditionChanges(b2, n2).find((x) => x.kind === 'client')!;
    const back2 = applyRevert(n2, c2);
    expect(back2.clients[0]!.usualStaffId).toBeNull();
    expect(back2.clients[0]!.note).toBe(cl.note);
  });

  it('定期パターン：足した・消したものは戻さず、直したものだけ戻せる', () => {
    const d = base();
    const p = d.patterns[0]!;
    const n: DemoData = {
      ...d,
      patterns: [
        { ...p, durationMinutes: p.durationMinutes === 60 ? 45 : 60 },
        ...d.patterns.slice(1),
        { ...p, id: 'p-new' },
      ],
    };
    const cs = conditionChanges(d, n).filter((c) => c.kind === 'patterns');
    expect(cs.map((c) => c.revert === null)).toEqual([true, false]);
    const back = applyRevert(n, cs[1]!);
    expect(back.patterns[0]).toEqual(p);
    expect(back.patterns.some((x) => x.id === 'p-new')).toBe(true);
  });

  it('〈利用者さん〉・訪問の種類・特性の項目・勤務時間（シフト）。すべて戻すは戻せるものだけ', () => {
    const d = base();
    const c = d.clients[0]!;
    const s = d.staff[0]!;
    const n: DemoData = {
      ...d,
      clients: [{ ...c, usualStaffId: c.usualStaffId === null ? s.id : null }, ...d.clients.slice(1)],
      visitTypes: [
        ...d.visitTypes,
        { id: 't-x', name: 'リハビリ', color: 0, durationMinutes: 60, requirements: [], note: '' },
      ],
      items: d.items.map((x, i) => (i === 0 ? { ...x, name: `${x.name}2` } : x)),
      availability: [...d.availability, { staffId: s.id, date: '2026-10-22', slots: [] }],
    };
    const ls = lines(d, n);
    expect(ls).toContain(`特性の項目：「${d.items[0]!.name}2」を直した`);
    expect(ls).toContain('訪問の種類：リハビリを追加');
    expect(ls).toContain(`${d.org.terms.client}：${c.displayName}さんのいつもの担当`);
    expect(ls).toContain(`勤務時間（シフト）：${s.name}さん（10/22）`);
    // 足した種類・特性の項目の直しは残り、〈利用者さん〉・勤務時間は戻る
    const left = conditionChanges(d, revertAll(n, conditionChanges(d, n))).map(changeLine);
    expect(left).toEqual([`特性の項目：「${d.items[0]!.name}2」を直した`, '訪問の種類：リハビリを追加']);
  });

  it('〈利用者さん〉の休み・定期パターンは〈利用者さん〉ごと', () => {
    const d = base();
    const c = d.clients[0]!;
    const n: DemoData = {
      ...d,
      clientLeaves: [...d.clientLeaves, { id: 'l-x', clientId: c.id, from: '2026-10-22', to: '2026-10-23', note: '' }],
    };
    const cs = conditionChanges(d, n);
    expect(cs.map(changeLine)).toEqual([`${d.org.terms.client}の休み：${c.displayName}さん`]);
    expect(applyRevert(n, cs[0]!).clientLeaves).toEqual(d.clientLeaves);
  });

  it('多いときは先頭3件と「ほか N件」', () => {
    const d = base();
    const n: DemoData = {
      ...d,
      visitTypes: ['A', 'B', 'C', 'D', 'E'].map((x) => ({
        id: `t-${x}`,
        name: x,
        color: 0,
        durationMinutes: 60,
        requirements: [],
        note: '',
      })),
    };
    const vt = conditionChanges({ ...d, visitTypes: [] }, n).find((c) => c.kind === 'visitTypes');
    expect(vt?.text).toBe('Aを追加・Bを追加・Cを追加 ほか2件');
  });
});

describe('madeWeightsChange（PRD D292）', () => {
  const withRun = (d: DemoData, date: string, rules: DemoData['rules']): DemoData => {
    const run: AiRun = {
      id: `run-${date}`,
      no: 1,
      date,
      createdAt: 0,
      label: '標準',
      presetId: 'standard',
      seed: 1,
      iterations: 1,
      rules,
      pins: {},
      routes: {},
      unassigned: [],
      score: 0,
      stopped: false,
    };
    return {
      ...d,
      aiRuns: { ...d.aiRuns, [date]: [run] },
      aiPlans: {
        ...d.aiPlans,
        [date]: {
          date,
          createdAt: 0,
          seed: 1,
          iterations: 1,
          routes: {},
          unassigned: [],
          score: 0,
          stopped: false,
          rules,
          generated: { routes: {}, unassigned: [], score: 0 },
          pins: {},
          runId: run.id,
        },
      },
    };
  };

  it('作ったときの重みと点数の基準の重みの違い。戻すと基準のプリセット（と試す重み）を作ったときの重みにする', () => {
    const d0 = base();
    const d = setBasisWeight(withRun(d0, '2026-10-22', d0.rules), 'wait', { weight: 4 });
    const c = madeWeightsChange(d, ['2026-10-22']);
    expect(c && changeLine(c)).toBe('作ったときの重み：空き時間（待ち） 3、今：4');
    const back = c!.revert!(d);
    expect(basisOf(back).weights.wait.weight).toBe(3);
    expect(back.rules.find((r) => r.type === 'wait')?.weight).toBe(3);
    expect(madeWeightsChange(back, ['2026-10-22'])).toBeNull();
  });

  it('違いが無い・記録が無いなら null。日によって違えばいちばん多い組と日数', () => {
    const d0 = base();
    expect(madeWeightsChange(d0, ['2026-10-22'])).toBeNull();
    const a = d0.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 1 } : r));
    const b = d0.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 2 } : r));
    let d = withRun(d0, '2026-10-22', a);
    d = withRun(d, '2026-10-23', b);
    d = withRun(d, '2026-10-24', b);
    const c = madeWeightsChange(d, ['2026-10-22', '2026-10-23', '2026-10-24']);
    expect(c && changeLine(c)).toBe('作ったときの重み（2日分）：空き時間（待ち） 2、今：3');
  });
});

describe('そのほか', () => {
  it('revertById：控えの位置に足す・消す・置き換える', () => {
    const b = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(revertById([{ id: 'a' }, { id: 'c' }], b, 'b')).toEqual(b);
    expect(revertById([...b, { id: 'x' }], b, 'x')).toEqual(b);
  });
  it('文', () => {
    expect(changesToggleText(3)).toBe('変更内容を見る（3件）');
    // 2026-10-21 00:05 JST
    expect(baseAtText(Date.UTC(2026, 9, 20, 15, 5))).toBe('10/21 0:05');
    const d = base();
    const n = setBasisWeight(d, 'wait', { weight: 1 });
    expect(revertBody(conditionChanges(d, n))).toBe('・条件の重み：空き時間（待ち） 3→1\nを変える前に戻します。');
    expect(revertBody(conditionChanges(d, n), 2)).toMatch(
      /足した・消したものなど 2件は戻しません（各画面で直してください）。$/,
    );
  });
});
