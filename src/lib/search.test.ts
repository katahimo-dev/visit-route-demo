import { describe, expect, it } from 'vitest';
import {
  chooseAllLabel,
  countAmong,
  defaultStaffOf,
  matchClient,
  normalizeKana,
  searchClients,
  staffClientMap,
} from './search';

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

describe('ハイフン類と長音', () => {
  it('ハイフン・全角マイナス・ダッシュは長音にそろう', () => {
    for (const ch of ['-', '－', '‐', '−', '–', '—']) expect(normalizeKana(`さとう${ch}`)).toBe('さとうー');
    expect(matchClient({ displayName: 'ケーキ店', kana: 'けーきてん' }, 'け-き')).toBe(true);
  });
});

describe('chooseAllLabel', () => {
  it('足す人数で「あと N人を選ぶ」', () => {
    expect(chooseAllLabel(3)).toBe('あと3人を選ぶ');
    expect(chooseAllLabel(1)).toBe('あと1人を選ぶ');
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

describe('staffClientMap', () => {
  it('案の担当といつもの担当を合わせる（未知の訪問は飛ばす）', () => {
    const m = staffClientMap(
      [
        ['s1', 'c1'],
        ['s1', 'c2'],
        ['s2', undefined],
        ['s1', 'c1'],
      ],
      [{ id: 'c3' }, { id: 'c4' }],
      new Map([['c3', 's2']]),
    );
    expect([...(m.get('s1') ?? [])]).toEqual(['c1', 'c2']);
    expect([...(m.get('s2') ?? [])]).toEqual(['c3']);
    expect(m.has('s3')).toBe(false);
  });
});

describe('defaultStaffOf（月間の「〈スタッフ〉が担当する人」で先頭の人が0人になる件）', () => {
  const staff = [{ id: 's8' }, { id: 's1' }, { id: 's2' }];
  it('先頭の人に担当する人がいなければ、担当する人がいる最初の人を選ぶ', () => {
    const n: Record<string, number> = { s8: 0, s1: 6, s2: 4 };
    expect(defaultStaffOf(staff, (id) => n[id] ?? 0)).toBe('s1');
  });
  it('だれも担当する人がいなければ先頭。〈スタッフ〉がいなければ空', () => {
    expect(defaultStaffOf(staff, () => 0)).toBe('s8');
    expect(defaultStaffOf([], () => 1)).toBe('');
  });
});

describe('countAmong', () => {
  it('候補にいる人だけ数える（休止中で候補にいない人は数えない）', () => {
    expect(countAmong(new Set(['c1', 'c2', 'c9']), [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }])).toBe(2);
  });
});
