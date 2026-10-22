import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Problem, SolveResult } from '../contracts/problem';
import { addDays } from '../domain/time';
import { putVisits, visitsOn } from '../patterns';
import { createDemoData } from '../seed';
import { solve } from '../solver';
import {
  type BatchDone,
  batchBandText,
  batchDoneText,
  batchHref,
  canMakeDay,
  createMonthBatch,
  dayInputsOf,
  dayLabel,
  missingDays,
  monthsLabel,
  proposalCounts,
  proposalDayFresh,
  weekBatchDays,
  weekLabel,
} from './monthBatch';

const TODAY = '2026-10-21';

/** 繰り返しの担当を外したデモのデータ（どの回も担当なし。版2） */
function unassigned(): DemoData {
  const d = createDemoData(TODAY);
  return { ...d, patterns: d.patterns.map((p) => ({ ...p, usualStaffId: null })) };
}
const staffed = (d: DemoData, date: string) => visitsOn(d, date).filter((v) => v.staffId !== null).length;

/** Worker なしで解く（手で終わらせる。止めると最良で終わる） */
function fakeSolve() {
  const calls: { resolve: () => void; stopped: boolean }[] = [];
  const fn = (problem: Problem) => {
    let done: (r: SolveResult) => void = () => {};
    const promise = new Promise<SolveResult>((res) => {
      done = res;
    });
    const c = {
      stopped: false,
      resolve: () => done(solve(problem, { seed: 1, iterations: 2000 })),
    };
    calls.push(c);
    return {
      promise,
      stop: () => {
        c.stopped = true;
        c.resolve();
      },
    };
  };
  return { fn, calls };
}

