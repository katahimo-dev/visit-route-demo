// 空き状況と問い合わせの試算（ADR-0012 追記。段階3）。design.md §4 vacancy の完了の条件
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Client, Visit, VisitType } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import type { Routes } from '../contracts/reassign';
import type { VacancyQuery } from '../contracts/vacancy';
import { addDays, hhmmToMinutes, minutesToHhmm, weekday } from '../domain/time';
import { baseOf } from '../lib/absences';
import { compile, naiveSeqs, scheduleRoute } from '../matching';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { applyPatterns } from '../patterns';
import { placeVisit } from '../reassign';
import { createDemoData } from '../seed';
import {
  dayLoad,
  INQUIRY_CLIENT_ID,
  INQUIRY_VISIT_ID,
  inquirySummary,
  type VacancyCell,
  type VacancyNoticeInput,
  type VacancyResult,
  vacancyNotice,
  vacancyOf,
  verdictOf,
} from './index';

const TERMS = { client: '利用者さん', staff: 'ヘルパー' };
const PLACE = { address: '近く', lat: 38.2605, lng: 140.8705 };
const MON1 = DATE; // 2026-10-12（月）
const MON2 = addDays(DATE, 7);
const WED1 = addDays(DATE, 2);
const m = hhmmToMinutes;

const query = (over: Partial<VacancyQuery> = {}): VacancyQuery => ({
  typeId: null,
  durationMinutes: 60,
  requirements: [],
  place: PLACE,
  marginMinutes: 15,
  dayStart: '07:00',
  dayEnd: '20:00',
  stepMinutes: 30,
  ...over,
});
const fixedOn = (id: string, c: string, date: string, at: string, minutes = 60): Visit =>
  visit(id, c, at, at, { date, windowKind: 'fixed', durationMinutes: minutes });
const cellOf = (r: VacancyResult, wd: number, at: string): VacancyCell =>
  r.cells.find((c) => c.weekday === wd && c.start === m(at))!;
const staffOn = (c: VacancyCell, date: string) => c.byDate.find((x) => x.date === date)?.staffIds;

/**
 * s1（女性・看護師。8:00〜18:00、月〜金）。月曜 2回：どちらも 9:00〜12:00 は訪問で詰まり、2回目の月曜だけ 14:00〜17:00 も詰まる。
 * 確定した割当（manualPlans）を元の案にする
 */
function small(over: Partial<DemoData> = {}): DemoData {
  const visits = [
    fixedOn('a1', 'c1', MON1, '09:00', 180),
    fixedOn('b1', 'c1', MON2, '09:00', 180),
    fixedOn('b2', 'c2', MON2, '14:00', 180),
  ];
  return makeData({
    staff: [staff('s1', 38.26, 140.87, { traits: { gender: '女性', license: ['看護師'] } })],
    clients: [client('c1', 38.261, 140.871), client('c2', 38.262, 140.871)],
    visits,
    manualPlans: { [MON1]: { s1: ['a1'] }, [MON2]: { s1: ['b1', 'b2'] } },
    ...over,
  });
}

