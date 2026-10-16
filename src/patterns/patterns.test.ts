import { describe, expect, it } from 'vitest';
import type { Client, Pattern, Visit } from '../contracts/documents';
import type { PatternInput } from '../contracts/patterns';
import { createDemoData } from '../seed';
import { applyPatterns, expandPattern, occursOn, removePattern, splitPattern } from './index';

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
        cancelled: false,
        note: '',
        typeId: 't1',
        pattern: { id: 'p1', date: '2026-10-12', edited: false },
      },
    ]);
  });
});

describe('applyPatterns', () => {
  const range = { from: '2026-10-12', to: '2026-10-25' };

  it('利用中でない・いない利用者さんのパターンは展開しない', () => {
    const cs = clients.map((c) => (c.id === c2 ? { ...c, active: false } : c));
    const r = applyPatterns(
      input([pat(), pat({ id: 'p2', clientId: c2 }), pat({ id: 'p3', clientId: 'nobody' })], [], cs),
      range,
      TODAY,
    );
    expect(r.visits.map((v) => v.id)).toEqual(['2026-10-12_p1', '2026-10-19_p1']);
    expect(r.removed).toEqual([]);
  });

  it('今日より前の日には作らない', () => {
    const r = applyPatterns(input([pat({ weekdays: [1, 2, 3, 4, 5] })]), range, '2026-10-15');
    expect(r.visits[0]!.date).toBe('2026-10-15');
    expect(r.visits.every((v) => v.date >= '2026-10-15')).toBe(true);
  });

  it('日付・開始（早）の順に足し、既存の訪問の順は変えない', () => {
    const existing: Visit = { ...expandPattern(pat({ id: 'x' }), range)[1]!, pattern: null, id: 'single' };
    const ps = [
      pat({ earliestStart: '14:00', latestStart: '14:00' }),
      pat({ id: 'p2', clientId: c2, weekdays: [1, 2] }),
    ];
    const r = applyPatterns(input(ps, [existing]), range, TODAY);
    expect(r.visits[0]).toBe(existing);
    expect(r.visits.slice(1).map((v) => v.id)).toEqual([
      '2026-10-12_p2',
      '2026-10-12_p1',
      '2026-10-13_p2',
      '2026-10-19_p2',
      '2026-10-19_p1',
      '2026-10-20_p2',
    ]);
    expect(r.added).toEqual(r.visits.slice(1).map((v) => ({ visitId: v.id, date: v.date })));
  });

  it('同じ入力から同じ訪問。2回続けても増えない', () => {
    const ps = [pat({ weekdays: [1, 3] }), pat({ id: 'p2', clientId: c2, everyWeeks: 2 })];
    const a = applyPatterns(input(ps), range, TODAY);
    const b = applyPatterns(input(ps), range, TODAY);
    expect(b).toEqual(a);
    const again = applyPatterns(input(ps, a.visits), range, TODAY);
    expect(again.visits).toEqual(a.visits);
    expect(again.added).toEqual([]);
  });

  it('この回だけ直した・取り消した・日付をずらした訪問は上書きされない', () => {
    const base = applyPatterns(input([pat({ weekdays: [1, 3] })]), range, TODAY).visits;
    const edited = base.map((v) => {
      if (v.id === '2026-10-12_p1')
        return { ...v, earliestStart: '15:00', latestStart: '15:00', pattern: { ...v.pattern!, edited: true } };
      if (v.id === '2026-10-14_p1') return { ...v, cancelled: true, pattern: { ...v.pattern!, edited: true } };
      if (v.id === '2026-10-19_p1') return { ...v, date: '2026-10-20', pattern: { ...v.pattern!, edited: true } };
      return v;
    });
    const r = applyPatterns(input([pat({ weekdays: [1, 3] })], edited), range, TODAY);
    expect(r.visits).toEqual(edited);
    expect(r.added).toEqual([]);
  });

  it('seed の20人・14日を展開して1秒以内', () => {
    const many = clients.map((c, i) => pat({ id: `p${i}`, clientId: c.id, weekdays: [1, 2, 3, 4, 5] }));
    const t = performance.now();
    const r = applyPatterns(input(many), { from: TODAY, to: '2026-10-25' }, TODAY);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(r.visits.length).toBe(clients.filter((c) => c.active).length * 10);
  });
});

