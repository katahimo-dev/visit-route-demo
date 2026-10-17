import { describe, expect, it } from 'vitest';
import { matchClient, normalizeKana, searchClients } from './search';

describe('normalizeKana', () => {
  it('カタカナをひらがなに、全角半角・大文字小文字・空白をそろえる', () => {
    expect(normalizeKana('トショカン フミ')).toBe('としょかんふみ');
    expect(normalizeKana('ﾄｼｮｶﾝ　ﾌﾐ')).toBe('としょかんふみ');
    expect(normalizeKana('ＡＢＣ abc')).toBe('abcabc');
    expect(normalizeKana('ヴァ')).toBe('ゔぁ');
    expect(normalizeKana('メモリアル')).toBe('めもりある');
    expect(normalizeKana('ー')).toBe('ー');
    expect(normalizeKana('')).toBe('');
  });
  it('濁点つきの半角カナも1字にそろう', () => {
    expect(normalizeKana('ｶﾞｸ')).toBe('がく');
  });
});

describe('matchClient', () => {
  const c = { displayName: '図書館 ふみ', kana: 'としょかん ふみ' };
  it('表示名・よみの部分一致（ひらがな・カタカナ・半角を問わない）', () => {
    expect(matchClient(c, '図書')).toBe(true);
    expect(matchClient(c, 'としょ')).toBe(true);
    expect(matchClient(c, 'トショ')).toBe(true);
    expect(matchClient(c, 'ｼｮｶﾝ')).toBe(true);
    expect(matchClient(c, 'かんふ')).toBe(true);
    expect(matchClient(c, 'フミ')).toBe(true);
    expect(matchClient(c, 'やぎ')).toBe(false);
  });
  it('空の検索はすべて当たる', () => {
    expect(matchClient(c, '')).toBe(true);
    expect(matchClient(c, '　 ')).toBe(true);
  });
  it('よみが空でも表示名で当たる', () => {
    expect(matchClient({ displayName: 'メモリアル あかり', kana: '' }, 'めもり')).toBe(true);
    expect(matchClient({ displayName: '城跡', kana: '' }, 'しろ')).toBe(false);
  });
});

describe('searchClients', () => {
  const xs = [
    { displayName: '泉図書館 いずみ', kana: 'いずみとしょかん いずみ' },
    { displayName: '図書館 ふみ', kana: 'としょかん ふみ' },
    { displayName: '若林図書館 わかば', kana: 'わかばやしとしょかん わかば' },
  ];
  it('先頭から一致する人を前に、上限を超えた分は数だけ', () => {
    const r = searchClients(xs, 'としょ', 2);
    expect(r.list.map((x) => x.displayName)).toEqual(['図書館 ふみ', '泉図書館 いずみ']);
    expect(r.rest).toBe(1);
  });
  it('空の検索は渡した順のまま', () => {
    expect(searchClients(xs, '', 10).list).toEqual(xs);
  });
});
