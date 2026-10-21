// 月まとめ作成の計算を画面の外で回す（PRD D256・D257。ADR-0042。design.md §4 pages「月単位の予定」）。
// 画面（月の予定・空き状況）は始める・止めるだけを頼み、計算はモジュールの入れ物で続ける（ほかの画面へ移っても止めない）。
// データの書き込みは App が渡す store の update(fn)（日ごと）。ページを閉じる・読み直すと止まる（再開はしない）
import type { DemoData } from '../contracts/data';
import type { Problem, SolveOptions, SolveResult } from '../contracts/problem';
import type { Rule } from '../contracts/rules';
import { addDays } from '../domain/time';
import { compile, withManualPrefs } from '../matching';
import { scoreRulesOf } from '../seed';
import { defaultIterations, runSolve } from '../solver';
import { attempt, own } from './common';
import { applyDayRun, type BatchMode, batchTargets, expandRange, planEdited, planStale, ymOf } from './month';
import { planOfRun, problemKey, reusableRun } from './runs';
import { createValueStore, type ReadableStore } from './valueStore';

/** 作る日（日ごとの作り方。empty＝まだ案の無い日だけとして作る：作っている間に案ができた日は飛ばし、今の案は変えない） */
export type BatchDay = { date: string; mode: BatchMode };

/** 始めた画面（月の予定・空き状況・週の予定） */
export type BatchSource = 'month' | 'vacancy' | 'week';

/** 定期パターンから訪問を作る範囲（両端を含む。今日より前は作らない） */
export type ExpandRange = { from: string; to: string };

/** 始めるときに渡すもの */
export type BatchJob = {
  /** 「月の予定を見る」で開く月（YYYY-MM） */
  ym: string;
  /** 上の帯・知らせの月の名前（「11月」。2か月にまたがれば「10・11月」） */
  label: string;
  /** 欄で選んだ作り方（月の予定の進み具合の表示用） */
  mode: BatchMode;
  days: readonly BatchDay[];
  /** 始めた画面（月の予定・空き状況・週の予定。ほかの画面のボタンの文・知らせの行き先を分ける） */
  source: BatchSource;
  /** 週の予定から始めたときの週の始まり（日曜。知らせ・上の帯の行き先 `/week?d=`。ほかは null） */
  weekStart?: string | null;
  /** 先に定期パターンから訪問を作る範囲（月の予定はその月、週の予定はその週。expandRange。作らなければ null） */
  expand: ExpandRange | null;
  today: string;
};

/** 作っている間の進み具合（作っていなければ null） */
export type BatchRun = {
  ym: string;
  label: string;
  mode: BatchMode;
  source: BatchSource;
  /** 週の予定から始めたときの週の始まり（ほかは null） */
  weekStart: string | null;
  /** 作る日の日付（順に） */
  targets: string[];
  /** いま作っている日の番号（0から） */
  index: number;
  /** 作れた日数 */
  made: number;
  iteration: number;
  total: number;
};

/** 終わったときの知らせ（終わるたびに新しい物。画面はこれを見てトーストを出す） */
export type BatchDone = {
  ym: string;
  label: string;
  source: BatchSource;
  /** 週の予定から始めたときの週の始まり（ほかは null） */
  weekStart: string | null;
  made: number;
  /** 入らない訪問がある日の数 */
  unassignedDays: number;
  /** ［止める］で止めた */
  stopped: boolean;
  /** 計算できずに止まった理由（無ければ null） */
  error: string | null;
  /** データを丸ごと差し替えたので止めた（abort。古いデータから作った結果は書かない） */
  aborted: boolean;
};

/** データの持ち主（App が store の data と update をつなぐ） */
export type BatchHost = { get(): DemoData; update(fn: (d: DemoData) => DemoData): void };

type Solve = (
  problem: Problem,
  options: SolveOptions,
  onProgress?: (p: { iteration: number; total: number }) => void,
) => { promise: Promise<SolveResult>; stop(): void };

export type MonthBatch = {
  /** 進み具合（作っていなければ null） */
  run: ReadableStore<BatchRun | null>;
  /** 最後に終わった知らせ */
  done: ReadableStore<BatchDone | null>;
  /** 始める。作っている間・つながっていない・作る日が無いときは始めず false（二重に始めない） */
  start(job: BatchJob): boolean;
  /** 止める（作っている日はそれまでの最良の案で残し、残りの日はやめる） */
  stop(): void;
  /**
   * すぐ捨てる（データを丸ごと差し替えたとき。作っている日の結果は書かない）。作っていれば止めた知らせ（aborted）を出す
   */
  abort(): void;
  /** 作っているか */
  running(): boolean;
  /** データの持ち主をつなぐ。外すと（ページを閉じる・App を外す）作っている計算を捨てる */
  connect(host: BatchHost): () => void;
};

