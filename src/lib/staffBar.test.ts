import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { addDays, hhmmToMinutes } from '../domain/time';
import { compile } from '../matching';
import { createDemoData } from '../seed';
import { dayLoad } from '../vacancy';
import { dayRoutes, writeRoutes } from './dayPlan';
import { dayPlanOf, staffDay } from './month';
import {
  busyParts,
  isAllRest,
  type StaffSlot,
  spanParts,
  spansOf,
  staffEdgeTexts,
  staffSlotSummary,
  staffSlots,
  staffSlotText,
} from './staffBar';
import { staffWeekTable, weekDates, weekDay } from './week';
import { workStats } from './workload';

const m = hhmmToMinutes;
const at = (slots: StaffSlot[], hhmm: string) => slots.find((x) => x.start === m(hhmm))?.state;
const span = (a: string, b: string) => ({ start: m(a), end: m(b) });

describe('busyParts・spanParts', () => {
  const stops = [
    { start: m('09:00'), end: m('10:00'), travelIn: 20 },
    { start: m('11:00'), end: m('12:00'), travelIn: 15 },
    { start: m('12:10'), end: m('13:00'), travelIn: 10 },
  ];

  it('busyParts：移動は訪問の直前（最初の訪問の自宅からの移動も入れる）。移動 0分は出さない', () => {
    expect(busyParts(stops)).toEqual([
      { kind: 'travel', start: m('08:40'), end: m('09:00') },
      { kind: 'visit', start: m('09:00'), end: m('10:00') },
      { kind: 'travel', start: m('10:45'), end: m('11:00') },
      { kind: 'visit', start: m('11:00'), end: m('12:00') },
      { kind: 'travel', start: m('12:00'), end: m('12:10') },
      { kind: 'visit', start: m('12:10'), end: m('13:00') },
    ]);
    expect(busyParts([{ start: 60, end: 90, travelIn: 0 }])).toEqual([{ kind: 'visit', start: 60, end: 90 }]);
  });

  it('spanParts：拘束の中だけ。訪問のあいだは 待ち→移動（移動は次の訪問の直前）、隙間なく並ぶ', () => {
    const parts = spanParts(stops);
    expect(parts).toEqual([
      { kind: 'visit', start: m('09:00'), end: m('10:00') },
      { kind: 'wait', start: m('10:00'), end: m('10:45') },
      { kind: 'travel', start: m('10:45'), end: m('11:00') },
      { kind: 'visit', start: m('11:00'), end: m('12:00') },
      { kind: 'travel', start: m('12:00'), end: m('12:10') },
      { kind: 'visit', start: m('12:10'), end: m('13:00') },
    ]);
    for (let i = 1; i < parts.length; i++) expect(parts[i]!.start).toBe(parts[i - 1]!.end);
    expect(spanParts([])).toEqual([]);
  });
});

