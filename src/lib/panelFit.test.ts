import { describe, expect, it } from 'vitest';
import { KEYBOARD_MIN_PX, panelFit } from './panelFit';

describe('panelFit', () => {
  it('キーボードが無い（見えている高さ＝画面の高さ）ときは合わせない', () => {
    expect(panelFit({ innerHeight: 844, height: 844, offsetTop: 0, scale: 1 })).toBeNull();
  });
  it('アドレスバーの出入りくらいの小さな差では合わせない', () => {
    expect(panelFit({ innerHeight: 844, height: 844 - KEYBOARD_MIN_PX + 1, offsetTop: 0, scale: 1 })).toBeNull();
  });
  it('キーボードで縮んだら、見えている所の高さに合わせる', () => {
    expect(panelFit({ innerHeight: 844, height: 500, offsetTop: 0, scale: 1 })).toEqual({ top: 0, height: 500 });
  });
  it('見えている所が下へずれたら（iOS）、上端もそこへ', () => {
    expect(panelFit({ innerHeight: 844, height: 500, offsetTop: 120.4, scale: 1 })).toEqual({ top: 120, height: 500 });
  });
  it('指で拡大しているときは合わせない（欄を潰さない）', () => {
    expect(panelFit({ innerHeight: 844, height: 422, offsetTop: 100, scale: 2 })).toBeNull();
  });
  it('読めない値では合わせない', () => {
    expect(panelFit({ innerHeight: 0, height: 0, offsetTop: 0, scale: 1 })).toBeNull();
    expect(panelFit({ innerHeight: 844, height: Number.NaN, offsetTop: 0, scale: 1 })).toBeNull();
  });
});
