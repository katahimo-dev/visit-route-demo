import { describe, expect, it } from 'vitest';
import { defaultVacancyInput, loadVacancyInput, saveVacancyInput, VACANCY_INPUT_KEY } from './vacancyInput';

const TODAY = '2026-10-21';

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    raw: m,
  };
}

describe('空き状況の入力を覚える（PRD D258）', () => {
  it('無ければ既定（開始日は今日）', () => {
    const s = memory();
    expect(loadVacancyInput(TODAY, null, s)).toEqual(defaultVacancyInput(TODAY));
    expect(loadVacancyInput(TODAY, null, null)).toEqual(defaultVacancyInput(TODAY));
  });

  it('覚えた入力を読み直す（往復）', () => {
    const s = memory();
    const v = {
      ...defaultVacancyInput(TODAY),
      typeId: 'vt-1',
      duration: '90',
      requirements: [{ itemId: 'gender', op: 'is' as const, value: 'female' }],
      place: { address: '仙台市', lat: 38.26, lng: 140.87, postalCode: '980-0811', pinnedAddress: '仙台市' },
      weeks: 2,
      from: '2026-10-25',
      wishDays: [2, 4],
      wishFrom: '10:00',
      wishTo: '12:00',
      perWeek: 2,
      noticePeriod: 'fourWeeks' as const,
      noticeTypeId: 'vt-2',
    };
    saveVacancyInput(v, s);
    expect(s.raw.has(VACANCY_INPUT_KEY)).toBe(true);
    const back = loadVacancyInput(TODAY, null, s);
    expect(back.requirements).toEqual(v.requirements);
    expect(back.typeId).toBe('vt-1');
    expect(back.place).toEqual(v.place);
    expect(back.wishDays).toEqual([2, 4]);
    expect(back.noticePeriod).toBe('fourWeeks');
    expect(back.from).toBe('2026-10-25');
    // 消えた種類は捨てる
    const gone = loadVacancyInput(TODAY, new Set(['vt-2']), s);
    expect(gone.typeId).toBe('');
    expect(gone.noticeTypeId).toBe('vt-2');
  });

  it('読めない項目だけ既定にする・壊れた文字は既定・開始日が今日より前なら今日', () => {
    const s = memory();
    s.setItem(VACANCY_INPUT_KEY, JSON.stringify({ duration: '45', weeks: 99, wishFrom: '25:00', from: '2026-10-01' }));
    const v = loadVacancyInput(TODAY, null, s);
    expect(v.duration).toBe('45');
    expect(v.weeks).toBe(defaultVacancyInput(TODAY).weeks);
    expect(v.wishFrom).toBe('09:00');
    expect(v.from).toBe(TODAY);
    s.setItem(VACANCY_INPUT_KEY, '{壊れた');
    expect(loadVacancyInput(TODAY, null, s)).toEqual(defaultVacancyInput(TODAY));
  });

  it('書けなくても例外を出さない', () => {
    const bad = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveVacancyInput(defaultVacancyInput(TODAY), bad)).not.toThrow();
  });
});
