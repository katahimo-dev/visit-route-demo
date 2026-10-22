import { describe, expect, it } from 'vitest';
import type { Client, Pattern, Visit } from '../contracts/documents';
import type { PatternInput } from '../contracts/patterns';
import { createDemoData } from '../seed';
import {
  expandPattern,
  findVisit,
  occursOn,
  putVisits,
  removePattern,
  splitPattern,
  visitsIn,
  visitsOn,
} from './index';

// 2026-10-11 は日曜。10-12 月・10-14 水・10-15 木・10-16 金・10-17 土
const TODAY = '2026-10-12';
const demo = createDemoData(TODAY);
const clients: Client[] = demo.clients;
const c1 = clients[0]!.id;
const c2 = clients[1]!.id;

const pat = (over: Partial<Pattern> = {}): Pattern => ({
  id: 'p1',
  clientId: c1,
  typeId: null,
  weekdays: [1],
  everyWeeks: 1,
  repeat: 'weekly',
  monthWeeks: [],
  dayTimes: [],
  windowKind: 'fixed',
  earliestStart: '10:00',
  latestStart: '10:00',
  durationMinutes: 60,
  from: '2026-10-12',
  to: null,
  usualStaffId: null,
  note: '',
  ...over,
});

const dates = (p: Pattern, from: string, to: string) => expandPattern(p, { from, to }).map((v) => v.date);
const input = (patterns: Pattern[], visits: Visit[] = [], cs: Client[] = clients): PatternInput => ({
  patterns,
  visits,
  clients: cs,
});

describe('occursOn・expandPattern（展開される日）', () => {
  it('毎週・複数の曜日（月・木）、from・to の端を含む', () => {
    const p = pat({ weekdays: [1, 4], from: '2026-10-15', to: '2026-10-29' });
    expect(dates(p, '2026-10-01', '2026-11-30')).toEqual([
      '2026-10-15',
      '2026-10-19',
      '2026-10-22',
      '2026-10-26',
      '2026-10-29',
    ]);
    expect(occursOn(p, '2026-10-14')).toBe(false); // from より前
    expect(occursOn(p, '2026-10-15')).toBe(true); // from ちょうど
    expect(occursOn(p, '2026-10-29')).toBe(true); // to ちょうど
    expect(occursOn(p, '2026-11-02')).toBe(false); // to より後
    expect(occursOn(p, '2026-10-20')).toBe(false); // 曜日が違う
  });

  it('隔週は from を含む週（日曜はじまり）を1週目にする', () => {
    // from は水曜。1週目＝10/11〜10/17（月曜 10/12 は from より前で無い）、3週目の 10/26、5週目の 11/9
    const p = pat({ everyWeeks: 2, from: '2026-10-14' });
    expect(dates(p, '2026-10-01', '2026-11-15')).toEqual(['2026-10-26', '2026-11-09']);
    // from が土曜でも、次の日曜は2週目
    const sun = pat({ weekdays: [0], everyWeeks: 2, from: '2026-10-17' });
    expect(dates(sun, '2026-10-01', '2026-11-15')).toEqual(['2026-10-25', '2026-11-08']);
  });

  it('4週ごと', () => {
    const p = pat({ everyWeeks: 4, from: '2026-10-12' });
    expect(dates(p, '2026-10-01', '2026-12-31')).toEqual(['2026-10-12', '2026-11-09', '2026-12-07']);
  });

  it('訪問の中身・ID', () => {
    const p = pat({
      typeId: 't1',
      windowKind: 'window',
      earliestStart: '09:00',
      latestStart: '11:00',
      durationMinutes: 40,
    });
    expect(expandPattern(p, { from: '2026-10-12', to: '2026-10-12' })).toEqual([
      {
        id: '2026-10-12_p1',
        date: '2026-10-12',
        clientId: c1,
        windowKind: 'window',
        earliestStart: '09:00',
        latestStart: '11:00',
        durationMinutes: 40,
        staffId: null,
        start: null,
        pinned: false,
        cancelled: false,
        note: '',
        typeId: 't1',
        pattern: { id: 'p1', date: '2026-10-12', edited: false },
        cancelKind: null,
      },
    ]);
  });
});

