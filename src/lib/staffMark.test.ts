import { describe, expect, it } from 'vitest';
import { graphemeCount, staffSchema } from '../contracts/documents';
import { staff } from '../matching/fixtures';
import { STAFF_COLORS } from './common';
import { staffColorMap, staffIconError, staffMarkText, surnameInitial } from './staffMark';

describe('〈スタッフ〉の印の文字（PRD D299。ADR-0050）', () => {
  it('既定は苗字（空白で区切った先頭の語）の最初の1文字。全角の空白・前後の空白も区切りとして扱う', () => {
    expect(surnameInitial('市役所 まち子')).toBe('市');
    expect(surnameInitial('  長町　小太郎')).toBe('長');
    expect(surnameInitial('ひかる')).toBe('ひ');
    expect(surnameInitial('')).toBe('?');
    // サロゲートペアの漢字・絵文字も1文字で切る
    expect(surnameInitial('𠮷田 花')).toBe('𠮷');
  });

  it('アイコンがあればそれ、空・空白だけなら苗字の最初の1文字', () => {
    expect(staffMarkText({ name: '市役所 まち子', icon: '訪' })).toBe('訪');
    expect(staffMarkText({ name: '市役所 まち子', icon: '' })).toBe('市');
    expect(staffMarkText({ name: '市役所 まち子', icon: '  ' })).toBe('市');
    expect(staffMarkText({ name: '市役所 まち子' })).toBe('市');
  });

  it('アイコンは見た目で2文字まで（結合した絵文字も1文字）。超えれば誤り', () => {
    expect(graphemeCount('👨‍👩‍👧')).toBe(1);
    expect(staffIconError('')).toBeNull();
    expect(staffIconError('訪')).toBeNull();
    expect(staffIconError('AB')).toBeNull();
    expect(staffIconError('🌸👨‍👩‍👧')).toBeNull();
    expect(staffIconError(' 訪 ')).toBeNull();
    expect(staffIconError('訪問者')).toContain('2文字');
    expect(staffIconError('a'.repeat(33))).toContain('2文字');
  });
});

describe('〈スタッフ〉の色（staffColorMap）', () => {
  it('全員（休止中も）を名前の順に並べた位置で決まり、データの並びに依らない', () => {
    const a = staff('a', 0, 0, { name: 'あ' });
    const b = staff('b', 0, 0, { name: 'い', active: false });
    const c = staff('c', 0, 0, { name: 'う' });
    const m = staffColorMap([c, a, b]);
    expect(m.get('a')).toBe(STAFF_COLORS[0]);
    expect(m.get('b')).toBe(STAFF_COLORS[1]);
    expect(m.get('c')).toBe(STAFF_COLORS[2]);
    // 同じ配列なら同じ Map を返す（作り直さない）
    const list = [a, b];
    expect(staffColorMap(list)).toBe(staffColorMap(list));
  });
});

describe('〈スタッフ〉の icon の読み込み（schema）', () => {
  const raw = (over: Record<string, unknown> = {}) => {
    const { icon: _drop, ...rest } = staff('s1', 0, 0);
    return { ...rest, ...over };
  };
  it("icon の無い古いデータは未設定（''）で読める", () => {
    expect(staffSchema.parse(raw()).icon).toBe('');
  });
  it('読み込みは形だけ見る：32コード単位までは読め（2文字の検査は画面と Excel）、前後の空白・33コード単位以上は読めない', () => {
    expect(staffSchema.parse(raw({ icon: '訪' })).icon).toBe('訪');
    expect(staffSchema.parse(raw({ icon: '🌸' })).icon).toBe('🌸');
    expect(staffSchema.parse(raw({ icon: '訪問者' })).icon).toBe('訪問者');
    expect(staffSchema.safeParse(raw({ icon: ' 訪' })).success).toBe(false);
    expect(staffSchema.safeParse(raw({ icon: 'あ'.repeat(33) })).success).toBe(false);
  });
});
