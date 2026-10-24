// 組み方の標準（PRD D350〜D354。ADR-0063）の、画面の外に置く入れ物と案を作る計算。
// 案（プリセットごとの表と数字）・下書き・作っている途中の進み具合をここに置き、ほかの画面へ移っても残す
// （読み直す・タブを閉じると消える。データには入れない）。案を作る計算も画面を離れても続ける
import type { DemoData } from '../contracts/data';
import { normalize, score, toHundred } from '../evaluate';
import { compile } from '../matching';
import { applyPreset, scoreRulesOf } from '../seed';
import { defaultIterations, runSolve } from '../solver';
import { attempt } from './common';
import {
  type ProposalStats,
  periodDates,
  proposalStats,
  type StandardDay,
  type StandardPeriod,
  type StandardTable,
  standardPatterns,
  standardPeriod,
  tableFromDays,
} from './standard';
import { createValueStore } from './valueStore';

/** プリセットごとの案 */
export type StandardProposal = {
  presetId: string;
  /** 作り終えた表（作っている間・作れなかったときは null） */
  table: StandardTable | null;
  stats: ProposalStats | null;
  done: boolean;
};

/** 下書き（from＝どこから作ったか。案のプリセット ID・今の標準は null） */
export type StandardDraft = { table: StandardTable; from: string | null };

export type StandardWork = {
  /** 案（作り始めたプリセットの分。data.presets の順） */
  proposals: StandardProposal[];
  /** 案を作った期間と、そのときの繰り返しの印（繰り返しが変わったら古い印を出す） */
  proposalsOf: { period: StandardPeriod; key: string } | null;
  running: { presetName: string; day: number; days: number } | null;
  error: string | null;
  draft: StandardDraft | null;
  /** 下書きを作ったときの繰り返しの印 */
  draftKey: string | null;
  /** 登録した直後の完了の表示（いつから） */
  /** 登録した「いつから」と登録の時刻（元に戻したら data.standard.at と合わなくなり、完了の表示を出さない） */
  registered: { since: string; at: number } | null;
};

const EMPTY: StandardWork = {
  proposals: [],
  proposalsOf: null,
  running: null,
  error: null,
  draft: null,
  draftKey: null,
  registered: null,
};

export const standardWork = createValueStore<StandardWork>(EMPTY);

/** 表の行にする繰り返しの印（ID・曜日・担当・標準の開始。これが変わったら案・下書きは古い。ほかの画面で担当を替えたときも） */
export function patternsKey(data: Pick<DemoData, 'patterns' | 'clients'>, today: string): string {
  return standardPatterns(data, today)
    .map(
      (p) =>
        `${p.id}:${p.weekdays.join(',')}:${p.usualStaffId ?? ''}:${(p.usualStarts ?? []).map((x) => `${x.weekday}@${x.start}`).join(',')}`,
    )
    .sort()
    .join('|');
}

/** 下書きを置く（完了の表示は消す） */
export function setDraft(draft: StandardDraft | null, key: string | null): void {
  standardWork.set((w) => ({ ...w, draft, draftKey: draft ? key : null, registered: draft ? null : w.registered }));
}

/** 作っている計算（1つだけ） */
let ctl: { stopped: boolean; stop: (() => void) | null } | null = null;

export const isRunning = () => ctl !== null;

/** 作るのを止める（作り終えた案は残す） */
export function stopProposals(): void {
  if (!ctl) return;
  ctl.stopped = true;
  ctl.stop?.();
}

/** ひな形の日の入力：保存した回・単発の訪問は見ず（visits を空にして繰り返しから計算した回だけ）、ピンも効かせない */
const templateOf = (d: DemoData): DemoData => ({ ...d, visits: [] });

/**
 * プリセットごとに案を作る（data.presets の順）。期間（standardPeriod）の日を1日ずつ、そのプリセットの重みで Worker で解き、
 * 日ごとの割当から標準の表（tableFromDays）とカードの数（点は点数の基準の物差し）を作る。始めたときのデータで作る
 */
export async function runProposals(data: DemoData, today: string): Promise<void> {
  if (ctl) return;
  const me: { stopped: boolean; stop: (() => void) | null } = { stopped: false, stop: null };
  ctl = me;
  const period = standardPeriod(data, today);
  const dates = periodDates(period);
  const base = templateOf(data);
  const basisRules = scoreRulesOf(data);
  const proposals: StandardProposal[] = data.presets.map((p) => ({
    presetId: p.id,
    table: null,
    stats: null,
    done: false,
  }));
  standardWork.set((w) => ({
    ...w,
    proposals: proposals.map((p) => ({ ...p })),
    proposalsOf: { period, key: patternsKey(data, today) },
    error: null,
  }));
  const publish = () => standardWork.set((w) => ({ ...w, proposals: proposals.map((p) => ({ ...p })) }));
  /** 点数の基準の物差しで 100点満点にする（日ごとに1回だけ作る） */
  const pointsCache = new Map<string, number | null>();
  const toPoints = (day: StandardDay): number | null => {
    const key = `${day.date}|${JSON.stringify(day.routes)}`;
    const hit = pointsCache.get(key);
    if (hit !== undefined) return hit;
    const p = attempt(() => compile({ ...base, rules: basisRules }, day.date)).value;
    const sc = p ? attempt(() => score(p, day.routes)).value : null;
    const scale = p ? attempt(() => normalize(p)).value : null;
    const out = sc && scale ? toHundred(sc.total, scale) : null;
    pointsCache.set(key, out);
    return out;
  };
  try {
    for (const [pi, preset] of data.presets.entries()) {
      if (me.stopped) break;
      const input = { ...base, rules: applyPreset(base.rules, preset) };
      const days: StandardDay[] = [];
      for (const [i, date] of dates.entries()) {
        if (me.stopped) break;
        standardWork.set((w) => ({ ...w, running: { presetName: preset.name, day: i + 1, days: dates.length } }));
        const p = attempt(() => compile(input, date)).value;
        if (!p || p.visits.length === 0 || p.staff.length === 0) continue;
        const started = runSolve(p, { seed: data.seed, iterations: defaultIterations(p) });
        me.stop = started.stop;
        const res = await started.promise;
        me.stop = null;
        if (me.stopped) break;
        days.push({ date, problem: p, routes: res.routes });
      }
      if (me.stopped) break;
      const prop = proposals[pi] as StandardProposal;
      prop.table = tableFromDays(data, days, today);
      prop.stats = days.length > 0 ? proposalStats(days, toPoints) : null;
      prop.done = true;
      publish();
    }
  } catch (e) {
    standardWork.set((w) => ({ ...w, error: e instanceof Error ? e.message : '案を作れませんでした' }));
  } finally {
    ctl = null;
    // 止めたときは作り終えていない案を外す
    standardWork.set((w) => ({ ...w, running: null, proposals: w.proposals.filter((p) => p.done) }));
  }
}

/** テスト用：入れ物を空に戻す */
export function resetStandardWork(): void {
  stopProposals();
  standardWork.set(EMPTY);
}
