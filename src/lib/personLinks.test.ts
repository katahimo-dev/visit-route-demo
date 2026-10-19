// 名前から詳細を開く場所を足す（PRD D205〜D209）の純粋関数
import { describe, expect, it } from 'vitest';
import type { ClientLeave } from '../contracts/documents';
import { lastDayChanged, leavePeople } from './personLinks';

describe('leavePeople', () => {
  const leaves: ClientLeave[] = [
    { id: 'l1', clientId: 'c1', from: '2026-10-20', to: '2026-10-22', note: '入院' },
    { id: 'l2', clientId: 'c2', from: '2026-10-21', to: '2026-10-21', note: '' },
  ];
  const names: Record<string, string> = { c1: '山田', c2: '佐藤' };
  it('同じ〈利用者さん〉は1回だけ、最初に出た順で、理由を添える', () => {
    const visits = [{ clientId: 'c2' }, { clientId: 'c1' }, { clientId: 'c2' }];
    expect(leavePeople(visits, leaves, '2026-10-21', (id) => names[id])).toEqual([
      { clientId: 'c2', name: '佐藤', note: '' },
      { clientId: 'c1', name: '山田', note: '入院' },
    ]);
  });
  it('データにいない人は名前を空にする・その日の休みが無ければ理由は空', () => {
    expect(leavePeople([{ clientId: 'x' }, { clientId: 'c1' }], leaves, '2026-10-23', (id) => names[id])).toEqual([
      { clientId: 'x', name: '', note: '' },
      { clientId: 'c1', name: '山田', note: '' },
    ]);
  });
  it('訪問が無ければ空', () => {
    expect(leavePeople([], leaves, '2026-10-21', (id) => names[id])).toEqual([]);
  });
});

describe('lastDayChanged', () => {
  const before = [
    { id: 's1', lastDay: null },
    { id: 's2', lastDay: '2026-11-30' },
    { id: 's3', lastDay: '2026-12-31' },
  ];
  it('最終勤務日が入った人・変わった人を、読み込んだあとの並びで返す', () => {
    const after = [
      { id: 's3', name: 'C', lastDay: '2027-01-31' },
      { id: 's2', name: 'B', lastDay: '2026-11-30' },
      { id: 's1', name: 'A', lastDay: '2026-10-31' },
    ];
    expect(lastDayChanged(before, after)).toEqual([
      { id: 's3', name: 'C', lastDay: '2027-01-31' },
      { id: 's1', name: 'A', lastDay: '2026-10-31' },
    ]);
  });
  it('消した人・変わらない人は数えない', () => {
    const after = [
      { id: 's1', name: 'A', lastDay: null },
      { id: 's2', name: 'B', lastDay: '2026-11-30' },
    ];
    expect(lastDayChanged(before, after)).toEqual([]);
  });
  it('足した人も最終勤務日があれば数える（importRoster の lastDaySet と同じ）', () => {
    const after = [
      { id: 's9', name: 'Z', lastDay: '2026-10-31' },
      { id: 's8', name: 'Y', lastDay: null },
    ];
    expect(lastDayChanged(before, after)).toEqual([{ id: 's9', name: 'Z', lastDay: '2026-10-31' }]);
  });
});
