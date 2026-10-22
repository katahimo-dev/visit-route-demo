import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { MAX_VISIT_TYPES, type Pattern, type VisitType } from '../contracts/documents';
import { compile } from '../matching';
import { createDemoData } from '../seed';
import { withSeedPlans } from '../seed/plans';
import { importJson, isImportError, migrate } from './index';
import { repair } from './repair';

const DAY = '2026-10-12';
/** 初期データ（版2：7日分の担当を書いた回が保存した訪問） */
const BASE = withSeedPlans(createDemoData(DAY), DAY, 3);
const base = () => structuredClone(BASE);
const visitsOn = (d: DemoData, date: string) => d.visits.filter((v) => v.date === date).map((v) => v.id);

describe('repair（契約は通るが中身が食い違うデータ。版2）', () => {
  it('食い違いのない初期データは変えない', () => {
    const d = base();
    expect(repair(d)).toEqual(d);
  });

  it('いないスタッフを指す担当は null（ピンも外す）、相性・稼働時間帯の上書きのいない人の分は消す', () => {
    const d = base();
    const v0 = d.visits[0]!;
    const c0 = d.clients[0]!;
    const r = repair({
      ...d,
      visits: d.visits.map((v) => (v.id === v0.id ? { ...v, staffId: 'ghost', pinned: true } : v)),
      compat: { ...d.compat, ghostClient: { s1: 2 }, [c0.id]: { ...d.compat[c0.id], ghost: -2 } },
      availability: [...d.availability, { staffId: 'ghost', date: DAY, slots: [] }],
    });
    expect(r.visits.find((v) => v.id === v0.id)).toMatchObject({ staffId: null, pinned: false });
    expect(r.compat.ghostClient).toBeUndefined();
    expect(r.compat[c0.id]).toEqual(d.compat[c0.id] ?? {});
    expect(r.availability).toEqual(d.availability);
  });

  it('伝えた内容：日付をキーにそろえ、重複は最初の1件、いない人の担当は null', () => {
    const d = base();
    const [a = '', b = ''] = visitsOn(d, DAY);
    const r = repair({
      ...d,
      snapshots: {
        [DAY]: {
          date: '2026-01-01',
          at: 1,
          visits: [
            { id: a, clientId: 'c1', staffId: 's1', start: '09:00' },
            { id: a, clientId: 'c1', staffId: 's2', start: '10:00' },
            { id: b, clientId: 'c2', staffId: 'ghost', start: '11:00' },
          ],
        },
      },
    });
    expect(r.snapshots[DAY]).toEqual({
      date: DAY,
      at: 1,
      visits: [
        { id: a, clientId: 'c1', staffId: 's1', start: '09:00' },
        { id: b, clientId: 'c2', staffId: null, start: '11:00' },
      ],
    });
  });

  it('条件の重み・必須はいつも点数の基準のプリセットにそろえる（重みは1組）', () => {
    const d = base();
    const tried = { ...d, rules: d.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 4.5 } : r)) };
    expect(repair(tried).rules).toEqual(d.rules);
  });

  it('同じ ID の重複は最初の1件、同じ人・同じ日の上書きは最後の1件', () => {
    const d = base();
    const s0 = d.staff[0]!;
    const r = repair({
      ...d,
      staff: [...d.staff, { ...s0, name: '重複' }],
      availability: [
        { staffId: s0.id, date: '2030-01-01', slots: [] },
        { staffId: s0.id, date: '2030-01-01', slots: [{ start: '09:00', end: '10:00' }] },
      ],
    });
    expect(r.staff.filter((s) => s.id === s0.id).map((s) => s.name)).toEqual([s0.name]);
    expect(r.availability).toEqual([{ staffId: s0.id, date: '2030-01-01', slots: [{ start: '09:00', end: '10:00' }] }]);
  });

  it('緯度・経度が片方だけ・範囲外の位置は未登録にする', () => {
    const d = base();
    const r = repair({
      ...d,
      staff: d.staff.map((s, i) => (i === 0 ? { ...s, home: { ...s.home, lng: null } } : s)),
      clients: d.clients.map((c, i) => (i === 0 ? { ...c, place: { ...c.place, lat: 1000 } } : c)),
    });
    expect(r.staff[0]!.home).toMatchObject({ lat: null, lng: null });
    expect(r.clients[0]!.place).toMatchObject({ lat: null, lng: null });
  });

  it('項目が消えた条件は残す（無効として扱う。matching が無視する）', () => {
    const d = base();
    const withGhost = {
      ...d,
      clients: d.clients.map((c) => ({ ...c, requirements: [{ itemId: 'ghost', op: 'is' as const, value: true }] })),
    };
    const r = repair(withGhost);
    expect(r.clients[0]!.requirements).toEqual([{ itemId: 'ghost', op: 'is', value: true }]);
    expect(() => compile(r, DAY)).not.toThrow();
  });

  it('読み込み（migrate・importJson）で直す', () => {
    const d = base();
    const v0 = d.visits[0]!;
    const bad = { ...d, visits: d.visits.map((v) => (v.id === v0.id ? { ...v, staffId: 'ghost' } : v)) };
    const r = migrate(JSON.parse(JSON.stringify(bad)));
    expect(isImportError(r)).toBe(false);
    expect((r as DemoData).visits[0]!.staffId).toBeNull();
    const r2 = importJson(JSON.stringify(bad));
    expect((r2 as DemoData).visits[0]!.staffId).toBeNull();
  });
});

