// 一覧の行を押してその人の画面を開く（PRD D308）
import { describe, expect, it } from 'vitest';
import { shouldOpenRow } from './rowOpen';

/** closest が返す要素を決めた偽の要素（DOM を使わない） */
const el = (hit: object | null) => ({ closest: () => hit }) as unknown as Element;
const rowWith = (...inside: object[]) =>
  ({ contains: (x: unknown) => inside.includes(x as object) }) as unknown as Element;

describe('shouldOpenRow', () => {
  it('ふつうの文字を押したら開く', () => {
    const t = el(null);
    expect(shouldOpenRow({ target: t, row: rowWith(t), selection: '', detail: 1 })).toBe(true);
  });
  it('行の中のボタン・リンクを押したら開かない', () => {
    const btn = {};
    const t = el(btn);
    expect(shouldOpenRow({ target: t, row: rowWith(t, btn), selection: '', detail: 1 })).toBe(false);
  });
  it('文字を選んでいるときは開かない', () => {
    const t = el(null);
    expect(shouldOpenRow({ target: t, row: rowWith(t), selection: '山田', detail: 1 })).toBe(false);
  });
  it('二度押し・三度押し（文字を選ぶ押し方）は開かない', () => {
    const t = el(null);
    expect(shouldOpenRow({ target: t, row: rowWith(t), selection: '', detail: 2 })).toBe(false);
    expect(shouldOpenRow({ target: t, row: rowWith(t), selection: '', detail: 3 })).toBe(false);
  });
  it('行を包む外の部品は数えない', () => {
    const t = el({});
    expect(shouldOpenRow({ target: t, row: rowWith(t), selection: '', detail: 1 })).toBe(true);
  });
  it('押した要素が行の中に無い（portal の吹き出しなど）・無ければ開かない', () => {
    expect(shouldOpenRow({ target: el(null), row: rowWith(), selection: '', detail: 1 })).toBe(false);
    expect(shouldOpenRow({ target: null, row: rowWith(), selection: '', detail: 1 })).toBe(false);
  });
});
