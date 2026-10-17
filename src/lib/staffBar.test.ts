import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { addDays, hhmmToMinutes } from '../domain/time';
import { compile } from '../matching';
import { applyPatterns } from '../patterns';
import { createDemoData } from '../seed';
import { dayLoad } from '../vacancy';
import { dayPlanOf, staffDay } from './month';
import { busyParts, type StaffSlot, spanParts, spansOf, staffSlotSummary, staffSlots, staffSlotText } from './staffBar';
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
  it('07:00〜20:00 の30分ごと（26マス）。訪問＞移動＞空き＞休み（欠勤の時間）＞勤務外', () => {
    const slots = staffSlots({
      shift: [span('08:00', '12:00')],
      base: [span('08:00', '17:00')],
      busy: busyParts([{ start: m('09:00'), end: m('10:00'), travelIn: 20 }]),
    });
    expect(slots).toHaveLength(26);
    expect(slots[0]!.start).toBe(m('07:00'));
    expect(slots.at(-1)!.start).toBe(m('19:30'));
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

  it('稼働時間帯が無い日（勤務なし・終日の欠勤・希望休・最終勤務日の後）は全部休み。残った訪問は訪問で出す', () => {
    const off = staffSlots({ shift: [], base: [], busy: [] });
    expect(off.every((x) => x.state === 'rest')).toBe(true);
    const left = staffSlots({
      shift: [],
      base: [span('09:00', '17:00')],
      busy: busyParts([{ start: m('14:00'), end: m('15:00'), travelIn: 0 }]),
    });
    expect(at(left, '14:00')).toBe('visit');
    expect(at(left, '07:00')).toBe('rest');
    expect(left.filter((x) => x.state === 'visit')).toHaveLength(2);
  });

  it('案の無い日（planned: false）は勤務内を「案なし」にし、空きにしない。休み・勤務外はそのまま', () => {
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
    expect(staffSlotSummary(slots)).toBe('案なし 9:00〜12:00・休み 12:00〜13:00');
  });

  it('spansOf：HH:mm の時間帯を分に', () => {
    expect(spansOf([{ start: '08:00', end: '12:30' }])).toEqual([{ start: 480, end: 750 }]);
  });
});

describe('文', () => {
  it('staffSlotText・staffSlotSummary（続く時間帯をまとめる。勤務外は書かない）', () => {
    const slots = staffSlots({
      shift: [span('09:00', '12:00')],
      base: [span('09:00', '13:00')],
      busy: busyParts([{ start: m('10:00'), end: m('11:00'), travelIn: 30 }]),
    });
    expect(staffSlotText(slots[4]!)).toBe('9:00〜9:30 空き');
    expect(staffSlotSummary(slots)).toBe(
      '訪問 10:00〜11:00・移動 9:30〜10:00・空き 9:00〜9:30、11:00〜12:00・休み 12:00〜13:00',
    );
    expect(staffSlotSummary(staffSlots({ shift: [span('21:00', '22:00')], base: [], busy: [] }))).toBe(
      'どの時間も勤務外',
    );
  });
});

/** seed を2週に広げ、各日に素朴な確定した割当（訪問を順に担当へ回す）を入れたデータ */
function seeded(): { data: DemoData; from: string } {
  const today = '2026-10-13';
  const d0 = createDemoData(today);
  const ch = applyPatterns(d0, { from: today, to: addDays(today, 13) }, today);
  const data: DemoData = { ...d0, patterns: ch.patterns, visits: ch.visits };
  const manualPlans: DemoData['manualPlans'] = {};
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
    manualPlans[date] = routes;
  }
  return { data: { ...data, manualPlans }, from: today };
}

describe('ほかの数え方と食い違わない', () => {
  it('月の混み具合（dayLoad）の「空き N人」＝その30分が「空き」の人の数、「働く」＝空き・訪問・移動のうち稼働時間帯に重なる人', () => {
    const { data, from } = seeded();
    let checked = 0;
    for (let i = 0; i < 14; i++) {
      const date = addDays(from, i);
      const load = dayLoad(data, date, { typeId: null });
      if (!load) continue;
      const p = compile({ ...data, visits: data.visits.filter((v) => v.date === date) }, date);
      const day = dayPlanOf(data, date, p);
      const bars = p.staff.filter((s) => s.slots.length > 0).map((s) => staffDay(data, day, s.id).bar);
      load.forEach((x, k) => {
        expect(bars.filter((b) => b[k]!.state === 'free').length).toBe(x.free);
      });
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('週の表のマスのバーは月の staffDay と同じ（数える案は今の案、無ければ確定した割当）', () => {
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
    const p = compile({ ...data, visits: data.visits.filter((v) => v.date === from) }, from);
    const stats = workStats(p, data.manualPlans[from]!, data.org, true);
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