describe('欠勤と振り直し（ADR-0011）', () => {
  const ab = (id: string, staffId: string, date: string, from: string | null = null, to: string | null = null) => ({
    id,
    staffId,
    date,
    from,
    to,
    note: '',
  });
  it('いない人の欠勤は消え、ID の重複は最初の1件、同じ人・同じ日は最後の1件', () => {
    const d = base();
    const s = d.staff[0]!.id;
    const r = repair({
      ...d,
      absences: [
        ab('a1', s, DAY),
        ab('a2', 'ghost', DAY),
        ab('a1', s, '2026-10-13', '09:00', '12:00'),
        ab('a3', s, DAY, '12:00', null),
      ],
    });
    expect(r.absences).toEqual([ab('a3', s, DAY, '12:00', null)]);
  });
  it('振り直しの情報の baseRoutes・basePins・insertRoutes は、いない人の列・重複を除く（absenceIds はそのまま）', () => {
    const d = base();
    const [a = '', b = ''] = visitsOn(d, DAY);
    const info = {
      method: 'insert' as const,
      baseRoutes: { s1: [a, a], ghost: [b] },
      basePins: { [a]: 's1', [b]: 'ghost' },
      insertRoutes: { s1: [a], ghost: [b] },
      absenceIds: ['消えた欠勤'],
    };
    const r = repair({ ...d, reassigns: { [DAY]: info } });
    expect(r.reassigns[DAY]).toEqual({
      ...info,
      baseRoutes: { s1: [a] },
      basePins: { [a]: 's1' },
      insertRoutes: { s1: [a] },
    });
    const anneal = { ...info, method: 'anneal' as const, stayWeight: 3 };
    expect(repair({ ...d, reassigns: { [DAY]: anneal } }).reassigns[DAY]).toMatchObject({
      method: 'anneal',
      stayWeight: 3,
    });
  });
  it('欠勤・振り直しの情報・伝えた内容を含むデータが 書き出し → 読み込み で同じに戻る', () => {
    const d = base();
    const [a = ''] = visitsOn(d, DAY);
    const s = d.staff[0]!.id;
    const x: DemoData = {
      ...d,
      absences: [ab('a1', s, DAY, '09:00', '12:00')],
      reassigns: { [DAY]: { method: 'insert', baseRoutes: { [s]: [a] }, basePins: {}, absenceIds: ['a1'] } },
      snapshots: { [DAY]: { date: DAY, at: 5, visits: [{ id: a, clientId: 'c1', staffId: s, start: '09:00' }] } },
    };
    expect(importJson(JSON.stringify(x))).toEqual(repair(x));
    expect(importJson(JSON.stringify(x))).toEqual(x);
  });
  it('終了 ≤ 開始・30分単位でない欠勤は契約で止める', () => {
    const d = base();
    const s = d.staff[0]!.id;
    expect(isImportError(migrate({ ...d, absences: [ab('a', s, DAY, '12:00', '09:00')] }))).toBe(true);
    expect(isImportError(migrate({ ...d, absences: [ab('a', s, DAY, '10:15', null)] }))).toBe(true);
  });
});

