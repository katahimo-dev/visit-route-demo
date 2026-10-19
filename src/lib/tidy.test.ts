import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { createDemoData } from '../seed';
import { addMonths, sizeText, tidyMonthLabel, tidyMonthOptions, tidyOld, tidyPreview } from './tidy';

/** 日付ごとに中身を持つだけの案と記録（形は見ない） */
const fake = (date: string) => ({ date, routes: { s1: ['v1'] } }) as unknown as DemoData['aiPlans'][string];
const run = (date: string, no: number) =>
  ({ id: `${date}#${no}`, no, date }) as unknown as DemoData['aiRuns'][string][number];

function withOld(): DemoData {
  const d = createDemoData('2026-10-12');
  return {
    ...d,
    aiPlans: { '2026-06-30': fake('2026-06-30'), '2026-07-01': fake('2026-07-01'), '2026-10-12': fake('2026-10-12') },
    aiRuns: {
      '2026-06-10': [run('2026-06-10', 1), run('2026-06-10', 2)],
      '2026-06-30': [run('2026-06-30', 1)],
      '2026-07-15': [run('2026-07-15', 1)],
    },
    manualPlans: { '2026-06-30': { s1: ['v1'] } },
  };
}

describe('古い案と記録の片づけ（PRD D227。ADR-0032）', () => {
  it('選べる月は今月から12か月前まで（新しい順）、既定は3か月前', () => {
    const { options, initial } = tidyMonthOptions('2026-10-21');
    expect(options[0]).toBe('2026-10');
    expect(options.at(-1)).toBe('2025-10');
    expect(options).toHaveLength(13);
    expect(initial).toBe('2026-07');
    expect(tidyMonthLabel('2026-07')).toBe('2026年7月より前');
  });
  it('年をまたいで月をずらす', () => {
    expect(addMonths('2026-02', -3)).toBe('2025-11');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -12)).toBe('2025-01');
  });
  it('選んだ月より前の日の案と記録を数え、空く見込み（JSON の文字数）を出す', () => {
    const d = withOld();
    const p = tidyPreview(d, '2026-07');
    expect(p).toMatchObject({ runs: 3, plans: 1, days: 2 });
    expect(p.chars).toBeGreaterThan(JSON.stringify(d.aiRuns['2026-06-10']).length);
    expect(tidyPreview(d, '2025-12')).toEqual({ runs: 0, plans: 0, days: 0, chars: 0 });
  });
  it('消すのは aiRuns・aiPlans だけ。確定した割当・訪問・人は残す', () => {
    const d = withOld();
    const t = tidyOld(d, '2026-07');
    expect(Object.keys(t.aiPlans).sort()).toEqual(['2026-07-01', '2026-10-12']);
    expect(Object.keys(t.aiRuns)).toEqual(['2026-07-15']);
    expect(t.manualPlans).toBe(d.manualPlans);
    expect(t.visits).toBe(d.visits);
    expect(t.staff).toBe(d.staff);
  });
  it('消すものが無ければ同じもの', () => {
    const d = withOld();
    expect(tidyOld(d, '2026-01')).toBe(d);
  });
  it('大きさの文', () => {
    expect(sizeText(100)).toBe('1KB 未満');
    expect(sizeText(10 * 1024)).toBe('約 10KB');
  });
});