describe('staffSlots', () => {
  it('0:00〜24:00 の30分ごと（48マス。PRD D82）。訪問＞移動＞空き＞休み（欠勤の時間）＞勤務外', () => {
    const slots = staffSlots({
      shift: [span('08:00', '12:00')],
      base: [span('08:00', '17:00')],
      busy: busyParts([{ start: m('09:00'), end: m('10:00'), travelIn: 20 }]),
    });
    expect(slots).toHaveLength(48);
    expect(slots[0]!.start).toBe(0);
    expect(slots.at(-1)!.start).toBe(m('23:30'));
    expect(at(slots, '07:30')).toBe('outside');
    expect(at(slots, '08:00')).toBe('free');
    // 8:40〜9:00 の移動
    expect(at(slots, '08:30')).toBe('travel');
    expect(at(slots, '09:00')).toBe('visit');
    expect(at(slots, '09:30')).toBe('visit');
    expect(at(slots, '10:00')).toBe('free');
    // 12:00〜17:00 は欠勤（休み）、その後は勤務外
    expect(at(slots, '12:00')).toBe('rest');
    expect(at(slots, '16:30')).toBe('rest');
    expect(at(slots, '17:00')).toBe('outside');
  });

  it('30分に少しでも重なれば数える（dayLoad と同じ）。訪問と移動が同じマスなら訪問', () => {
    const slots = staffSlots({
      shift: [span('07:00', '20:00')],
      base: [span('07:00', '20:00')],
      busy: busyParts([{ start: m('10:20'), end: m('10:40'), travelIn: 25 }]),
    });
    expect(at(slots, '09:30')).toBe('travel'); // 9:55〜10:20 の移動
    expect(at(slots, '10:00')).toBe('visit');
    expect(at(slots, '10:30')).toBe('visit');
    expect(at(slots, '11:00')).toBe('free');
  });

  it('稼働時間帯が無い日（勤務なし・終日の欠勤・希望休・最終勤務日の後）は 8〜20時が全部休み（外は勤務外）。残った訪問は訪問で出す', () => {
    const off = staffSlots({ shift: [], base: [], busy: [] });
    expect(off.filter((x) => x.start >= m('08:00') && x.start < m('20:00')).every((x) => x.state === 'rest')).toBe(
      true,
    );
    expect(off.filter((x) => x.start < m('08:00') || x.start >= m('20:00')).every((x) => x.state === 'outside')).toBe(
      true,
    );
    expect(staffSlotSummary(off)).toBe('休み 8:00〜20:00');
    expect(staffEdgeTexts(off)).toEqual({ early: null, late: null });
    const left = staffSlots({
      shift: [],
      base: [span('09:00', '17:00')],
      busy: busyParts([{ start: m('14:00'), end: m('15:00'), travelIn: 0 }]),
    });
    expect(at(left, '14:00')).toBe('visit');
    expect(at(left, '08:00')).toBe('rest');
    // 8時より前は、欠勤の前の稼働時間帯（9:00〜）にも掛からないので勤務外
    expect(at(left, '07:00')).toBe('outside');
    expect(left.filter((x) => x.state === 'visit')).toHaveLength(2);
  });

  it('計算できない日（planned: false）は勤務内を「分からない」にし、空きにしない。休み・勤務外はそのまま', () => {
    const slots = staffSlots({
      shift: [span('09:00', '12:00')],
      base: [span('09:00', '13:00')],
      busy: [],
      planned: false,
    });
    expect(at(slots, '09:00')).toBe('noplan');
    expect(at(slots, '11:30')).toBe('noplan');
    expect(at(slots, '12:00')).toBe('rest');
    expect(at(slots, '13:00')).toBe('outside');
    expect(slots.some((x) => x.state === 'free')).toBe(false);
    expect(staffSlotSummary(slots)).toBe('分からない 9:00〜12:00・休み 12:00〜13:00');
  });

  it('spansOf：HH:mm の時間帯を分に', () => {
    expect(spansOf([{ start: '08:00', end: '12:30' }])).toEqual([{ start: 480, end: 750 }]);
  });
});

describe('端の印（PRD D82）', () => {
  it('8時より前・20時以降の 訪問・移動・空き・案なし を「8時より前：…」「20時以降：…」に。休み・勤務外だけなら出さない', () => {
    const slots = staffSlots({
      shift: [span('06:30', '21:00')],
      base: [span('06:30', '21:00')],
      busy: busyParts([
        { start: m('07:00'), end: m('07:30'), travelIn: 20 },
        { start: m('20:00'), end: m('20:30'), travelIn: 0 },
      ]),
    });
    expect(staffEdgeTexts(slots)).toEqual({
      early: '8時より前：訪問 7:00〜7:30・移動 6:30〜7:00・空き 7:30〜8:00',
      late: '20時以降：訪問 20:00〜20:30・空き 20:30〜21:00',
    });
    // 8〜20時の中だけなら印なし
    const inside = staffSlots({ shift: [span('08:00', '20:00')], base: [span('08:00', '20:00')], busy: [] });
    expect(staffEdgeTexts(inside)).toEqual({ early: null, late: null });
    // 欠勤の時間（休み）だけなら印なし
    const rest = staffSlots({ shift: [span('08:00', '18:00')], base: [span('07:00', '18:00')], busy: [] });
    expect(at(rest, '07:00')).toBe('rest');
    expect(staffEdgeTexts(rest)).toEqual({ early: null, late: null });
  });

  it('間の勤務外を抜いたマスでも、時刻が続かなければ区切る', () => {
    const slots = staffSlots({
      shift: [span('05:00', '05:30'), span('06:30', '07:00')],
      base: [span('05:00', '05:30'), span('06:30', '07:00')],
      busy: [],
    });
    expect(staffEdgeTexts(slots).early).toBe('8時より前：空き 5:00〜5:30、6:30〜7:00');
  });
});