/** 終わった知らせの文（「11月の案を22日分作りました」） */
export function batchDoneText(d: BatchDone): string {
  if (d.aborted) return `データを差し替えたので、${d.label}の案づくりを止めました（${d.made}日分は作りました）`;
  if (d.error) return `${d.label}の案を${d.made}日分作ったところで止まりました（${d.error}）`;
  if (d.stopped) return `${d.label}の案を${d.made}日分作ったところで止めました`;
  return `${d.label}の案を${d.made}日分作りました${d.unassignedDays > 0 ? `（入らない訪問がある日 ${d.unassignedDays}日）` : ''}`;
}

/** 上の帯の文（「11月の案を作っています 8/22日」） */
export function batchBandText(r: BatchRun): string {
  return `${r.label}の案を作っています ${Math.min(r.index + 1, r.targets.length)}/${r.targets.length}日`;
}

/** 日付の月の名前（「11月」「10・11月」） */
export function monthsLabel(dates: readonly string[]): string {
  const months = [...new Set(dates.map((d) => Number(d.slice(5, 7))))];
  return `${months.join('・')}月`;
}

/**
 * 足りない案の日（空き状況の［足りない案を作る］。PRD D259）：dates のうち今日以降で、まだ案の無い日（empty）と
 * 条件が変わった日（stale。月の予定の「条件が変わった日を作り直す」と同じ決め方）。確定した日・訪問の無い日は入れない。
 * 手直しのある条件が変わった日は入れない（手直しを捨てるかは月の予定で選ぶ）
 */