describe('vacancyOf：判定（小さな問題）', () => {
  it('空いている人がいる時刻は ○、詰まっている時刻・稼働時間外は ×、ある週だけ詰まっていれば △ と入らない日付', () => {
    for (const place of [PLACE, null]) {
      const r = vacancyOf(small(), query({ place }), { from: MON1, weeks: 2 });
      expect(r.exact).toBe(place !== null);
      expect(r.dates).toHaveLength(14);
      expect(r.noPlanDates).toEqual([]);
      // 12:30：どちらの月曜も空いている（2回目の月曜は 14:00 の訪問に移動して間に合う）
      const c13 = cellOf(r, 1, '12:30');
      expect(verdictOf(c13)).toBe('ok');
      expect(c13).toMatchObject({ min: 1, weeksOk: 2, weeksTotal: 2 });
      expect(c13.byDate.map((x) => x.date)).toEqual([MON1, MON2]);
      // 10:00：どちらも訪問で詰まる
      expect(verdictOf(cellOf(r, 1, '10:00'))).toBe('ng');
      // 7:00・17:30：稼働時間外（8:00〜18:00）
      expect(verdictOf(cellOf(r, 1, '07:00'))).toBe('ng');
      expect(verdictOf(cellOf(r, 1, '17:30'))).toBe('ng');
      // 15:00：2回目の月曜だけ詰まる → △、入らない日付は2回目の月曜
      const c15 = cellOf(r, 1, '15:00');
      expect(verdictOf(c15)).toBe('partial');
      expect(c15).toMatchObject({ min: 0, weeksOk: 1, weeksTotal: 2 });
      expect(staffOn(c15, MON1)).toEqual(['s1']);
      expect(staffOn(c15, MON2)).toEqual([]);
      // 土曜は休み（訪問の無い日は空の案として数える）
      expect(cellOf(r, 6, '13:00')).toMatchObject({ weeksOk: 0, weeksTotal: 2 });
      expect(verdictOf(cellOf(r, 6, '13:00'))).toBe('ng');
    }
  });

  it('正確は移動を含む：近い場所なら訪問のすぐあとに入り、遠い場所では入らない。目安は前後の余白で見る', () => {
    const range = { from: MON1, weeks: 1 };
    const near = vacancyOf(small(), query(), range);
    const rough = vacancyOf(small(), query({ place: null }), range);
    // 12:00（訪問の終わりちょうど）：正確は移動の分だけ間に合わず、目安も余白15分で ×
    expect(staffOn(cellOf(near, 1, '12:00'), MON1)).toEqual([]);
    expect(staffOn(cellOf(rough, 1, '12:00'), MON1)).toEqual([]);
    expect(staffOn(cellOf(near, 1, '12:30'), MON1)).toEqual(['s1']);
    expect(staffOn(cellOf(rough, 1, '12:30'), MON1)).toEqual(['s1']);
    // 遠い場所（車で40分ほど）：訪問のすぐあと・始業直後には着けない
    const far = vacancyOf(small(), query({ place: { address: '遠く', lat: 38.4, lng: 140.95 } }), range);
    expect(staffOn(cellOf(far, 1, '12:30'), MON1)).toEqual([]);
    expect(staffOn(cellOf(far, 1, '08:00'), MON1)).toEqual([]);
    expect(staffOn(cellOf(far, 1, '15:00'), MON1)).toEqual(['s1']);
  });

  it('開始時刻：dayStart〜dayEnd を step 刻み。終わりが dayEnd を超える時刻は出さない。範囲が空なら times も cells も空', () => {
    const r = vacancyOf(small(), query({ durationMinutes: 90 }), { from: MON1, weeks: 1 });
    expect(r.times[0]).toBe(m('07:00'));
    expect(r.times.at(-1)).toBe(m('18:30'));
    expect(r.cells).toHaveLength(7 * r.times.length);
    expect(r.cells.map((c) => c.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6].flatMap((wd) => r.times.map(() => wd)));
    const empty = vacancyOf(small(), query({ dayStart: '19:30', dayEnd: '20:00' }), { from: MON1, weeks: 1 });
    expect(empty.times).toEqual([]);
    expect(empty.cells).toEqual([]);
    expect(empty.dates).toHaveLength(7);
  });
});

