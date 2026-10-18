import { describe, expect, it } from 'vitest';
import type { ClientLeave } from '../contracts/documents';
import { cleanTraits, discardDialog, isDirty, orDash, splitLeaves } from './viewMode';

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

describe('discardDialog', () => {
  it('場面ごとの問い・本文・ボタン（呼び方と名前を入れる。危険の色・取り消しは「編集を続ける」）', () => {
    expect(discardDialog('view', 'スタッフ', '山田')).toEqual({
      title: '変更を捨てて、閲覧に戻りますか？',
      body: '山田（スタッフ）の変更を保存していません。',
      confirmLabel: '捨てて閲覧に戻る',
      cancelLabel: '編集を続ける',
      tone: 'danger',
    });
    expect(discardDialog('close', '利用者さん', '鈴木').title).toBe('変更を捨てて、欄を閉じますか？');
    const sw = discardDialog('switch', '利用者さん', '鈴木', '佐藤');
    expect([sw.title, sw.body, sw.confirmLabel]).toEqual([
      '変更を捨てて、佐藤を開きますか？',
      '鈴木（利用者さん）の変更を保存していません。',
      '捨てて佐藤を開く',
    ]);
  });
  it('名前が空なら「（名前なし）」', () => {
    expect(discardDialog('close', 'スタッフ', '  ').body).toMatch(/^（名前なし）（スタッフ）/);
    expect(discardDialog('switch', 'スタッフ', '山田', '').title).toContain('（名前なし）を開きますか？');
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

describe('splitLeaves', () => {
  const l = (id: string, from: string, to: string): ClientLeave => ({ id, clientId: 'c1', from, to, note: '' });
  it('今日を含むこれからの休みを開始日の順に、終わった休みは件数だけ', () => {
    const r = splitLeaves(
      [l('b', '2026-11-10', '2026-11-12'), l('p', '2026-10-01', '2026-10-17'), l('a', '2026-10-15', '2026-10-18')],
      '2026-10-18',
    );
    expect(r.ahead.map((x) => x.id)).toEqual(['a', 'b']);
    expect(r.past).toBe(1);
  });
  it('休みが無ければ空', () => {
    expect(splitLeaves([], '2026-10-18')).toEqual({ ahead: [], past: 0 });
  });
});
