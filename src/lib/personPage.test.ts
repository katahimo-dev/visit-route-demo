import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Pattern } from '../contracts/documents';
import { client, DATE, makeData, staff } from '../matching/fixtures';
import { putVisits, visitsOn } from '../patterns';
import {
  CLIENT_TABS,
  calDates,
  calTitle,
  calViewOf,
  clientCalItems,
  clientStaffGroups,
  itemsByDate,
  mergeFields,
  monthWeeksMon,
  personPathKind,
  pickFields,
  STAFF_TABS,
  shiftAnchor,
  slotOf,
  staffAbsencesIn,
  staffCalItems,
  tabOf,
  tabSearch,
} from './personPage';
import { cancelVisitOp } from './visitOps';

// DATE（2026-10-12）は月曜

function data(): DemoData {
  const p: Pattern = {
    id: 'p1',
    clientId: 'c1',
    typeId: null,
    weekdays: [1, 3],
    everyWeeks: 1,
    repeat: 'weekly',
    monthWeeks: [],
    dayTimes: [],
    windowKind: 'fixed',
    earliestStart: '09:30',
    latestStart: '09:30',
    durationMinutes: 45,
    from: DATE,
    to: null,
    usualStaffId: null,
    note: '',
  };
  const d = makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.27, 140.86)],
    clients: [client('c1', 38.27, 140.88)],
    patterns: [p],
  });
  // 版2（ADR-0053）：繰り返しの回は計算する（保存しない）
  return d;
}

describe('ルートとタブ', () => {
  it('人の画面のパスを見分ける（一覧・〈スタッフ〉の画面のスマホ版は含めない）', () => {
    expect(personPathKind('/clients/c1')).toBe('client');
    expect(personPathKind('/staff/new')).toBe('staff');
    expect(personPathKind('/clients')).toBeNull();
    expect(personPathKind('/staff-view/s1')).toBeNull();
  });
  it('タブは知らない値なら先頭の予定。書くときは先頭を消し、ほかのクエリは残して edit は消す', () => {
    expect(tabOf(CLIENT_TABS, null)).toBe('schedule');
    expect(tabOf(CLIENT_TABS, 'leaves')).toBe('leaves');
    expect(tabOf(STAFF_TABS, 'leaves')).toBe('schedule');
    expect(tabSearch('?cal=month&tab=basic&edit=place', 'schedule', 'schedule')).toBe('?cal=month');
    expect(tabSearch('', 'basic', 'schedule')).toBe('?tab=basic');
  });
});

describe('節の項目', () => {
  it('節の項目だけ入力の値を重ね、ほかは保存した中身のまま', () => {
    const saved = { a: 1, b: 2, c: 3 };
    const form = { a: 9, b: 8, c: 7 };
    expect(pickFields(form, ['a'])).toEqual({ a: 9 });
    expect(mergeFields(saved, form, ['a', 'c'])).toEqual({ a: 9, b: 2, c: 7 });
  });
});

describe('カレンダーの期間', () => {
  it('週は月〜日、月は月曜はじまりの週を並べる', () => {
    expect(calDates('week', '2026-10-14')).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    const weeks = monthWeeksMon('2026-10');
    expect(weeks[0]![0]).toBe('2026-09-28');
    expect(weeks.at(-1)!.at(-1)).toBe('2026-11-01');
    expect(weeks).toHaveLength(5);
    expect(calDates('month', '2026-10-20')).toHaveLength(35);
  });
  it('送る・見出し・見せ方', () => {
    expect(shiftAnchor('week', '2026-10-14', 1)).toBe('2026-10-21');
    expect(shiftAnchor('month', '2026-10-14', -1)).toBe('2026-09-01');
    expect(calTitle('week', '2026-10-14')).toBe('10/12（月）〜10/18（日）');
    expect(calTitle('month', '2026-10-14')).toBe('2026年10月');
    expect(calViewOf('month')).toBe('month');
    expect(calViewOf('x')).toBe('week');
  });
});

describe('カレンダーの回', () => {
  it('〈利用者さん〉の回：担当あり・担当なし・取り消し・休み、時刻は開始（早）〜＋所要', () => {
    const d0 = data();
    const a = '2026-10-12_p1';
    const b = '2026-10-14_p1';
    const c0 = cancelVisitOp(d0, '2026-10-19_p1', true);
    const first = visitsOn(c0, '2026-10-12').find((v) => v.id === a)!;
    const d = {
      ...c0,
      visits: putVisits(c0.visits, [{ ...first, staffId: 's1', start: '09:30' }]),
      clientLeaves: [{ id: 'l1', clientId: 'c1', from: '2026-10-21', to: '2026-10-21', note: '' }],
    };
    const items = clientCalItems(d, 'c1', '2026-10-12', '2026-10-25');
    const by = new Map(items.map((it) => [it.visit.id, it]));
    expect(by.get(a)).toMatchObject({ state: 'assigned', staffId: 's1', start: 570, end: 615 });
    expect(by.get(b)!.state).toBe('unassigned');
    expect(by.get('2026-10-19_p1')!.state).toBe('sameDay');
    expect(by.get('2026-10-21_p1')!.state).toBe('leave');
    expect(itemsByDate(items).get('2026-10-12')).toHaveLength(1);
    expect(staffCalItems(d, 's1', '2026-10-12', '2026-10-25').map((it) => it.visit.id)).toEqual([a]);
  });
  it('空き枠：同じ枠なら押しただけ（既定の所要）、枠をまたいだら押した枠と離した枠を含む長さ', () => {
    expect(slotOf(600, 675)).toEqual({ start: 600, duration: 90 });
    // 上へ動かしても押した枠（10:00〜10:15）を含む
    expect(slotOf(675, 600)).toEqual({ start: 600, duration: 90 });
    expect(slotOf(600, 600)).toEqual({ start: 600, duration: 60 });
    expect(slotOf(600, 615)).toEqual({ start: 600, duration: 30 });
  });
});

describe('欠勤・相性', () => {
  it('その人のその期間の欠勤（日付の順）', () => {
    const d = {
      absences: [
        { id: 'a2', staffId: 's1', date: '2026-10-20', from: null, to: null, note: '希望休' },
        { id: 'a1', staffId: 's1', date: '2026-10-13', from: null, to: null, note: '' },
        { id: 'a3', staffId: 's2', date: '2026-10-14', from: null, to: null, note: '' },
      ],
    };
    expect(staffAbsencesIn(d, 's1', '2026-10-12', '2026-10-31').map((a) => a.id)).toEqual(['a1', 'a2']);
  });
  it('〈利用者さん〉から見た相性を記号ごとに', () => {
    const g = clientStaffGroups({ c1: { s1: 2, s2: -2 } }, 'c1', [{ id: 's1' }, { id: 's2' }, { id: 's3' }]);
    expect(g.great.map((s) => s.id)).toEqual(['s1']);
    expect(g.ng.map((s) => s.id)).toEqual(['s2']);
    expect(g.good).toEqual([]);
  });
});
