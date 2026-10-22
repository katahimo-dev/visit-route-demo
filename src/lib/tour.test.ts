import { describe, expect, it } from 'vitest';
import {
  shouldAutoOpenTour,
  TOUR_START_CHOICES,
  TOUR_START_NOTE,
  TOUR_START_QUESTION,
  TOUR_TODAY_LABEL,
  tourCountText,
  tourMove,
  tourNextLabel,
  tourSteps,
} from './tour';

const terms = { staff: 'スタッフ', client: '利用者さん' };

describe('tourSteps（PRD D277）', () => {
  it('3枚：ホーム → 予定で作って確定 → 欠勤・キャンセル（条件の重み・探すの枚は無い）', () => {
    const s = tourSteps(terms);
    expect(s.map((x) => x.key)).toEqual(['home', 'plan', 'absence']);
    for (const x of s) {
      expect(x.title).not.toBe('');
      expect(x.body).not.toBe('');
      expect(x.where).not.toBe('');
    }
    expect(JSON.stringify(s)).not.toContain('Ctrl+K');
    expect(JSON.stringify(s)).not.toContain('条件の重み');
  });
  it('呼び方を入れる（直書きしない）', () => {
    const s = tourSteps({ staff: 'ヘルパー', client: 'お客様' });
    expect(s[2]!.body).toContain('ヘルパーの急な欠勤');
    expect(s[2]!.body).toContain('お客様の当日キャンセル');
    expect(s[1]!.points!.join('')).toContain('ヘルパーの画面');
    expect(JSON.stringify(s)).not.toContain('利用者さん');
    expect(JSON.stringify(tourSteps(terms))).not.toContain('ヘルパー');
  });
  it('予定の枚は3段（AI案 → 手直し（ピン）→ 確定）を順に並べ、［月｜週｜日］で切り替えると書く', () => {
    const plan = tourSteps(terms)[1]!;
    expect(plan.key).toBe('plan');
    expect(plan.title).toBe('予定で案を作って確定します');
    expect(plan.body).toContain('［月｜週｜日］');
    expect(plan.points).toHaveLength(3);
    expect(plan.points![0]).toMatch(/^AI案：/);
    expect(plan.points![1]).toMatch(/^手直し（ピン）：/);
    expect(plan.points![2]).toMatch(/^確定：/);
  });
  it('場所の文はメニュー・下のタブの名前（予定・欠勤。ADR-0045）', () => {
    const s = tourSteps(terms);
    expect(s[0]!.title).toContain('今日やること');
    expect(s[1]!.where).toBe('メニューの「予定」（スマホは下のタブの「予定」）');
    expect(s[2]!.where).toBe('メニューの「欠勤・キャンセルを登録」（スマホは下のタブの「欠勤」）');
  });
  it('欠勤・キャンセルを切ると2枚（PRD D213）', () => {
    expect(tourSteps(terms, { sudden: false }).map((x) => x.key)).toEqual(['home', 'plan']);
  });
});

describe('「どこまで使うか」の選択肢（PRD D276）', () => {
  it('基本 → すべての2つ。名前と説明', () => {
    expect(TOUR_START_CHOICES.map((c) => c.id)).toEqual(['basic', 'all']);
    expect(TOUR_START_CHOICES.map((c) => c.label)).toEqual(['基本', 'すべて']);
    for (const c of TOUR_START_CHOICES) expect(c.description).not.toBe('');
    expect(TOUR_START_QUESTION).toBe('どこまで使いますか');
    expect(TOUR_START_NOTE).toContain('管理者設定');
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
    expect(tourNextLabel(0, 3)).toBe('次へ');
    expect(tourNextLabel(2, 3)).toBe('閉じる');
    expect(TOUR_TODAY_LABEL).toBe('今日の予定を開く');
    expect(tourCountText(1, 3)).toBe('2 / 3');
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
    // 人の画面へのリンク（PRD D308）
    expect(shouldAutoOpenTour(false, '', '/clients/c1')).toBe(false);
    expect(shouldAutoOpenTour(false, '', '/clients')).toBe(true);
    expect(shouldAutoOpenTour(true, '?id=c1')).toBe(false);
  });
});
