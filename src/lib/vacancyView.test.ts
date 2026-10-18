import { describe, expect, it } from 'vitest';
import { VACANCY_MARGIN_DEFAULT } from '../contracts/vacancy';
import { GLOSSARY } from './glossary';
import { cellFace, markLegend, noticeLine, placeLine, whenWhatLine } from './vacancyView';

describe('cellFace（マスの見た目と読み方）', () => {
  it('○ は人数（目安なら「約」）', () => {
    const f = cellFace({ min: 3, weeksOk: 4, weeksTotal: 4 }, false, '月 10:00から');
    expect(f.mark).toBe('○');
    expect(f.sub).toBe('約3');
    expect(f.label).toBe('月 10:00から：○ どの週も受けられる・どの週でも 約3人（4/4週）');
    expect(cellFace({ min: 3, weeksOk: 4, weeksTotal: 4 }, true, 'x').sub).toBe('3');
  });
  it('× に「約0」、△ に「0」を出さない（△ は受けられる週の数）', () => {
    const ng = cellFace({ min: 0, weeksOk: 0, weeksTotal: 4 }, false, '火 9:00から');
    expect(ng.mark).toBe('×');
    expect(ng.sub).toBe('');
    expect(ng.label).not.toContain('約0');
    expect(ng.label).toContain('受けられない');
    const pa = cellFace({ min: 0, weeksOk: 2, weeksTotal: 4 }, false, '水 9:00から');
    expect(pa.mark).toBe('△');
    expect(pa.sub).toBe('2/4');
    expect(pa.label).toContain('受けられない週がある（受けられる週 2/4週）');
  });
  it('？ は案が無く数えていない（数字なし）', () => {
    const u = cellFace({ min: 0, weeksOk: 0, weeksTotal: 0 }, true, '日 9:00から');
    expect(u.mark).toBe('？');
    expect(u.sub).toBe('');
    expect(u.label).toBe('日 9:00から：？ 案が無く数えていない');
  });
  it('凡例は4つの印で、目安なら「約」の見本', () => {
    expect(markLegend(false).map((x) => x.mark)).toEqual(['○', '△', '×', '？']);
    expect(markLegend(false)[0]!.sample).toBe('約3');
    expect(markLegend(true)[0]!.sample).toBe('3');
    expect(markLegend(true)[3]!.text).toBe('案が無く数えていない');
  });
});

describe('placeLine（場所の段階の要約）', () => {
  it('空なら「場所を入れると移動も含めて絞り込めます」と目安', () => {
    const l = placeLine({ address: '', pinnedAddress: '', hasPin: false }, 15);
    expect(l.set).toBe(false);
    expect(l.text).toContain('場所を入れると移動も含めて絞り込めます');
    expect(l.text).toContain('前後15分');
  });
  it('住所だけなら位置がまだ無いこと', () => {
    const l = placeLine({ address: ' 仙台市 ', pinnedAddress: '', hasPin: false }, 15);
    expect(l).toEqual({ text: '仙台市（位置がまだありません。地図に置くと移動を含めて数えます）', set: false });
  });
  it('ピンがあれば置いたときの住所（無ければ「選んだ場所」）で移動を含む', () => {
    expect(placeLine({ address: '別の住所', pinnedAddress: '一番町1-1', hasPin: true }, 15)).toEqual({
      text: '一番町1-1（移動を含めて数えています）',
      set: true,
    });
    expect(placeLine({ address: '', pinnedAddress: '', hasPin: true }, 15).text).toBe(
      '選んだ場所（移動を含めて数えています）',
    );
  });
});

describe('noticeLine・whenWhatLine', () => {
  it('案内文の要約', () => {
    expect(noticeLine('来週', null, 60)).toBe('来週・種類なし（60分）');
    expect(noticeLine('先4週', '家事', 90)).toBe('先4週・家事（90分）');
    expect(noticeLine('今週', null, null)).toBe('今週・種類なし（所要を入れてください）');
  });
  it('いつ・何をの要約', () => {
    expect(
      whenWhatLine({
        typeName: null,
        duration: '60',
        durationOk: true,
        wishOk: true,
        weekdayLabels: [],
        from: '9:00',
        to: '17:00',
        perWeek: 1,
        startMd: '10/20',
        weeks: 4,
      }),
    ).toBe('種類なし・60分・どの曜日でも・9:00〜17:00に始める・週1回・10/20から4週');
    expect(
      whenWhatLine({
        typeName: '家事',
        duration: '90',
        durationOk: true,
        wishOk: true,
        weekdayLabels: ['月', '水'],
        from: '10:00',
        to: '12:00',
        perWeek: 2,
        startMd: '11/1',
        weeks: 2,
      }),
    ).toBe('家事・90分・月水・10:00〜12:00に始める・週2回・11/1から2週');
  });
  it('所要が正しくない・「から」が「まで」より後なら、その部分は「—」', () => {
    const base = {
      typeName: null,
      duration: '3',
      durationOk: false,
      weekdayLabels: ['火'],
      from: '17:00',
      to: '9:00',
      wishOk: false,
      perWeek: 1,
      startMd: '10/20',
      weeks: 4,
    };
    expect(whenWhatLine(base)).toBe('種類なし・—・火・—・週1回・10/20から4週');
    expect(whenWhatLine({ ...base, durationOk: true, duration: '60' })).toBe(
      '種類なし・60分・火・—・週1回・10/20から4週',
    );
    expect(whenWhatLine({ ...base, wishOk: true })).toBe('種類なし・—・火・17:00〜9:00に始める・週1回・10/20から4週');
  });
});

describe('用語の説明（空き状況）', () => {
  it('「目安（約）」の説明の分は既定の見込みの分と同じ', () => {
    expect(GLOSSARY.vacancyEstimate.text).toContain(`${VACANCY_MARGIN_DEFAULT}分`);
    expect(GLOSSARY.vacancyCount.label).toBe('受けられる人数');
  });
});
