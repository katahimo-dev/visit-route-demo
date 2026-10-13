import { describe, expect, it } from 'vitest';
import { demoDataSchema } from '../contracts/data';
import { addDays } from '../domain/time';
import { applyPreset, createDemoData, daysFrom, INITIAL_PRESETS as PRESETS, presetOf } from './index';

const TODAY = '2026-10-12';

describe('createDemoData', () => {
  it('同じ日付なら同じデータ', () => {
    expect(createDemoData(TODAY)).toEqual(createDemoData(TODAY));
  });

  it('契約（demoDataSchema）を通る', () => {
    expect(() => demoDataSchema.parse(createDemoData(TODAY))).not.toThrow();
    expect(() => demoDataSchema.parse(createDemoData('2027-03-01'))).not.toThrow();
  });

  it('c6 に性別の必要条件、c2 と s2 は相性×', () => {
    const d = createDemoData(TODAY);
    const c6 = d.clients.find((c) => c.id === 'c6');
    expect(c6?.requirements).toContainEqual({ itemId: 'gender', op: 'is', value: '女性' });
    expect(d.compat.c2?.s2).toBe(-2);
    expect(d.compat.c12?.s7).toBe(-2);
  });

  it('14日分の訪問がある', () => {
    const d = createDemoData(TODAY);
    const dates = new Set(d.visits.map((v) => v.date));
    for (let i = 0; i < 14; i++) expect(dates.has(addDays(TODAY, i))).toBe(true);
    expect(dates.size).toBe(14);
  });

  it('手作業の割当は入れない（ADR-0005）', () => {
    const d = createDemoData(TODAY);
    expect(d.manualPlans).toEqual({});
    expect(d.visits.every((v) => v.staffId === null)).toBe(true);
    expect(d.aiRuns).toEqual({});
  });

  it('いつもの担当は入る（内部の手作業らしい割当で最も多い人）', () => {
    const d = createDemoData(TODAY);
    expect(d.clients.some((c) => c.usualStaffId !== null)).toBe(true);
  });
});

describe('daysFrom', () => {
  it('既存の日は変えず、足りない日だけ足す', () => {
    const d = createDemoData(TODAY);
    const e = daysFrom(d, addDays(TODAY, 7), 14);
    expect(e.visits.filter((v) => v.date < addDays(TODAY, 14))).toEqual(d.visits);
    expect(new Set(e.visits.map((v) => v.date)).size).toBe(21);
    expect(e.visits.every((v) => v.staffId === null)).toBe(true);
    expect(() => demoDataSchema.parse(e)).not.toThrow();
  });
});

describe('プリセット', () => {
  it('3種あり、標準は初期の条件と同じ', () => {
    const d = createDemoData(TODAY);
    expect(PRESETS).toHaveLength(3);
    expect(d.presets.map((p) => p.id)).toEqual(['standard', 'travel', 'people']);
    expect(d.presets).toEqual(PRESETS);
    expect(d.presets[0]).not.toBe(PRESETS[0]);
    expect(applyPreset(d.rules, PRESETS[0]!)).toEqual(d.rules);
    expect(presetOf(d.rules, d.presets)?.id).toBe('standard');
  });
  it('当てた条件はそのプリセットと分かる。重みを変えると null', () => {
    const d = createDemoData(TODAY);
    for (const p of PRESETS) expect(presetOf(applyPreset(d.rules, p), d.presets)?.id).toBe(p.id);
    const changed = d.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 0.5 } : r));
    expect(presetOf(changed, d.presets)).toBeNull();
  });
});
