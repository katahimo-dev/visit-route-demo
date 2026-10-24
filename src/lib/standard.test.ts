// 組み方の標準（PRD D350〜D354。ADR-0063）
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Pattern, Visit } from '../contracts/documents';
import { client, makeData, staff } from '../matching/fixtures';
import { findVisit, visitOf, visitsOn } from '../patterns';
import { initialPresets } from '../seed';
import { aiPinsOf, dayProblemOf, routesOf, standardPinsOf, writeRoutes } from './dayPlan';
import {
  bestIndex,
  cellOf,
  currentTable,
  cycleWeeks,
  defaultSince,
  diffCounts,
  earliestSince,
  mondayOf,
  nextMonday,
  registerStandard,
  type StandardTable,
  setCell,
  standardPatterns,
  standardPeriod,
  startError,
  tableDiff,
  tableFromDays,
  temporaryChanges,
} from './standard';
import { patternsKey } from './standardDraft';

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
/** 今の標準の表のマスを替えた表 */
const tableWith = (d: DemoData, cells: [string, number, string | null, string | null][]): StandardTable =>
  cells.reduce(
    (t, [patternId, wd, staffId, start]) => setCell(t, { patternId, weekday: wd }, { staffId, start }),
    currentTable(d, TODAY),
  );
const reg = (d: DemoData, t: StandardTable, since = MON, temp: 'drop' | 'pin' = 'drop') =>
  registerStandard(d, t, since, TODAY, { newId: ids, temp, at: 1 });

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
    expect(mondayOf(WED)).toBe(MON);
    expect(mondayOf('2026-10-18')).toBe(MON);
    expect(mondayOf(MON)).toBe(MON);
    expect(standardPeriod(data(), TODAY)).toEqual({ from: MON, to: '2026-10-18', weeks: 1 });
    expect(standardPeriod(data(), TODAY, 2).to).toBe('2026-10-25');
  });
  it('いつから：既定は来週の月曜。伝えた日より後', () => {
    const d = data({ snapshots: { '2026-10-13': { date: '2026-10-13', at: 0, visits: [] } } });
    expect(earliestSince(d, TODAY)).toBe(WED);
    expect(defaultSince(d, TODAY)).toBe(WED);
    expect(defaultSince(data(), TODAY)).toBe(MON);
  });
});

