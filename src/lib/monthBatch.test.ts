import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Problem, SolveResult } from '../contracts/problem';
import { addDays } from '../domain/time';
import { compile, withManualPrefs } from '../matching';
import { createDemoData, scoreRulesOf } from '../seed';
import { solve } from '../solver';
import { own } from './common';
import { patchManualPrefs } from './manualPrefs';
import { applyDayRun, expandRange } from './month';
import {
  type BatchDone,
  batchBandText,
  batchDoneText,
  batchHref,
  createMonthBatch,
  missingDays,
  monthsLabel,
  weekBatchDays,
  weekLabel,
} from './monthBatch';
import { problemKey } from './runs';

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
    expand: null,
    today: TODAY,
    source: 'month' as const,
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
      source: 'month' as const,
      weekStart: null,
    };
    expect(batchBandText(run)).toBe('11月の案を作っています 8/22日');
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
    };
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

  it('データを丸ごと差し替えたら捨てる（abort）：作っている日の結果は書かず、止めた知らせ', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const h = hostOf(noPlans());
    b.connect(h.host);
    b.start(job);
    s.calls[0]!.resolve();
    await tick();
    expect(h.writes()).toBe(1);
    b.abort();
    expect(b.run.get()).toBeNull();
    const done = b.done.get()!;
    expect(done).toMatchObject({ made: 1, aborted: true, stopped: true });
    expect(batchDoneText(done)).toBe('データを差し替えたので、10月の案づくりを止めました（1日分は作りました）');
    await finishAll(s.calls, 1);
    expect(h.writes()).toBe(1);
    expect(b.running()).toBe(false);
    // 作っていなければ何もしない
    b.abort();
    expect(b.done.get()).toBe(done);
  });

  it('作り直しの間にその日の今の案が変わったら（日の予定の手直し）、記録だけ足して今の案は変えない', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    // 記録は消す（使い回さずに解く）
    const d0 = { ...made(noPlans(), TODAY), aiRuns: {} };
    const h = hostOf(d0);
    b.connect(h.host);
    b.start({ ...job, mode: 'all', days: [{ date: TODAY, mode: 'all' }] });
    const edited = { ...own(h.data().aiPlans, TODAY)!, pins: { x: 'y' } };
    h.host.update((d) => ({ ...d, aiPlans: { ...d.aiPlans, [TODAY]: edited } }));
    s.calls[0]!.resolve();
    await tick();
    expect(own(h.data().aiPlans, TODAY)).toBe(edited);
    expect(own(h.data().aiRuns, TODAY)).toHaveLength(1);
    expect(b.done.get()).toMatchObject({ made: 1 });
  });

  it('作り直しの間に変わらなければ今の案を書き換える', async () => {
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const d0 = { ...made(noPlans(), TODAY), aiRuns: {} };
    const before = own(d0.aiPlans, TODAY);
    const h = hostOf(d0);
    b.connect(h.host);
    b.start({ ...job, mode: 'all', days: [{ date: TODAY, mode: 'all' }] });
    // 使い回せる記録があれば計算しないので、Worker を呼ぶかどうかに依らず終わるまで進める
    await finishAll(s.calls);
    await tick();
    expect(b.running()).toBe(false);
    expect(own(h.data().aiPlans, TODAY)).not.toBe(before);
  });

  it('足りない案の日：条件が変わった日は stale、手直しのある条件が変わった日は入れない', () => {
    const d0 = made(noPlans(), TODAY);
    const v = d0.visits.find((x) => x.date === TODAY && !x.cancelled)!;
    // 案を作ったあとに訪問の所要を変える＝条件が変わった
    const changed = {
      ...d0,
      visits: d0.visits.map((x) => (x.id === v.id ? { ...x, durationMinutes: x.durationMinutes + 30 } : x)),
    };
    const range = [TODAY];
    expect(missingDays(changed, range, TODAY)).toEqual([{ date: TODAY, mode: 'stale' }]);
    const plan = own(changed.aiPlans, TODAY)!;
    const edited = { ...changed, aiPlans: { ...changed.aiPlans, [TODAY]: { ...plan, pins: { [v.id]: 'someone' } } } };
    expect(missingDays(edited, range, TODAY)).toEqual([]);
  });
});

/** その日の案を基準の重みで作って書いたデータ */
function made(d: DemoData, date: string): DemoData {
  const rules = scoreRulesOf(d);
  const p = compile({ ...d, rules }, date);
  const result = solve(p, { seed: 1, iterations: 2000 });
  return applyDayRun(d, date, { rules, result, createdAt: 1, inputKey: problemKey(p), onlyEmpty: false });
}

describe('週の範囲で作る（PRD D280。ADR-0046）', () => {
  const today = '2026-10-28';
  /** 月をまたぐ週（10/27〜11/2。日曜はじまりでなくても範囲として扱える） */
  const across = Array.from({ length: 7 }, (_, i) => addDays('2026-10-27', i));

  it('作る日：月をまたぐ週は2つの月から。今日より前・案のある日・確定した日は入れない', () => {
    const d = { ...createDemoData(today), aiPlans: {}, aiRuns: {} };
    const ex = expandRange(d, across[0]!, across[6]!, today).data;
    const t = weekBatchDays(ex, across, today).map((x) => x.date);
    expect(t.some((x) => x.startsWith('2026-10'))).toBe(true);
    expect(t.some((x) => x.startsWith('2026-11'))).toBe(true);
    expect(t.every((x) => x >= today && x <= across[6]!)).toBe(true);
    const first = t[0]!;
    const confirmed = { ...ex, manualPlans: { ...ex.manualPlans, [first]: {} } };
    expect(weekBatchDays(confirmed, across, today).map((x) => x.date)).not.toContain(first);
    expect(weekLabel('2026-11-01')).toBe('11/1〜11/7の週');
  });

  it('先に週の範囲だけ訪問を作り（週の外は作らない）、週の案の無い日を作る。知らせと行き先は週', async () => {
    const base = { ...createDemoData(today), aiPlans: {}, aiRuns: {} };
    // 週の後半（10/30 以降）と週の外の訪問を消して「未作成」にする
    const cut = { ...base, visits: base.visits.filter((v) => v.date < '2026-10-30') };
    const ex = expandRange(cut, across[0]!, across[6]!, today);
    expect(ex.added).toBeGreaterThan(0);
    const targets = weekBatchDays(ex.data, across, today);
    const s = fakeSolve();
    const b = createMonthBatch(s.fn);
    const h = hostOf(cut);
    b.connect(h.host);
    const ok = b.start({
      ym: '2026-10',
      label: weekLabel(across[0]!),
      mode: 'empty',
      days: targets,
      expand: { from: across[0]!, to: across[6]! },
      today,
      source: 'week',
      weekStart: across[0]!,
    });
    expect(ok).toBe(true);
    expect(h.data().visits.some((v) => v.date >= '2026-10-30' && v.date <= across[6]!)).toBe(true);
    expect(h.data().visits.some((v) => v.date > across[6]!)).toBe(false);
    expect(b.run.get()).toMatchObject({ source: 'week', weekStart: across[0], label: '10/27〜11/2の週' });
    await finishAll(s.calls);
    expect(b.done.get()).toMatchObject({ source: 'week', weekStart: across[0], made: targets.length });
    for (const t of targets) expect(own(h.data().aiPlans, t.date)).toBeTruthy();
    expect(batchHref({ ym: '2026-10', source: 'week', weekStart: across[0]! })).toBe(`/week?d=${across[0]}`);
    expect(batchHref({ ym: '2026-11', source: 'month', weekStart: null })).toBe('/month?ym=2026-11');
  });
});
