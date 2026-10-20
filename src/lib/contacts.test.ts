// 連絡の一覧と連絡文（PRD D35・D244〜D246。ADR-0011 追記・ADR-0038）
import { describe, expect, it } from 'vitest';
import type { ContactList } from '../contracts/reassign';
import {
  allContactsText,
  type ContactWords,
  clientMessages,
  contactCount,
  contactRows,
  dateWordOf,
  familyName,
  promisedText,
  staffMessage,
} from './contacts';

const names: Record<string, string> = {
  s1: '山田 花',
  s2: '佐藤 一郎',
  s3: '鈴木 次郎',
  c1: '天文台ほしみ',
  c2: '青葉',
  c3: '若林',
  c4: '宮城野',
};
const w: ContactWords = {
  day: '10月14日（水）',
  staffWord: 'スタッフ',
  staffName: (id) => names[id] ?? id,
  clientName: (id) => names[id] ?? id,
  clientAddress: (id) => (id === 'c1' ? '仙台市青葉区1-1' : ''),
  visitMinutes: (id) => (id === 'v1' ? 60 : null),
  orgName: 'ほしみ訪問介護',
  promised: (id) => (id === 'v2' ? { from: 890, to: 910 } : null),
};
const list: ContactList = {
  staffChanged: [
    { visitId: 'v1', clientId: 'c1', fromStaffId: 's1', toStaffId: 's2', fromStart: 840, toStart: 840 },
    { visitId: 'v3', clientId: 'c3', fromStaffId: 's1', toStaffId: null, fromStart: 960, toStart: null },
  ],
  timeChanged: [{ visitId: 'v2', clientId: 'c2', fromStaffId: 's2', toStaffId: 's2', fromStart: 900, toStart: 920 }],
  staff: [
    {
      staffId: 's1',
      added: [],
      removed: [
        { visitId: 'v1', clientId: 'c1', fromStaffId: 's1', toStaffId: 's2', fromStart: 840, toStart: 840 },
        { visitId: 'v3', clientId: 'c3', fromStaffId: 's1', toStaffId: null, fromStart: 960, toStart: null },
      ],
      shifted: [],
    },
    {
      staffId: 's2',
      added: [{ visitId: 'v1', clientId: 'c1', fromStaffId: 's1', toStaffId: 's2', fromStart: 840, toStart: 840 }],
      removed: [],
      shifted: [{ visitId: 'v2', clientId: 'c2', fromStaffId: 's2', toStaffId: 's2', fromStart: 900, toStart: 920 }],
    },
  ],
};
const EMPTY: ContactList = { staffChanged: [], timeChanged: [], staff: [] };

describe('連絡文（スタッフあて：丁寧語の短文）', () => {
  it('新しく入る訪問は時刻・住所・所要、時刻が変わる訪問は元 → 新しい開始', () => {
    expect(staffMessage(list.staff[1]!, w)).toBe(
      [
        '佐藤 一郎さん',
        '10月14日（水）の予定の変更です。',
        '・14:00 天文台ほしみ様の訪問をお願いします（仙台市青葉区1-1・60分）。',
        '・15:00 青葉様の訪問は、開始が15:20に変わりました。',
      ].join('\n'),
    );
  });
  it('外れる訪問は代わりの人の名前、入らないなら調整中。住所は載せない', () => {
    const text = staffMessage(list.staff[0]!, w);
    expect(text).toContain('・14:00 天文台ほしみ様の訪問は、佐藤 一郎さんに代わりました。伺わなくて大丈夫です。');
    expect(text).toContain('・16:00 若林様の訪問は、代わりのスタッフを調整中です。伺わなくて大丈夫です。');
    expect(text).not.toContain('仙台市');
  });
  it('新しく入る・外れる訪問は時刻の順', () => {
    const mixed = staffMessage(
      {
        staffId: 's2',
        added: [{ visitId: 'v9', clientId: 'c3', fromStaffId: 's1', toStaffId: 's2', fromStart: 810, toStart: 810 }],
        removed: [{ visitId: 'v8', clientId: 'c2', fromStaffId: 's2', toStaffId: 's1', fromStart: 780, toStart: 780 }],
        shifted: [],
      },
      w,
    ).split('\n');
    expect(mixed[2]).toContain('13:00 青葉様の訪問は、山田 花さんに代わりました');
    expect(mixed[3]).toBe('・13:30 若林様の訪問をお願いします。');
  });
  it('キャンセルは担当に「中止です」', () => {
    const text = staffMessage({ staffId: 's3', added: [], removed: [], shifted: [] }, w, [
      { visitId: 'v7', clientId: 'c4', staffId: 's3', start: 570 },
      { visitId: 'v6', clientId: 'c2', staffId: 's1', start: 600 },
    ]);
    expect(text).toBe(
      [
        '鈴木 次郎さん',
        '10月14日（水）の予定の変更です。',
        '・9:30 宮城野様の訪問は、中止です（キャンセル）。伺わなくて大丈夫です。',
      ].join('\n'),
    );
  });
  it('呼び方（terms.staff）を変えると連絡文の呼び方も変わる。敬称（様・さん）は固定', () => {
    const text = staffMessage(list.staff[0]!, { ...w, staffWord: 'ヘルパー' });
    expect(text).toContain('代わりのヘルパーを調整中です');
    expect(text).not.toContain('スタッフ');
    expect(text.split('\n')[0]).toBe('山田 花さん');
  });
});

