// 「AI で組む」の日・週・月の範囲（PRD D256・D257・D328。ADR-0042・ADR-0053・ADR-0054）の計算を画面の外で回す。
// 画面は始める・止めるだけを頼み、計算はモジュールの入れ物で続ける（ほかの画面へ移っても止めない）。
// 1日ずつ AI で組み、終わったら提案（日ごとの担当・時刻の変更）を出す。訪問には書かない。「当てる」（apply）で、
// 組み始めたときのままの日だけ担当・開始を1回の update で訪問に書く（ピンの訪問は動かさない。全体の「元に戻す」で1手戻せる）。
// 提案はその場だけ（保存しない）。ページを閉じる・読み直すと止まる（再開はしない）
import type { DemoData } from '../contracts/data';
import type { Visit } from '../contracts/documents';
import type { Problem, SolveOptions, SolveResult } from '../contracts/problem';
import type { ReassignDiff } from '../contracts/reassign';
import { addDays } from '../domain/time';
import type { CompileInput } from '../matching';
import { visitsOn } from '../patterns';
import { reassignDiff } from '../reassign';
import { defaultIterations, runSolve } from '../solver';
import { own } from './common';
import { activeDayVisits, dayProblemOf, pinsOf, routesOf, unassignedOf, writeRoutes } from './dayPlan';
import type { BatchMode } from './month';
import { createValueStore, type ReadableStore } from './valueStore';

/** 組む日（日ごとの選び方：care＝要対応のある日、all＝伝えていない日すべて） */
export type BatchDay = { date: string; mode: BatchMode };

/** 範囲（月・週・日）か始めた画面（空き状況）。知らせ・帯の行き先と文を分ける */
export type BatchSource = 'month' | 'vacancy' | 'week' | 'day';

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
  /** 週の予定から始めたときの週の始まり（月曜。知らせ・上の帯の行き先 `/week?d=`。ほかは null） */
  weekStart?: string | null;
  today: string;
};

/** 提案の1日（組み始めたときの訪問と、組んだ担当の並び・今との差） */
export type ProposalDay = {
  date: string;
  problem: Problem;
  /** 組み始めたときのその日の訪問（今と違えば当てない） */
  visits: readonly Visit[];
  /** 提案の担当の並び */
  routes: Record<string, string[]>;
  /** 組み始めたときの担当 → 提案の差（担当が変わる・時刻が変わる） */
  diff: ReassignDiff | null;
  /** 提案でも担当なしの訪問の数 */
  unassigned: number;
};

/** 日・週・月の範囲の提案（その場だけ。保存しない） */
export type BatchProposal = {
  /** 出すたびに新しい番号（画面がフォーカス・知らせを出し分ける） */
  id: number;
  ym: string;
  label: string;
  source: BatchSource;
  weekStart: string | null;
  days: ProposalDay[];
  /** ［止める］で途中まで */
  stopped: boolean;
};

/** 提案の数（担当が変わる・時刻が変わる訪問の合計と、変わる日・担当なしの残る日） */
export function proposalCounts(p: Pick<BatchProposal, 'days'>): {
  days: number;
  moved: number;
  shifted: number;
  changedDays: number;
  unassignedDays: number;
} {
  let moved = 0;
  let shifted = 0;
  let changedDays = 0;
  let unassignedDays = 0;
  for (const d of p.days) {
    const m = d.diff?.moved.length ?? 0;
    const s = d.diff?.shifted.length ?? 0;
    moved += m;
    shifted += s;
    if (m + s > 0) changedDays++;
    if (d.unassigned > 0) unassignedDays++;
  }
  return { days: p.days.length, moved, shifted, changedDays, unassignedDays };
}

/** その日を当ててよいか（組み始めたときの訪問のまま・伝えていない） */
export function proposalDayFresh(d: DemoData, day: ProposalDay): boolean {
  const now = visitsOn(d, day.date);
  return now.length === day.visits.length && now.every((v, k) => v === day.visits[k]) && !own(d.snapshots, day.date);
}

