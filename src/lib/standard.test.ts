// 組み方の標準（PRD D350〜D354。ADR-0062）
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Pattern, Visit } from '../contracts/documents';
import { client, makeData, staff } from '../matching/fixtures';
import { findVisit, visitOf, visitsOn } from '../patterns';
import { aiPinsOf, dayProblemOf, routesOf, standardPinsOf, writeRoutes } from './dayPlan';
import {
  bestIndex,
  cycleWeeks,
  defaultSince,
  earliestSince,
  nextMonday,
  registerStandard,
  standardDiff,
  standardPeriod,
  temporaryChanges,
} from './standard';

const TODAY = '2026-10-07'; // 水曜
const MON = '2026-10-12';
const WED = '2026-10-14';
const pattern = (over: Partial<Pattern> = {}): Pattern => ({
  id: 'p1',
  clientId: 'c1',
  typeId: null,
  weekdays: [1, 3],
  everyWeeks: 1,
  repeat: 'weekly',
  monthWeeks: [],
  dayTimes: [],
  windowKind: 'window',
  earliestStart: '09:00',
  latestStart: '12:00',
  durationMinutes: 60,
  from: '2026-10-01',
  to: null,
  usualStaffId: 's1',
  note: '',
  ...over,
});
const data = (over: Partial<DemoData> = {}): DemoData =>
  makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.262, 140.872)],
    clients: [client('c1', 38.261, 140.871)],
    visits: [],
    patterns: [pattern()],
    ...over,
  });
/** 計算した回を担当・開始を変えて保存した回にする */
const saved = (d: DemoData, date: string, over: Partial<Visit>): Visit => ({
  ...(findVisit(d, `${date}_p1`) as Visit),
  ...over,
});
let n = 0;
const ids = () => `n${++n}`;

describe('周期と期間', () => {
  it('間隔の最大（毎月は4・無ければ1）', () => {
    expect(cycleWeeks(data(), TODAY).weeks).toBe(1);
    expect(cycleWeeks(data({ patterns: [pattern({ everyWeeks: 2 })] }), TODAY)).toMatchObject({ weeks: 2 });
    expect(cycleWeeks(data({ patterns: [pattern({ repeat: 'monthly', monthWeeks: [1] })] }), TODAY).weeks).toBe(4);
    expect(cycleWeeks(data({ patterns: [] }), TODAY).weeks).toBe(1);
    // 終わった繰り返しは数えない
    expect(cycleWeeks(data({ patterns: [pattern({ everyWeeks: 3, to: '2026-10-01' })] }), TODAY).weeks).toBe(1);
  });
  it('期間は来週の月曜から', () => {
    expect(nextMonday('2026-10-07')).toBe(MON);
    expect(nextMonday('2026-10-11')).toBe(MON);
    expect(nextMonday('2026-10-05')).toBe(MON);
    expect(standardPeriod(data(), TODAY)).toEqual({ from: MON, to: '2026-10-18', weeks: 1 });
    expect(standardPeriod(data(), TODAY, 2).to).toBe('2026-10-25');
  });
  it('いつから：伝えた日より後', () => {
    const d = data({ snapshots: { '2026-10-13': { date: '2026-10-13', at: 0, visits: [] } } });
    expect(earliestSince(d, TODAY)).toBe(WED);
    expect(defaultSince(d, standardPeriod(d, TODAY), TODAY)).toBe(WED);
    expect(defaultSince(data(), standardPeriod(data(), TODAY), TODAY)).toBe(MON);
  });
});

describe('standardDiff', () => {
  it('変わらなければ changed は偽', () => {
    const rows = standardDiff(data(), standardPeriod(data(), TODAY));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ changed: false, split: false, staff: { before: 's1', after: 's1' } });
  });
  it('担当と開始が変われば差分。開始は曜日ごと', () => {
    const d0 = data();
    const d = { ...d0, visits: [saved(d0, MON, { staffId: 's2', start: '10:00' }), saved(d0, WED, { staffId: 's2' })] };
    const [r] = standardDiff(d, standardPeriod(d, TODAY));
    expect(r).toMatchObject({ changed: true, split: false, staff: { before: 's1', after: 's2' } });
    expect(r!.starts).toEqual([{ weekday: 1, before: null, after: '10:00' }]);
  });
  it('曜日で担当が違えば分ける。週で違えば最初の週。時間の約束の外は書かない', () => {
    const d0 = data();
    const period = standardPeriod(d0, TODAY, 2);
    const d = {
      ...d0,
      visits: [saved(d0, MON, { staffId: 's2', start: '13:00' }), saved(d0, '2026-10-19', { staffId: 's1' })],
    };
    const [r] = standardDiff(d, period);
    expect(r!.split).toBe(true);
    expect(r!.warnings).toEqual(expect.arrayContaining(['weekdaySplit', 'weeksDiffer', 'outsideWindow']));
    expect(r!.days).toEqual([
      { weekday: 1, staffId: 's2', start: null },
      { weekday: 3, staffId: 's1', start: null },
    ]);
  });
});

