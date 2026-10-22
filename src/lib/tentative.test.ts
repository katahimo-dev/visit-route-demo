import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Pattern } from '../contracts/documents';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { visitsOn } from '../patterns';
import { cancelTentative, confirmedDatesOf } from './tentative';

const pattern: Pattern = {
  id: 'p1',
  clientId: 'c2',
  typeId: null,
  weekdays: [2],
  everyWeeks: 1,
  repeat: 'weekly',
  monthWeeks: [],
  dayTimes: [],
  windowKind: 'fixed',
  earliestStart: '15:00',
  latestStart: '15:00',
  durationMinutes: 60,
  from: DATE,
  to: null,
  usualStaffId: 's1',
  note: '',
};

const data = (): DemoData => ({
  ...makeData({
    staff: [staff('s1', 38.26, 140.87)],
    clients: [client('c1', 38.27, 140.88), client('c2', 38.27, 140.881, { tentative: true })],
    visits: [
      visit('v1', 'c1', '09:00', '09:00', { staffId: 's1' }),
      visit('v2', 'c2', '11:00', '11:00', { staffId: 's1', pinned: true }),
      visit('v3', 'c2', '13:00', '13:00'),
    ],
    patterns: [pattern],
  }),
  compat: { c1: { s1: 1 }, c2: { s1: -1 } },
  snapshots: {
    [DATE]: {
      date: DATE,
      at: 1,
      visits: [
        { id: 'v1', clientId: 'c1', staffId: 's1', start: '09:00' },
        { id: 'v2', clientId: 'c2', staffId: 's1', start: '11:00' },
      ],
    },
  },
});

describe('cancelTentative（仮押さえを取り消す。版2）', () => {
  it('その人の訪問・繰り返しを消し、〈利用者さん〉を相性から除く。伝えた内容はそのまま（未連絡の変更になる）', () => {
    const r = cancelTentative(data(), 'c2', DATE);
    expect(r.clients.map((c) => c.id)).toEqual(['c1']);
    expect(r.visits.map((v) => v.id)).toEqual(['v1']);
    expect(r.patterns).toEqual([]);
    expect(visitsOn(r, '2026-10-13')).toEqual([]);
    expect(r.compat).toEqual({ c1: { s1: 1 } });
    expect(r.snapshots[DATE]!.visits).toHaveLength(2);
  });

  it('confirmedDatesOf：その人の訪問を伝えた日', () => {
    expect(confirmedDatesOf(data(), 'c2')).toEqual([DATE]);
    expect(confirmedDatesOf({ ...data(), snapshots: {} }, 'c2')).toEqual([]);
  });
});
