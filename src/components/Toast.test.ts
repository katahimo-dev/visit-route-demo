import { describe, expect, it } from 'vitest';
import { toastMs } from './Toast';

describe('toastMs（PRD D268）', () => {
  it('文だけは短く、ボタン付きは6秒から長い文ほど長く、10秒で止める', () => {
    expect(toastMs('コピーしました', false)).toBe(2500);
    expect(toastMs('山田さんへ移しました', true)).toBe(6000);
    expect(toastMs('あ'.repeat(60), true)).toBe(7200);
    expect(toastMs('あ'.repeat(200), true)).toBe(10000);
  });
});
