import { describe, expect, it } from 'vitest';
import type { ClientLeave } from '../contracts/documents';
import { discardMessage, isDirty, orDash, splitLeaves } from './viewMode';

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
  it('欄の外の入力が変わっていれば変更あり', () => {
    expect(isDirty(structuredClone(saved), saved, true)).toBe(true);
  });
});

describe('discardMessage', () => {
  it('場面ごとの文（呼び方と名前を入れる）', () => {
    expect(discardMessage('view', 'スタッフ', '山田')).toBe(
      '山田（スタッフ）の変更を保存していません。変更を捨てて、閲覧に戻りますか？',
    );
    expect(discardMessage('close', '利用者さん', '鈴木')).toContain('欄を閉じますか？');
    expect(discardMessage('switch', '利用者さん', '鈴木', '佐藤')).toBe(
      '鈴木（利用者さん）の変更を保存していません。変更を捨てて、佐藤を開きますか？',
    );
  });
  it('名前が空なら「（名前なし）」', () => {
    expect(discardMessage('close', 'スタッフ', '  ')).toMatch(/^（名前なし）（スタッフ）/);
    expect(discardMessage('switch', 'スタッフ', '山田', '')).toContain('（名前なし）を開きますか？');
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
