// 郵便番号の入力と表示（PRD D86・D118。ADR-0016）
import { describe, expect, it } from 'vitest';
import { formatPostalCode, normalizePostalCode } from './postalCode';

describe('normalizePostalCode', () => {
  it('いろいろなハイフン・全角の数字・「〒」・空白を受けて7桁に', () => {
    expect(normalizePostalCode('980-0811')).toBe('9800811');
    expect(normalizePostalCode('９８０－０８１１')).toBe('9800811'); // 全角のハイフン
    expect(normalizePostalCode('980‐0811')).toBe('9800811'); // U+2010
    expect(normalizePostalCode('980ｰ0811')).toBe('9800811'); // 半角の長音
    expect(normalizePostalCode('980ー0811')).toBe('9800811'); // 全角の長音
    expect(normalizePostalCode('980−0811')).toBe('9800811'); // 負の記号
    expect(normalizePostalCode('〒980　0811')).toBe('9800811'); // 全角の空白
    expect(normalizePostalCode('  980 - 0811  ')).toBe('9800811'); // 空白の多い貼り付け
    expect(normalizePostalCode('\t9800811\n')).toBe('9800811');
  });
  it('空は空、7桁にできなければ null', () => {
    expect(normalizePostalCode('')).toBe('');
    expect(normalizePostalCode('　')).toBe('');
    expect(normalizePostalCode('980-081')).toBeNull();
    expect(normalizePostalCode('980-08111')).toBeNull();
    expect(normalizePostalCode('980/0811')).toBeNull();
    expect(normalizePostalCode('〒')).toBe('');
  });
});

describe('formatPostalCode', () => {
  it('7桁なら 123-4567、ほかはそのまま', () => {
    expect(formatPostalCode('9800811')).toBe('980-0811');
    expect(formatPostalCode('98008')).toBe('98008');
    expect(formatPostalCode('')).toBe('');
  });
});
