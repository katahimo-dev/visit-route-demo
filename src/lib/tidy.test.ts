import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { visit } from '../matching/fixtures';
import { createDemoData } from '../seed';
import { addMonths, sizeText, tidyMonthLabel, tidyMonthOptions, tidyOld, tidyPreview } from './tidy';

/** 古い日の保存した訪問・伝えた内容・振り直しの情報を持つデータ（版2） */
function withOld(): DemoData {
  const d = createDemoData('2026-10-12');
  const snap = (date: string) => ({
    date,
    at: 1,
    visits: [{ id: 'v1', clientId: 'c1', staffId: 's1', start: '09:00' }],
  });
  return {
    ...d,
    visits: [
      visit('o1', 'c1', '09:00', '09:00', { date: '2026-06-10' }),
      visit('o2', 'c1', '09:00', '09:00', { date: '2026-06-30' }),
      visit('n1', 'c1', '09:00', '09:00', { date: '2026-07-15' }),
    ],
    snapshots: { '2026-06-30': snap('2026-06-30'), '2026-07-01': snap('2026-07-01') },
    reassigns: {
      '2026-06-30': { method: 'insert', baseRoutes: {}, basePins: {}, absenceIds: [] },
    },
  };
}

describe('古い訪問の片づけ（PRD D227。ADR-0032・ADR-0053）', () => {
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
  it('選んだ月より前の日の保存した訪問と伝えた内容を数え、空く見込み（JSON の文字数）を出す', () => {
    const d = withOld();
    const p = tidyPreview(d, '2026-07');
    expect(p).toMatchObject({ visits: 2, snapshots: 1, days: 2 });
    expect(p.chars).toBeGreaterThan(0);
    expect(tidyPreview(d, '2025-12')).toEqual({ visits: 0, snapshots: 0, days: 0, chars: 0 });
  });
  it('消すのは古い保存した訪問・伝えた内容・振り直しの情報だけ。繰り返し・人は残す', () => {
    const d = withOld();
    const t = tidyOld(d, '2026-07');
    expect(t.visits.map((v) => v.id)).toEqual(['n1']);
    expect(Object.keys(t.snapshots)).toEqual(['2026-07-01']);
    expect(t.reassigns).toEqual({});
    expect(t.patterns).toBe(d.patterns);
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
