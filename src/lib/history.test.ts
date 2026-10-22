import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { createHistory, HISTORY_MAX, historyKey, historyKeysOn, isTextTarget } from './history';

/** 中身は見ないので、参照だけ違うデータ */
const mk = (n: number) => ({ n }) as unknown as DemoData;
const flush = () => new Promise((r) => queueMicrotask(() => r(null)));

describe('createHistory（全体の元に戻す。PRD D329。ADR-0054）', () => {
  it('積んで戻す・やり直す。戻したあとに積むとやり直しは消える', async () => {
    const h = createHistory();
    const [a, b, c, d] = [mk(0), mk(1), mk(2), mk(3)];
    h.record(a, b, '担当を替える');
    h.record(b, c, '訪問を取り消す');
    await flush();
    expect(h.state.get()).toMatchObject({ undo: '訪問を取り消す', redo: null, undoCount: 2 });
    expect(h.undo(c)).toEqual({ data: b, label: '訪問を取り消す' });
    expect(h.undo(b)).toEqual({ data: a, label: '担当を替える' });
    expect(h.undo(a)).toBeNull();
    await flush();
    expect(h.state.get()).toMatchObject({ undo: null, redo: '担当を替える', redoCount: 2 });
    expect(h.redo(a)).toEqual({ data: b, label: '担当を替える' });
    h.record(b, d, '確定');
    expect(h.redo(d)).toBeNull();
    await flush();
    expect(h.state.get()).toMatchObject({ undo: '確定', redo: null, undoCount: 2 });
  });
  it('同じなら積まない。名前が無ければ「変更」', async () => {
    const h = createHistory();
    const a = mk(0);
    h.record(a, a, 'x');
    h.record(a, mk(1));
    await flush();
    expect(h.state.get()).toMatchObject({ undo: '変更', undoCount: 1 });
  });
  it('同じ update の印（StrictMode で2回呼ばれた）は前の手を置き換える', async () => {
    const h = createHistory();
    const a = mk(0);
    const t = {};
    h.record(a, mk(1), 'x', t);
    const b2 = mk(2);
    h.record(a, b2, 'x', t);
    await flush();
    expect(h.state.get().undoCount).toBe(1);
    expect(h.undo(b2)!.data).toBe(a);
  });
  it('同じ印の手は前の手が別の手のあとでも置き換え、2つ積まない。peek は直前の手', () => {
    const h = createHistory();
    const [a, b, c, c2] = [mk(0), mk(1), mk(2), mk(3)];
    const t = {};
    h.record(a, b, '一', t);
    h.record(b, c, '二');
    // 同じ印の関数が別の前のデータでもう一度呼ばれた（描き直し）
    h.record(a, c2, '一', t);
    expect(h.peek()?.label).toBe('二');
    expect(h.undo(c)!.label).toBe('二');
    expect(h.undo(b)!.label).toBe('一');
    expect(h.undo(a)).toBeNull();
    expect(h.peek()).toBeNull();
  });
  it(`最大 ${HISTORY_MAX}手。clear で空`, async () => {
    const h = createHistory();
    let cur = mk(0);
    for (let i = 1; i <= HISTORY_MAX + 5; i++) {
      const next = mk(i);
      h.record(cur, next, `手${i}`);
      cur = next;
    }
    await flush();
    expect(h.state.get().undoCount).toBe(HISTORY_MAX);
    h.clear();
    await flush();
    expect(h.state.get()).toEqual({ undo: null, redo: null, undoCount: 0, redoCount: 0 });
  });
});

describe('historyKey・isTextTarget', () => {
  it('〈スタッフ〉のスマホ画面・月の予定の印刷では効かせない', () => {
    expect(historyKeysOn('/plan')).toBe(true);
    expect(historyKeysOn('/month')).toBe(true);
    expect(historyKeysOn('/staff-view/s1')).toBe(false);
    expect(historyKeysOn('/month/print')).toBe(false);
  });
  const k = (x: Partial<KeyboardEvent>) => ({
    key: 'z',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...x,
  });
  it('Ctrl+Z・Ctrl+Shift+Z・Ctrl+Y（mac は ⌘）', () => {
    expect(historyKey(k({ ctrlKey: true }), false)).toBe('undo');
    expect(historyKey(k({ ctrlKey: true, shiftKey: true, key: 'Z' }), false)).toBe('redo');
    expect(historyKey(k({ ctrlKey: true, key: 'y' }), false)).toBe('redo');
    expect(historyKey(k({ metaKey: true }), true)).toBe('undo');
    expect(historyKey(k({ ctrlKey: true }), true)).toBeNull();
    expect(historyKey(k({}), false)).toBeNull();
    expect(historyKey(k({ ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(historyKey(k({ ctrlKey: true, key: 'x' }), false)).toBeNull();
  });
  it('入力欄・テキストエリア・選ぶ欄の中では奪わない（チェック・ボタンは奪う）', () => {
    const el = (tagName: string, type?: string) =>
      ({ tagName, type, isContentEditable: false, closest: () => null }) as unknown as EventTarget;
    expect(isTextTarget(el('INPUT', 'text'))).toBe(true);
    expect(isTextTarget(el('INPUT', 'time'))).toBe(true);
    expect(isTextTarget(el('TEXTAREA'))).toBe(true);
    expect(isTextTarget(el('SELECT'))).toBe(true);
    expect(isTextTarget(el('INPUT', 'checkbox'))).toBe(false);
    expect(isTextTarget(el('BUTTON'))).toBe(false);
    expect(isTextTarget(null)).toBe(false);
  });
});