describe('連絡文（〈利用者さん〉あて：敬語）', () => {
  it('担当が代わる・開始が変わる・入らない。担当は姓だけ、前の担当・住所は載せない', () => {
    const m = clientMessages(list, w);
    expect(m.map((x) => x.clientId)).toEqual(['c1', 'c2', 'c3']);
    expect(m[0]!.text).toBe(
      [
        '天文台ほしみ様',
        'いつもお世話になっております。ほしみ訪問介護です。',
        '10月14日（水）の訪問について、変更をお知らせいたします。',
        '・14:00の訪問は、担当が佐藤に代わります。',
        'ご迷惑をおかけして申し訳ございません。どうぞよろしくお願いいたします。',
      ].join('\n'),
    );
    expect(m[0]!.text).not.toContain('山田');
    expect(m[0]!.text).not.toContain('仙台市');
    // 約束に幅があれば「〜の間」で書き、新しい開始は「ごろ」
    expect(m[1]!.text).toContain('・14:50〜15:10の間の訪問は、開始が15:20ごろに変わります（担当は変わりません）。');
    expect(m[2]!.text).toContain('担当の調整がついておりません。あらためてご連絡いたします。');
    const moved = clientMessages(
      { ...list, staffChanged: [{ ...list.staffChanged[0]!, toStart: 870 }], timeChanged: [] },
      w,
    );
    expect(moved[0]!.text).toContain('担当が佐藤に代わり、開始は14:30ごろになります。');
  });
  it('事業所名が無ければ名乗りを省く', () => {
    expect(clientMessages(list, { ...w, orgName: '' })[0]!.text.split('\n')[1]).toBe('いつもお世話になっております。');
  });
});

