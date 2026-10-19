import { describe, expect, it } from 'vitest';
import { shouldAutoOpenTour, TOUR_TODAY_LABEL, tourCountText, tourMove, tourNextLabel, tourSteps } from './tour';

const terms = { staff: 'スタッフ', client: '利用者さん' };

describe('tourSteps', () => {
  it('6枚：ホーム → 予定 → 欠勤・キャンセル → 条件 → 探す → 3段（PRD D226）', () => {
    const s = tourSteps(terms, false);
    expect(s.map((x) => x.key)).toEqual(['home', 'plan', 'absence', 'rules', 'search', 'flow']);
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
    expect(s[5]!.points!.join('')).toContain('ヘルパーの画面');
    // 呼び方を直書きしない
    expect(JSON.stringify(s)).not.toContain('利用者さん');
    expect(JSON.stringify(tourSteps(terms, false))).not.toContain('ヘルパー');
  });
  it('最後の枚は3段（AI案 → 手直し（固定）→ 確定）を順に並べる', () => {
    const last = tourSteps(terms, false).at(-1)!;
    expect(last.key).toBe('flow');
    expect(last.title).toContain('AI案 → 手直し → 確定');
    expect(last.points).toHaveLength(3);
    expect(last.points![0]).toMatch(/^AI案：/);
    expect(last.points![1]).toMatch(/^手直し（固定）：/);
    expect(last.points![2]).toMatch(/^確定：/);
    expect(last.body).toContain('今日の予定を開いて');
  });
  it('場所の文はメニューの名前（予定・当日・問い合わせ・AI の条件。ADR-0034）', () => {
    const s = tourSteps(terms, false);
    expect(s[0]!.title).toContain('今日やること');
    expect(s[1]!.where).toBe('メニューの「予定」（月の予定・週の予定・日の予定・案を比べる）');
    expect(s[2]!.where).toBe('メニューの「当日・問い合わせ」の「欠勤・キャンセルを登録」');
    expect(s[3]!.where).toBe('メニューの「AI の条件」（条件の重み・相性）');
    expect(tourSteps(terms, false, { compat: false })[3]!.where).toBe('メニューの「AI の条件」（条件の重み）');
    expect(s[3]!.body).toMatch(/^条件の重み・相性を変えると/);
    // 相性を切っていれば本文にも出さない
    expect(tourSteps(terms, false, { compat: false })[3]!.body).toMatch(/^条件の重みを変えると/);
    expect(tourSteps(terms, false, { compat: false })[3]!.body).not.toContain('相性');
    expect(s[5]!.where).toContain('「日の予定」');
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
    expect(tourNextLabel(0, 6)).toBe('次へ');
    expect(tourNextLabel(5, 6)).toBe('閉じる');
    expect(TOUR_TODAY_LABEL).toBe('今日の予定を開く');
    expect(tourCountText(1, 6)).toBe('2 / 6');
  });
});

describe('shouldAutoOpenTour', () => {
  it('まだ見ていないときだけ', () => {
    expect(shouldAutoOpenTour(false, '')).toBe(true);
    expect(shouldAutoOpenTour(true, '')).toBe(false);
    expect(shouldAutoOpenTour(false, '?ym=2026-10&layout=list')).toBe(true);
  });
  it('?id=・?do= のリンクで開いたときは開かない', () => {
    expect(shouldAutoOpenTour(false, '?id=c1')).toBe(false);
    expect(shouldAutoOpenTour(false, '?date=2026-10-21&do=absence')).toBe(false);
    expect(shouldAutoOpenTour(false, '?do=batch')).toBe(false);
    expect(shouldAutoOpenTour(true, '?id=c1')).toBe(false);
  });
});