describe('visitsOn・findVisit・putVisits（計算した回と保存した回。版2。ADR-0053）', () => {
  it('利用中の〈利用者さん〉のパターンから計算し、開始の順に並べる。利用中でない・いない人の回は出さない', () => {
    const cs = clients.map((c) => (c.id === c2 ? { ...c, active: false } : c));
    const ps = [
      pat({ earliestStart: '14:00', latestStart: '14:00' }),
      pat({ id: 'p2', clientId: c2 }),
      pat({ id: 'p3', clientId: 'nobody' }),
      pat({ id: 'p4', earliestStart: '09:00', latestStart: '09:00' }),
    ];
    expect(visitsOn(input(ps, [], cs), '2026-10-12').map((v) => v.id)).toEqual(['2026-10-12_p4', '2026-10-12_p1']);
    expect(visitsOn(input(ps, [], cs), '2026-10-13')).toEqual([]);
  });

  it('保存した回（同じ ID）は計算した回より先で、二重にしない。日付をずらした回は保存した日に出る', () => {
    const p = pat({ weekdays: [1, 3] });
    const moved = {
      ...findVisit(input([p]), '2026-10-12_p1')!,
      date: '2026-10-13',
      pattern: { id: 'p1', date: '2026-10-12', edited: true },
    };
    const single: Visit = { ...moved, id: 'single', pattern: null, earliestStart: '08:00', latestStart: '08:00' };
    const d = input([p], [moved, single]);
    expect(visitsOn(d, '2026-10-12')).toEqual([]);
    expect(visitsOn(d, '2026-10-13').map((v) => v.id)).toEqual(['single', '2026-10-12_p1']);
    expect(findVisit(d, '2026-10-12_p1')).toBe(moved);
    expect(findVisit(d, '2026-10-14_p1')!.date).toBe('2026-10-14');
    // パターンの日でない ID・形の違う ID は無い
    expect(findVisit(d, '2026-10-15_p1')).toBeNull();
    expect(findVisit(d, 'nope')).toBeNull();
  });

  it('計算した回は同じパターン・同じ日なら同じオブジェクト（画面の覚えを効かせる）。計算した回の担当は繰り返しの担当', () => {
    const p = pat({ usualStaffId: 's1' });
    const a = visitsOn(input([p]), '2026-10-12')[0]!;
    expect(visitsOn(input([p]), '2026-10-12')[0]).toBe(a);
    expect(a).toMatchObject({ staffId: 's1', start: null, pinned: false });
  });

  it('putVisits は同じ ID を置き換え、無ければ足す（元は書き換えない）', () => {
    const p = pat();
    const v = findVisit(input([p]), '2026-10-12_p1')!;
    const a = putVisits([], [v]);
    expect(a).toEqual([v]);
    const b = putVisits(a, [{ ...v, note: 'x' }]);
    expect(b.map((x) => x.note)).toEqual(['x']);
    expect(a[0]!.note).toBe('');
    expect(putVisits(a, [])).toBe(a);
  });

  it('seed の20人・4週を計算して1秒以内', () => {
    const many = clients.map((c, i) => pat({ id: `p${i}`, clientId: c.id, weekdays: [1, 2, 3, 4, 5] }));
    const t = performance.now();
    const r = visitsIn(input(many), { from: TODAY, to: '2026-11-08' });
    expect(performance.now() - t).toBeLessThan(1000);
    expect(r.length).toBe(clients.filter((c) => c.active).length * 20);
  });
});

