import { describe, expect, it } from 'vitest';
import { foldHidden } from './fold';

const items = [
  { id: 'a', top: 0 },
  { id: 'b', top: 1 },
  { id: 'c', top: 30 },
  { id: 'd', top: 31 },
  { id: 'e', top: 60 },
  { id: 'f', top: 90 },
];

describe('foldHidden', () => {
  it('2行に入らない項目を隠す', () => {
    expect([...foldHidden(items, new Set(), 2)]).toEqual(['e', 'f']);
  });
  it('選んでいる人は3行目より下でも隠さない', () => {
    expect([...foldHidden(items, new Set(['f']), 2)]).toEqual(['e']);
  });
  it('見出しの行（firstTop）も1行目に数える', () => {
    expect([...foldHidden(items.slice(2), new Set(), 2, 0)]).toEqual(['e', 'f']);
  });
  it('入りきれば何も隠さない', () => {
    expect(foldHidden(items.slice(0, 4), new Set(), 2).size).toBe(0);
    expect(foldHidden([], new Set(), 2).size).toBe(0);
  });
});
