import { describe, expect, it } from 'vitest';
import { MAX_RUNS_PER_DAY } from '../contracts/data';
import type { SolveResult } from '../contracts/problem';
import { applyPreset, createDemoData, PRESETS } from '../seed';
import { addRun, planOfRun, runLabel } from './runs';

const DAY = '2026-10-12';
const result = (routes: Record<string, string[]>): SolveResult => ({
  routes,
  unassigned: [],
  score: 1,
  seed: 1,
  iterations: 10,
  stopped: false,
});

describe('AI案の記録（ADR-0005）', () => {
  it('作るたびに通し番号を付けて足し、プリセットと一致すればその名前', () => {
    const d0 = createDemoData(DAY);
    const travel = applyPreset(d0.rules, PRESETS[1]!);
    const d1 = addRun(d0, DAY, { rules: d0.rules, pins: {}, result: result({ s1: ['a'] }), createdAt: 1 });
    const d2 = addRun(d1, DAY, { rules: travel, pins: {}, result: result({ s1: ['b'] }), createdAt: 2 });
    const runs = d2.aiRuns[DAY]!;
    expect(runs.map((r) => [r.no, r.label, r.presetId])).toEqual([
      [1, '標準', 'standard'],
      [2, '移動を短く', 'travel'],
    ]);
  });

  it('最新の記録を消して作り直すと番号は同じでも ID は別（比較の選択を取り違えない）', () => {
    const d0 = createDemoData(DAY);
    const d1 = addRun(d0, DAY, { rules: d0.rules, pins: {}, result: result({ s1: ['a'] }), createdAt: 1 });
    const removed = { ...d1, aiRuns: { [DAY]: [] } };
    const d2 = addRun(removed, DAY, { rules: d0.rules, pins: {}, result: result({ s1: ['b'] }), createdAt: 2 });
    expect(d2.aiRuns[DAY]![0]!.no).toBe(d1.aiRuns[DAY]![0]!.no);
    expect(d2.aiRuns[DAY]![0]!.id).not.toBe(d1.aiRuns[DAY]![0]!.id);
  });

  it('同じ条件・種・固定・結果は足さない', () => {
    const d0 = createDemoData(DAY);
    const x = { rules: d0.rules, pins: {}, result: result({ s1: ['a'] }), createdAt: 1 };
    const d1 = addRun(d0, DAY, x);
    expect(addRun(d1, DAY, { ...x, createdAt: 2 })).toBe(d1);
  });

  it('1日の上限を超えたら古いものから消す。番号は続ける', () => {
    let d = createDemoData(DAY);
    for (let i = 0; i < MAX_RUNS_PER_DAY + 2; i++)
      d = addRun(d, DAY, { rules: d.rules, pins: {}, result: result({ s1: [`v${i}`] }), createdAt: i });
    const runs = d.aiRuns[DAY]!;
    expect(runs).toHaveLength(MAX_RUNS_PER_DAY);
    expect(runs[0]!.no).toBe(3);
    expect(runs.at(-1)!.no).toBe(MAX_RUNS_PER_DAY + 2);
  });

  it('名前：重みを変えたら「条件を変えた案」、固定で組み直しは件数を足す', () => {
    const rules = createDemoData(DAY).rules;
    expect(
      runLabel(
        rules.map((r) => ({ ...r, weight: r.type === 'wait' ? 0.5 : r.weight })),
        0,
      ),
    ).toBe('条件を変えた案');
    expect(runLabel(rules, 2)).toBe('標準・固定2件で組み直し');
  });

  it('記録を今の案にすると、AIが出したまま＝記録の結果', () => {
    const d0 = createDemoData(DAY);
    const d1 = addRun(d0, DAY, { rules: d0.rules, pins: {}, result: result({ s1: ['a'] }), createdAt: 1 });
    const p = planOfRun(d1.aiRuns[DAY]![0]!);
    expect(p.routes).toEqual({ s1: ['a'] });
    expect(p.generated.routes).toEqual(p.routes);
    expect(p.pins).toEqual({});
  });
});