describe('訪問の種類・定期パターン（ADR-0012）', () => {
  // seed は種類・パターンを持つ（ADR-0012）。ここでは種類・パターンの無いデータ（保存した回を単発にしたもの）から始める
  const base = (): DemoData => {
    const d = structuredClone(BASE);
    return {
      ...d,
      visitTypes: [],
      patterns: [],
      visits: d.visits.map((v) => ({ ...v, typeId: null, pattern: null })),
    };
  };
  const vt = (id: string, name = id): VisitType => ({
    id,
    name,
    color: 0,
    durationMinutes: 60,
    requirements: [],
    note: '',
  });
  const pt = (id: string, clientId: string, over: Partial<Pattern> = {}): Pattern => ({
    id,
    clientId,
    typeId: null,
    weekdays: [1],
    everyWeeks: 1,
    repeat: 'weekly',
    monthWeeks: [],
    dayTimes: [],
    windowKind: 'fixed',
    earliestStart: '09:00',
    latestStart: '09:00',
    durationMinutes: 60,
    from: DAY,
    to: null,
    usualStaffId: null,
    note: '',
    ...over,
  });

  it('種類：ID の重複は最初の1件、20を超える分は後ろを捨てる', () => {
    const d = base();
    const types = [vt('t0', '最初'), vt('t0', '重複'), ...Array.from({ length: 25 }, (_, i) => vt(`t${i + 1}`))];
    const r = repair({ ...d, visitTypes: types });
    expect(r.visitTypes).toHaveLength(MAX_VISIT_TYPES);
    expect(r.visitTypes[0]).toEqual(vt('t0', '最初'));
    expect(r.visitTypes.at(-1)!.id).toBe('t19');
  });

  it('パターン：いない利用者さんの分は消し、いない種類・いない人は null、曜日は重なりを除いて小さい順、ID の重複は最初の1件', () => {
    const d = base();
    const c = d.clients[0]!.id;
    const s = d.staff[0]!.id;
    const r = repair({
      ...d,
      visitTypes: [vt('t1')],
      patterns: [
        pt('p1', c, { typeId: 'ghost-type', usualStaffId: 'ghost-staff', weekdays: [5, 1, 5, 3] }),
        pt('p2', 'ghost-client'),
        pt('p3', c, { typeId: 't1', usualStaffId: s, weekdays: [0, 6] }),
        pt('p1', c, { note: '重複' }),
      ],
    });
    expect(r.patterns).toEqual([
      pt('p1', c, { typeId: null, usualStaffId: null, weekdays: [1, 3, 5] }),
      pt('p3', c, { typeId: 't1', usualStaffId: s, weekdays: [0, 6] }),
    ]);
  });

  it('訪問：いない種類の typeId は null、どのパターンでもない pattern は null（訪問は残す）', () => {
    const d = base();
    const c = d.clients[0]!.id;
    const [a = '', b = '', e = ''] = visitsOn(d, DAY);
    const r = repair({
      ...d,
      visitTypes: [vt('t1')],
      patterns: [pt('p1', c), pt('p2', 'ghost-client')],
      visits: d.visits.map((v) => {
        if (v.id === a) return { ...v, typeId: 't1', pattern: { id: 'p1', date: DAY, edited: true } };
        if (v.id === b) return { ...v, typeId: 'ghost', pattern: { id: 'p2', date: DAY, edited: false } };
        if (v.id === e) return { ...v, pattern: { id: 'ghost', date: DAY, edited: false } };
        return v;
      }),
    });
    const byId = new Map(r.visits.map((v) => [v.id, v]));
    expect(r.visits).toHaveLength(d.visits.length);
    expect(byId.get(a)).toMatchObject({ typeId: 't1', pattern: { id: 'p1', date: DAY, edited: true } });
    expect(byId.get(b)).toMatchObject({ typeId: null, pattern: null });
    expect(byId.get(e)).toMatchObject({ typeId: null, pattern: null });
  });

  it('終了日が開始日より前・開始（早）が開始（遅）より後・曜日が0個のパターンは契約で止める', () => {
    const d = base();
    const c = d.clients[0]!.id;
    const bad = (p: Pattern) => migrate(JSON.parse(JSON.stringify({ ...d, patterns: [p] })));
    const e1 = bad(pt('p', c, { from: DAY, to: '2026-10-11' }));
    expect(isImportError(e1)).toBe(true);
    expect((e1 as { message: string }).message).toContain('終了日は開始日以降にしてください');
    expect(isImportError(bad(pt('p', c, { earliestStart: '10:00', latestStart: '09:00' })))).toBe(true);
    expect(isImportError(bad(pt('p', c, { weekdays: [] })))).toBe(true);
    expect(isImportError(bad(pt('p', c, { from: DAY, to: DAY })))).toBe(false);
  });

  it('種類・パターン・保存した回を含むデータが 書き出し → 読み込み で同じに戻る', () => {
    const d = base();
    const c = d.clients[0]!.id;
    const s = d.staff[0]!.id;
    const p = pt('p1', c, { typeId: 't1', usualStaffId: s, weekdays: [1, 4], everyWeeks: 2, to: '2026-12-31' });
    const x: DemoData = {
      ...d,
      visitTypes: [
        { ...vt('t1', '介護'), requirements: [{ itemId: 'gender', op: 'is', value: '女性' }], note: 'メモ' },
      ],
      patterns: [p],
      visits: [
        ...d.visits,
        {
          ...d.visits[0]!,
          id: `${DAY}_p1`,
          clientId: c,
          typeId: 't1',
          pattern: { id: 'p1', date: DAY, edited: false },
        },
        {
          ...d.visits[0]!,
          id: `2026-10-15_p1`,
          date: '2026-10-16',
          clientId: c,
          typeId: 't1',
          pattern: { id: 'p1', date: '2026-10-15', edited: true },
        },
      ],
    };
    expect(repair(x)).toEqual(x);
    expect(importJson(JSON.stringify(x))).toEqual(x);
  });
});