describe('vacancyOf：担当できる人', () => {
  /** s2（男性・資格なし）を足す。s2 は終日空いている */
  const withS2 = (over: Partial<DemoData> = {}) => {
    const d = small(over);
    return {
      ...d,
      staff: [...d.staff, staff('s2', 38.2602, 140.8702, { traits: { gender: '男性', license: ['なし'] } })],
      ...over,
    };
  };
  const REHAB: VisitType = {
    id: 'rehab',
    name: 'リハビリ',
    color: 0,
    durationMinutes: 60,
    requirements: [{ itemId: 'license', op: 'hasAny', value: ['看護師'] }],
    note: '',
  };

  it('query.requirements・種類の必要条件を満たさない人は数えない', () => {
    for (const place of [PLACE, null]) {
      const range = { from: MON1, weeks: 1 };
      const all = vacancyOf(withS2(), query({ place }), range);
      expect(staffOn(cellOf(all, 1, '13:00'), MON1)?.sort()).toEqual(['s1', 's2']);
      const women = vacancyOf(
        withS2(),
        query({ place, requirements: [{ itemId: 'gender', op: 'is', value: '女性' }] }),
        range,
      );
      expect(staffOn(cellOf(women, 1, '13:00'), MON1)).toEqual(['s1']);
      // 10:00 は s1 が詰まっている：女性の条件では ×
      expect(verdictOf(cellOf(women, 1, '10:00'))).toBe('ng');
      const rehab = vacancyOf(withS2({ visitTypes: [REHAB] }), query({ place, typeId: 'rehab' }), range);
      expect(staffOn(cellOf(rehab, 1, '13:00'), MON1)).toEqual(['s1']);
      // いない種類は種類なし
      const ghost = vacancyOf(withS2(), query({ place, typeId: 'ghost' }), range);
      expect(staffOn(cellOf(ghost, 1, '13:00'), MON1)?.sort()).toEqual(['s1', 's2']);
    }
  });

  it('欠勤の時間は空きにならない', () => {
    for (const place of [PLACE, null]) {
      const d = small({ absences: [{ id: 'x', staffId: 's1', date: MON1, from: '13:00', to: '15:00', note: '' }] });
      const r = vacancyOf(d, query({ place }), { from: MON1, weeks: 1 });
      expect(staffOn(cellOf(r, 1, '13:00'), MON1)).toEqual([]);
      expect(staffOn(cellOf(r, 1, '14:00'), MON1)).toEqual([]);
      expect(staffOn(cellOf(r, 1, '15:30'), MON1)).toEqual(['s1']);
    }
  });

  it('休み・稼働時間の上書きで休みの人は数えない', () => {
    const d = small({ availability: [{ staffId: 's1', date: MON1, slots: [] }] });
    const r = vacancyOf(d, query(), { from: MON1, weeks: 1 });
    expect(staffOn(cellOf(r, 1, '13:00'), MON1)).toEqual([]);
  });
});

describe('vacancyOf：元の案', () => {
  it('訪問があって案も確定も無い日は数えず noPlanDates に出る。訪問の無い日は空の案として数える', () => {
    const d = small();
    const x: DemoData = { ...d, visits: [...d.visits, fixedOn('w1', 'c1', WED1, '10:00')] };
    for (const place of [PLACE, null]) {
      const r = vacancyOf(x, query({ place }), { from: MON1, weeks: 1 });
      expect(r.noPlanDates).toEqual([WED1]);
      const c = cellOf(r, 3, '13:00');
      expect(c.weeksTotal).toBe(0);
      expect(c.byDate).toEqual([]);
      expect(verdictOf(c)).toBe('unknown');
      // 木曜は訪問が無い：空の案
      expect(cellOf(r, 4, '13:00')).toMatchObject({ weeksTotal: 1, weeksOk: 1 });
    }
  });

  it('確定した割当が無ければ今の案（aiPlans）を元の案にする', () => {
    const d = small({ manualPlans: {} });
    const plan = (date: string, routes: Routes) => ({
      date,
      createdAt: 0,
      seed: 1,
      iterations: 1,
      routes,
      unassigned: [],
      score: 0,
      stopped: false,
      rules: [],
      generated: { routes, unassigned: [], score: 0 },
      pins: {},
    });
    const x: DemoData = { ...d, aiPlans: { [MON1]: plan(MON1, { s1: ['a1'] }) } };
    const r = vacancyOf(x, query(), { from: MON1, weeks: 2 });
    expect(r.noPlanDates).toEqual([MON2]);
    expect(verdictOf(cellOf(r, 1, '10:00'))).toBe('ng');
    expect(verdictOf(cellOf(r, 1, '15:00'))).toBe('ok');
  });
});

describe('verdictOf', () => {
  const cell = (weeksOk: number, weeksTotal: number): VacancyCell => ({
    weekday: 1,
    start: 600,
    byDate: [],
    min: 0,
    weeksOk,
    weeksTotal,
  });
  it('数えた日が0なら unknown、全部なら ok、一部なら partial、無ければ ng', () => {
    expect(verdictOf(cell(0, 0))).toBe('unknown');
    expect(verdictOf(cell(4, 4))).toBe('ok');
    expect(verdictOf(cell(1, 4))).toBe('partial');
    expect(verdictOf(cell(0, 4))).toBe('ng');
  });
});