describe('splitPattern（版2）', () => {
  const p = pat({ weekdays: [1, 3] });
  const next = (over: Partial<Pattern> = {}) => {
    const {
      id: _i,
      from: _f,
      ...rest
    } = pat({ weekdays: [1, 3], earliestStart: '13:00', latestStart: '13:00', ...over });
    return rest;
  };
  const occ = (id: string) => findVisit(input([p]), id)!;
  // 10/21 は時刻だけこの回、10/26 は取り消し、10/28 は担当だけ組んだ（変えていない）保存した回
  const stored: Visit[] = [
    {
      ...occ('2026-10-21_p1'),
      earliestStart: '16:00',
      latestStart: '16:00',
      pattern: { id: 'p1', date: '2026-10-21', edited: true },
    },
    { ...occ('2026-10-26_p1'), cancelled: true },
    { ...occ('2026-10-28_p1'), staffId: 's1', start: '10:00' },
  ];
  const all = (c: { patterns: Pattern[]; visits: Visit[] }) =>
    visitsIn({ ...c, clients }, { from: '2026-10-12', to: '2026-11-08' });

  it('since が from より後：元の to が前日、新しいパターンが since から。以降の回が新しい中身になる', () => {
    const r = splitPattern(input([p], stored), 'p1', next(), '2026-10-19', TODAY, 'p9');
    expect(r.patterns).toEqual([
      { ...p, to: '2026-10-18' },
      { ...next(), id: 'p9', from: '2026-10-19' },
    ]);
    // 変えていない保存した回は消す（新しい中身で計算する）
    expect(r.removed).toEqual([{ visitId: '2026-10-28_p1', date: '2026-10-28' }]);
    // この回だけ変えた・取り消した回は新しいパターンの回として残す（ID を付け替える）
    expect(r.visits.map((v) => v.id)).toEqual(['2026-10-21_p9', '2026-10-26_p9']);
    expect(r.visits.find((v) => v.id === '2026-10-21_p9')!.earliestStart).toBe('16:00');
    const list = all(r);
    expect(list.filter((v) => v.date < '2026-10-19').every((v) => v.earliestStart === '10:00')).toBe(true);
    expect(
      list
        .filter((v) => v.date >= '2026-10-19' && !v.cancelled && !v.pattern?.edited)
        .every((v) => v.earliestStart === '13:00'),
    ).toBe(true);
    // 二重にならない
    expect(list.filter((v) => v.date === '2026-10-21')).toHaveLength(1);
  });

  it('終わったパターンを後の日で直しても期間は延びない（to は min(元の to, since の前日)）', () => {
    const ended = pat({ weekdays: [1, 3], to: '2026-10-21' });
    const r = splitPattern(input([ended]), 'p1', next(), '2026-11-02', TODAY, 'p9');
    expect(r.patterns[0]).toEqual(ended);
    const r2 = splitPattern(input([ended]), 'p1', next(), '2026-10-19', TODAY, 'p9');
    expect(r2.patterns[0]!.to).toBe('2026-10-18');
  });

  it('since が from 以前：同じ ID のまま置き換え、変えていない保存した回を消す', () => {
    const r = splitPattern(input([p], stored), 'p1', next(), '2026-10-01', TODAY, 'p9');
    expect(r.patterns).toEqual([{ ...next(), id: 'p1', from: p.from }]);
    expect(r.removed.map((x) => x.date)).toEqual(['2026-10-28']);
    expect(r.visits.map((v) => v.id)).toEqual(['2026-10-21_p1', '2026-10-26_p1']);
  });

  it('今日より前の保存した回は変えない（max(since, 今日) から）', () => {
    const past = { ...occ('2026-10-12_p1'), staffId: 's1', start: '10:00' };
    const r = splitPattern(input([p], [past]), 'p1', next(), '2026-10-01', '2026-10-15', 'p9');
    expect(r.visits).toEqual([past]);
    expect(r.removed).toEqual([]);
  });

  it('パターンが無ければ何もしない', () => {
    const d = input([p], stored);
    const r = splitPattern(d, 'none', next(), '2026-10-19', TODAY, 'p9');
    expect(r).toEqual({ patterns: d.patterns, visits: d.visits, removed: [] });
  });
});

describe('removePattern（版2）', () => {
  it('今日より前に始まった繰り返しは昨日で終わらせ、今日以降の変えていない回を消す。この回だけ変えた回は単発にする', () => {
    const p = pat({ weekdays: [1, 3] });
    const other = pat({ id: 'p2', clientId: c2 });
    const occ = (id: string) => findVisit(input([p]), id)!;
    const vs = [
      { ...occ('2026-10-12_p1'), staffId: 's1' },
      { ...occ('2026-10-19_p1'), staffId: 's1' },
      { ...occ('2026-10-21_p1'), note: 'この回だけ', pattern: { id: 'p1', date: '2026-10-21', edited: true } },
    ];
    const r = removePattern(input([p, other], vs), 'p1', '2026-10-14');
    expect(r.patterns).toEqual([{ ...p, to: '2026-10-13' }, other]);
    expect(r.removed.map((x) => x.visitId)).toEqual(['2026-10-19_p1']);
    expect(r.visits.map((v) => [v.id, v.pattern?.id ?? null])).toEqual([
      ['2026-10-12_p1', 'p1'],
      ['2026-10-21_p1', null],
    ]);
    // 今日より前の回はそのまま計算される
    const mine = (date: string) =>
      visitsOn({ ...r, clients }, date)
        .filter((v) => v.id.endsWith('_p1'))
        .map((v) => v.id);
    expect(mine('2026-10-12')).toEqual(['2026-10-12_p1']);
    expect(mine('2026-10-26')).toEqual([]);
  });
  it('今日以降に始まる繰り返しはまるごと消す', () => {
    const p = pat({ from: '2026-10-19' });
    expect(removePattern(input([p]), 'p1', TODAY).patterns).toEqual([]);
  });
});

