// 横に巻く表の端（PRD D221・D222）
import { describe, expect, it } from 'vitest';
import { moreRight, scrollLeftToShow } from './scrollEdge';

describe('moreRight', () => {
  it('巻ける幅があり左端なら続きがある', () => {
    expect(moreRight({ scrollLeft: 0, clientWidth: 300, scrollWidth: 900 })).toBe(true);
  });
  it('右の端まで巻いたら無い（丸めの 1〜2px は端とみなす）', () => {
    expect(moreRight({ scrollLeft: 600, clientWidth: 300, scrollWidth: 900 })).toBe(false);
    expect(moreRight({ scrollLeft: 598.5, clientWidth: 300, scrollWidth: 900 })).toBe(false);
    expect(moreRight({ scrollLeft: 590, clientWidth: 300, scrollWidth: 900 })).toBe(true);
  });
  it('入りきる表には無い', () => {
    expect(moreRight({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 })).toBe(false);
    expect(moreRight({ scrollLeft: 0, clientWidth: 300, scrollWidth: 301 })).toBe(false);
  });
});

describe('scrollLeftToShow', () => {
  const box = { scrollLeft: 0, clientWidth: 300, scrollWidth: 1000 };
  it('列を止めた列のすぐ右（間 4px）に寄せる', () => {
    // 列は左端から 400px、止めた列の右端は 80px → 400−80−4
    expect(scrollLeftToShow(box, 400, 80)).toBe(316);
  });
  it('今の巻き位置からの差で決める', () => {
    expect(scrollLeftToShow({ ...box, scrollLeft: 100 }, 300, 80)).toBe(316);
  });
  it('巻ける範囲に収める（左へは0、右へは端まで）', () => {
    expect(scrollLeftToShow(box, 50, 80)).toBe(0);
    expect(scrollLeftToShow(box, 2000, 80)).toBe(700);
    expect(scrollLeftToShow({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 }, 200, 0)).toBe(0);
  });
});
