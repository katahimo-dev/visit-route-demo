import { describe, expect, it } from 'vitest';
import { addDays } from '../domain/time';
import { findVisit, visitsOn } from '../patterns';
import { createDemoData } from '../seed';
import { cellKeyOf, issuesAt, keyMove, movedText, moveLabel, nextStaffFor, visitKeyOf } from './visitKeys';
import { draftOf, staffChoices, toldDaysChanged } from './visitOps';

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
  it('表（PRD D342）：↑↓ は隣の担当の行・←→ は1日（時刻はそのまま）。リストは時間軸と同じ', () => {
    expect(visitKeyOf(key('ArrowUp'), 'table')).toEqual({ kind: 'staff', step: -1 });
    expect(visitKeyOf(key('ArrowDown'), 'table')).toEqual({ kind: 'staff', step: 1 });
    expect(visitKeyOf(key('ArrowLeft'), 'table')).toEqual({ kind: 'day', days: -1 });
    expect(visitKeyOf(key('ArrowRight'), 'table')).toEqual({ kind: 'day', days: 1 });
    expect(visitKeyOf(key('Enter'), 'table')).toEqual({ kind: 'open' });
    expect(visitKeyOf(key('ArrowDown', true), 'table')).toBeNull();
    expect(visitKeyOf(key('ArrowDown'), 'list')).toEqual({ kind: 'time', minutes: 15 });
  });
  it('Shift+Enter（複数選択）・Shift+↑↓・Ctrl つき・ほかのキーは読まない', () => {
    expect(visitKeyOf(key('Enter', true))).toBeNull();
    expect(visitKeyOf(key('ArrowUp', true))).toBeNull();
    expect(visitKeyOf({ ...key('ArrowUp'), ctrlKey: true })).toBeNull();
    expect(visitKeyOf({ ...key('z'), ctrlKey: true })).toBeNull();
    expect(visitKeyOf(key(' '))).toBeNull();
  });
  it('隣の担当（Shift+←→）：その向きに順に見て、担当できる最初の人。担当できない人は飛ばし、いなければ理由', () => {
    const order = data.staff.filter((x) => x.active).map((x) => x.id);
    const c = staffChoices(data, rep.id, draftOf(rep));
    const ok = new Set(c.choices.filter((x) => !x.disabled && !x.current).map((x) => x.staffId));
    const r = nextStaffFor(data, rep.id, order, 1);
    const at = rep.staffId ? order.indexOf(rep.staffId) : -1;
    const want = order.slice(at + 1).find((id) => ok.has(id));
    if (want) expect(r).toEqual({ staffId: want });
    else expect('why' in r).toBe(true);
    // 間に担当できない人（並びに無い ID・休み）を挟んでも飛ばす
    if (want) {
      const withGap = [...order.slice(0, at + 1), 'nobody', ...order.slice(at + 1)];
      expect(nextStaffFor(data, rep.id, withGap, 1)).toEqual({ staffId: want });
    }
    // 担当できる人がいなければ理由
    expect(nextStaffFor(data, rep.id, [rep.staffId ?? 'x', 'nobody'], 1)).toMatchObject({
      why: expect.stringContaining('担当できる人がいません'),
    });
    expect(nextStaffFor(data, rep.id, [rep.staffId ?? 'x'], 1, 'row')).toMatchObject({
      why: expect.stringContaining('下に担当の行はありません'),
    });
    expect(nextStaffFor(data, rep.id, [rep.staffId ?? 'x'], 1)).toMatchObject({
      why: expect.stringContaining('担当の列はありません'),
    });
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
  it('これ以降で変わる確定（伝えた）した日を、計算した回でも見つける（範囲を選び直す帯・欄の確かめ）', () => {
    const next = addDays(TODAY, 7);
    const told = { ...data, snapshots: { ...data.snapshots, [next]: { at: 0, visits: [] } as never } };
    const once = keyMove(told, rep.id, { kind: 'time', minutes: 15 }, TODAY);
    const all = keyMove(told, rep.id, { kind: 'time', minutes: 15 }, TODAY, 'following', {
      visit: 'v-n',
      patterns: ['pt-x', 'pt-y'],
    });
    expect(once.ok && toldDaysChanged(told, once.data, TODAY)).toEqual([]);
    expect(all.ok && toldDaysChanged(told, all.data, TODAY)).toEqual([next]);
  });
  it('変わった日を返す（確定した日の確かめに使う）', () => {
    const r = keyMove(data, rep.id, { kind: 'day', days: 1 }, TODAY);
    expect(r.ok && [...r.dates].sort()).toEqual([TODAY, addDays(TODAY, 1)]);
  });
  it('動かした先の要対応：担当が休みの日へ移すと出る', () => {
    if (!rep.staffId) return;
    const next = addDays(TODAY, 1);
    const off = {
      ...data,
      absences: [...data.absences, { id: 'ab-k', staffId: rep.staffId, date: next, from: null, to: null, note: '' }],
    };
    const r = keyMove(off, rep.id, { kind: 'day', days: 1 }, TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(issuesAt(r.data, r.visitId, r.date).length).toBeGreaterThan(0);
    expect(issuesAt(data, rep.id, TODAY).length).toBe(0);
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

describe('月のマスのキーの読み替え（PRD D340）', () => {
  const cell = (
    k: string,
    o: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
  ) => cellKeyOf({ ...key(k), ...o });
  it('←→ は前・次の日、↑↓ は前・次の週', () => {
    expect(cell('ArrowLeft')).toEqual({ kind: 'go', days: -1 });
    expect(cell('ArrowRight')).toEqual({ kind: 'go', days: 1 });
    expect(cell('ArrowUp')).toEqual({ kind: 'go', days: -7 });
    expect(cell('ArrowDown')).toEqual({ kind: 'go', days: 7 });
  });
  it('Enter はその日の回の一覧を開く', () => {
    expect(cell('Enter')).toEqual({ kind: 'open' });
  });
  it('Shift／Ctrl／⌘＋Enter はその日をまとめて選ぶ', () => {
    expect(cell('Enter', { shiftKey: true })).toEqual({ kind: 'select' });
    expect(cell('Enter', { ctrlKey: true })).toEqual({ kind: 'select' });
    expect(cell('Enter', { metaKey: true })).toEqual({ kind: 'select' });
  });
  it('Alt つきは読まない（Alt＋Enter・Alt＋矢印・Shift＋Alt＋Enter）', () => {
    expect(cell('Enter', { altKey: true })).toBeNull();
    expect(cell('ArrowLeft', { altKey: true })).toBeNull();
    expect(cell('Enter', { altKey: true, shiftKey: true })).toBeNull();
  });
  it('Shift・Ctrl・⌘ つきの矢印・ほかのキーは読まない', () => {
    expect(cell('ArrowLeft', { shiftKey: true })).toBeNull();
    expect(cell('ArrowDown', { shiftKey: true })).toBeNull();
    expect(cell('ArrowRight', { ctrlKey: true })).toBeNull();
    expect(cell('ArrowUp', { metaKey: true })).toBeNull();
    expect(cell('Delete')).toBeNull();
    expect(cell(' ')).toBeNull();
  });
});