describe('splitPattern', () => {
  const range = { from: '2026-10-12', to: '2026-11-08' };
  const p = pat({ weekdays: [1, 3] });
  const next = (over: Partial<Pattern> = {}) => {
    const {
      id: _i,
      from: _f,
      ...rest
    } = pat({ weekdays: [1, 3], earliestStart: '13:00', latestStart: '13:00', ...over });
    return rest;
  };
  // 10/12〜11/8 の月・水（8回）。10/21 は時刻だけこの回、10/26 は取り消し
  const expanded = applyPatterns(input([p]), range, TODAY).visits.map((v) => {
    if (v.id === '2026-10-21_p1')
      return { ...v, earliestStart: '16:00', latestStart: '16:00', pattern: { ...v.pattern!, edited: true } };
    if (v.id === '2026-10-26_p1') return { ...v, cancelled: true };
    return v;
  });
  const before = expanded.length;

  it('since が from より後：元の to が前日、新しいパターンが since から。範囲の訪問が新しい中身になる', () => {
    const r = splitPattern(input([p], expanded), 'p1', next(), '2026-10-19', TODAY, 'p9');
    expect(r.patterns).toEqual([
      { ...p, to: '2026-10-18' },
      { ...next(), id: 'p9', from: '2026-10-19' },
    ]);
    // since より前は変わらない
    for (const id of ['2026-10-12_p1', '2026-10-14_p1']) {
      expect(r.visits.find((v) => v.id === id)).toEqual(expanded.find((v) => v.id === id));
    }
    // edited・取り消しは残る
    expect(r.visits.find((v) => v.id === '2026-10-21_p1')).toEqual(expanded.find((v) => v.id === '2026-10-21_p1'));
    expect(r.visits.find((v) => v.id === '2026-10-26_p1')).toEqual(expanded.find((v) => v.id === '2026-10-26_p1'));
    const removedDates = ['2026-10-19', '2026-10-28', '2026-11-02', '2026-11-04'];
    expect(r.removed).toEqual(removedDates.map((d) => ({ visitId: `${d}_p1`, date: d })));
    // 新しいパターンから展開（10/21・10/26 も新しい ID で入る。最後の日 11/4 まで）
    const addedDates = ['2026-10-19', '2026-10-21', '2026-10-26', '2026-10-28', '2026-11-02', '2026-11-04'];
    expect(r.added).toEqual(addedDates.map((d) => ({ visitId: `${d}_p9`, date: d })));
    for (const v of r.visits.filter((x) => x.pattern?.id === 'p9')) {
      expect(v.earliestStart).toBe('13:00');
    }
    expect(r.visits).toHaveLength(before - 4 + 6);
  });

  it('since が from 以前：同じ ID のまま置き換え、edited でない訪問を作り直す', () => {
    const r = splitPattern(input([p], expanded), 'p1', next(), '2026-10-01', TODAY, 'p9');
    expect(r.patterns).toEqual([{ ...next(), id: 'p1', from: p.from }]);
    // 置き換えは同じ ID なので、edited・取り消しの回は作らない
    expect(r.removed.map((x) => x.date)).toEqual([
      '2026-10-12',
      '2026-10-14',
      '2026-10-19',
      '2026-10-28',
      '2026-11-02',
      '2026-11-04',
    ]);
    expect(r.added).toEqual(r.removed);
    expect(r.visits.filter((v) => !v.cancelled && !v.pattern?.edited).every((v) => v.earliestStart === '13:00')).toBe(
      true,
    );
    expect(r.visits.find((v) => v.id === '2026-10-21_p1')!.earliestStart).toBe('16:00');
    expect(r.visits).toHaveLength(before);
  });

  it('今日より前の訪問は作り直さない（max(since, 今日) から）', () => {
    const r = splitPattern(input([p], expanded), 'p1', next(), '2026-10-01', '2026-10-15', 'p9');
    expect(r.removed[0]!.date).toBe('2026-10-19');
    expect(r.visits.find((v) => v.id === '2026-10-12_p1')!.earliestStart).toBe('10:00');
  });

  it('パターンが無ければ何もしない', () => {
    const d = input([p], expanded);
    const r = splitPattern(d, 'none', next(), '2026-10-19', TODAY, 'p9');
    expect(r).toEqual({ patterns: d.patterns, visits: d.visits, added: [], removed: [] });
  });
});

describe('removePattern', () => {
  it('今日以降の edited でない訪問が消え、残した訪問の pattern は null', () => {
    const p = pat({ weekdays: [1, 3] });
    const other = pat({ id: 'p2', clientId: c2 });
    const vs = applyPatterns(input([p, other]), { from: '2026-10-12', to: '2026-10-25' }, TODAY).visits.map((v) =>
      v.id === '2026-10-21_p1' ? { ...v, note: 'この回だけ', pattern: { ...v.pattern!, edited: true } } : v,
    );
    const r = removePattern(input([p, other], vs), 'p1', '2026-10-14');
    expect(r.patterns).toEqual([other]);
    expect(r.removed.map((x) => x.visitId)).toEqual(['2026-10-14_p1', '2026-10-19_p1']);
    const own = r.visits.filter((v) => v.id.endsWith('_p1'));
    expect(own.map((v) => v.id)).toEqual(['2026-10-12_p1', '2026-10-21_p1']);
    expect(own.every((v) => v.pattern === null)).toBe(true);
    expect(r.visits.filter((v) => v.id.endsWith('_p2'))).toEqual(vs.filter((v) => v.id.endsWith('_p2')));
  });
});
