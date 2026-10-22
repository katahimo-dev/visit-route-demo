import { describe, expect, it } from 'vitest';
import { canSelectVisit, isMultiClick, isMultiKey, toggleGroup, toggleId } from './visitSelect';

const mods = (o: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...o,
});
const TODAY = '2026-10-21';

describe('複数選択の押し方（PRD D330・D340）', () => {
  it('Shift・Ctrl・⌘ のどれかを押しながらのクリックは複数選択', () => {
    expect(isMultiClick(mods({ shiftKey: true }))).toBe(true);
    expect(isMultiClick(mods({ ctrlKey: true }))).toBe(true);
    expect(isMultiClick(mods({ metaKey: true }))).toBe(true);
  });
  it('何も押さない・Alt だけのクリックは複数選択ではない', () => {
    expect(isMultiClick(mods())).toBe(false);
    expect(isMultiClick(mods({ altKey: true }))).toBe(false);
  });
  it('Shift／Ctrl／⌘＋Enter は複数選択のキー', () => {
    expect(isMultiKey({ key: 'Enter', ...mods({ shiftKey: true }) })).toBe(true);
    expect(isMultiKey({ key: 'Enter', ...mods({ ctrlKey: true }) })).toBe(true);
    expect(isMultiKey({ key: 'Enter', ...mods({ metaKey: true }) })).toBe(true);
  });
  it('Enter だけ・Alt つき・Enter 以外のキーは複数選択のキーではない', () => {
    expect(isMultiKey({ key: 'Enter', ...mods() })).toBe(false);
    expect(isMultiKey({ key: 'Enter', ...mods({ shiftKey: true, altKey: true }) })).toBe(false);
    expect(isMultiKey({ key: 'a', ...mods({ shiftKey: true }) })).toBe(false);
    expect(isMultiKey({ key: 'ArrowDown', ...mods({ ctrlKey: true }) })).toBe(false);
  });
});

describe('選べる訪問（canSelectVisit）', () => {
  it('今日・今日より後の訪問は選べる', () => {
    expect(canSelectVisit({ date: TODAY, cancelled: false }, false, TODAY)).toBe(true);
    expect(canSelectVisit({ date: '2026-10-22', cancelled: false }, false, TODAY)).toBe(true);
  });
  it('今日より前・取り消し・休みのため無しは選べない', () => {
    expect(canSelectVisit({ date: '2026-10-20', cancelled: false }, false, TODAY)).toBe(false);
    expect(canSelectVisit({ date: TODAY, cancelled: true }, false, TODAY)).toBe(false);
    expect(canSelectVisit({ date: TODAY, cancelled: false }, true, TODAY)).toBe(false);
  });
});

describe('選ぶ・外す', () => {
  it('toggleId：無ければ後ろに足し、あれば外す。元の配列は変えない', () => {
    const ids = ['a', 'b'];
    expect(toggleId(ids, 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleId(ids, 'a')).toEqual(['b']);
    expect(ids).toEqual(['a', 'b']);
  });
  it('toggleGroup：全部選んでいれば全部外す（ほかの選択は残す）', () => {
    expect(toggleGroup(['x', 'a', 'b'], ['a', 'b'])).toEqual(['x']);
  });
  it('toggleGroup：足りなければ足りない分だけ足す（重ねない）', () => {
    expect(toggleGroup(['a'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(toggleGroup([], ['a', 'b'])).toEqual(['a', 'b']);
  });
  it('toggleGroup：まとまりが空なら変えない', () => {
    const ids = ['a'];
    expect(toggleGroup(ids, [])).toBe(ids);
  });
});