describe('標準の表', () => {
  it('今の標準の表：曜日ごとの担当と標準の開始（時間の約束の外は無し）', () => {
    const d = data({
      patterns: [
        pattern({
          usualStarts: [
            { weekday: 1, start: '10:00' },
            { weekday: 3, start: '13:00' },
          ],
        }),
      ],
    });
    expect(currentTable(d, TODAY)).toEqual({
      p1: { 1: { staffId: 's1', start: '10:00' }, 3: { staffId: 's1', start: null } },
    });
  });
  it('行にしない繰り返し：終わった・利用中でない〈利用者さん〉・分けた前の側', () => {
    const d = data({
      clients: [client('c1', 38.261, 140.871), { ...client('c2', 38.261, 140.871), active: false }],
      patterns: [
        pattern({ id: 'old', to: '2026-10-01' }),
        pattern({ id: 'off', clientId: 'c2' }),
        pattern({ id: 'before', to: '2026-10-11' }),
        pattern({ id: 'after', from: MON }),
      ],
    });
    expect(standardPatterns(d, TODAY).map((p) => p.id)).toEqual(['after']);
    expect(Object.keys(currentTable(d, TODAY))).toEqual(['after']);
  });
  it('違うマス・マスを替える・表に無いマスは今の標準', () => {
    const d = data();
    const cur = currentTable(d, TODAY);
    expect(tableDiff(cur, cur)).toEqual([]);
    const t = setCell(cur, { patternId: 'p1', weekday: 3 }, { staffId: 's2', start: '10:00' });
    expect(cur.p1?.[3]).toEqual({ staffId: 's1', start: null }); // 元の表は変えない
    expect(tableDiff(t, cur)).toEqual([{ patternId: 'p1', weekday: 3, kind: 'staff' }]);
    // 開始だけ違っても違うマス
    const t2 = setCell(cur, { patternId: 'p1', weekday: 1 }, { staffId: 's1', start: '09:30' });
    expect(tableDiff(t2, cur)).toEqual([{ patternId: 'p1', weekday: 1, kind: 'time' }]);
    expect(
      diffCounts(tableDiff(setCell(t, { patternId: 'p1', weekday: 1 }, { staffId: 's1', start: '09:30' }), cur)),
    ).toEqual({
      all: 2,
      staff: 1,
      time: 1,
    });
    // 表に無い繰り返し・今の標準に無い繰り返し
    expect(tableDiff({}, cur)).toEqual([]);
    expect(tableDiff({ gone: { 1: { staffId: 's2', start: null } } }, cur)).toEqual([]);
    expect(cellOf({}, cur, 'p1', 1)).toEqual({ staffId: 's1', start: null });
    expect(cellOf(t, cur, 'p1', 3)).toEqual({ staffId: 's2', start: '10:00' });
    expect(cellOf(t, cur, 'p1', 2)).toBeNull();
  });
  it('案から表：曜日ごとに最初の回の担当と lenient の開始。担当なしは無し。回の無い曜日は今の標準', () => {
    const d = data();
    const p = dayProblemOf(d, MON)!;
    expect(tableFromDays(d, [{ problem: p, routes: { s2: [`${MON}_p1`] } }], TODAY)).toEqual({
      p1: { 1: { staffId: 's2', start: '09:00' }, 3: { staffId: 's1', start: null } },
    });
    expect(tableFromDays(d, [{ problem: p, routes: {} }], TODAY).p1?.[1]).toEqual({ staffId: null, start: null });
    // 2週目の同じ曜日は見ない
    const p2 = dayProblemOf(d, '2026-10-19')!;
    const t = tableFromDays(
      d,
      [
        { problem: p, routes: { s2: [`${MON}_p1`] } },
        { problem: p2, routes: { s1: ['2026-10-19_p1'] } },
      ],
      TODAY,
    );
    expect(t.p1?.[1]?.staffId).toBe('s2');
  });
  it('マスの開始の誤り：空は可・時間の約束の外は受け付けない', () => {
    const p = pattern({ dayTimes: [{ weekday: 3, earliestStart: '14:00', latestStart: '15:00' }] });
    expect(startError(p, 1, '')).toBeNull();
    expect(startError(p, 1, '09:00')).toBeNull();
    expect(startError(p, 1, '12:30')).toContain('09:00〜12:00');
    expect(startError(p, 3, '10:00')).toContain('14:00〜15:00');
    expect(startError(p, 3, '14:30')).toBeNull();
    expect(startError(p, 1, '9:00')).not.toBeNull();
  });
});

