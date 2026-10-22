import { describe, expect, it } from 'vitest';
import { cleanTraits, isDirty, orDash } from './viewMode';

describe('isDirty', () => {
  const saved = { id: 'a', name: '山田', tags: ['x'] };
  it('欄が無ければ変更なし', () => {
    expect(isDirty(null, saved)).toBe(false);
    expect(isDirty(null, undefined)).toBe(false);
  });
  it('比べる元が無いとき（保存した人が消えた）は変更あり', () => {
    expect(isDirty(structuredClone(saved), undefined)).toBe(true);
  });
  it('元と同じなら変更なし、違えば変更あり', () => {
    expect(isDirty(structuredClone(saved), saved)).toBe(false);
    expect(isDirty({ ...saved, name: '山田 花子' }, saved)).toBe(true);
    expect(isDirty({ ...saved, tags: [] }, saved)).toBe(true);
  });
  it('新しい人は開いたときの空の欄と比べる（何も入れていなければ変更なし）', () => {
    const blank = { id: 'n', name: '', tags: [] as string[] };
    expect(isDirty(structuredClone(blank), blank)).toBe(false);
    expect(isDirty({ ...blank, name: '新' }, blank)).toBe(true);
  });
  it('特性を選んでから未入力に戻しても変更なし（null・空の文字・空の配列は無いのと同じ）', () => {
    const base = { id: 'a', traits: { t1: true } as Record<string, unknown> };
    expect(isDirty({ id: 'a', traits: { t1: true, t2: null } }, base)).toBe(false);
    expect(isDirty({ id: 'a', traits: { t1: true, t3: '', t4: [] } }, base)).toBe(false);
    expect(isDirty({ id: 'a', traits: { t1: false } }, base)).toBe(true);
    expect(isDirty({ id: 'a', traits: { t1: true, t2: 0 } }, base)).toBe(true);
    // 元のほうに未入力が残っていても同じ
    expect(isDirty({ id: 'a', traits: {} }, { id: 'a', traits: { t2: null } })).toBe(false);
  });
  it('欄の外の入力が変わっていれば変更あり', () => {
    expect(isDirty(structuredClone(saved), saved, true)).toBe(true);
  });
});

describe('cleanTraits', () => {
  it('null・空の文字・空の配列のキーを消し、ほかは残す', () => {
    expect(cleanTraits({ a: null, b: '', c: [], d: false, e: 0, f: ['x'], g: 'y', h: true })).toEqual({
      d: false,
      e: 0,
      f: ['x'],
      g: 'y',
      h: true,
    });
  });
});

describe('orDash', () => {
  it('空・空白だけ・null・undefined は「—」、ほかは前後の空白を取る', () => {
    expect(orDash('')).toBe('—');
    expect(orDash('  ')).toBe('—');
    expect(orDash(null)).toBe('—');
    expect(orDash(undefined)).toBe('—');
    expect(orDash(' 鍵はポスト ')).toBe('鍵はポスト');
  });
});
