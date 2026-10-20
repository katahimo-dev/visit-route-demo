import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Problem, SolveResult } from '../contracts/problem';
import { addDays } from '../domain/time';
import { compile, withManualPrefs } from '../matching';
import { createDemoData, scoreRulesOf } from '../seed';
import { solve } from '../solver';
import { own } from './common';
import { patchManualPrefs } from './manualPrefs';
import { type BatchDone, batchBandText, batchDoneText, createMonthBatch, missingDays, monthsLabel } from './monthBatch';

const TODAY = '2026-10-21';

/** 案の無いデモのデータ（今日から7日分の案を消す） */
function noPlans(): DemoData {
  const d = createDemoData(TODAY);
  return { ...d, aiPlans: {}, aiRuns: {} };
}

/** Worker なしで解く（手で終わらせる。止めると最良の案で終わる） */
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

describe('monthBatch（PRD D256・D257。ADR-0042）', () => {
  const days = [TODAY, addDays(TODAY, 1)];
  const job = {
    ym: '2026-10',
    label: '10月',
    mode: 'empty' as const,
    days: days.map((date) => ({ date, mode: 'empty' as const })),
    expandYm: null,
    today: TODAY,
  };

  it('つながっていなければ始めない', () => {
    const b = createMonthBatch(fakeSolve().fn);
    expect(b.start(job)).toBe(false);
    expect(b.run.get()).toBeNull();
  });

  it('日ごとに update で書き、終わったら知らせる。作っている間は二重に始めない', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const h = hostOf(noPlans());
    b.connect(h.host);
    expect(b.start(job)).toBe(true);
    expect(b.running()).toBe(true);
    expect(b.start(job)).toBe(false);
    expect(b.run.get()).toMatchObject({ ym: '2026-10', label: '10月', targets: days, index: 0, made: 0 });
    s.calls[0]!.resolve();
    await tick();
    // 1日目を書いた（2日目はまだ）
    expect(own(h.data().aiPlans, days[0]!)).toBeTruthy();
    expect(own(h.data().aiPlans, days[1]!)).toBeUndefined();
    expect(b.run.get()).toMatchObject({ index: 1, made: 1 });
    expect(h.writes()).toBe(1);
    await finishAll(s.calls, 1);
    expect(b.run.get()).toBeNull();
    expect(h.writes()).toBe(2);
    expect(b.done.get()).toMatchObject({ ym: '2026-10', made: 2, stopped: false, error: null });
    expect(own(h.data().aiPlans, days[1]!)).toBeTruthy();
    // 終わったらまた始められる
    expect(b.running()).toBe(false);
  });

  it('止める：作っている日は最良の案で残し、残りの日はやめる', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const h = hostOf(noPlans());
    b.connect(h.host);
    b.start(job);
    b.stop();
    await tick();
    await tick();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.stopped).toBe(true);
    expect(b.run.get()).toBeNull();
    expect(b.done.get()).toMatchObject({ made: 1, stopped: true });
    expect(own(h.data().aiPlans, days[1]!)).toBeUndefined();
  });

  it('外す（ページを閉じる・App を外す）と計算を捨て、結果を書かない', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const h = hostOf(noPlans());
    const off = b.connect(h.host);
    b.start(job);
    off();
    expect(b.run.get()).toBeNull();
    await tick();
    expect(h.writes()).toBe(0);
    expect(b.done.get()).toBeNull();
  });

  it('まだ案の無い日だけ：作っている間に案ができた日は飛ばす', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const base = noPlans();
    const h = hostOf(base);
    b.connect(h.host);
    b.start(job);
    // 2日目に別の画面で案ができた（中身は何でもよい）
    const other = { ...({} as DemoData['aiPlans'][string]), date: days[1]! };
    h.host.update((d) => ({ ...d, aiPlans: { ...d.aiPlans, [days[1]!]: other } }));
    s.calls[0]!.resolve();
    await tick();
    await tick();
    expect(s.calls).toHaveLength(1);
    expect(b.done.get()).toMatchObject({ made: 1 });
    expect(h.data().aiPlans[days[1]!]).toBe(other);
  });

  it('文', () => {
    const run = {
      ym: '2026-11',
      label: '11月',
      mode: 'empty' as const,
      targets: Array.from({ length: 22 }, (_, i) => addDays('2026-11-01', i)),
      index: 7,
      made: 7,
      iteration: 0,
      total: 1,
    };
    expect(batchBandText(run)).toBe('11月の案を作っています 8/22日');
    const done: BatchDone = { ym: '2026-11', label: '11月', made: 22, unassignedDays: 0, stopped: false, error: null };
    expect(batchDoneText(done)).toBe('11月の案を22日分作りました');
    expect(batchDoneText({ ...done, unassignedDays: 2 })).toBe(
      '11月の案を22日分作りました（入らない訪問がある日 2日）',
    );
    expect(batchDoneText({ ...done, made: 8, stopped: true })).toBe('11月の案を8日分作ったところで止めました');
    expect(monthsLabel(['2026-10-30', '2026-11-02'])).toBe('10・11月');
    expect(monthsLabel(['2026-11-02'])).toBe('11月');
  });

  it('足りない案の日（空き状況。PRD D259）：範囲の今日以降で案の無い日、確定した日・今日より前は入れない', () => {
    const d = noPlans();
    const range = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i - 2));
    const withVisits = new Set(d.visits.filter((v) => !v.cancelled).map((v) => v.date));
    const all = missingDays(d, range, TODAY);
    expect(all.every((x) => x.mode === 'empty' && x.date >= TODAY && withVisits.has(x.date))).toBe(true);
    expect(all.map((x) => x.date)).toEqual(range.filter((x) => x >= TODAY && withVisits.has(x)));
    // 確定した日は入れない
    const first = all[0]!.date;
    const confirmed = { ...d, manualPlans: { ...d.manualPlans, [first]: {} as DemoData['manualPlans'][string] } };
    expect(missingDays(confirmed, range, TODAY).map((x) => x.date)).not.toContain(first);
  });

  it('手直しの記憶（ADR-0043）を当てて作り、記録に prefPins を書く', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const d0 = noPlans();
    const v = d0.visits.find((x) => x.date === TODAY && !x.cancelled)!;
    // その訪問をいま担当できる人のうち、最後の人を記憶にする
    const base = compile({ ...d0, rules: scoreRulesOf(d0) }, TODAY);
    const vi = base.visits.findIndex((x) => x.id === v.id);
    const who = base.staff.filter((_, k) => base.allowed[vi]![k]).at(-1)!.id;
    const d = patchManualPrefs(d0, { set: { [v.id]: who } }, 1);
    const expected = withManualPrefs(compile({ ...d, rules: scoreRulesOf(d) }, TODAY), d).applied;
    expect(expected[v.id]).toBe(who);
    const h = hostOf(d);
    b.connect(h.host);
    b.start({ ...job, days: [{ date: TODAY, mode: 'empty' }] });
    s.calls[0]!.resolve();
    await tick();
    const runs = own(h.data().aiRuns, TODAY)!;
    expect(runs.at(-1)!.prefPins).toEqual(expected);
    const route = Object.entries(own(h.data().aiPlans, TODAY)!.routes).find(([, ids]) => ids.includes(v.id));
    expect(route?.[0]).toBe(who);
  });
});
