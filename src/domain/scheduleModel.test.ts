// 写した元：katahimo-dev/visit-route-poc @ a46e7db web/src/features/admin/schedule/model.test.ts

import { describe, expect, it } from 'vitest';
import type { Staff, Visit } from '../contracts/documents';
import { assign, isRed, NONE, reconcile, timesOf, warningsOf } from './scheduleModel';

const visit = (id: string, earliestStart: string, extra: Partial<Visit> = {}): Visit & { id: string } => ({
  id,
  date: '2026-10-12',
  clientId: `c-${id}`,
  windowKind: 'fixed',
  earliestStart,
  latestStart: earliestStart,
  durationMinutes: 60,
  staffId: null,
  cancelled: false,
  note: '',
  typeId: null,
  pattern: null,
  ...extra,
});
const mapOf = (vs: (Visit & { id: string })[]) => new Map(vs.map((v) => [v.id, v]));

describe('reconcile', () => {
  it('消えた訪問を除き、新しい訪問は担当の列か未割当へ入れ、どの列も開始時刻の順にする', () => {
    const vs = [visit('a', '09:00'), visit('b', '13:00'), visit('c', '11:00', { staffId: 's1' }), visit('d', '10:00')];
    const view = reconcile({ s1: ['b', 'a', 'gone'], [NONE]: [] }, vs, ['s1', 's2']);
    expect(view.cols.s1).toEqual(['a', 'c', 'b']);
    expect(view.cols.s2).toEqual([]);
    expect(view.unassigned).toEqual(['d']);
  });
});

describe('assign', () => {
  it('移した先では開始時刻の順に入る', () => {
    const vs = [visit('a', '09:00'), visit('b', '13:00'), visit('c', '11:00')];
    const view = assign({ cols: { s1: ['a', 'b'] }, unassigned: ['c'] }, 'c', 's1', mapOf(vs));
    expect(view.cols.s1).toEqual(['a', 'c', 'b']);
    expect(view.unassigned).toEqual([]);
  });
  it('未割当に戻せる', () => {
    const vs = [visit('a', '09:00')];
    const view = assign({ cols: { s1: ['a'] }, unassigned: [] }, 'a', NONE, mapOf(vs));
    expect(view).toEqual({ cols: { s1: [] }, unassigned: ['a'] });
  });
});

describe('timesOf', () => {
  it('時間の固定された訪問が重なれば、両方を重なりにする', () => {
    const vs = [visit('a', '09:00', { durationMinutes: 90 }), visit('b', '10:00'), visit('c', '13:00')];
    const t = timesOf(['a', 'b', 'c'], mapOf(vs));
    expect(t.get('a')).toEqual({ start: 540, end: 630, overlap: true });
    expect(t.get('b')).toEqual({ start: 630, end: 690, overlap: true });
    expect(t.get('c')?.overlap).toBe(false);
  });
  it('開始に幅があり、前が終わってから始めて間に合うなら重なりではない', () => {
    const vs = [
      visit('a', '09:00', { durationMinutes: 90 }),
      visit('b', '10:00', { windowKind: 'window', latestStart: '11:00' }),
    ];
    const t = timesOf(['a', 'b'], mapOf(vs));
    expect(t.get('b')).toEqual({ start: 630, end: 690, overlap: false });
    expect(t.get('a')?.overlap).toBe(false);
  });
});

describe('timesOf：稼働時間帯に寄せる', () => {
  const slots = [
    { start: '10:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ];
  it('幅のある訪問は、時間帯の中で入れる最も早い時刻に始める（時間外にしない）', () => {
    const late = visit('a', '09:00', { windowKind: 'window', latestStart: '11:00' });
    expect(timesOf(['a'], mapOf([late]), slots).get('a')).toMatchObject({ start: 600, end: 660 });
    const overLunch = visit('b', '11:30', { windowKind: 'window', latestStart: '14:30' });
    expect(timesOf(['b'], mapOf([overLunch]), slots).get('b')).toMatchObject({ start: 840, end: 900 });
  });
  it('幅の中で収まらなければ、そのままの時刻（時間外として知らせる）', () => {
    const fixed = visit('c', '09:00');
    expect(timesOf(['c'], mapOf([fixed]), slots).get('c')).toMatchObject({ start: 540, end: 600 });
  });
});

describe('warningsOf', () => {
  const staff: Staff = {
    id: 's1',
    name: 'テスト',
    home: { address: '', lat: null, lng: null },
    travelMode: 'DRIVE',
    workDays: [1, 2, 3, 4, 5],
    shiftStart: '08:00',
    shiftEnd: '18:00',
    active: true,
    traits: {},
    requirements: [],
    preferences: [],
  };
  const slots = [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ];
  it('重なり・稼働時間外（休みの抜けにかかる）を印にする', () => {
    const w = warningsOf(staff, 's1', slots, { start: 11 * 60 + 30, end: 12 * 60 + 30, overlap: true });
    expect(w).toEqual(['overlap', 'outside']);
    expect(isRed(w)).toBe(true);
    expect(warningsOf(staff, 's1', slots, { start: 9 * 60, end: 10 * 60, overlap: false })).toEqual([]);
  });
  it('休みの日（時間帯なし）は時間外。未割当には印を付けない', () => {
    expect(warningsOf(staff, 's1', [], { start: 600, end: 660, overlap: false })).toEqual(['outside']);
    expect(warningsOf(undefined, null, slots, undefined)).toEqual([]);
  });
});

describe('reconcile（Object の組み込みの名前の ID）', () => {
  it('スタッフID が constructor・toString でも、保存した割当に無ければ空の列（Object の組み込みを拾って落ちない）', () => {
    const vs = [visit('a', '09:00', { staffId: 'constructor' }), visit('b', '10:00')];
    const view = reconcile({}, vs, ['constructor', 'toString']);
    expect(view.cols).toEqual({ constructor: ['a'], toString: [] });
    expect(view.unassigned).toEqual(['b']);
  });
});