describe('registerStandard', () => {
  it('いつからで分けて担当と標準の開始を書く。計算した回はその担当と開始', () => {
    const d0 = data();
    const period = standardPeriod(d0, TODAY);
    const d = {
      ...d0,
      visits: [saved(d0, MON, { staffId: 's2', start: '10:00' }), saved(d0, WED, { staffId: 's2', start: '11:00' })],
    };
    const out = registerStandard(d, period, MON, TODAY, { newId: ids, temp: 'pin', at: 1 });
    expect(out.patterns).toHaveLength(2);
    expect(out.patterns[0]).toMatchObject({ id: 'p1', to: '2026-10-11' });
    const np = out.patterns[1]!;
    expect(np).toMatchObject({
      from: MON,
      usualStaffId: 's2',
      usualStarts: [
        { weekday: 1, start: '10:00' },
        { weekday: 3, start: '11:00' },
      ],
    });
    // 標準と同じになった保存した回は消える
    expect(out.visits).toEqual([]);
    const next = visitsOn(out, '2026-10-19')[0]!;
    expect(next).toMatchObject({ staffId: 's2', start: '10:00', pinned: false });
    expect(out.standard).toMatchObject({ from: MON, weeks: 1, at: 1 });
    // 前の回はそのまま
    expect(visitsOn(out, '2026-10-05')[0]).toMatchObject({ staffId: 's1' });
  });
  it('曜日で担当が違えば曜日ごとの繰り返し', () => {
    const d0 = data();
    const d = { ...d0, visits: [saved(d0, MON, { staffId: 's2' })] };
    const out = registerStandard(d, standardPeriod(d, TODAY), MON, TODAY, { newId: ids, temp: 'pin', at: 1 });
    const live = out.patterns.filter((p) => p.from === MON);
    expect(live.map((p) => [p.weekdays, p.usualStaffId])).toEqual([
      [[1], 's2'],
      [[3], 's1'],
    ]);
    expect(visitsOn(out, '2026-10-19').map((v) => v.staffId)).toEqual(['s2']);
    expect(visitsOn(out, '2026-10-21').map((v) => v.staffId)).toEqual(['s1']);
  });
  it('一時の変更はピンを立てて残すか消す。ピンの回・この回だけ変えた回は残す', () => {
    const d0 = data();
    const period = standardPeriod(d0, TODAY);
    const base = [saved(d0, MON, { staffId: 's2' }), saved(d0, WED, { staffId: 's2' })];
    const temp = saved(d0, '2026-10-19', { staffId: 's1', start: '09:30' });
    const pinned = saved(d0, '2026-10-21', { staffId: 's1', pinned: true });
    const edited = saved(d0, '2026-10-26', {
      durationMinutes: 90,
      pattern: { id: 'p1', date: '2026-10-26', edited: true },
    });
    const d = { ...d0, visits: [...base, temp, pinned, edited] };
    const rows = standardDiff(d, period);
    expect(temporaryChanges(d, rows, MON, period).map((t) => t.visitId)).toEqual([temp.id]);
    const kept = registerStandard(d, period, MON, TODAY, { newId: ids, temp: 'pin', at: 1 });
    const np = kept.patterns.find((p) => p.from === MON)!;
    const byDate = (x: DemoData, date: string) => visitsOn(x, date)[0]!;
    expect(byDate(kept, '2026-10-19')).toMatchObject({
      id: `2026-10-19_${np.id}`,
      staffId: 's1',
      start: '09:30',
      pinned: true,
    });
    expect(byDate(kept, '2026-10-21')).toMatchObject({ staffId: 's1', pinned: true });
    expect(byDate(kept, '2026-10-26')).toMatchObject({ id: `2026-10-26_${np.id}`, durationMinutes: 90 });
    const dropped = registerStandard(d, period, MON, TODAY, { newId: ids, temp: 'drop', at: 1 });
    expect(byDate(dropped, '2026-10-19')).toMatchObject({ staffId: 's2', pinned: false });
    expect(byDate(dropped, '2026-10-21')).toMatchObject({ staffId: 's1', pinned: true });
  });
  it('伝えた日の回は変えない（いつからは伝えた日より後）', () => {
    const d0 = data();
    const told = saved(d0, MON, { staffId: 's2' });
    const d = { ...d0, visits: [told], snapshots: { [MON]: { date: MON, at: 0, visits: [] } } };
    const out = registerStandard(d, standardPeriod(d, TODAY), MON, TODAY, { newId: ids, temp: 'drop', at: 1 });
    expect(out.visits).toContainEqual(told);
    expect(out.standard?.from).toBe('2026-10-13');
  });
  it('差分が無ければ同じデータ', () => {
    const d = data();
    expect(registerStandard(d, standardPeriod(d, TODAY), MON, TODAY, { newId: ids, temp: 'pin', at: 1 })).toBe(d);
  });
});