/** store の代わり（update はすぐ当てる） */
function hostOf(start: DemoData) {
  let data = start;
  let writes = 0;
  return {
    host: {
      get: () => data,
      update: (fn: (d: DemoData) => DemoData) => {
        data = fn(data);
        writes++;
      },
    },
    data: () => data,
    writes: () => writes,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
/** 計算を1日ずつ進める（解き終わらせて次の日へ） */
async function finishAll(calls: { resolve: () => void }[], from = 0) {
  for (let i = from; i < 50; i++) {
    for (let k = 0; k < 5 && !calls[i]; k++) await tick();
    if (!calls[i]) return;
    calls[i]!.resolve();
    await tick();
  }
}

describe('monthBatch（担当を AI で組む。PRD D256・D257。ADR-0042・ADR-0053）', () => {
  const days = [TODAY, addDays(TODAY, 1)];
  const job = {
    ym: '2026-10',
    label: '10月',
    mode: 'care' as const,
    days: days.map((date) => ({ date, mode: 'care' as const })),
    today: TODAY,
    source: 'month' as const,
  };

  it('つながっていなければ始めない', () => {
    const b = createMonthBatch(fakeSolve().fn);
    expect(b.start(job)).toBe(false);
    expect(b.run.get()).toBeNull();
  });

  it('日ごとに組んで提案にし（訪問には書かない）、終わったら知らせる。組んでいる間は二重に始めない。当てると1回の update', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const start = unassigned();
    const h = hostOf(start);
    b.connect(h.host);
    expect(b.start(job)).toBe(true);
    expect(b.running()).toBe(true);
    expect(b.start(job)).toBe(false);
    expect(b.run.get()).toMatchObject({ ym: '2026-10', label: '10月', targets: days, index: 0, made: 0 });
    s.calls[0]!.resolve();
    await tick();
    expect(staffed(h.data(), days[0]!)).toBe(0);
    expect(b.run.get()).toMatchObject({ index: 1, made: 1 });
    expect(h.writes()).toBe(0);
    expect(b.proposal.get()).toBeNull();
    await finishAll(s.calls, 1);
    expect(b.run.get()).toBeNull();
    expect(h.writes()).toBe(0);
    const done = b.done.get()!;
    expect(done).toMatchObject({ ym: '2026-10', made: 2, stopped: false, error: null });
    expect(done.proposal!.moved).toBeGreaterThan(0);
    const prop = b.proposal.get()!;
    expect(prop.days.map((x) => x.date)).toEqual(days);
    expect(proposalCounts(prop).moved).toBe(done.proposal!.moved);
    // 当てる：1回の update で両方の日に書く
    expect(b.apply()).toEqual({ applied: days, skipped: [] });
    expect(h.writes()).toBe(1);
    expect(h.data()).not.toBe(start);
    expect(staffed(h.data(), days[0]!)).toBeGreaterThan(0);
    expect(staffed(h.data(), days[1]!)).toBeGreaterThan(0);
    // AI が組んだ担当にはピンを付けない
    expect(visitsOn(h.data(), days[0]!).every((v) => !v.pinned)).toBe(true);
    expect(b.proposal.get()).toBeNull();
    expect(b.apply()).toBeNull();
    expect(b.running()).toBe(false);
  });

  it('止める：組んでいる日は最良で残し、残りの日はやめる', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const h = hostOf(unassigned());
    b.connect(h.host);
    b.start(job);
    b.stop();
    await tick();
    await tick();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.stopped).toBe(true);
    expect(b.run.get()).toBeNull();
    expect(b.done.get()).toMatchObject({ made: 1, stopped: true });
    expect(b.proposal.get()).toMatchObject({ stopped: true });
    expect(b.proposal.get()!.days).toHaveLength(1);
    b.discard();
    expect(b.proposal.get()).toBeNull();
    expect(h.writes()).toBe(0);
  });

  it('外す（ページを閉じる・App を外す）と計算を捨て、結果を書かない', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const h = hostOf(unassigned());
    const off = b.connect(h.host);
    b.start(job);
    off();
    expect(b.run.get()).toBeNull();
    await tick();
    expect(h.writes()).toBe(0);
    expect(b.done.get()).toBeNull();
  });

  it('組んだあとにその日の訪問が変わった（日の予定で直した）・確定した日は当てない', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const h = hostOf(unassigned());
    b.connect(h.host);
    b.start({ ...job, days: [{ date: TODAY, mode: 'care' }] });
    const v = visitsOn(h.data(), TODAY)[0]!;
    h.host.update((d) => ({ ...d, visits: putVisits(d.visits, [{ ...v, note: '直した' }]) }));
    const edited = h.data();
    s.calls[0]!.resolve();
    await tick();
    expect(h.data()).toBe(edited);
    expect(b.done.get()).toMatchObject({ made: 1 });
    expect(b.apply()).toEqual({ applied: [], skipped: [TODAY] });
    expect(h.data()).toBe(edited);
    expect(h.writes()).toBe(1);
  });

  it('組んだあとにその日の欠勤・希望休・稼働時間・人・休みが変わったら当てない（休みの人に当てない。PR #81 のレビュー）', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const h = hostOf(unassigned());
    b.connect(h.host);
    b.start({
      ...job,
      days: [
        { date: TODAY, mode: 'care' },
        { date: days[1]!, mode: 'care' },
      ],
    });
    await finishAll(s.calls);
    const p = b.proposal.get()!;
    const sid = h.data().staff.find((x) => x.active)!.id;
    // 今日だけ欠勤を入れる：今日は当てず、明日は当てる
    h.host.update((d) => ({
      ...d,
      absences: [...d.absences, { id: 'ab-x', staffId: sid, date: TODAY, from: null, to: null, note: '' }],
    }));
    expect(proposalDayFresh(h.data(), p.days[0]!)).toBe(false);
    expect(proposalDayFresh(h.data(), p.days[1]!)).toBe(true);
    expect(b.apply()).toEqual({ applied: [days[1]], skipped: [TODAY] });
    // 人（休止）・〈利用者さん〉の休みが変わっても古い
    const base = unassigned();
    const day = { ...p.days[1]!, inputs: dayInputsOf(base, days[1]!), visits: visitsOn(base, days[1]!) };
    expect(proposalDayFresh(base, day)).toBe(true);
    expect(proposalDayFresh({ ...base, staff: base.staff.map((x) => ({ ...x })) }, day)).toBe(false);
    const c = base.clients[0]!;
    expect(
      proposalDayFresh(
        {
          ...base,
          clientLeaves: [...base.clientLeaves, { id: 'l1', clientId: c.id, from: days[1]!, to: days[1]!, note: '' }],
        },
        day,
      ),
    ).toBe(false);
    // ほかの日の欠勤では古くしない
    expect(
      proposalDayFresh(
        {
          ...base,
          absences: [
            ...base.absences,
            { id: 'ab-y', staffId: sid, date: addDays(TODAY, 9), from: null, to: null, note: '' },
          ],
        },
        day,
      ),
    ).toBe(true);
  });

  it('組む前に確定した日は飛ばす', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const d = unassigned();
    const h = hostOf({ ...d, snapshots: { [days[1]!]: { date: days[1]!, at: 1, visits: [] } } });
    b.connect(h.host);
    b.start(job);
    await finishAll(s.calls);
    expect(s.calls).toHaveLength(1);
    expect(b.proposal.get()!.days.map((x) => x.date)).toEqual([days[0]]);
  });

  it('文', () => {
    const run = {
      ym: '2026-11',
      label: '11月',
      mode: 'care' as const,
      targets: Array.from({ length: 22 }, (_, i) => addDays('2026-11-01', i)),
      index: 7,
      made: 7,
      iteration: 0,
      total: 1,
      source: 'month' as const,
      weekStart: null,
    };
    expect(batchBandText(run)).toBe('11月の担当を組んでいます 8/22日');
    const done: BatchDone = {
      ym: '2026-11',
      label: '11月',
      source: 'month',
      weekStart: null,
      made: 22,
      unassignedDays: 0,
      stopped: false,
      error: null,
      aborted: false,
      proposal: { moved: 30, shifted: 4 },
    };
    expect(batchDoneText(done)).toBe(
      '11月の提案を出しました（22日分・担当が変わる 30件・時刻が変わる 4件）。見て「当てる」と担当が変わります',
    );
    expect(batchDoneText({ ...done, made: 8, stopped: true })).toBe(
      '11月の担当を8日分組んだところで止めました（8日分の提案・担当が変わる 30件・時刻が変わる 4件）',
    );
    expect(batchDoneText({ ...done, made: 0, proposal: null })).toBe('11月に組める日がありませんでした');
    expect(batchDoneText({ ...done, made: 1, aborted: true })).toBe(
      'データを差し替えたので、11月の担当を組むのを止めました（提案は捨てました）',
    );
    expect(dayLabel('2026-11-03')).toBe('11/3');
    expect(monthsLabel(['2026-10-30', '2026-11-02'])).toBe('10・11月');
    expect(monthsLabel(['2026-11-02'])).toBe('11月');
  });

  it('担当の足りない日（空き状況。PRD D259）：範囲の今日以降で担当なしの訪問がある日。確定した日・今日より前は入れない', () => {
    const d = unassigned();
    const range = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i - 2));
    const withVisits = range.filter((x) => x >= TODAY && visitsOn(d, x).some((v) => !v.cancelled));
    const all = missingDays(d, range, TODAY);
    expect(all.map((x) => x.date)).toEqual(withVisits);
    expect(all.every((x) => x.mode === 'care')).toBe(true);
    const first = all[0]!.date;
    const told = { ...d, snapshots: { [first]: { date: first, at: 1, visits: [] } } };
    expect(missingDays(told, range, TODAY).map((x) => x.date)).not.toContain(first);
    // 繰り返しの担当で全部埋まっていれば足りない日は無い
    expect(missingDays(createDemoData(TODAY), [TODAY], TODAY).length).toBeLessThanOrEqual(1);
  });

  it('データを丸ごと差し替えたら捨てる（abort）：組んでいる日の結果は書かず、止めた知らせ', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const h = hostOf(unassigned());
    b.connect(h.host);
    b.start(job);
    s.calls[0]!.resolve();
    await tick();
    b.abort();
    expect(b.run.get()).toBeNull();
    const done = b.done.get()!;
    expect(done).toMatchObject({ made: 1, aborted: true, stopped: true });
    expect(b.proposal.get()).toBeNull();
    await finishAll(s.calls, 1);
    expect(h.writes()).toBe(0);
    expect(b.running()).toBe(false);
    b.abort();
    expect(b.done.get()).toBe(done);
  });
});

