import { describe, expect, it } from 'vitest';
import {
  clientParamOf,
  defaultTimelineClients,
  handoffFromTable,
  TIMELINE_CLIENT_MAX,
  timelineChipIds,
  timelineSelection,
} from './timelineClients';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);
const week = ids(11);
const known = new Set([...week, 'x1', 'x2']);

describe('defaultTimelineClients', () => {
  it('この週の先頭8人', () => {
    expect(TIMELINE_CLIENT_MAX).toBe(8);
    expect(defaultTimelineClients(week)).toEqual(ids(8));
    expect(defaultTimelineClients(ids(3))).toEqual(ids(3));
    expect(defaultTimelineClients([])).toEqual([]);
  });
});

describe('timelineSelection', () => {
  it('?client= が無ければ初期値（先頭8人）', () => {
    expect(timelineSelection(null, week, known)).toEqual({ ids: ids(8), isDefault: true });
  });
  it('?client= があればそれ（候補にいる人だけ）。空なら0人', () => {
    expect(timelineSelection(['c3', 'zz', 'x1'], week, known)).toEqual({ ids: ['c3', 'x1'], isDefault: false });
    expect(timelineSelection([], week, known)).toEqual({ ids: [], isDefault: false });
  });
  it('週を送ると、?client= が無ければその週の先頭8人', () => {
    const next = ['c9', 'c10', 'c11'];
    expect(timelineSelection(null, next, known).ids).toEqual(next);
  });
});

describe('clientParamOf', () => {
  it('初期値と同じ人なら書かない（順は問わない）', () => {
    expect(clientParamOf(ids(8), week)).toBeNull();
    expect(clientParamOf([...ids(8)].reverse(), week)).toBeNull();
  });
  it('違えば ID をつなぐ。0人は空の文字', () => {
    expect(clientParamOf(ids(7), week)).toBe(ids(7).join(','));
    expect(clientParamOf([...ids(7), 'c9'], week)).toBe([...ids(7), 'c9'].join(','));
    expect(clientParamOf([], week)).toBe('');
  });
  it('この週に訪問が無ければ、0人が初期値', () => {
    expect(clientParamOf([], [])).toBeNull();
  });
});

describe('timelineChipIds', () => {
  it('この週の人のあとに、選んでいてそこにいない人を選んだ順に', () => {
    expect(timelineChipIds(['c1', 'c2'], ['c2', 'x2', 'x1'])).toEqual(['c1', 'c2', 'x2', 'x1']);
    expect(timelineChipIds(['c1'], [])).toEqual(['c1']);
  });
});

describe('handoffFromTable', () => {
  const base = { hasParam: false, filtered: true, filteredIds: ['c4', 'c6', 'c9'], weekIds: week };
  it('表で絞り込んでいれば、その先頭8人を書く', () => {
    expect(handoffFromTable(base)).toBe('c4,c6,c9');
    expect(handoffFromTable({ ...base, filteredIds: ids(10) })).toBeNull(); // 先頭8人＝初期値と同じ
    expect(handoffFromTable({ ...base, filteredIds: ids(10).slice(1) })).toBe(ids(9).slice(1).join(','));
  });
  it('?client= があればそのまま（書かない）', () => {
    expect(handoffFromTable({ ...base, hasParam: true })).toBeNull();
  });
  it('絞り込んでいない・0人なら書かない（初期値＝この週の先頭8人）', () => {
    expect(handoffFromTable({ ...base, filtered: false })).toBeNull();
    expect(handoffFromTable({ ...base, filteredIds: [] })).toBeNull();
  });
});
