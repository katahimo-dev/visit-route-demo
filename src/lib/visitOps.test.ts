import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Pattern, Visit } from '../contracts/documents';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { findVisit, putVisits, visitsIn } from '../patterns';
import {
  applyVisitEdit,
  assignmentOf,
  assignOnDays,
  cancelVisitOp,
  clientVisitsIn,
  dayVisitRows,
  draftOf,
  endPatternOp,
  newDraft,
  occurrenceChanges,
  restoreOccurrenceOp,
  scopeTexts,
  staffChoices,
  staffPickError,
  staffVisitsIn,
  timeChanged,
  unassignedVisits,
  uncancelVisitOp,
  visitInfo,
} from './visitOps';

// DATE（2026-10-12）は月曜。今日は DATE。版2（ADR-0053）：繰り返しの回は計算し、変えた回だけ保存する

const IDS = { visit: 'vnew', patterns: ['np1', 'np2'] as const };
const NOW = 1000;

function pattern(id: string, weekdays: number[], over: Partial<Pattern> = {}): Pattern {
  return {
    id,
    clientId: 'c1',
    typeId: null,
    weekdays,
    everyWeeks: 1,
    repeat: 'weekly',
    monthWeeks: [],
    dayTimes: [],
    windowKind: 'fixed',
    earliestStart: '09:00',
    latestStart: '09:00',
    durationMinutes: 60,
    from: DATE,
    to: null,
    usualStaffId: null,
    note: '',
    ...over,
  };
}

/** 月曜のパターン（10/12・10/19・10/26 の回）と2人の〈スタッフ〉 */
function data(patterns: Pattern[] = [pattern('p1', [1])], over: Partial<DemoData> = {}): DemoData {
  return makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.27, 140.86)],
    clients: [client('c1', 38.27, 140.88)],
    patterns,
    ...over,
  });
}

const find = (d: DemoData, id: string) => findVisit(d, id)!;
/** 10月の訪問（計算した回も） */
const all = (d: DemoData) => visitsIn(d, { from: DATE, to: '2026-10-31' });
/** その回を変えて保存する */
const put = (d: DemoData, id: string, over: Partial<Visit>): DemoData => ({
  ...d,
  visits: putVisits(d.visits, [{ ...find(d, id), ...over }]),
});

describe('draftOf・timeChanged', () => {
  it('メモと〈利用者さん〉は日時の変更に数えない', () => {
    const v = visit('v1', 'c1', '09:00', '10:00');
    expect(timeChanged(v, { ...draftOf(v), note: 'x' })).toBe(false);
    expect(timeChanged(v, { ...draftOf(v), earliestStart: '09:30' })).toBe(true);
    expect(timeChanged(v, { ...draftOf(v), typeId: 't1' })).toBe(true);
  });
  it('新しい訪問の初期値は利用中の先頭の〈利用者さん〉・09:00・60分', () => {
    const f = newDraft(data(), '2026-10-13');
    expect(f).toMatchObject({ clientId: 'c1', date: '2026-10-13', earliestStart: '09:00', durationMinutes: 60 });
  });
});

describe('visitInfo・occurrenceChanges', () => {
  it('繰り返しの回は繰り返しの文と、この回の変更', () => {
    const d = data();
    const moved = { ...find(d, '2026-10-19_p1'), date: '2026-10-20', earliestStart: '10:00', latestStart: '10:00' };
    const d2 = { ...d, visits: putVisits(d.visits, [moved]) };
    const info = visitInfo(d2, moved.id, DATE)!;
    expect(info.patternText).toBe('月 09:00（10/12から）');
    expect(info.changes).toEqual(['日付 10/19→10/20', '時刻 09:00→10:00']);
    expect(occurrenceChanges(find(d, '2026-10-26_p1'), d.patterns[0], [])).toEqual([]);
  });
  it('今日より前の訪問は見るだけ', () => {
    expect(visitInfo(data(), '2026-10-12_p1', '2026-10-13')!.editable).toBe(false);
  });
  it('担当は訪問の担当（計算した回は繰り返しの担当）', () => {
    const id = '2026-10-19_p1';
    expect(assignmentOf(data(), id)).toEqual({ staffId: null, pinned: false });
    const usual = data([pattern('p1', [1], { usualStaffId: 's1' })]);
    expect(assignmentOf(usual, id)).toEqual({ staffId: 's1', pinned: false });
    expect(assignmentOf(put(usual, id, { staffId: 's2', pinned: true }), id)).toEqual({ staffId: 's2', pinned: true });
  });
});