describe('週の範囲で組む（PRD D280。ADR-0046）', () => {
  const today = '2026-10-28';
  const across = Array.from({ length: 7 }, (_, i) => addDays('2026-10-27', i));

  it('組む日：月をまたぐ週は2つの月から。今日より前・確定した日は入れない', () => {
    const d = createDemoData(today);
    const t = weekBatchDays(d, across, today).map((x) => x.date);
    expect(t.some((x) => x.startsWith('2026-10'))).toBe(true);
    expect(t.some((x) => x.startsWith('2026-11'))).toBe(true);
    expect(t.every((x) => x >= today && x <= across[6]!)).toBe(true);
    const first = t[0]!;
    const told = { ...d, snapshots: { [first]: { date: first, at: 1, visits: [] } } };
    expect(weekBatchDays(told, across, today).map((x) => x.date)).not.toContain(first);
    expect(weekLabel('2026-11-01')).toBe('11/1〜11/7の週');
    expect(canMakeDay(d, today)).toBe(true);
  });

  it('知らせと行き先は週', async () => {
    const d = unassigned();
    const targets = weekBatchDays(d, across, today).slice(0, 2);
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const h = hostOf(d);
    b.connect(h.host);
    b.start({
      ym: '2026-10',
      label: weekLabel(across[0]!),
      mode: 'all',
      days: targets,
      today,
      source: 'week',
      weekStart: across[0]!,
    });
    expect(b.run.get()).toMatchObject({ source: 'week', weekStart: across[0], label: '10/27〜11/2の週' });
    await finishAll(s.calls);
    expect(b.done.get()).toMatchObject({ source: 'week', weekStart: across[0], made: targets.length });
    expect(batchHref({ ym: '2026-10', source: 'week', weekStart: across[0]! })).toBe(`/week?d=${across[0]}`);
    expect(batchHref({ ym: '2026-11', source: 'month', weekStart: null })).toBe('/month?ym=2026-11');
    expect(batchHref({ ym: '2026-10', source: 'day', weekStart: across[0]! })).toBe(`/week?d=${across[0]}`);
  });
});
