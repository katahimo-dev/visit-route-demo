import { describe, expect, it } from 'vitest';
import { addDays } from '../domain/time';
import { findVisit, visitsOn } from '../patterns';
import { createDemoData } from '../seed';
import { keyMove, movedText, moveLabel, neighborStaff, visitKeyOf } from './visitKeys';

const TODAY = '2026-10-21';
const data = createDemoData(TODAY);
/** 今日の繰り返しの回（取り消していない） */
const rep = visitsOn(data, TODAY).find((v) => !v.cancelled && !!v.pattern)!;
const key = (k: string, shift = false) => ({ key: k, shiftKey: shift, ctrlKey: false, metaKey: false, altKey: false });

describe('キーの読み替え（PRD D333）', () => {
  it('↑↓ は15分・←→ は1日・Shift+←→ は隣の担当・Enter は欄・Delete は取り消し', () => {
    expect(visitKeyOf(key('ArrowUp'))).toEqual({ kind: 'time', minutes: -15 });
    expect(visitKeyOf(key('ArrowDown'))).toEqual({ kind: 'time', minutes: 15 });
    expect(visitKeyOf(key('ArrowLeft'))).toEqual({ kind: 'day', days: -1 });
    expect(visitKeyOf(key('ArrowRight'))).toEqual({ kind: 'day', days: 1 });
    expect(visitKeyOf(key('ArrowLeft', true))).toEqual({ kind: 'staff', step: -1 });
    expect(visitKeyOf(key('ArrowRight', true))).toEqual({ kind: 'staff', step: 1 });
    expect(visitKeyOf(key('Enter'))).toEqual({ kind: 'open' });
    expect(visitKeyOf(key('Delete'))).toEqual({ kind: 'cancel' });
    expect(visitKeyOf(key('Backspace'))).toEqual({ kind: 'cancel' });
  });
  it('Shift+Enter（複数選択）・Shift+↑↓・Ctrl つき・ほかのキーは読まない', () => {
    expect(visitKeyOf(key('Enter', true))).toBeNull();
    expect(visitKeyOf(key('ArrowUp', true))).toBeNull();
    expect(visitKeyOf({ ...key('ArrowUp'), ctrlKey: true })).toBeNull();
    expect(visitKeyOf({ ...key('z'), ctrlKey: true })).toBeNull();
    expect(visitKeyOf(key(' '))).toBeNull();
  });
  it('隣の担当：端で止まる・担当なしから → は先頭', () => {
    expect(neighborStaff(['a', 'b', 'c'], 'b', 1)).toBe('c');
    expect(neighborStaff(['a', 'b', 'c'], 'b', -1)).toBe('a');
    expect(neighborStaff(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(neighborStaff(['a', 'b', 'c'], null, 1)).toBe('a');
    expect(neighborStaff(['a', 'b', 'c'], null, -1)).toBeNull();
    expect(neighborStaff([], 'a', 1)).toBeNull();
  });
});

describe('キーで動かす（PRD D333）', () => {
  it('↓ で15分後（この回だけ。幅・担当はそのまま）', () => {
    const r = keyMove(data, rep.id, { kind: 'time', minutes: 15 }, TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const after = findVisit(r.data, r.visitId)!;
    expect(m(after.earliestStart) - m(rep.earliestStart)).toBe(15);
    expect(m(after.latestStart) - m(rep.latestStart)).toBe(15);
    expect(after.pattern?.edited).toBe(true);
    expect(r.repeating).toBe(true);
    // 次の週の同じ回は変わらない
    const next = visitsOn(r.data, addDays(TODAY, 7)).find((v) => v.pattern?.id === rep.pattern!.id);
    if (next) expect(next.earliestStart).toBe(rep.earliestStart);
  });
  it('→ で次の日（この回だけ）。今日より前へはできない', () => {
    const r = keyMove(data, rep.id, { kind: 'day', days: 1 }, TODAY);
    expect(r.ok && r.date).toBe(addDays(TODAY, 1));
    const back = keyMove(data, rep.id, { kind: 'day', days: -1 }, TODAY);
    expect(back.ok).toBe(false);
  });
  it('これ以降：同じ曜日の次の週の回も動く', () => {
    const r = keyMove(data, rep.id, { kind: 'time', minutes: 15 }, TODAY, 'following', {
      visit: 'v-new',
      patterns: ['pt-a', 'pt-b'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const next = visitsOn(r.data, addDays(TODAY, 7)).find(
      (v) => v.clientId === rep.clientId && !v.cancelled && v.pattern?.id !== rep.pattern!.id,
    );
    expect(next).toBeTruthy();
    const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    expect(m(next!.earliestStart) - m(rep.earliestStart)).toBe(15);
  });
  it('担当を替える（ピン）。取り消した訪問は動かせない', () => {
    const other = data.staff.find((s) => s.active && s.id !== rep.staffId)!;
    const r = keyMove(data, rep.id, { kind: 'staff', staffId: other.id }, TODAY);
    if (r.ok) {
      const v = findVisit(r.data, r.visitId)!;
      expect(v.staffId).toBe(other.id);
      expect(v.pinned).toBe(true);
    } else expect(r.why).not.toBe('');
    const cancelled = { ...data, visits: data.visits.map((v) => (v.id === rep.id ? { ...v, cancelled: true } : v)) };
    const saved = findVisit(cancelled, rep.id);
    if (saved?.cancelled) expect(keyMove(cancelled, rep.id, { kind: 'time', minutes: 15 }, TODAY).ok).toBe(false);
  });
  it('日をまたぐ時刻にはしない', () => {
    const late = { ...rep, earliestStart: '23:50', latestStart: '23:50', durationMinutes: 5 };
    const d = {
      ...data,
      visits: [...data.visits.filter((v) => v.id !== rep.id), { ...late, pattern: null, id: 'late' }],
    };
    const r = keyMove(d, 'late', { kind: 'time', minutes: 15 }, TODAY);
    expect(r.ok).toBe(false);
  });
  it('手の名前と読み上げの文', () => {
    const name = () => '消防 まもる';
    expect(moveLabel({ kind: 'time', minutes: 15 }, name)).toBe('訪問を15分後へ');
    expect(moveLabel({ kind: 'time', minutes: -15 }, name)).toBe('訪問を15分前へ');
    expect(moveLabel({ kind: 'day', days: 1 }, name)).toBe('訪問を次の日へ');
    expect(moveLabel({ kind: 'staff', staffId: 'x' }, name)).toBe('担当を消防 まもるさんへ');
    expect(
      movedText(
        { date: '2026-10-28', start: '09:15', staffId: 'x', repeating: true },
        '図書館 ふみ',
        name,
        'following',
      ),
    ).toBe('図書館 ふみさん：10/28（水） 09:15・担当 消防 まもるさん（これ以降）');
    expect(movedText({ date: '2026-10-28', start: '09:15', staffId: null, repeating: false }, 'A', name)).toBe(
      'Aさん：10/28（水） 09:15・担当なし',
    );
  });
});