describe('文', () => {
  it('staffSlotText・staffSlotSummary（続く時間帯をまとめる。勤務外は書かない）', () => {
    const slots = staffSlots({
      shift: [span('09:00', '12:00')],
      base: [span('09:00', '13:00')],
      busy: busyParts([{ start: m('10:00'), end: m('11:00'), travelIn: 30 }]),
    });
    expect(staffSlotText(slots.find((x) => x.start === m('09:00'))!)).toBe('9:00〜9:30 空き');
    expect(staffSlotSummary(slots)).toBe(
      '訪問 10:00〜11:00・移動 9:30〜10:00・空き 9:00〜9:30、11:00〜12:00・休み 12:00〜13:00',
    );
    // 20時以降の勤務も数える（PRD D82）
    expect(staffSlotSummary(staffSlots({ shift: [span('21:00', '22:00')], base: [], busy: [] }))).toBe(
      '空き 21:00〜22:00',
    );
    expect(staffSlotSummary([{ start: m('09:00'), state: 'outside' }])).toBe('どの時間も勤務外');
  });
});

/** seed の2週の各日に、素朴な担当（訪問を順に担当へ回す）を訪問に書いたデータ（版2：担当は訪問に持つ） */
function seeded(): { data: DemoData; from: string } {
  const today = '2026-10-13';
  let data = createDemoData(today);
  for (let i = 0; i < 14; i++) {
    const date = addDays(today, i);
    const p = compile(data, date);
    if (p.visits.length === 0) continue;
    const working = p.staff.filter((s) => s.slots.length > 0).map((s) => s.id);
    const routes: Record<string, string[]> = {};
    p.visits.forEach((v, k) => {
      const sid = working[k % working.length]!;
      routes[sid] = [...(routes[sid] ?? []), v.id];
    });
    data = writeRoutes(data, date, p, routes, { pins: {} });
  }
  return { data, from: today };
}