/** 提案を当てる（純粋関数）：組み始めたときのままの日だけ訪問に書く。当てた日・当てなかった日 */
export function applyProposal(
  d: DemoData,
  p: Pick<BatchProposal, 'days'>,
): { data: DemoData; applied: string[]; skipped: string[] } {
  let out = d;
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const day of p.days) {
    if (!proposalDayFresh(d, day)) {
      skipped.push(day.date);
      continue;
    }
    out = writeRoutes(out, day.date, day.problem, day.routes);
    applied.push(day.date);
  }
  return { data: out, applied, skipped };
}

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
  /** データを丸ごと差し替えたので止めた（abort。古いデータから作った結果は捨てる） */
  aborted: boolean;
  /** 出した提案（変わる訪問の数。提案が無ければ null） */
  proposal: { moved: number; shifted: number } | null;
};

/** データの持ち主（App が store の data と update をつなぐ） */
export type BatchHost = { get(): DemoData; update(fn: (d: DemoData) => DemoData, label?: string): void };

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
  /** 今の提案（無ければ null。当てる・捨てる・新しく組み始めると消える） */
  proposal: ReadableStore<BatchProposal | null>;
  /** 提案を当てる（1回の update。当てた日・当てなかった日。提案が無ければ null） */
  apply(): { applied: string[]; skipped: string[] } | null;
  /** 提案を捨てる */
  discard(): void;
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

/** 終わった知らせの文（「11月の提案を出しました（22日分・担当が変わる 30件）」） */
export function batchDoneText(d: BatchDone): string {
  if (d.aborted) return `データを差し替えたので、${d.label}の担当を組むのを止めました（提案は捨てました）`;
  const counts = d.proposal ? `・担当が変わる ${d.proposal.moved}件・時刻が変わる ${d.proposal.shifted}件` : '';
  if (d.error) return `${d.label}の担当を${d.made}日分組んだところで止まりました（${d.error}）`;
  if (d.stopped) return `${d.label}の担当を${d.made}日分組んだところで止めました（${d.made}日分の提案${counts}）`;
  if (d.made === 0) return `${d.label}に組める日がありませんでした`;
  return `${d.label}の提案を出しました（${d.made}日分${counts}）。見て「当てる」と担当が変わります`;
}

/** 上の帯の文（「11月の担当を組んでいます 8/22日」） */
export function batchBandText(r: BatchRun): string {
  return `${r.label}の担当を組んでいます ${Math.min(r.index + 1, r.targets.length)}/${r.targets.length}日`;
}

/** 日付の月の名前（「11月」「10・11月」） */
export function monthsLabel(dates: readonly string[]): string {
  const months = [...new Set(dates.map((d) => Number(d.slice(5, 7))))];
  return `${months.join('・')}月`;
}

/** その日に担当なしの訪問があるか（伝えていない日だけ） */
function hasUnassigned(data: DemoData, date: string): boolean {
  if (own(data.snapshots, date)) return false;
  const p = dayProblemOf(data, date);
  return !!p && p.visits.length > 0 && unassignedOf(p, routesOf(p, visitsOn(data, date))).length > 0;
}

/**
 * 担当の足りない日（空き状況の［足りない担当を組む］。PRD D259）：dates のうち今日以降で、伝えていない、担当なしの訪問がある日
 */
export function missingDays(data: DemoData, dates: readonly string[], today: string): BatchDay[] {
  return dates
    .filter((d) => d >= today && hasUnassigned(data, d))
    .sort()
    .map((date) => ({ date, mode: 'care' as const }));
}

/**
 * 週の予定の「この週の担当を AI で組む」で組む日（PRD D280）：dates（週の7日）のうち今日以降で、伝えていない、
 * 計算に入れる訪問がある日
 */
export function weekBatchDays(data: DemoData, dates: readonly string[], today: string): BatchDay[] {
  return dates
    .filter((d) => d >= today && !own(data.snapshots, d) && activeDayVisits(data, d).length > 0)
    .sort()
    .map((date) => ({ date, mode: 'all' as const }));
}

/**
 * その日の担当を組めるか：compile でき、計算に入る訪問と〈スタッフ〉がいる。週の予定は組めない日を数えない（PRD D280）
 */
export function canMakeDay(data: CompileInput, date: string): boolean {
  const base = dayProblemOf(data, date);
  return !!base && base.visits.length > 0 && base.staff.length > 0;
}

/** 日の呼び名（「10/28」。範囲が1日のとき） */
export function dayLabel(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** 週の呼び名（「11/2〜11/8の週」。上の帯・知らせの文の月の名前の代わり） */
export function weekLabel(start: string): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return `${md(start)}〜${md(addDays(start, 6))}の週`;
}