describe('inquirySummary', () => {
  /** times は 9:00〜12:00 の30分刻み。ok・partial は「曜日 → 開始時刻」の一覧 */
  const result = (ok: Record<number, string[]>, partial: Record<number, { at: string; missing: string[] }[]> = {}) => {
    const times = Array.from({ length: 7 }, (_, i) => m('09:00') + i * 30);
    const dates = Array.from({ length: 14 }, (_, i) => addDays('2026-10-18', i)); // 日曜から2週
    const cells: VacancyCell[] = [];
    for (let wd = 0; wd < 7; wd++) {
      const days = dates.filter((d) => weekday(d) === wd);
      for (const t of times) {
        const at = minutesToHhmm(t);
        const p = partial[wd]?.find((x) => x.at === at);
        const isOk = ok[wd]?.includes(at) ?? false;
        const byDate = days.map((date) => ({
          date,
          staffIds: isOk || (p && !p.missing.includes(date)) ? ['s1'] : [],
        }));
        const n = byDate.filter((x) => x.staffIds.length > 0).length;
        cells.push({
          weekday: wd,
          start: t,
          byDate,
          min: n === days.length ? 1 : 0,
          weeksOk: n,
          weeksTotal: days.length,
        });
      }
    }
    return { exact: true, dates, noPlanDates: [], times, cells };
  };
  const wish = (over = {}) => ({
    weekdays: [2, 4],
    from: '09:00',
    to: '12:00',
    perWeek: 2,
    startDate: '2026-10-20',
    ...over,
  });

  it('○ の連続した範囲をまとめ、週の回数が足りれば「対応できます」', () => {
    const r = result({ 2: ['10:00', '10:30', '11:00', '11:30'], 4: ['10:00', '10:30', '11:00', '11:30'] });
    expect(inquirySummary(r, wish(), TERMS)).toBe('火・木の 10:00〜11:30 なら、10月20日（火）から週2回で対応できます');
  });

  it('曜日ごとに範囲が違えば曜日ごとに並べ、途切れた範囲は分ける。希望の時間帯の外は見ない', () => {
    const r = result({ 2: ['09:00', '09:30', '11:00'], 4: ['10:00', '12:00'] });
    expect(inquirySummary(r, wish({ to: '11:30' }), TERMS)).toBe(
      '火 9:00〜9:30、11:00、木 10:00 なら、10月20日（火）から週2回で対応できます',
    );
  });

  it('週の回数が足りなければ ○ の曜日と △ の曜日（入らない日付）を並べる。呼び方は terms', () => {
    const r = result({ 2: ['10:00', '10:30'] }, { 4: [{ at: '10:00', missing: ['2026-10-29'] }] });
    expect(inquirySummary(r, wish(), TERMS)).toBe(
      '週2回のうち、どの週も対応できるのは 火の 10:00〜10:30 だけです\n木 10:00 は 10/29 に空いているヘルパーがいません',
    );
    expect(inquirySummary(r, wish(), { client: 'お客様', staff: 'シッター' })).toContain(
      '空いているシッターがいません',
    );
    // ○ が無く △ だけ
    const onlyPartial = result({}, { 4: [{ at: '10:00', missing: ['2026-10-22'] }] });
    expect(inquirySummary(onlyPartial, wish(), TERMS)).toBe(
      'ご希望の曜日・時間帯では、どの週も対応できる時間はありません\n木 10:00 は 10/22 に空いているヘルパーがいません',
    );
  });

  it('○ も △ も無ければ空きが無い。曜日の指定が無ければ全曜日を見る', () => {
    const r = result({ 5: ['10:00'] });
    expect(inquirySummary(r, wish(), TERMS)).toBe('ご希望の曜日・時間帯では、いまは空きがありません');
    expect(inquirySummary(r, wish({ weekdays: [], perWeek: 1 }), TERMS)).toBe(
      '金の 10:00 なら、10月20日（火）から週1回で対応できます',
    );
  });
});