export function missingDays(data: DemoData, dates: readonly string[], today: string): BatchDay[] {
  const inRange = new Set(dates.filter((d) => d >= today));
  const out: BatchDay[] = [];
  for (const ym of new Set([...inRange].map(ymOf))) {
    for (const date of batchTargets(data, ym, today, 'empty')) if (inRange.has(date)) out.push({ date, mode: 'empty' });
    const stale = batchTargets(data, ym, today, 'stale', (d) => inRange.has(d) && planStale(data, data, d));
    for (const date of stale) {
      const p = own(data.aiPlans, date);
      if (p && !planEdited(p)) out.push({ date, mode: 'stale' });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 週の予定の「この週の案を作る」で作る日（PRD D280）：dates（週の7日）のうち今日以降で、訪問があって（data は定期パターンから
 * 展開したあとのもの）まだ案も確定した割当も無い日。月の予定の「まだ案の無い日だけ」（batchTargets の empty）を週に絞ったもの
 */
export function weekBatchDays(
  data: Parameters<typeof batchTargets>[0],
  dates: readonly string[],
  today: string,
): BatchDay[] {
  const inRange = new Set(dates.filter((d) => d >= today));
  const out: BatchDay[] = [];
  for (const ym of new Set([...inRange].map(ymOf)))
    for (const date of batchTargets(data, ym, today, 'empty')) if (inRange.has(date)) out.push({ date, mode: 'empty' });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 週の呼び名（「11/2〜11/8の週」。上の帯・知らせの文の月の名前の代わり） */
export function weekLabel(start: string): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return `${md(start)}〜${md(addDays(start, 6))}の週`;
}

/** 進み具合の帯の文・知らせのボタンの行き先（週の予定から始めたならその週、ほかは月の予定のその月） */
export function batchHref(x: Pick<BatchRun, 'ym' | 'source' | 'weekStart'>): string {
  return x.source === 'week' && x.weekStart ? `/week?d=${x.weekStart}` : `/month?ym=${x.ym}`;
}

/** 入れ物を作る（solve は差し替えられる。テストは Worker なしで解く） */
export function createMonthBatch(solve: Solve = runSolve): MonthBatch {
  const run = createValueStore<BatchRun | null>(null);
  const done = createValueStore<BatchDone | null>(null);
  let host: BatchHost | null = null;
  /** 計算の世代。つなぎ直す（外す）と進め、前の世代の結果は捨てる */
  let generation = 0;
  let current: { stop(): void } | null = null;
  let stopped = false;

  /** 作っている計算を捨てる（結果は書かない） */
  const drop = () => {
    generation++;
    current?.stop();
    current = null;
    run.set(null);
  };

  const start = (job: BatchJob): boolean => {
    if (run.get() !== null || host === null || job.days.length === 0) return false;
    const h = host;
    const gen = ++generation;
    const live = () => gen === generation;
    const targets = job.days.map((x) => x.date);
    const ex = job.expand;
    const weekStart = job.weekStart ?? null;
    const today = job.today;
    stopped = false;
    let made = 0;
    let unassignedDays = 0;
    if (ex) h.update((d) => expandRange(d, ex.from, ex.to, today).data);
    run.set({
      ym: job.ym,
      label: job.label,
      mode: job.mode,
      source: job.source,
      weekStart,
      targets,
      index: 0,
      made: 0,
      iteration: 0,
      total: 1,
    });
    const patch = (p: Partial<BatchRun>) => run.set((b) => (b ? { ...b, ...p } : b));

    const finish = (why?: string) => {
      current = null;
      run.set(null);
      done.set({
        ym: job.ym,
        label: job.label,
        source: job.source,
        weekStart,
        made,
        unassignedDays,
        stopped,
        error: why ?? null,
        aborted: false,
      });
    };

    // ---- 1日ずつ作る（計算の中身は月の予定の画面から写したまま。どの規則で作るかは変えない）----
    const step = (i: number) => {
      if (!live()) return;
      if (i >= job.days.length || stopped) {
        finish();
        return;
      }
      const { date: day, mode: m } = job.days[i]!;
      // いちばん新しいデータで（作っている間の編集も入れる）。展開は同じ結果になるので、まだ描画されていなくても同じ訪問になる
      const latest = ex ? expandRange(h.get(), ex.from, ex.to, today).data : h.get();
      patch({ index: i, iteration: 0, total: 1 });
      // 作っている間に確定した・（まだ案の無い日だけで）案ができた日は飛ばす
      if (own(latest.manualPlans, day) || (m === 'empty' && own(latest.aiPlans, day))) {
        step(i + 1);
        return;
      }
      // 作り始めたときのその日の今の案。書く直前に変わっていれば（作っている間に日の予定で手直し・作り直し）、記録だけ足して今の案は変えない
      const before = own(latest.aiPlans, day);
      /** その日の今の案を変えないか（まだ案の無い日だけ・作っている間に今の案が変わった・確定した） */
      const keep = (d: DemoData) =>
        (m === 'empty' && !!own(d.aiPlans, day)) || own(d.aiPlans, day) !== before || !!own(d.manualPlans, day);
      // 点数の基準（条件の重みの画面の重み。ADR-0035）で作る
      const rules = scoreRulesOf(latest);
      const base = attempt(() => compile({ ...latest, rules }, day)).value;
      if (!base || base.visits.length === 0 || base.staff.length === 0) {
        step(i + 1);
        return;
      }
      // 手直しの記憶（ADR-0043）を当てて解く（当てたものは記録の prefPins）
      const { problem: p, applied: prefPins } = withManualPrefs(base, latest);
      const key = problemKey(p);
      // 同じ条件・いまのデータで作った記録があれば計算しない（lib/runs の reusableRun）
      const saved = attempt(() => reusableRun(own(latest.aiRuns, day) ?? [], p, rules, latest.seed, key)).value;
      if (saved) {
        h.update((d) => (keep(d) ? d : { ...d, aiPlans: { ...d.aiPlans, [day]: planOfRun(saved) } }));
        made++;
        if (saved.unassigned.length > 0) unassignedDays++;
        patch({ made });
        // 描画を挟んでから次へ
        setTimeout(() => step(i + 1), 0);
        return;
      }
      solveDay(p, latest, rules, key, day, keep, i, prefPins);
    };

    const solveDay = (
      p: Problem,
      latest: DemoData,
      rules: Rule[],
      key: string,
      day: string,
      keep: (d: DemoData) => boolean,
      i: number,
      prefPins: Record<string, string>,
    ) => {
      const started = attempt(() =>
        solve(p, { seed: latest.seed, iterations: defaultIterations(p) }, (x) => {
          if (!live()) return;
          patch({ iteration: x.iteration, total: x.total });
        }),
      );
      if (!started.value) {
        finish(started.error ?? 'AI案を作れませんでした');
        return;
      }
      current = started.value;
      started.value.promise
        .then((result) => {
          if (!live()) return;
          h.update((d) =>
            applyDayRun(d, day, {
              rules,
              result,
              createdAt: Date.now(),
              inputKey: key,
              // 今の案を変えないとき（applyDayRun の onlyEmpty と同じ扱い：記録だけ足す）
              onlyEmpty: keep(d),
              prefPins,
            }),
          );
          made++;
          if (result.unassigned.length > 0) unassignedDays++;
          patch({ made });
          current = null;
          step(i + 1);
        })
        .catch((e) => {
          if (!live()) return;
          finish(e instanceof Error ? e.message : 'AI案を作れませんでした');
        });
    };

    step(0);
    return true;
  };

  return {
    run,
    done,
    start,
    stop: () => {
      if (run.get() === null) return;
      stopped = true;
      current?.stop();
    },
    running: () => run.get() !== null,
    abort: () => {
      const r = run.get();
      if (r === null) return;
      drop();
      done.set({
        ym: r.ym,
        label: r.label,
        source: r.source,
        weekStart: r.weekStart,
        made: r.made,
        unassignedDays: 0,
        stopped: true,
        error: null,
        aborted: true,
      });
    },
    connect: (h) => {
      host = h;
      return () => {
        if (host !== h) return;
        host = null;
        drop();
      };
    },
  };
}

/** アプリで1つの入れ物 */
export const monthBatch: MonthBatch = createMonthBatch();
