// 動きを減らす設定：巻き方の切り替えと、matchMedia が無い・失敗するとき
import { describe, expect, it } from 'vitest';
import { prefersReducedMotion, REDUCED_MOTION_QUERY, scrollBehavior } from './motion';

const media = (reduce: boolean) => (query: string) => ({ matches: reduce && query === REDUCED_MOTION_QUERY });

describe('prefersReducedMotion', () => {
  it('設定があれば true、無ければ false', () => {
    expect(prefersReducedMotion(media(true))).toBe(true);
    expect(prefersReducedMotion(media(false))).toBe(false);
  });
  it('matchMedia が無い・例外を投げるときは false', () => {
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(
      prefersReducedMotion(() => {
        throw new Error('使えない');
      }),
    ).toBe(false);
  });
});

describe('scrollBehavior', () => {
  it('動きを減らす設定ではすぐ移る（auto）、ほかはなめらか（smooth）', () => {
    expect(scrollBehavior(media(true))).toBe('auto');
    expect(scrollBehavior(media(false))).toBe('smooth');
    expect(scrollBehavior(undefined)).toBe('smooth');
  });
  it('引数なしでも動く（テストの環境には matchMedia が無いので smooth）', () => {
    expect(scrollBehavior()).toBe('smooth');
  });
});
