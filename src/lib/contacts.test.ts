// 連絡の一覧の連絡文（PRD D35。ADR-0011 追記）
import { describe, expect, it } from 'vitest';
import type { ContactList } from '../contracts/reassign';
import { allContactsText, type ContactWords, clientMessages, dayWordOf, staffMessage } from './contacts';

const names: Record<string, string> = { s1: '山田', s2: '佐藤', c1: '天文台ほしみ', c2: '青葉', c3: '若林' };
const w: ContactWords = {
  day: '本日',
  staffWord: 'スタッフ',
  staffName: (id) => names[id] ?? id,
  clientName: (id) => names[id] ?? id,
  clientAddress: (id) => (id === 'c1' ? '仙台市青葉区1-1' : ''),
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

describe('連絡文', () => {
  it('スタッフへ：追加の訪問（時刻・行き先）・外れる訪問・開始が変わる訪問', () => {
    expect(staffMessage(list.staff[1]!, w)).toBe(
      [
        '佐藤さん',
        '本日の予定の変更です。',
        '・本日 14:00 天文台ほしみ様（仙台市青葉区1-1）の訪問を追加でお願いします。',
        '・本日 15:00 青葉様の訪問の開始が 15:20 に変わります。',
      ].join('\n'),
    );
    expect(staffMessage(list.staff[0]!, w)).toContain('・本日 14:00 天文台ほしみ様の訪問は、ほかのスタッフが伺います');
    expect(staffMessage(list.staff[0]!, w)).toContain('・本日 16:00 若林様の訪問は、担当を調整中です');
    // 増える・外れる訪問は時刻の順に並べる
    const mixed = staffMessage(
      {
        staffId: 's2',
        added: [{ visitId: 'v9', clientId: 'c3', fromStaffId: 's1', toStaffId: 's2', fromStart: 810, toStart: 810 }],
        removed: [{ visitId: 'v8', clientId: 'c2', fromStaffId: 's2', toStaffId: 's1', fromStart: 780, toStart: 780 }],
        shifted: [],
      },
      w,
    ).split('\n');
    expect(mixed[2]).toContain('13:00 青葉様の訪問は、ほかのスタッフが伺います');
    expect(mixed[3]).toContain('13:30 若林様の訪問を追加でお願いします');
  });
  it('訪問先へ：担当が変わる（前→新しい担当）・入らない・開始が変わる。訪問先ごとに1つ', () => {
    const m = clientMessages(list, w);
    expect(m.map((x) => x.clientId)).toEqual(['c1', 'c2', 'c3']);
    expect(m[0]!.text).toBe('天文台ほしみ様\n・本日 14:00 の訪問は、担当が 山田さんから 佐藤さんに代わります。');
    expect(m[1]!.text).toBe('青葉様\n・本日 15:00 の訪問の開始が 15:20 に変わります（担当は 佐藤さんのままです）。');
    expect(m[2]!.text).toContain('担当の調整がつかず、あらためてご連絡します');
    const moved = clientMessages(
      { ...list, staffChanged: [{ ...list.staffChanged[0]!, toStart: 870 }], timeChanged: [] },
      w,
    );
    expect(moved[0]!.text).toContain('佐藤さんに代わります、開始が 14:30 になります。');
  });
  it('すべての連絡文はスタッフ → 訪問先の順、間に空行。日付の言い方', () => {
    expect(allContactsText(list, w).split('\n\n')).toHaveLength(5);
    expect(dayWordOf('2026-10-14', '2026-10-14')).toBe('本日');
    expect(dayWordOf('2026-10-15', '2026-10-14')).toBe('10月15日（木）');
  });
});
