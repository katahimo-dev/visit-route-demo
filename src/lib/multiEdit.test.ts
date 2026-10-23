import { describe, expect, it } from 'vitest';
import { addDays } from '../domain/time';
import { findVisit, visitsOn } from '../patterns';
import { createDemoData } from '../seed';
import { assignMany, cancelMany, moveManyToDate, multiResultText, selectionText, shiftMany } from './multiEdit';

const TODAY = '2026-10-21';
const data = createDemoData(TODAY);
/** 今日の訪問から2件（取り消していない） */
const two = visitsOn(data, TODAY)
  .filter((v) => !v.cancelled)
  .slice(0, 2)
  .map((v) => v.id);

describe('複数選択の操作（PRD D330。ADR-0054）', () => {
  it('時刻をまとめてずらす（この回だけ。幅はそのまま）', () => {
    const r = shiftMany(data, two, 15, TODAY);
    expect(r.done).toBe(2);
    expect(r.failed).toEqual([]);
    for (const id of two) {
      const before = findVisit(data, id)!;
      const after = findVisit(r.data, id)!;
      const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      expect(m(after.earliestStart) - m(before.earliestStart)).toBe(15);
      expect(m(after.latestStart) - m(before.latestStart)).toBe(15);
    }
  });
  it('まとめて取り消す。今日より前・消えた訪問はできない理由', () => {
    const past = visitsOn(data, addDays(TODAY, -3)).find((v) => !v.cancelled)!;
    const r = cancelMany(data, [...two, past.id, 'nope'], TODAY);
    expect(r.done).toBe(2);
    expect(r.failed.map((f) => f.why)).toEqual(['今日より前の訪問', '消された訪問']);
    for (const id of two) expect(findVisit(r.data, id)!.cancelled).toBe(true);
    expect(multiResultText('訪問を取り消しました', r)).toBe(
      '2件の訪問を取り消しました（2件はできませんでした：今日より前の訪問・消された訪問）',
    );
  });
  it('担当をまとめて替える（ピンにする）。その日に働かない人は替えない', () => {
    const p = data.staff.find((s) => s.active)!;
    const r = assignMany(data, two, p.id, TODAY);
    expect(r.done + r.failed.length).toBe(2);
    for (const id of two) {
      const v = findVisit(r.data, id)!;
      if (r.failed.some((f) => f.visitId === id)) continue;
      expect(v.staffId).toBe(p.id);
      expect(v.pinned).toBe(true);
    }
  });
  it('まとめて別の日へ（PRD D343）：日付だけ変わり時刻はそのまま。同じ日・今日より前の日は理由', () => {
    const to = addDays(TODAY, 2);
    const r = moveManyToDate(data, two, to, TODAY);
    expect(r.done).toBe(2);
    for (const id of two) {
      const before = findVisit(data, id)!;
      const after = visitsOn(r.data, to).find(
        (v) => v.clientId === before.clientId && v.earliestStart === before.earliestStart && !v.cancelled,
      );
      expect(after).toBeTruthy();
      expect(visitsOn(r.data, TODAY).some((v) => v.id === id && !v.cancelled)).toBe(false);
    }
    expect(moveManyToDate(data, two, TODAY, TODAY).failed.map((f) => f.why)).toEqual(['同じ日', '同じ日']);
    const past = moveManyToDate(data, two, addDays(TODAY, -1), TODAY);
    expect(past.done).toBe(0);
    expect(past.data).toBe(data);
    expect(past.failed.map((f) => f.why)).toEqual(['今日より前の日', '今日より前の日']);
  });
  it('文', () => {
    expect(selectionText(3)).toBe('3件を選択');
    expect(multiResultText('担当を替えました', { done: 3, failed: [] })).toBe('3件の担当を替えました');
  });
});