describe('ほかの数え方と食い違わない', () => {
  it('月の混み具合（dayLoad）の「空き N人」＝その30分が「空き」の人の数、「働く」＝空き・訪問・移動のうち稼働時間帯に重なる人', () => {
    const { data, from } = seeded();
    let checked = 0;
    for (let i = 0; i < 14; i++) {
      const date = addDays(from, i);
      const load = dayLoad(data, date, { typeId: null });
      if (!load) continue;
      const p = compile(data, date);
      const day = dayPlanOf(data, date, p);
      const bars = p.staff.filter((s) => s.slots.length > 0).map((s) => staffDay(data, day, s.id).bar);
      load.forEach((x, k) => {
        expect(bars.filter((b) => b[k]!.state === 'free').length).toBe(x.free);
      });
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('8時より前・20時以降に勤務・訪問がある人がいても、1日全体（0〜24時）で空きの人数が一致する（PRD D82）', () => {
    const { data: d0, from } = seeded();
    // 1人目を 6:30〜21:00 の勤務に、その人の訪問を 7:00 と 20:00 から入れられるようにする
    const sid = d0.staff[0]!.id;
    const data: DemoData = {
      ...d0,
      staff: d0.staff.map((s) => (s.id === sid ? { ...s, shiftStart: '06:30', shiftEnd: '21:00' } : s)),
    };
    let early = 0;
    let late = 0;
    for (let i = 0; i < 14; i++) {
      const date = addDays(from, i);
      const load = dayLoad(data, date, { typeId: null });
      if (!load) continue;
      expect(load).toHaveLength(48);
      const p = compile(data, date);
      const day = dayPlanOf(data, date, p);
      const bars = p.staff.filter((s) => s.slots.length > 0).map((s) => staffDay(data, day, s.id).bar);
      load.forEach((x, k) => {
        expect(bars.filter((b) => b[k]!.state === 'free').length).toBe(x.free);
      });
      if (load.some((x) => x.start < m('08:00') && x.working > 0)) early++;
      if (load.some((x) => x.start >= m('20:00') && x.working > 0)) late++;
      const mine = staffDay(data, day, sid).bar;
      if (mine.some((x) => x.start < m('08:00') && x.state !== 'outside')) {
        expect(staffEdgeTexts(mine).early).toMatch(/^8時より前：/);
      }
    }
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(0);
  });

  it('訪問の無い勤務日は「空き」（dayLoad と同じ）', () => {
    const { data, from } = seeded();
    const date = addDays(from, 1);
    const empty: DemoData = { ...data, visits: [], patterns: [] };
    const p = compile(empty, date);
    const sid = p.staff.find((s) => s.slots.length > 0)!.id;
    const x = staffDay(empty, dayPlanOf(empty, date), sid);
    expect(x.bar.some((y) => y.state === 'free')).toBe(true);
    expect(x.bar.some((y) => y.state === 'noplan')).toBe(false);
    const load = dayLoad(empty, date, { typeId: null })!;
    expect(load.some((y) => y.free > 0)).toBe(true);
  });

  it('週の表のマスのバーは月の staffDay と同じ（訪問の担当）', () => {
    const { data, from } = seeded();
    const days = weekDates(from).map((date) => weekDay(data, date));
    const t = staffWeekTable(data, days);
    for (const r of t.rows)
      r.cells.forEach((c, k) => {
        expect(c.bar).toEqual(staffDay(data, dayPlanOf(data, days[k]!.date), r.staffId).bar);
      });
  });

  it('稼働の見込みの内訳の合計は 訪問・移動・待ち の分と拘束に一致する', () => {
    const { data, from } = seeded();
    const p = compile(data, from);
    const stats = workStats(p, dayRoutes(data, from, p), data.org);
    expect(stats.length).toBeGreaterThan(0);
    for (const s of stats) {
      const sum = (k: string) => s.parts.filter((x) => x.kind === k).reduce((acc, x) => acc + x.end - x.start, 0);
      expect(sum('visit')).toBeCloseTo(s.visit, 6);
      expect(sum('travel')).toBeCloseTo(s.travel, 6);
      expect(sum('wait')).toBeCloseTo(s.wait, 6);
      expect(s.parts[0]!.start).toBe(s.start);
      expect(s.parts.at(-1)!.end).toBe(s.end);
    }
  });
});

describe('isAllRest（3段とも休みか。PRD D85）', () => {
  const day = (state: (t: number) => StaffSlot['state']): StaffSlot[] =>
    Array.from({ length: 48 }, (_, i) => ({ start: i * 30, state: state(i * 30) }));
  it('8〜20時が全部休みなら true（8時より前・20時以降は見ない）', () => {
    expect(isAllRest(day((t) => (t < 8 * 60 || t >= 20 * 60 ? 'outside' : 'rest')))).toBe(true);
    expect(isAllRest(day(() => 'rest'))).toBe(true);
  });
  it('休みの日に訪問が1件残っていれば false（重ねて隠さない）', () => {
    expect(isAllRest(day((t) => (t === 10 * 60 ? 'visit' : 'rest')))).toBe(false);
    expect(isAllRest(day((t) => (t === 9 * 60 + 30 ? 'travel' : 'rest')))).toBe(false);
  });
  it('時間の欠勤（一部だけ休み）・8〜20時のマスが無い並びは false', () => {
    expect(isAllRest(day((t) => (t >= 13 * 60 && t < 20 * 60 ? 'rest' : 'free')))).toBe(false);
    expect(isAllRest([{ start: 7 * 60, state: 'rest' }])).toBe(false);
    expect(isAllRest([])).toBe(false);
  });
});
