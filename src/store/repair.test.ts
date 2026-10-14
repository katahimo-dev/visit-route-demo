import { describe, expect, it } from 'vitest';
import { type AiPlan, type DemoData, MAX_RUNS_PER_DAY } from '../contracts/data';
import { compile } from '../matching';
import { createDemoData } from '../seed';
import { importJson, isImportError, migrate } from './index';
import { repair } from './repair';

const DAY = '2026-10-12';
const base = () => createDemoData(DAY);
const visitsOn = (d: DemoData, date: string) => d.visits.filter((v) => v.date === date).map((v) => v.id);

const plan = (routes: Record<string, string[]>, unassigned: string[], pins: Record<string, string> = {}): AiPlan => ({
  date: DAY,
  createdAt: 1,
  seed: 1,
  iterations: 10,
  routes,
  unassigned,
  score: 0,
  stopped: false,
  rules: [],
  generated: { routes, unassigned, score: 0 },
  pins,
});

describe('repair（契約は通るが中身が食い違うデータ）', () => {
  it('食い違いのない初期データは変えない', () => {
    const d = base();
    expect(repair(d)).toEqual(d);
  });

  it('いないスタッフ・訪問を指す手作業案は、その列・その訪問を除く（未割当の列は残す）', () => {
    const d = base();
    const [a = '', b = '', c = ''] = visitsOn(d, DAY);
    const other = visitsOn(d, '2026-10-13')[0] ?? '';
    const r = repair({
      ...d,
      manualPlans: { [DAY]: { s1: [a, 'v-none', other, a], ghost: [b], __none: [c, a] } },
    });
    expect(r.manualPlans[DAY]).toEqual({ s1: [a], __none: [c] });
  });

  it('AI案：いないスタッフの列の訪問は未割当へ、いない訪問は除く、固定はいる訪問・スタッフだけ', () => {
    const d = base();
    const [a = '', b = '', c = ''] = visitsOn(d, DAY);
    const p = plan({ s1: [a, 'v-none'], ghost: [b] }, [c, 'v-none2', a], { [a]: 's1', [b]: 'ghost', 'v-none': 's1' });
    const run = {
      id: `${DAY}#1`,
      no: 1,
      date: DAY,
      createdAt: 1,
      label: '標準',
      presetId: 'standard',
      seed: 1,
      iterations: 10,
      rules: [],
      pins: p.pins,
      routes: p.routes,
      unassigned: p.unassigned,
      score: 0,
      stopped: false,
    };
    const r = repair({ ...d, aiPlans: { [DAY]: p }, aiRuns: { [DAY]: [run, { ...run, label: '重複' }] } });
    const x = r.aiPlans[DAY]!;
    expect(x.routes).toEqual({ s1: [a] });
    expect(x.unassigned).toEqual([c, b]);
    expect(x.generated.routes).toEqual({ s1: [a] });
    expect(x.generated.unassigned).toEqual([c, b]);
    expect(x.pins).toEqual({ [a]: 's1' });
    // 記録も同じに直し、ID の重複は最初の1件
    expect(r.aiRuns[DAY]).toHaveLength(1);
    expect(r.aiRuns[DAY]![0]).toMatchObject({
      label: '標準',
      routes: { s1: [a] },
      unassigned: [c, b],
      pins: { [a]: 's1' },
    });
  });

  it('記録は1日 MAX_RUNS_PER_DAY 件まで（古いものから捨てる）', () => {
    const d = base();
    const runs = Array.from({ length: MAX_RUNS_PER_DAY + 5 }, (_, i) => ({
      id: `${DAY}#${i + 1}@${i}`,
      no: i + 1,
      date: DAY,
      createdAt: i,
      label: '標準',
      presetId: 'standard',
      seed: 1,
      iterations: 10,
      rules: [],
      pins: {},
      routes: {},
      unassigned: [],
      score: 0,
      stopped: false,
    }));
    const r = repair({ ...d, aiRuns: { [DAY]: runs } });
    expect(r.aiRuns[DAY]).toHaveLength(MAX_RUNS_PER_DAY);
    expect(r.aiRuns[DAY]![0]!.no).toBe(6);
  });

  it('いないスタッフを指す担当・いつもの担当は null、相性・稼働時間帯の上書きのいない人の分は消す', () => {
    const d = base();
    const v0 = d.visits[0]!;
    const c0 = d.clients[0]!;
    const r = repair({
      ...d,
      visits: d.visits.map((v) => (v.id === v0.id ? { ...v, staffId: 'ghost' } : v)),
      clients: d.clients.map((c) => (c.id === c0.id ? { ...c, usualStaffId: 'ghost' } : c)),
      compat: { ...d.compat, ghostClient: { s1: 2 }, [c0.id]: { ...d.compat[c0.id], ghost: -2 } },
      availability: [...d.availability, { staffId: 'ghost', date: DAY, slots: [] }],
    });
    expect(r.visits.find((v) => v.id === v0.id)!.staffId).toBeNull();
    expect(r.clients.find((c) => c.id === c0.id)!.usualStaffId).toBeNull();
    expect(r.compat.ghostClient).toBeUndefined();
    expect(r.compat[c0.id]).toEqual(d.compat[c0.id] ?? {});
    expect(r.availability).toEqual(d.availability);
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
    const bad = { ...d, manualPlans: { ...d.manualPlans, [DAY]: { ghost: ['v-none'] } } };
    const r = migrate(JSON.parse(JSON.stringify(bad)));
    expect(isImportError(r)).toBe(false);
    expect((r as DemoData).manualPlans[DAY]).toEqual({});
    const r2 = importJson(JSON.stringify(bad));
    expect((r2 as DemoData).manualPlans[DAY]).toEqual({});
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
  it('absences の無い古いデータは [] で読める', () => {
    const d = base();
    const { absences: _a, ...old } = JSON.parse(JSON.stringify(d));
    const r = migrate(old);
    expect(isImportError(r)).toBe(false);
    expect((r as DemoData).absences).toEqual([]);
    const nulled = migrate({ ...old, absences: null });
    expect(isImportError(nulled)).toBe(false);
    expect((nulled as DemoData).absences).toEqual([]);
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
  it('今の案・記録の reassign の baseRoutes・basePins・insertRoutes は routes・pins と同じ規則で直す（absenceIds はそのまま。古いデータの now は捨てる）', () => {
    const d = base();
    const [a = '', b = ''] = visitsOn(d, DAY);
    const info = {
      method: 'insert' as const,
      from: 'plan' as const,
      baseRoutes: { s1: [a, 'v-none', a], ghost: [b] },
      basePins: { [a]: 's1', [b]: 'ghost' },
      insertRoutes: { s1: [a, 'v-none'], ghost: [b] },
      absenceIds: ['消えた欠勤'],
    };
    // 古いデータ（いまの時刻 now が残っている）も読め、now は捨てる
    const p = { ...plan({ s1: [a] }, []), reassign: { ...info, now: '10:30' } };
    const r = repair({ ...d, aiPlans: { [DAY]: p } });
    expect(r.aiPlans[DAY]!.reassign).toEqual({
      ...info,
      baseRoutes: { s1: [a] },
      basePins: { [a]: 's1' },
      insertRoutes: { s1: [a] },
    });
    // 案B（method: 'anneal'・stayWeight）も読める
    const pb = { ...plan({ s1: [a] }, []), reassign: { ...info, method: 'anneal' as const, stayWeight: 3 } };
    expect(repair({ ...d, aiPlans: { [DAY]: pb } }).aiPlans[DAY]!.reassign).toMatchObject({
      method: 'anneal',
      stayWeight: 3,
    });
  });
  it('欠勤・AiPlan.reassign・AiRun.reassign を含むデータが 書き出し → 読み込み で同じに戻る', () => {
    const d = base();
    const [a = ''] = visitsOn(d, DAY);
    const s = d.staff[0]!.id;
    const info = {
      method: 'insert' as const,
      from: 'confirmed' as const,
      baseRoutes: { [s]: [a] },
      basePins: {},
      baseGenerated: { routes: { [s]: [a] }, unassigned: [], score: 3 },
      baseRunId: `${DAY}#1@1`,
      absenceIds: ['a1'],
    };
    const routes = { [s]: [a] };
    const run = {
      id: `${DAY}#1@1`,
      no: 1,
      date: DAY,
      createdAt: 1,
      label: '欠勤の振り直し',
      presetId: null,
      seed: 1,
      iterations: 0,
      rules: [],
      pins: { [a]: s },
      routes,
      unassigned: [],
      score: 0,
      stopped: false,
      reassign: info,
    };
    const x: DemoData = {
      ...d,
      absences: [ab('a1', s, DAY, '09:00', '12:00')],
      aiPlans: { [DAY]: { ...plan(routes, [], { [a]: s }), reassign: info } },
      aiRuns: { [DAY]: [run] },
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