describe('registerStandard', () => {
  it('いつからで分けて担当と標準の開始を書く。標準と同じになった保存した回は消える', () => {
    const d0 = data();
    const d = {
      ...d0,
      visits: [saved(d0, MON, { staffId: 's2', start: '10:00' }), saved(d0, WED, { staffId: 's2', start: '11:00' })],
    };
    const t = tableWith(d, [
      ['p1', 1, 's2', '10:00'],
      ['p1', 3, 's2', '11:00'],
    ]);
    expect(temporaryChanges(d, t, MON, TODAY)).toEqual([]);
    const out = reg(d, t);
    expect(out.patterns).toHaveLength(2);
    expect(out.patterns[0]).toMatchObject({ id: 'p1', to: '2026-10-11' });
    expect(out.patterns[1]).toMatchObject({
      from: MON,
      usualStaffId: 's2',
      usualStarts: [
        { weekday: 1, start: '10:00' },
        { weekday: 3, start: '11:00' },
      ],
    });
    expect(out.visits).toEqual([]);
    expect(visitsOn(out, '2026-10-19')[0]).toMatchObject({ staffId: 's2', start: '10:00', pinned: false });
    expect(out.standard).toMatchObject({ from: MON, weeks: 1, at: 1 });
    // 前の回はそのまま
    expect(visitsOn(out, '2026-10-05')[0]).toMatchObject({ staffId: 's1' });
    // 登録したあとは今の標準と同じ（分けた前の側は行にしない）
    const after = currentTable(out, TODAY);
    expect(Object.keys(after)).toEqual([out.patterns[1]!.id]);
    expect(Object.values(after)[0]).toEqual(t.p1);
  });
  it('曜日で担当が違えば曜日ごとの繰り返し', () => {
    const d = data();
    const out = reg(d, tableWith(d, [['p1', 1, 's2', null]]));
    const live = out.patterns.filter((p) => p.from === MON);
    expect(live.map((p) => [p.weekdays, p.usualStaffId])).toEqual([
      [[1], 's2'],
      [[3], 's1'],
    ]);
    expect(visitsOn(out, '2026-10-19').map((v) => v.staffId)).toEqual(['s2']);
    expect(visitsOn(out, '2026-10-21').map((v) => v.staffId)).toEqual(['s1']);
  });
  it('違う予定は入れ替える（既定）か残す（ピン）。ピンの回・この回だけ変えた回はどちらでも残す', () => {
    const d0 = data();
    const base = [saved(d0, MON, { staffId: 's2' }), saved(d0, WED, { staffId: 's2' })];
    const temp = saved(d0, '2026-10-19', { staffId: 's1', start: '09:30' });
    const pinned = saved(d0, '2026-10-21', { staffId: 's1', pinned: true });
    const edited = saved(d0, '2026-10-26', {
      durationMinutes: 90,
      pattern: { id: 'p1', date: '2026-10-26', edited: true },
    });
    const d = { ...d0, visits: [...base, temp, pinned, edited] };
    const t = tableWith(d, [
      ['p1', 1, 's2', null],
      ['p1', 3, 's2', null],
    ]);
    expect(temporaryChanges(d, t, MON, TODAY)).toEqual([
      {
        visitId: temp.id,
        date: '2026-10-19',
        clientId: 'c1',
        now: { staffId: 's1', start: '09:30' },
        standard: { staffId: 's2', start: null },
      },
    ]);
    const byDate = (x: DemoData, date: string) => visitsOn(x, date)[0]!;
    const dropped = reg(d, t);
    const np = dropped.patterns.find((p) => p.from === MON)!;
    expect(byDate(dropped, '2026-10-19')).toMatchObject({ staffId: 's2', pinned: false });
    expect(byDate(dropped, '2026-10-21')).toMatchObject({ staffId: 's1', pinned: true });
    expect(byDate(dropped, '2026-10-26')).toMatchObject({ id: `2026-10-26_${np.id}`, durationMinutes: 90 });
    const kept = reg(d, t, MON, 'pin');
    const kp = kept.patterns.find((p) => p.from === MON)!;
    expect(byDate(kept, '2026-10-19')).toMatchObject({
      id: `2026-10-19_${kp.id}`,
      staffId: 's1',
      start: '09:30',
      pinned: true,
    });
    expect(byDate(kept, '2026-10-21')).toMatchObject({ staffId: 's1', pinned: true });
    expect(byDate(kept, '2026-10-26')).toMatchObject({ id: `2026-10-26_${kp.id}`, durationMinutes: 90 });
  });
  it('いつからより前の予定は数えない・変えない', () => {
    const d0 = data();
    const temp = saved(d0, MON, { staffId: 's1', start: '09:30' });
    const d = { ...d0, visits: [temp] };
    const t = tableWith(d, [['p1', 1, 's2', null]]);
    expect(temporaryChanges(d, t, MON, TODAY)).toHaveLength(1);
    expect(temporaryChanges(d, t, '2026-10-13', TODAY)).toEqual([]);
    const out = reg(d, t, '2026-10-13');
    expect(out.visits).toContainEqual(temp);
  });
  it('伝えた日の回は変えない（いつからは伝えた日より後）', () => {
    const d0 = data();
    const told = saved(d0, MON, { staffId: 's2' });
    const d = { ...d0, visits: [told], snapshots: { [MON]: { date: MON, at: 0, visits: [] } } };
    const out = reg(d, tableWith(d, [['p1', 1, 's1', '10:00']]));
    expect(out.visits).toContainEqual(told);
    expect(out.standard?.from).toBe('2026-10-13');
  });
  it('違うマスが無ければ同じデータ', () => {
    const d = data();
    expect(reg(d, currentTable(d, TODAY))).toBe(d);
  });
  it('案から作った下書きなら点数の基準をそのプリセットにする。渡さなければ今のまま', () => {
    const presets = initialPresets();
    const d = data({ presets, scorePresetId: presets[0]!.id });
    const t = tableWith(d, [['p1', 1, 's2', null]]);
    const withPreset = registerStandard(d, t, MON, TODAY, {
      newId: ids,
      temp: 'drop',
      at: 1,
      presetId: presets[1]!.id,
    });
    expect(withPreset.scorePresetId).toBe(presets[1]!.id);
    expect(withPreset.standard?.presetId).toBe(presets[1]!.id);
    const without = reg(d, t);
    expect(without.scorePresetId).toBe(presets[0]!.id);
    expect(without.standard?.presetId).toBe(presets[0]!.id);
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
    expect(cycleWeeks(d0, TODAY).weeks).toBe(2);
    const out = reg(d0, tableWith(d0, [['p1', 1, 's2', null]]));
    const np = out.patterns.find((p) => p.usualStaffId === 's2')!;
    expect(np.from).toBe('2026-10-19');
    expect(out.standard?.weeks).toBe(2);
    const on = (date: string) => visitsOn(out, date).map((v) => v.staffId);
    expect(on('2026-10-12')).toEqual([]);
    expect(on('2026-10-19')).toEqual(['s2']);
    expect(on('2026-10-26')).toEqual([]);
    expect(on('2026-11-02')).toEqual(['s2']);
  });
  it('いつからより前に終わる繰り返しは書き換えない', () => {
    const d = data({ patterns: [pattern({ to: '2026-10-21' })] });
    expect(reg(d, tableWith(d, [['p1', 1, 's2', null]]), '2026-10-26')).toBe(d);
  });
  it('標準と同じピンの回はピンのまま残す', () => {
    const d0 = data();
    const d = {
      ...d0,
      visits: [saved(d0, MON, { staffId: 's2', pinned: true }), saved(d0, WED, { staffId: 's2' })],
    };
    const out = reg(
      d,
      tableWith(d, [
        ['p1', 1, 's2', null],
        ['p1', 3, 's2', null],
      ]),
    );
    expect(visitsOn(out, MON)[0]).toMatchObject({ staffId: 's2', pinned: true });
    expect(visitsOn(out, WED)[0]).toMatchObject({ staffId: 's2', pinned: false });
  });
  it('伝えた日へ動かした回の元の日より前は、いつからに選べない', () => {
    const d0 = data();
    const movedVisit = saved(d0, WED, { date: MON, pattern: { id: 'p1', date: WED, edited: true } });
    const d = { ...d0, visits: [movedVisit], snapshots: { [MON]: { date: MON, at: 0, visits: [] } } };
    expect(earliestSince(d, TODAY)).toBe('2026-10-15');
  });
  it('登録し直し：分けた後の側をその場で書き換える', () => {
    const d = data();
    const once = reg(d, tableWith(d, [['p1', 1, 's2', null]]));
    const cur = currentTable(once, TODAY);
    const [monId] = Object.keys(cur);
    const twice = reg(once, setCell(cur, { patternId: monId!, weekday: 1 }, { staffId: 's1', start: '10:00' }));
    expect(twice.patterns.length).toBe(once.patterns.length);
    expect(twice.patterns.find((p) => p.id === monId)).toMatchObject({ usualStaffId: 's1', from: MON });
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

describe('PR #92 のレビュー', () => {
  it('いつからで分けた後の側の繰り返しがあれば、その開始日より前はいつからに選べない', () => {
    const d = data({
      patterns: [pattern({ to: '2026-10-18' }), pattern({ id: 'n1', from: '2026-10-19', usualStaffId: 's2' })],
    });
    expect(earliestSince(d, TODAY)).toBe('2026-10-19');
    // 前の側がもう終わっていれば制限しない
    expect(earliestSince(d, '2026-10-19')).toBe('2026-10-19');
  });
  it('繰り返しの担当・標準の開始が同じ ID のまま変わったら、下書きの印が変わる', () => {
    const d = data();
    const changed = data({ patterns: [pattern({ usualStaffId: 's2' })] });
    const started = data({ patterns: [pattern({ usualStarts: [{ weekday: 1, start: '10:00' }] })] });
    expect(patternsKey(changed, TODAY)).not.toBe(patternsKey(d, TODAY));
    expect(patternsKey(started, TODAY)).not.toBe(patternsKey(d, TODAY));
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