describe('dayLoad', () => {
  const at = (load: ReturnType<typeof dayLoad>, hhmm: string) => load?.find((x) => x.start === m(hhmm));

  it('07:00〜20:00 の30分ごとに、働く人と、そのうち訪問の [開始 − 来る移動, 終了) と重ならない人（空き）', () => {
    // MON1：s1（8:00〜18:00）は 9:00〜12:00 が訪問。自宅から c1 への移動の分も使う
    const d = small();
    const load = dayLoad(d, MON1, { typeId: null })!;
    expect(load).toHaveLength(26);
    expect(load[0]!.start).toBe(m('07:00'));
    expect(load.at(-1)!.start).toBe(m('19:30'));
    const p = compile(d, MON1);
    const travel = p.travel[p.staff[0]!.point]![p.visits[0]!.point]!;
    expect(travel).toBeGreaterThan(0);
    expect(travel).toBeLessThan(30);
    // 稼働時間外は働く人 0
    expect(at(load, '07:30')).toEqual({ start: m('07:30'), working: 0, free: 0 });
    expect(at(load, '18:00')).toEqual({ start: m('18:00'), working: 0, free: 0 });
    // 8:30〜9:00 は来る移動に使う（空き 0）、8:00〜8:30 は空き
    expect(at(load, '08:00')).toEqual({ start: m('08:00'), working: 1, free: 1 });
    expect(at(load, '08:30')).toEqual({ start: m('08:30'), working: 1, free: 0 });
    expect(at(load, '11:30')).toEqual({ start: m('11:30'), working: 1, free: 0 });
    expect(at(load, '12:00')).toEqual({ start: m('12:00'), working: 1, free: 1 });
    // 訪問の無い日は空の案（全部空き）、休みの日は働く人 0
    expect(
      dayLoad(d, WED1, { typeId: null })!
        .filter((x) => x.working > 0)
        .every((x) => x.free === 1),
    ).toBe(true);
    expect(dayLoad(d, addDays(MON1, 5), { typeId: null })!.every((x) => x.working === 0 && x.free === 0)).toBe(true);
  });

  it('種類で絞る：種類の必要条件を満たさない人は数えない。いない種類は種類なし', () => {
    const rehab: VisitType = {
      id: 'rehab',
      name: 'リハビリ',
      color: 3,
      durationMinutes: 40,
      requirements: [{ itemId: 'license', op: 'hasAny', value: ['理学療法士'] }],
      note: '',
    };
    const nurse: VisitType = {
      ...rehab,
      id: 'nurse',
      requirements: [{ itemId: 'license', op: 'hasAny', value: ['看護師'] }],
    };
    const d = small({ visitTypes: [rehab, nurse] });
    expect(dayLoad(d, MON1, { typeId: 'rehab' })!.every((x) => x.working === 0 && x.free === 0)).toBe(true);
    expect(dayLoad(d, MON1, { typeId: 'nurse' })).toEqual(dayLoad(d, MON1, { typeId: null }));
    expect(dayLoad(d, MON1, { typeId: 'none' })).toEqual(dayLoad(d, MON1, { typeId: null }));
    // 理学療法士の s2（10:00〜16:00）を足す：すべての人なら 10:00〜12:00 は働く 2人・空き 1人、リハビリなら s2 だけ
    const s2 = staff('s2', 38.26, 140.87, {
      shiftStart: '10:00',
      shiftEnd: '16:00',
      traits: { license: ['理学療法士'] },
    });
    const d2 = small({ visitTypes: [rehab, nurse], staff: [...d.staff, s2] });
    expect(at(dayLoad(d2, MON1, { typeId: null }), '10:30')).toEqual({ start: m('10:30'), working: 2, free: 1 });
    expect(at(dayLoad(d2, MON1, { typeId: null }), '13:00')).toEqual({ start: m('13:00'), working: 2, free: 2 });
    expect(at(dayLoad(d2, MON1, { typeId: 'rehab' }), '10:30')).toEqual({ start: m('10:30'), working: 1, free: 1 });
    expect(at(dayLoad(d2, MON1, { typeId: 'rehab' }), '08:00')).toEqual({ start: m('08:00'), working: 0, free: 0 });
  });

  it('訪問があって案の無い日は null', () => {
    const d = small({ manualPlans: {} });
    expect(dayLoad(d, MON1, { typeId: null })).toBeNull();
  });

  it('欠勤の時間は働く人に入らない', () => {
    const d = small({ absences: [{ id: 'x', staffId: 's1', date: WED1, from: null, to: '12:00', note: '' }] });
    const load = dayLoad(d, WED1, { typeId: null })!;
    expect(at(load, '11:30')).toEqual({ start: m('11:30'), working: 0, free: 0 });
    expect(at(load, '12:00')).toEqual({ start: m('12:00'), working: 1, free: 1 });
  });
});