describe('毎月の第N曜日・曜日ごとの時刻（ADR-0013）', () => {
  // 2026年10月の木曜は 1・8・15・22・29（第5あり）、11月は 5・12・19・26（第5なし）、12月は 3・10・17・24・31
  it('毎月の第3・第4木曜だけ。第5の木曜は作らない', () => {
    const p = pat({ weekdays: [4], repeat: 'monthly', monthWeeks: [3, 4], from: '2026-10-01' });
    expect(dates(p, '2026-10-01', '2026-11-30')).toEqual(['2026-10-15', '2026-10-22', '2026-11-19', '2026-11-26']);
    expect(occursOn(p, '2026-10-29')).toBe(false);
    expect(occursOn(p, '2026-10-08')).toBe(false);
  });

  it('第5を選ぶと、第5のある月だけ作る（everyWeeks は見ない）', () => {
    const p = pat({ weekdays: [4], repeat: 'monthly', monthWeeks: [5], everyWeeks: 3, from: '2026-10-01' });
    expect(dates(p, '2026-10-01', '2026-12-31')).toEqual(['2026-10-29', '2026-12-31']);
  });

  it('毎月で複数の曜日（第1の月・水）。from・to の端を守る', () => {
    const p = pat({ weekdays: [1, 3], repeat: 'monthly', monthWeeks: [1], from: '2026-10-05', to: '2026-11-04' });
    // 10月の第1月曜 10/5・第1水曜 10/7、11月の第1月曜 11/2・第1水曜 11/4
    expect(dates(p, '2026-10-01', '2026-12-31')).toEqual(['2026-10-05', '2026-10-07', '2026-11-02', '2026-11-04']);
  });

  it('毎週系（repeat が weekly）は今までと同じ。monthWeeks があっても見ない', () => {
    const p = pat({ weekdays: [4], monthWeeks: [3], from: '2026-10-01' });
    expect(dates(p, '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-01',
      '2026-10-08',
      '2026-10-15',
      '2026-10-22',
      '2026-10-29',
    ]);
  });

  it('曜日ごとの時刻：月曜は 9:30、木曜は共通の 15:00（ID は日付_パターンID のまま）', () => {
    const p = pat({
      weekdays: [1, 4],
      windowKind: 'window',
      earliestStart: '15:00',
      latestStart: '15:30',
      dayTimes: [{ weekday: 1, earliestStart: '09:30', latestStart: '10:00' }],
    });
    const vs = expandPattern(p, { from: '2026-10-12', to: '2026-10-15' });
    expect(vs.map((v) => [v.id, v.earliestStart, v.latestStart])).toEqual([
      ['2026-10-12_p1', '09:30', '10:00'],
      ['2026-10-15_p1', '15:00', '15:30'],
    ]);
  });

  it('splitPattern で毎週を毎月の第4木曜に直すと、以降の回だけ新しい規則で計算する', () => {
    const p = pat({ weekdays: [4], from: '2026-10-01' });
    const { id: _id, from: _from, ...rest } = p;
    const c = splitPattern(
      input([p]),
      'p1',
      { ...rest, repeat: 'monthly', monthWeeks: [4] },
      '2026-10-20',
      TODAY,
      'p2',
    );
    const own = (id: string) =>
      visitsIn({ ...c, clients }, { from: '2026-10-12', to: '2026-11-30' })
        .filter((v) => v.pattern?.id === id)
        .map((v) => v.date);
    expect(own('p1')).toEqual(['2026-10-15']);
    expect(own('p2')).toEqual(['2026-10-22', '2026-11-26']);
  });
});