/** 進み具合の帯の文・知らせのボタンの行き先（週の予定から始めたならその週、日ならその日の週、ほかは月の予定のその月） */
export function batchHref(x: Pick<BatchRun, 'ym' | 'source' | 'weekStart'>): string {
  return (x.source === 'week' || x.source === 'day') && x.weekStart ? `/week?d=${x.weekStart}` : `/month?ym=${x.ym}`;
}

/** 入れ物を作る（solve は差し替えられる。テストは Worker なしで解く） */
export function createMonthBatch(solve: Solve = runSolve): MonthBatch {
  const run = createValueStore<BatchRun | null>(null);
  const done = createValueStore<BatchDone | null>(null);
  const proposal = createValueStore<BatchProposal | null>(null);
  let proposalId = 0;
  let host: BatchHost | null = null;
  /** 計算の世代。つなぎ直す（外す）と進め、前の世代の結果は捨てる */
  let generation = 0;
  let current: { stop(): void } | null = null;
  let stopped = false;

  /** 作っている計算を捨てる（結果は出さない） */
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
    const weekStart = job.weekStart ?? null;
    stopped = false;
    // 新しく組み始めたら前の提案は捨てる（提案は1つだけ）
    proposal.set(null);
    let made = 0;
    let unassignedDays = 0;
    const days: ProposalDay[] = [];
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
      const counts = proposalCounts({ days });
      if (days.length > 0)
        proposal.set({
          id: ++proposalId,
          ym: job.ym,
          label: job.label,
          source: job.source,
          weekStart,
          days: [...days],
          stopped,
        });
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
        proposal: days.length > 0 ? { moved: counts.moved, shifted: counts.shifted } : null,
      });
    };

    const step = (i: number) => {
      if (!live()) return;
      if (i >= job.days.length || stopped) {
        finish();
        return;
      }
      const day = job.days[i]!.date;
      const latest = h.get();
      patch({ index: i, iteration: 0, total: 1 });
      // 組んでいる間に確定した日は飛ばす
      if (own(latest.snapshots, day)) {
        step(i + 1);
        return;
      }
      const visits = visitsOn(latest, day);
      const pins = pinsOf(visits);
      const p = dayProblemOf(latest, day, Object.keys(pins).length > 0 ? pins : undefined);
      if (!p || p.visits.length === 0 || p.staff.length === 0) {
        step(i + 1);
        return;
      }
      const started = (() => {
        try {
          return solve(p, { seed: latest.seed, iterations: defaultIterations(p) }, (x) => {
            if (!live()) return;
            patch({ iteration: x.iteration, total: x.total });
          });
        } catch (e) {
          finish(e instanceof Error ? e.message : '担当を組めませんでした');
          return null;
        }
      })();
      if (!started) return;
      current = started;
      started.promise
        .then((result) => {
          if (!live()) return;
          const before = routesOf(p, visits);
          let diff: ReassignDiff | null = null;
          try {
            diff = reassignDiff({ problem: p, routes: before }, { problem: p, routes: result.routes });
          } catch {
            diff = null;
          }
          days.push({
            date: day,
            problem: p,
            visits,
            routes: result.routes,
            diff,
            unassigned: result.unassigned.length,
          });
          made++;
          if (result.unassigned.length > 0) unassignedDays++;
          patch({ made });
          current = null;
          step(i + 1);
        })
        .catch((e) => {
          if (!live()) return;
          finish(e instanceof Error ? e.message : '担当を組めませんでした');
        });
    };

    step(0);
    return true;
  };

  return {
    run,
    done,
    proposal,
    start,
    apply: () => {
      const p = proposal.get();
      if (!p || !host || run.get() !== null) return null;
      let result: { applied: string[]; skipped: string[] } = { applied: [], skipped: [] };
      const h = host;
      // 当てるかどうかを今のデータで決めてから、1回の update で書く（全体の「元に戻す」の1手）
      const r = applyProposal(h.get(), p);
      result = { applied: r.applied, skipped: r.skipped };
      if (r.applied.length > 0)
        h.update(
          (d) => applyProposal(d, { days: p.days.filter((x) => r.applied.includes(x.date)) }).data,
          `AI の提案を当てる（${p.label}）`,
        );
      proposal.set(null);
      return result;
    },
    discard: () => proposal.set(null),
    stop: () => {
      if (run.get() === null) return;
      stopped = true;
      current?.stop();
    },
    running: () => run.get() !== null,
    abort: () => {
      proposal.set(null);
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
        proposal: null,
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
