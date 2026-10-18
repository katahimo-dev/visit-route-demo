import { describe, expect, it } from 'vitest';
import { shouldAutoOpenTour, tourCountText, tourMove, tourNextLabel, tourSteps } from './tour';

const terms = { staff: 'スタッフ', client: '利用者さん' };

describe('tourSteps', () => {
  it('5枚：ホーム → 予定 → 欠勤・キャンセル → 条件 → 探す', () => {
    const s = tourSteps(terms, false);
    expect(s.map((x) => x.key)).toEqual(['home', 'plan', 'absence', 'rules', 'search']);
    for (const x of s) {
      expect(x.title).not.toBe('');
      expect(x.body).not.toBe('');
      expect(x.where).not.toBe('');
    }
  });
  it('呼び方とキーの印を入れる', () => {
    const s = tourSteps({ staff: 'ヘルパー', client: 'お客様' }, false);
    expect(s[2]!.body).toContain('ヘルパーの急な欠勤');
    expect(s[2]!.body).toContain('お客様の当日キャンセル');
    expect(s[4]!.title).toBe('Ctrl+K で探せます');
    expect(tourSteps(terms, true)[4]!.title).toBe('⌘K で探せます');
    // 呼び方を直書きしない
    expect(JSON.stringify(s)).not.toContain('利用者さん');
  });
});

describe('tourMove', () => {
  it('次へ・戻る・とばす', () => {
    expect(tourMove(0, 5, 'next')).toBe(1);
    expect(tourMove(3, 5, 'next')).toBe(4);
    expect(tourMove(2, 5, 'back')).toBe(1);
    expect(tourMove(2, 5, 'skip')).toBeNull();
  });
  it('最初の「戻る」は動かず、最後の「次へ」は閉じる', () => {
    expect(tourMove(0, 5, 'back')).toBe(0);
    expect(tourMove(4, 5, 'next')).toBeNull();
  });
  it('範囲の外・0枚', () => {
    expect(tourMove(9, 5, 'back')).toBe(3);
    expect(tourMove(-1, 5, 'next')).toBe(1);
    expect(tourMove(0, 0, 'next')).toBeNull();
  });
  it('ボタンの文と何枚目か', () => {
    expect(tourNextLabel(0, 5)).toBe('次へ');
    expect(tourNextLabel(4, 5)).toBe('はじめる');
    expect(tourCountText(1, 5)).toBe('2 / 5');
  });
});

describe('shouldAutoOpenTour', () => {
  it('まだ見ていない・自動操作でないときだけ', () => {
    expect(shouldAutoOpenTour(false, false)).toBe(true);
    expect(shouldAutoOpenTour(true, false)).toBe(false);
    expect(shouldAutoOpenTour(false, true)).toBe(false);
    expect(shouldAutoOpenTour(true, true)).toBe(false);
  });
});