describe('〈利用者さん〉の仮押さえ（ADR-0012 追記。段階3）', () => {
  it('repair は仮押さえを変えず、書き出し → 読み込み で同じに戻る', () => {
    const d = base();
    // 仮押さえは利用中の前の段階だけ（ADR-0015）
    const x: DemoData = {
      ...d,
      clients: d.clients.map((c, i) => (i === 0 ? { ...c, tentative: true, stage: 'inquiry' as const } : c)),
    };
    expect(repair(x)).toEqual(x);
    const back = importJson(JSON.stringify(x));
    expect(isImportError(back)).toBe(false);
    expect((back as DemoData).clients[0]!.tentative).toBe(true);
    expect(back).toEqual(x);
  });

  it('真偽でない tentative は契約で止める', () => {
    const d = base();
    const bad = JSON.parse(JSON.stringify(d));
    bad.clients[0].tentative = 'はい';
    expect(isImportError(importJson(JSON.stringify(bad)))).toBe(true);
  });
});

describe('〈利用者さん〉のよみ（PRD D61）', () => {
  it('よみが 書き出し → 読み込み で同じに戻る', () => {
    const d = base();
    const x: DemoData = { ...d, clients: d.clients.map((c, i) => ({ ...c, kana: `よみ${i}` })) };
    expect(repair(x)).toEqual(x);
    const back = importJson(JSON.stringify(x));
    expect(isImportError(back)).toBe(false);
    expect(back).toEqual(x);
  });

  it('51文字のよみは契約で止める', () => {
    const d = base();
    const bad = JSON.parse(JSON.stringify(d));
    bad.clients[0].kana = 'あ'.repeat(51);
    expect(isImportError(importJson(JSON.stringify(bad)))).toBe(true);
  });
});