/** seed を4週に広げ、各日に素朴な案を確定した割当として入れたデータ */
function seededMonth(): { data: DemoData; from: string } {
  const today = '2026-10-13';
  const d0 = createDemoData(today);
  const end = addDays(today, 27);
  const ch = applyPatterns(d0, { from: today, to: end }, today);
  let data: DemoData = { ...d0, patterns: ch.patterns, visits: ch.visits };
  const manualPlans: DemoData['manualPlans'] = {};
  for (let i = 0; i < 28; i++) {
    const date = addDays(today, i);
    const p = compile(data, date);
    if (p.visits.length === 0) continue;
    const seqs = naiveSeqs(p);
    manualPlans[date] = Object.fromEntries(p.staff.map((s, k) => [s.id, seqs[k]!.map((v) => p.visits[v]!.id)]));
  }
  data = { ...data, manualPlans };
  return { data, from: today };
}

/** vacancyOf の正確の判定と同じ問題（仮の〈利用者さん〉・訪問を足して compile し、仮の訪問の時刻を start に） */
function inquiryProblem(data: DemoData, q: VacancyQuery, date: string, start: number, last: number): Problem {
  const c: Client = {
    ...client(INQUIRY_CLIENT_ID, q.place!.lat!, q.place!.lng!),
    requirements: q.requirements,
  };
  const v = visit(INQUIRY_VISIT_ID, INQUIRY_CLIENT_ID, minutesToHhmm(m(q.dayStart)), minutesToHhmm(last), {
    date,
    durationMinutes: q.durationMinutes,
    typeId: q.typeId,
  });
  const p = compile({ ...data, clients: [...data.clients, c], visits: [...data.visits, v] }, date);
  return {
    ...p,
    visits: p.visits.map((x) => (x.id === INQUIRY_VISIT_ID ? { ...x, earliest: start, latest: start } : x)),
  };
}