describe('applyVisitEdit：この回だけ', () => {
  it('時刻を変えると「この回だけ変えた」になり、ほかの回は変えない', () => {
    const d = data();
    const v = find(d, '2026-10-19_p1');
    const r = applyVisitEdit(
      d,
      { visitId: v.id, draft: { ...draftOf(v), earliestStart: '10:00' }, scope: 'once' },
      DATE,
      IDS,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(find(r.data, v.id)).toMatchObject({
      earliestStart: '10:00',
      latestStart: '10:00',
      pattern: { edited: true },
    });
    expect(find(r.data, '2026-10-26_p1').earliestStart).toBe('09:00');
    expect(r.dates).toEqual(['2026-10-19']);
  });
  it('何も変えなければ unchanged', () => {
    const d = data();
    const v = find(d, '2026-10-19_p1');
    const r = applyVisitEdit(d, { visitId: v.id, draft: draftOf(v), scope: 'once' }, DATE, IDS, NOW);
    expect(r.ok && r.unchanged).toBe(true);
  });
  it('今日より前の日・取り消した訪問・時刻の前後は誤り', () => {
    const d = data();
    const v = find(d, '2026-10-19_p1');
    const past = applyVisitEdit(
      d,
      { visitId: v.id, draft: { ...draftOf(v), date: '2026-10-01' }, scope: 'once' },
      DATE,
      IDS,
      NOW,
    );
    expect(past).toMatchObject({ ok: false, field: 'date' });
    const c = cancelVisitOp(d, v.id, false);
    expect(applyVisitEdit(c, { visitId: v.id, draft: draftOf(v), scope: 'once' }, DATE, IDS, NOW).ok).toBe(false);
    const bad = applyVisitEdit(
      d,
      {
        visitId: v.id,
        draft: { ...draftOf(v), windowKind: 'window', earliestStart: '10:00', latestStart: '09:00' },
        scope: 'once',
      },
      DATE,
      IDS,
      NOW,
    );
    expect(bad).toMatchObject({ ok: false, field: 'latestStart' });
  });
  it('担当だけ替える：その回の担当にしてピンを付ける', () => {
    const d = data();
    const id = '2026-10-19_p1';
    const r = applyVisitEdit(
      d,
      { visitId: id, draft: draftOf(find(d, id)), staff: 's2', scope: 'once' },
      DATE,
      IDS,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(find(r.data, id)).toMatchObject({ staffId: 's2', pinned: true });
    // ほかの回は変えない
    expect(find(r.data, '2026-10-26_p1').staffId).toBeNull();
  });
  it('担当なし（この回だけ）：担当を外してピンも外す', () => {
    const d0 = data([pattern('p1', [1], { usualStaffId: 's1' })]);
    const id = '2026-10-19_p1';
    const d = put(d0, id, { pinned: true });
    const r = applyVisitEdit(
      d,
      { visitId: id, draft: draftOf(find(d, id)), staff: null, scope: 'once' },
      DATE,
      IDS,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(find(r.data, id)).toMatchObject({ staffId: null, pinned: false });
  });
});

describe('applyVisitEdit：これ以降・すべて', () => {
  it('これ以降：その回から同じ曜日の回を新しい時刻・所要にし、前の回は変えない', () => {
    const d = data();
    const v = find(d, '2026-10-19_p1');
    const r = applyVisitEdit(
      d,
      { visitId: v.id, draft: { ...draftOf(v), earliestStart: '10:00', durationMinutes: 90 }, scope: 'following' },
      DATE,
      IDS,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(find(r.data, '2026-10-12_p1').earliestStart).toBe('09:00');
    const after = find(r.data, r.visitId);
    expect(after).toMatchObject({ date: '2026-10-19', earliestStart: '10:00', durationMinutes: 90 });
    const later = all(r.data).find((x) => x.date === '2026-10-26' && !x.cancelled)!;
    expect(later).toMatchObject({ earliestStart: '10:00', durationMinutes: 90 });
    const np = r.data.patterns.find((p) => p.id === after.pattern!.id)!;
    expect(np).toMatchObject({ from: '2026-10-19', earliestStart: '10:00', durationMinutes: 90 });
  });
  it('すべて：今日以降で最初の回から変える（後の回を開いても）', () => {
    const d = data();
    const v = find(d, '2026-10-26_p1');
    const r = applyVisitEdit(
      d,
      { visitId: v.id, draft: { ...draftOf(v), earliestStart: '11:00' }, scope: 'all' },
      DATE,
      IDS,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    const starts = all(r.data)
      .filter((x) => !x.cancelled)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((x) => `${x.date} ${x.earliestStart}`);
    expect(starts).toEqual(['2026-10-12 11:00', '2026-10-19 11:00', '2026-10-26 11:00']);
    expect(find(r.data, r.visitId).date).toBe('2026-10-26');
  });
  it('これ以降の担当：分けた繰り返しの担当にし、その後の回はその人になる', () => {
    const d = data();
    const a = '2026-10-19_p1';
    const r = applyVisitEdit(
      d,
      { visitId: a, draft: draftOf(find(d, a)), staff: 's2', scope: 'following' },
      DATE,
      IDS,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    const after = find(r.data, r.visitId);
    expect(r.data.patterns.find((p) => p.id === after.pattern!.id)!.usualStaffId).toBe('s2');
    const owners = ['2026-10-19', '2026-10-26'].map((date) => all(r.data).find((x) => x.date === date)!.staffId);
    expect(owners).toEqual(['s2', 's2']);
    // 前の回のパターンは前のまま
    expect(r.data.patterns.find((p) => p.id === 'p1')!.usualStaffId).toBeNull();
    expect(find(r.data, '2026-10-12_p1').staffId).toBeNull();
  });
  it('担当なしは「この回だけ」でだけ選べる', () => {
    const d = data();
    const id = '2026-10-19_p1';
    expect(
      applyVisitEdit(d, { visitId: id, draft: draftOf(find(d, id)), staff: null, scope: 'following' }, DATE, IDS, NOW)
        .ok,
    ).toBe(false);
  });
  it('範囲の文と、そのままにする回', () => {
    const d = cancelVisitOp(data([pattern('p1', [1, 3])]), '2026-10-26_p1', false);
    const t = scopeTexts(d, '2026-10-19_p1', DATE)!;
    expect(t.following).toBe('10/19 以降の月曜の回');
    expect(t.otherDays).toBe(true);
    expect(t.keptDates).toEqual({ following: ['2026-10-26'], all: ['2026-10-26'] });
    expect(scopeTexts(makeData({ visits: [visit('v1', 'c1', '09:00', '09:00')] }), 'v1', DATE)).toBeNull();
  });
});

describe('applyVisitEdit：新しい訪問', () => {
  it('単発の訪問を足す。担当を選べばその人に当ててピンを付ける', () => {
    const d = data();
    const r = applyVisitEdit(
      d,
      { visitId: null, draft: { ...newDraft(d, '2026-10-13'), earliestStart: '13:00' }, staff: 's1', scope: 'once' },
      DATE,
      IDS,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(find(r.data, 'vnew')).toMatchObject({ date: '2026-10-13', earliestStart: '13:00', pattern: null });
    expect(find(r.data, 'vnew')).toMatchObject({ staffId: 's1', pinned: true });
  });
  it('〈利用者さん〉が無ければ誤り', () => {
    const d = data();
    const r = applyVisitEdit(
      d,
      { visitId: null, draft: { ...newDraft(d, DATE), clientId: '' }, scope: 'once' },
      DATE,
      IDS,
      NOW,
    );
    expect(r.ok).toBe(false);
  });
});

describe('取り消し・やめる・繰り返しのとおりに戻す', () => {
  it('取り消してやめると「この回だけ変えた」も外れる（ほかに変えた所が無ければ）', () => {
    const d = data();
    const id = '2026-10-19_p1';
    const c = cancelVisitOp(d, id, true);
    expect(find(c, id)).toMatchObject({ cancelled: true, cancelKind: 'sameDay', pattern: { edited: true } });
    const u = uncancelVisitOp(c, id);
    expect(find(u, id)).toMatchObject({ cancelled: false, cancelKind: null, pattern: { edited: false } });
  });
  it('この回の変更を戻す', () => {
    const d = data();
    const id = '2026-10-19_p1';
    const r = applyVisitEdit(
      d,
      { visitId: id, draft: { ...draftOf(find(d, id)), date: '2026-10-20' }, scope: 'once' },
      DATE,
      IDS,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    const back = restoreOccurrenceOp(r.data, id, DATE);
    expect(find(back, id)).toMatchObject({ date: '2026-10-19', earliestStart: '09:00', pattern: { edited: false } });
  });
});

describe('担当の候補', () => {
  it('欄の日時で候補を出し、今の担当を返す', () => {
    const id = '2026-10-19_p1';
    const d = put(data(), id, { staffId: 's1' });
    const c = staffChoices(d, id, draftOf(find(d, id)));
    expect(c.currentStaffId).toBe('s1');
    expect(c.choices.map((x) => x.staffId).sort()).toEqual(['s1', 's2']);
    expect(c.choices.find((x) => x.staffId === 's2')!.description).toMatch(/時間の約束/);
    // 日付を変えると、その日の候補（今の担当は無し）
    const moved = staffChoices(d, id, { ...draftOf(find(d, id)), date: '2026-10-20' });
    expect(moved).toMatchObject({ currentStaffId: null });
  });
  it('日付が無ければ理由', () => {
    const d = data();
    expect(staffChoices(d, null, { ...newDraft(d, DATE), date: '' }).why).toMatch(/日付/);
  });
});

describe('一覧', () => {
  it('担当なしの訪問・その日の行・〈利用者さん〉の期間の回', () => {
    const a = '2026-10-19_p1';
    const d0 = put(data([pattern('p1', [1], { usualStaffId: 's1' })]), a, { staffId: null });
    const extra: Visit = visit('v2', 'c1', '08:00', '08:00', {
      date: '2026-10-19',
      windowKind: 'fixed',
      staffId: 's1',
    });
    const d = { ...d0, visits: [...d0.visits, extra] };
    expect(unassignedVisits(d, DATE, '2026-10-31').map((v) => v.id)).toEqual([a]);
    const rows = dayVisitRows(d, '2026-10-19', '07:00', 1);
    expect(rows.rows.map((r) => [r.visit.id, r.mark])).toEqual([[a, 'unassigned']]);
    expect(rows.rest).toBe(1);
    expect(clientVisitsIn(d, 'c1', '2026-10-19', '2026-10-19').map((v) => v.id)).toEqual(['v2', a]);
  });
});

describe('レビューの直し（PR #78）', () => {
  it('日付を変えたあと、その日に働かない人は選べない（前の日の候補で当てない）', () => {
    const id = '2026-10-19_p1';
    const d = put(data(), id, { staffId: 's1' });
    const draft = { ...draftOf(find(d, id)), date: '2026-10-24' }; // 土曜は s1・s2 とも働かない
    expect(staffPickError(d, id, draft, 's2')).toMatch(/候補にいません|選べません/);
    const r = applyVisitEdit(d, { visitId: id, draft, staff: 's2', scope: 'once' }, DATE, IDS, NOW);
    expect(r.ok).toBe(false);
    // 担当なしも、日付を変えたら今の担当がいないので選べない
    expect(staffPickError(d, id, draft, null)).not.toBeNull();
    expect(staffPickError(d, id, draft, undefined)).toBeNull();
  });
  it('force でも、その日に問題にいない人は当てない', () => {
    const d = data();
    const r = assignOnDays(d, [{ visitId: '2026-10-19_p1', date: '2026-10-19' }], 'nobody', new Set(['2026-10-19_p1']));
    expect(r.failed.map((x) => x.why)).toEqual(['その日は働かない']);
  });
  it('この回だけ日付を変えた回で「これ以降」：欄の日付をそのまま使い、後の回も同じだけずらす', () => {
    const d = data();
    const id = '2026-10-19_p1';
    const once = applyVisitEdit(
      d,
      { visitId: id, draft: { ...draftOf(find(d, id)), date: '2026-10-20' }, scope: 'once' },
      DATE,
      IDS,
      NOW,
    );
    if (!once.ok) throw new Error(once.error);
    const v = find(once.data, id);
    const r = applyVisitEdit(
      once.data,
      { visitId: id, draft: { ...draftOf(v), earliestStart: '10:00' }, scope: 'following' },
      DATE,
      IDS,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(find(r.data, r.visitId)).toMatchObject({ date: '2026-10-20', earliestStart: '10:00' });
    const later = all(r.data)
      .filter((x) => x.date > '2026-10-20' && !x.cancelled)
      .map((x) => `${x.date} ${x.earliestStart}`);
    expect(later).toEqual(['2026-10-27 10:00']);
  });
  it('「これ以降」でメモだけ変えたら、この回だけのメモにする（繰り返しは分けない）', () => {
    const d = data();
    const id = '2026-10-19_p1';
    const r = applyVisitEdit(
      d,
      { visitId: id, draft: { ...draftOf(find(d, id)), note: '鍵は管理人' }, scope: 'following' },
      DATE,
      IDS,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(find(r.data, id).note).toBe('鍵は管理人');
    expect(r.data.patterns).toEqual(d.patterns);
  });
  it('「すべて」はこの回だけ変えた回を起点にせず、範囲の繰り返しは動かした回のパターン', () => {
    const d0 = data();
    // 最初の回（10/12）をこの回だけ変える
    const e = applyVisitEdit(
      d0,
      {
        visitId: '2026-10-12_p1',
        draft: { ...draftOf(find(d0, '2026-10-12_p1')), earliestStart: '08:00' },
        scope: 'once',
      },
      DATE,
      IDS,
      NOW,
    );
    if (!e.ok) throw new Error(e.error);
    const d = e.data;
    const v = find(d, '2026-10-26_p1');
    expect(scopeTexts(d, v.id, DATE)!.keptDates.all).toEqual(['2026-10-12']);
    const r = applyVisitEdit(
      d,
      { visitId: v.id, draft: { ...draftOf(v), earliestStart: '11:00' }, staff: 's2', scope: 'all' },
      DATE,
      IDS,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(find(r.data, '2026-10-12_p1').earliestStart).toBe('08:00');
    const series = all(r.data).filter((x) => x.date >= '2026-10-19' && !x.cancelled);
    expect(series.map((x) => x.earliestStart)).toEqual(['11:00', '11:00']);
    const pid = series[0]!.pattern!.id;
    expect(series.every((x) => x.pattern!.id === pid)).toBe(true);
    expect(r.data.patterns.find((p) => p.id === pid)!.usualStaffId).toBe('s2');
    expect(series.map((x) => assignmentOf(r.data, x.id).staffId)).toEqual(['s2', 's2']);
  });
  it('今ある訪問の〈利用者さん〉は変えない', () => {
    const d = data();
    const id = '2026-10-19_p1';
    const r = applyVisitEdit(
      d,
      { visitId: id, draft: { ...draftOf(find(d, id)), clientId: 'zz', note: 'x' }, scope: 'once' },
      DATE,
      IDS,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(find(r.data, id).clientId).toBe('c1');
  });
});

describe('staffVisitsIn（〈スタッフ〉の画面の予定。PRD D309）', () => {
  it('訪問の担当がその人の訪問だけ。取り消しは出さない', () => {
    const a = '2026-10-19_p1';
    const b = '2026-10-26_p1';
    const d = put(put(data(), a, { staffId: 's1' }), b, { staffId: 's1' });
    expect(staffVisitsIn(d, 's1', '2026-10-12', '2026-10-31').map((v) => v.id)).toEqual([a, b]);
    expect(staffVisitsIn(d, 's2', '2026-10-12', '2026-10-31')).toEqual([]);
    const cancelled = cancelVisitOp(d, a, false);
    expect(staffVisitsIn(cancelled, 's1', '2026-10-12', '2026-10-31').map((v) => v.id)).toEqual([b]);
    // 期間の外は数えない
    expect(staffVisitsIn(d, 's1', '2026-10-20', '2026-10-25')).toEqual([]);
  });
});

describe('endPatternOp（繰り返しを終わらせる。PRD D308）', () => {
  it('終了日を入れ、それより後の回は計算されなくなる。この回だけ変えた・取り消した回は残す', () => {
    const d0 = data();
    const edited = cancelVisitOp(d0, '2026-10-26_p1', false);
    const r = endPatternOp(edited, 'p1', '2026-10-19', DATE);
    expect(r.data.patterns[0]!.to).toBe('2026-10-19');
    expect(r.removed).toBe(0);
    expect(all(r.data).map((v) => v.id)).toEqual(['2026-10-12_p1', '2026-10-19_p1', '2026-10-26_p1']);
    const r2 = endPatternOp(d0, 'p1', '2026-10-12', DATE);
    expect(all(r2.data).map((v) => v.id)).toEqual(['2026-10-12_p1']);
    // 変えていない保存した回は消す
    const stored = put(d0, '2026-10-26_p1', { staffId: 's1' });
    expect(endPatternOp(stored, 'p1', '2026-10-12', DATE).removed).toBe(1);
  });
  it('今日より前の回は消さない・確定した日を数える・今の終了日のほうが早ければそのまま', () => {
    const d0 = {
      ...data(),
      snapshots: {
        '2026-10-26': {
          date: '2026-10-26',
          at: 1,
          visits: [{ id: '2026-10-26_p1', clientId: 'c1', staffId: 's1', start: '09:00' }],
        },
      },
    };
    const r = endPatternOp(d0, 'p1', '2026-10-01', '2026-10-20');
    expect(r.data.patterns[0]!.to).toBe('2026-10-19');
    expect(r.confirmedDays).toBe(1);
    expect(all(r.data).some((v) => v.id === '2026-10-19_p1')).toBe(true);
    const short = data([pattern('p1', [1], { to: '2026-10-19' })]);
    expect(endPatternOp(short, 'p1', '2026-10-26', DATE).data.patterns[0]!.to).toBe('2026-10-19');
    expect(endPatternOp(d0, 'none', DATE, DATE).data).toBe(d0);
  });
});