describe('連絡の一覧（5段目の行）', () => {
  it('1人に1行：スタッフ（種類の印）→ 〈利用者さん〉', () => {
    const rows = contactRows(list, [], w);
    expect(rows.map((r) => [r.key, r.kinds])).toEqual([
      ['staff:s1', ['removed']],
      ['staff:s2', ['added', 'shifted']],
      ['client:c1', ['client']],
      ['client:c2', ['client']],
      ['client:c3', ['client']],
    ]);
    expect(rows[0]!.name).toBe('山田 花さん');
    expect(rows[2]!.name).toBe('天文台ほしみ様');
    expect(rows[1]!.text).toBe(staffMessage(list.staff[1]!, w));
  });
  it('キャンセル：担当にだけ「中止」。差に出た同じ訪問は除き、キャンセルした〈利用者さん〉には送らない', () => {
    const withCancel: ContactList = {
      staffChanged: [
        { visitId: 'v7', clientId: 'c4', fromStaffId: 's3', toStaffId: null, fromStart: 570, toStart: null },
      ],
      timeChanged: [],
      staff: [
        {
          staffId: 's3',
          added: [],
          removed: [
            { visitId: 'v7', clientId: 'c4', fromStaffId: 's3', toStaffId: null, fromStart: 570, toStart: null },
          ],
          shifted: [],
        },
      ],
    };
    const rows = contactRows(withCancel, [{ visitId: 'v7', clientId: 'c4', staffId: 's3', start: 570 }], w);
    expect(rows.map((r) => [r.key, r.kinds])).toEqual([['staff:s3', ['cancelled']]]);
    expect(rows[0]!.text).toContain('宮城野様の訪問は、中止です');
    expect(rows[0]!.text).not.toContain('調整中');
  });
  it('同じ人が外れて入る：1行にまとめ、時刻の順', () => {
    const a = { visitId: 'v1', clientId: 'c1', fromStaffId: 's2', toStaffId: 's1', fromStart: 600, toStart: 600 };
    const b = { visitId: 'v2', clientId: 'c2', fromStaffId: 's1', toStaffId: 's2', fromStart: 540, toStart: 540 };
    const rows = contactRows(
      {
        staffChanged: [b, a],
        timeChanged: [],
        staff: [
          { staffId: 's1', added: [a], removed: [b], shifted: [] },
          { staffId: 's2', added: [b], removed: [a], shifted: [] },
        ],
      },
      [],
      w,
    );
    expect(rows.filter((r) => r.to === 'staff').map((r) => [r.id, r.kinds])).toEqual([
      ['s1', ['removed', 'added']],
      ['s2', ['removed', 'added']],
    ]);
    expect(rows[0]!.text.split('\n').slice(2)).toEqual([
      '・9:00 青葉様の訪問は、佐藤 一郎さんに代わりました。伺わなくて大丈夫です。',
      '・10:00 天文台ほしみ様の訪問をお願いします（仙台市青葉区1-1・60分）。',
    ]);
  });
  it('時刻だけ変わる人と中止が同じ人に重なる：1行に「時刻が変わる」と「中止」', () => {
    const sh = { visitId: 'v2', clientId: 'c2', fromStaffId: 's2', toStaffId: 's2', fromStart: 900, toStart: 920 };
    const rows = contactRows(
      { staffChanged: [], timeChanged: [sh], staff: [{ staffId: 's2', added: [], removed: [], shifted: [sh] }] },
      [{ visitId: 'v7', clientId: 'c4', staffId: 's2', start: 570 }],
      w,
    );
    expect(rows.map((r) => [r.key, r.kinds])).toEqual([
      ['staff:s2', ['shifted', 'cancelled']],
      ['client:c2', ['client']],
    ]);
    expect(rows[0]!.text.split('\n').slice(2)).toEqual([
      '・9:30 宮城野様の訪問は、中止です（キャンセル）。伺わなくて大丈夫です。',
      '・15:00 青葉様の訪問は、開始が15:20に変わりました。',
    ]);
  });
  it('担当の無いキャンセル・変更なしは行なし', () => {
    expect(contactRows(EMPTY, [{ visitId: 'v7', clientId: 'c4', staffId: null, start: 570 }], w)).toEqual([]);
    expect(contactRows(EMPTY, [], w)).toEqual([]);
  });
});

describe('ほか', () => {
  it('すべての連絡文はスタッフ → 訪問先の順、間に空行。日付・時刻の書き方', () => {
    expect(allContactsText(list, w).split('\n\n')).toHaveLength(5);
    expect(promisedText({ from: 540, to: 540 })).toBe('9:00');
    expect(promisedText({ from: 540, to: 570 })).toBe('9:00〜9:30の間');
    expect(dateWordOf('2026-10-14')).toBe('10月14日（水）');
    expect(familyName('山田 花')).toBe('山田');
    expect(familyName('山田　花')).toBe('山田');
    expect(familyName('ひかり')).toBe('ひかり');
  });
  it('連絡が要る訪問の数＝担当が変わる訪問＋時刻だけ変わる訪問（同じ訪問は1件）', () => {
    expect(contactCount(list)).toBe(3);
    expect(contactCount({ ...list, timeChanged: [...list.timeChanged, list.staffChanged[0]!] })).toBe(3);
    expect(contactCount(null)).toBe(0);
    expect(contactCount(EMPTY)).toBe(0);
  });
});