describe('標準のピン（PRD D352）', () => {
  it('担当のある計算した回はピン。保存した回・担当できない回は除く', () => {
    const d = data();
    expect(standardPinsOf(d, MON, visitsOn(d, MON))).toEqual({ [`${MON}_p1`]: 's1' });
    // s1 が休み（勤務日でない土曜の回）は外す
    const sat = data({ patterns: [pattern({ weekdays: [6] })] });
    expect(standardPinsOf(sat, '2026-10-17', visitsOn(sat, '2026-10-17'))).toEqual({});
    // 保存した回は標準のピンにしない（手のピンだけ）
    const v = { ...visitOf(pattern(), MON), staffId: 's2', pinned: true };
    const withSaved = { ...d, visits: [v] };
    expect(standardPinsOf(withSaved, MON, visitsOn(withSaved, MON))).toEqual({});
    expect(aiPinsOf(withSaved, MON, visitsOn(withSaved, MON))).toEqual({ [v.id]: 's2' });
  });
});

describe('レビューで見つかった場合', () => {
  it('隔週は回のある週から始め、周期をずらさない', () => {
    // 隔週・月曜・10/5 から：回は 10/5・10/19・11/2
    const d0 = data({ patterns: [pattern({ weekdays: [1], everyWeeks: 2, from: '2026-10-05' })] });
    const period = standardPeriod(d0, TODAY);
    expect(period).toMatchObject({ from: MON, weeks: 2 });
    const d = { ...d0, visits: [saved(d0, '2026-10-19', { staffId: 's2' })] };
    const out = registerStandard(d, period, MON, TODAY, { newId: ids, temp: 'pin', at: 1 });
    const np = out.patterns.find((p) => p.usualStaffId === 's2')!;
    expect(np.from).toBe('2026-10-19');
    const on = (date: string) => visitsOn(out, date).map((v) => v.staffId);
    expect(on('2026-10-12')).toEqual([]);
    expect(on('2026-10-19')).toEqual(['s2']);
    expect(on('2026-10-26')).toEqual([]);
    expect(on('2026-11-02')).toEqual(['s2']);
  });
  it('いつからより前に終わる繰り返しは書き換えない', () => {
    const d0 = data({ patterns: [pattern({ to: '2026-10-21' })] });
    const d = { ...d0, visits: [saved(d0, MON, { staffId: 's2' }), saved(d0, WED, { staffId: 's2' })] };
    const out = registerStandard(d, standardPeriod(d, TODAY, 2), '2026-10-26', TODAY, {
      newId: ids,
      temp: 'pin',
      at: 1,
    });
    expect(out).toBe(d);
  });
  it('標準と同じピンの回はピンのまま残す', () => {
    const d0 = data();
    const d = {
      ...d0,
      visits: [saved(d0, MON, { staffId: 's2', pinned: true }), saved(d0, WED, { staffId: 's2' })],
    };
    const out = registerStandard(d, standardPeriod(d, TODAY), MON, TODAY, { newId: ids, temp: 'pin', at: 1 });
    expect(visitsOn(out, MON)[0]).toMatchObject({ staffId: 's2', pinned: true });
    expect(visitsOn(out, WED)[0]).toMatchObject({ staffId: 's2', pinned: false });
  });
  it('伝えた日へ動かした回の元の日より前は、いつからに選べない', () => {
    const d0 = data();
    const movedVisit = saved(d0, WED, { date: MON, pattern: { id: 'p1', date: WED, edited: true } });
    const d = { ...d0, visits: [movedVisit], snapshots: { [MON]: { date: MON, at: 0, visits: [] } } };
    expect(earliestSince(d, TODAY)).toBe('2026-10-15');
  });
  it('AI の提案を反映して保存した回も、担当が標準のままなら標準のピン', () => {
    const d = data();
    const p = dayProblemOf(d, MON)!;
    const written = writeRoutes(d, MON, p, { s1: [`${MON}_p1`] });
    expect(written.visits).toHaveLength(1);
    expect(standardPinsOf(written, MON, visitsOn(written, MON))).toEqual({ [`${MON}_p1`]: 's1' });
    expect(routesOf(p, visitsOn(written, MON))).toEqual({ s1: [`${MON}_p1`] });
  });
});

describe('bestIndex', () => {
  it('いちばん点の高いカード（同点は前）', () => {
    const s = (points: number | null) => ({
      points,
      travelMinutes: 0,
      unassigned: 0,
      spread: 0,
      most: null,
      least: null,
      hard: 0,
    });
    expect(bestIndex([s(80), s(90), s(90)])).toBe(1);
    expect(bestIndex([null, s(null)])).toBe(-1);
  });
});
