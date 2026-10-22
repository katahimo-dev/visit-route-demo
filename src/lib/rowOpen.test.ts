// 一覧の行を押して閲覧の欄を開く（PRD D297）
import { describe, expect, it } from 'vitest';
import { shouldOpenRow } from './rowOpen';

/** closest が返す要素を決めた偽の要素（DOM を使わない） */
const target = (hit: object | null) => ({ closest: () => hit }) as unknown as Element;
const rowWith = (...inside: object[]) =>
  ({ contains: (x: unknown) => inside.includes(x as object) }) as unknown as Element;

describe('shouldOpenRow', () => {
  it('ふつうの文字を押したら開く', () => {
    expect(shouldOpenRow(target(null), rowWith(), '')).toBe(true);
  });
  it('行の中のボタン・リンクを押したら開かない', () => {
    const btn = {};
    expect(shouldOpenRow(target(btn), rowWith(btn), '')).toBe(false);
  });
  it('文字を選んでいるときは開かない', () => {
    expect(shouldOpenRow(target(null), rowWith(), '山田')).toBe(false);
  });
  it('行の外の部品（行を包むボタンなど）は数えない', () => {
    expect(shouldOpenRow(target({}), rowWith(), '')).toBe(true);
  });
  it('押した要素が無ければ開く', () => {
    expect(shouldOpenRow(null, rowWith(), '')).toBe(true);
  });
});