describe('第N曜日・曜日ごとの時刻・〈利用者さん〉の休み・決まりごと（ADR-0013）', () => {
  const pattern = (d: DemoData, over: Partial<Pattern> = {}): Pattern => ({ ...d.patterns[0]!, ...over });

  it('repair：いない〈利用者さん〉の休みと ID の重複を除く。monthWeeks は小さい順（毎週系なら []）、dayTimes は曜日にあるものだけ・曜日の順', () => {
    const d = base();
    const c = d.clients[0]!.id;
    const leaves = [
      { id: 'l1', clientId: c, from: DAY, to: DAY, note: '' },
      { id: 'l1', clientId: c, from: '2026-10-20', to: '2026-10-21', note: '重複' },
      { id: 'l2', clientId: 'nobody', from: DAY, to: DAY, note: '' },
    ];
    const p = pattern(d, {
      weekdays: [1, 4],
      repeat: 'monthly',
      monthWeeks: [4, 3, 4],
      dayTimes: [
        { weekday: 4, earliestStart: '15:00', latestStart: '15:00' },
        { weekday: 2, earliestStart: '11:00', latestStart: '11:00' },
        { weekday: 1, earliestStart: '09:30', latestStart: '09:30' },
      ],
    });
    const weekly = pattern(d, { id: 'pw', repeat: 'weekly', monthWeeks: [2] });
    const r = repair({ ...d, clientLeaves: leaves, patterns: [p, weekly, ...d.patterns.slice(1)] });
    expect(r.clientLeaves.map((l) => l.id)).toEqual(['l1']);
    const rp = r.patterns.find((x) => x.id === p.id)!;
    expect(rp.monthWeeks).toEqual([3, 4]);
    expect(rp.dayTimes.map((t) => t.weekday)).toEqual([1, 4]);
    expect(r.patterns.find((x) => x.id === 'pw')!.monthWeeks).toEqual([]);
  });

  it('毎月で第N週が空・同じ曜日の時刻が2つ・終了日が開始日より前の休みは契約で止める', () => {
    const d = base();
    const bad = (x: Partial<DemoData>) => isImportError(migrate(JSON.parse(JSON.stringify({ ...d, ...x }))));
    expect(bad({ patterns: [pattern(d, { repeat: 'monthly', monthWeeks: [] })] })).toBe(true);
    expect(bad({ patterns: [pattern(d, { repeat: 'monthly', monthWeeks: [6] })] })).toBe(true);
    const t = { weekday: 1, earliestStart: '09:00', latestStart: '09:00' };
    expect(bad({ patterns: [pattern(d, { dayTimes: [t, t] })] })).toBe(true);
    expect(bad({ patterns: [pattern(d, { dayTimes: [{ ...t, latestStart: '08:00' }] })] })).toBe(true);
    const c = d.clients[0]!.id;
    expect(bad({ clientLeaves: [{ id: 'l', clientId: c, from: '2026-10-20', to: '2026-10-19', note: '' }] })).toBe(
      true,
    );
    expect(bad({ clients: d.clients.map((x, i) => (i === 0 ? { ...x, keyNote: 'あ'.repeat(201) } : x)) })).toBe(true);
  });

  it('休み・第N曜日・曜日ごとの時刻・決まりごとを含むデータが 書き出し → 読み込み で同じに戻る', () => {
    const d = base();
    const c = d.clients[0]!.id;
    const x: DemoData = {
      ...d,
      clientLeaves: [{ id: 'l1', clientId: c, from: DAY, to: '2026-10-14', note: '入院' }],
      patterns: [
        pattern(d, {
          weekdays: [1, 4],
          repeat: 'monthly',
          monthWeeks: [3, 4],
          dayTimes: [{ weekday: 1, earliestStart: '09:30', latestStart: '09:30' }],
        }),
        ...d.patterns.slice(1),
      ],
      clients: d.clients.map((cl, i) => (i === 0 ? { ...cl, entryNote: '裏口から', parkingNote: '月極の3番' } : cl)),
    };
    expect(repair(x)).toEqual(x);
    const back = importJson(JSON.stringify(x));
    expect(isImportError(back)).toBe(false);
    expect(back).toEqual(x);
  });
});

describe('担当できる人を限る（ADR-0014）', () => {
  it('repair：いない人・休止中の人と重なりを除く。全員いなくなれば []（限らない）。食い違いが無ければ同じ物', () => {
    const d = base();
    const [s1, s2, s3] = d.staff.map((s) => s.id);
    const clients = d.clients.map((c, i) =>
      i === 0
        ? { ...c, allowedStaffIds: [s1!, 'ghost', s2!, s1!, s3!] }
        : i === 1
          ? { ...c, allowedStaffIds: [s3!] }
          : i === 2
            ? { ...c, allowedStaffIds: [s1!, s2!] }
            : c,
    );
    const staff = d.staff.map((s) => (s.id === s3 ? { ...s, active: false } : s));
    const r = repair({ ...d, staff, clients });
    expect(r.clients[0]!.allowedStaffIds).toEqual([s1, s2]);
    expect(r.clients[1]!.allowedStaffIds).toEqual([]);
    // 直す所が無い〈利用者さん〉は同じ物
    expect(r.clients[2]).toBe(clients[2]);
  });

  it('51人を超える担当できる人は契約で止める', () => {
    const d = base();
    const bad = JSON.parse(JSON.stringify(d));
    bad.clients[0].allowedStaffIds = Array.from({ length: 51 }, (_, i) => `s${i}`);
    expect(isImportError(importJson(JSON.stringify(bad)))).toBe(true);
  });
});