describe('性質：seed の日', () => {
  const { data, from } = seededMonth();
  const q = query({ place: { address: '', lat: 38.262, lng: 140.88 } });

  it('正確の判定で入るとされた人に placeVisit で入れると、他の人の担当・順番・開始時刻が変わらず strict で回れる', () => {
    const r = vacancyOf(data, q, { from, weeks: 1 });
    expect(r.noPlanDates).toEqual([]);
    let checked = 0;
    for (const cell of r.cells) {
      for (const { date, staffIds } of cell.byDate) {
        if (staffIds.length === 0) continue;
        const p = inquiryProblem(data, q, date, cell.start, r.times.at(-1)!);
        const base = baseOf(data, date, p)!.routes;
        const before = timing(p, base);
        for (const sid of staffIds) {
          const after = placeVisit(p, base, INQUIRY_VISIT_ID, sid);
          for (const st of p.staff) {
            const col = (after[st.id] ?? []).filter((id) => id !== INQUIRY_VISIT_ID);
            expect(col).toEqual(base[st.id] ?? []);
          }
          const t = timing(p, after);
          expect(t.get(sid)).not.toBeNull();
          for (const st of p.staff) {
            const b = before.get(st.id);
            const a = t.get(st.id);
            if (b === null) continue;
            const starts = (a ?? []).filter((x) => x.visitId !== INQUIRY_VISIT_ID);
            expect(starts.map((x) => x.visitId)).toEqual(b!.map((x) => x.visitId));
            starts.forEach((x, k) => {
              expect(x.start).toBeCloseTo(b![k]!.start, 6);
            });
          }
          const mine = t.get(sid)!.find((x) => x.visitId === INQUIRY_VISIT_ID)!;
          expect(mine.start).toBeCloseTo(cell.start, 6);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('同じ入力で同じ結果。データ・今の案を書き換えない', () => {
    const before = JSON.stringify(data);
    const a = vacancyOf(data, q, { from, weeks: 2 });
    const b = vacancyOf(data, q, { from, weeks: 2 });
    expect(a).toEqual(b);
    expect(vacancyOf(data, query({ place: null }), { from, weeks: 2 })).toEqual(
      vacancyOf(data, query({ place: null }), { from, weeks: 2 }),
    );
    expect(dayLoad(data, from, { typeId: null })).toEqual(dayLoad(data, from, { typeId: null }));
    expect(JSON.stringify(data)).toBe(before);
  });

  it('速さ：8人・約17件／日・4週・07:00〜20:00 で、正確の試算が 2秒以内、目安の表が 500ms 以内', () => {
    const range = { from, weeks: 4 };
    let t0 = performance.now();
    const exact = vacancyOf(data, q, range);
    const exactMs = performance.now() - t0;
    t0 = performance.now();
    const rough = vacancyOf(data, query({ place: null }), range);
    const roughMs = performance.now() - t0;
    console.log(`vacancyOf 4週：正確 ${exactMs.toFixed(0)}ms、目安 ${roughMs.toFixed(0)}ms`);
    expect(exact.dates).toHaveLength(28);
    expect(exact.noPlanDates).toEqual([]);
    expect(rough.cells.some((c) => verdictOf(c) === 'ok')).toBe(true);
    expect(exact.cells.some((c) => verdictOf(c) === 'ok')).toBe(true);
    expect(exactMs).toBeLessThan(2000);
    expect(roughMs).toBeLessThan(500);
  });
});

/** 列ごとの strict の時刻（回れなければ null） */
function timing(p: Problem, routes: Routes) {
  const vIndex = new Map(p.visits.map((v, i) => [v.id, i]));
  const out = new Map<string, { visitId: string; start: number }[] | null>();
  p.staff.forEach((st, s) => {
    const seq = (routes[st.id] ?? []).map((id) => vIndex.get(id)).filter((x): x is number => x !== undefined);
    const t = scheduleRoute(p, s, seq, 'strict');
    out.set(st.id, t ? t.stops.map((x) => ({ visitId: x.visitId, start: x.start })) : null);
  });
  return out;
}

describe('〈利用者さん〉の休み（ADR-0013）', () => {
  it('休みの〈利用者さん〉の訪問は数えない（その時間が空く）。休みを消すと元に戻る', () => {
    const leave = { id: 'l1', clientId: 'c2', from: MON2, to: MON2, note: '入院' };
    for (const place of [PLACE, null]) {
      const without = vacancyOf(small(), query({ place }), { from: MON1, weeks: 2 });
      expect(verdictOf(cellOf(without, 1, '15:00'))).toBe('partial');
      const r = vacancyOf(small({ clientLeaves: [leave] }), query({ place }), { from: MON1, weeks: 2 });
      expect(verdictOf(cellOf(r, 1, '15:00'))).toBe('ok');
      expect(staffOn(cellOf(r, 1, '15:00'), MON2)).toEqual(['s1']);
    }
  });

  it('dayLoad も休みの訪問を数えない', () => {
    const leave = { id: 'l1', clientId: 'c2', from: MON2, to: MON2, note: '' };
    const at = (d: DemoData) => dayLoad(d, MON2, { typeId: null })!.find((x) => x.start === m('15:00'))!;
    expect(at(small()).free).toBe(0);
    expect(at(small({ clientLeaves: [leave] })).free).toBe(1);
  });
});

describe('vacancyNotice（空き枠の案内文。ADR-0013）', () => {
  const input = (over: Partial<VacancyNoticeInput> = {}): VacancyNoticeInput => ({
    orgName: 'テスト訪問看護',
    terms: TERMS,
    typeName: 'リハビリ',
    durationMinutes: 60,
    period: { from: MON1, to: addDays(MON1, 6) },
    mode: 'dates',
    exact: false,
    ...over,
  });

  it('日付ごと：1人以上が受けられる開始時刻を連続した範囲にまとめる。事業所名・種類・所要が入る', () => {
    const r = vacancyOf(small(), query({ place: null }), { from: MON1, weeks: 1 });
    const text = vacancyNotice(r, input());
    const lines = text.split('\n');
    expect(lines[0]).toBe(
      'テスト訪問看護です。10/12〜10/18に、リハビリ（60分）の訪問をお受けできる開始の時間をご案内します。',
    );
    // 月曜は 9:00〜12:00 が訪問で詰まる（目安は前後15分）。火〜金は 8:30〜16:30。土日は休み
    expect(lines[1]).toBe('・10/12（月） 12:30〜16:30');
    expect(lines[2]).toBe('・10/13（火） 8:30〜16:30');
    expect(lines).toHaveLength(7);
    expect(lines.at(-1)).toContain('移動の時間などで変わることがあります');
    expect(lines.at(-1)).toContain('新しい利用者さんのご相談');
  });

  it('日付ごと：期間の外の日・案の無い日は入れない。途切れた範囲は「、」で分ける', () => {
    const extra = fixedOn('a2', 'c2', MON1, '14:00', 60);
    const noPlan = fixedOn('w1', 'c1', WED1, '10:00', 60);
    const d = small({ visits: [...small().visits, extra, noPlan], manualPlans: { [MON1]: { s1: ['a1', 'a2'] } } });
    const r = vacancyOf(d, query({ place: null }), { from: MON1, weeks: 1 });
    expect(r.noPlanDates).toEqual([WED1]);
    const text = vacancyNotice(r, input({ period: { from: MON1, to: addDays(MON1, 2) } }));
    expect(text).toContain('・10/12（月） 12:30、15:30〜16:30');
    expect(text).toContain('・10/13（火）');
    expect(text).not.toContain('・10/14');
    expect(text).not.toContain('・10/15');
  });

  it('曜日ごと：どの週も受けられる（○）時刻だけ。月〜日の順。種類なし・移動を含むとき', () => {
    const r = vacancyOf(small(), query({ place: null }), { from: MON1, weeks: 2 });
    const text = vacancyNotice(
      r,
      input({ mode: 'weekly', typeName: null, exact: true, period: { from: MON1, to: addDays(MON1, 13) } }),
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe(
      'テスト訪問看護です。10/12〜10/25の毎週、続けて60分の訪問をお受けできる開始の時間をご案内します。',
    );
    // 月曜：2回目の月曜は 14:00〜17:00 も詰まる → 両方の週で受けられるのは 12:30 だけ
    expect(lines[1]).toBe('・月 12:30');
    expect(lines[2]).toBe('・火 8:30〜16:30');
    expect(lines.at(-1)).toBe('開始の時間の目安です。新しい利用者さんのご相談は、お気軽にお問い合わせください。');
  });

  it('今日のもう過ぎた時刻は載せない（notBefore。今の時刻は画面が渡す）', () => {
    const r = vacancyOf(small(), query({ place: null }), { from: MON1, weeks: 1 });
    const text = vacancyNotice(r, input({ notBefore: { date: MON1, minutes: m('14:10') } }));
    expect(text).toContain('・10/12（月） 14:30〜16:30');
    // ほかの日は変わらない
    expect(text).toContain('・10/13（火） 8:30〜16:30');
  });

  it('曜日ごと：案のある週がその曜日の週の数より少なければ「〇週中〇週」と書き添える', () => {
    // 2回目の火曜に案の無い訪問を足す → 火曜は2週中1週だけ数える
    const noPlan = fixedOn('t2', 'c1', addDays(MON2, 1), '10:00', 60);
    const r = vacancyOf(small({ visits: [...small().visits, noPlan] }), query({ place: null }), {
      from: MON1,
      weeks: 2,
    });
    const text = vacancyNotice(r, input({ mode: 'weekly', period: { from: MON1, to: addDays(MON1, 13) } }));
    expect(text).toContain('・火 8:30〜16:30（2週中1週の予定で確認）');
    expect(text).toContain('・水 8:30〜16:30\n');
  });

  it('空きが無ければその旨の文', () => {
    const r = vacancyOf(small(), query({ place: null, dayStart: '07:00', dayEnd: '08:30' }), { from: MON1, weeks: 1 });
    const text = vacancyNotice(r, input());
    expect(text.split('\n')[1]).toBe(
      'いまはご案内できる空きがありません。ご希望の曜日・時間があれば、お問い合わせください。',
    );
  });
});
