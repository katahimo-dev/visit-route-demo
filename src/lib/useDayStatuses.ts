import { useMemo } from 'react';
import type { DemoData } from '../contracts/data';
import type { Visit } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import type { CompileInput } from '../matching';
import { visitsOn } from '../patterns';
import { own } from './common';
import { dayProblemOf } from './dayPlan';
import { type DayStatus, dayStatus } from './month';

/** 日の表示の計算の覚え（日付ごと。同じ入力なら compile・検査し直さない） */
type Memo = {
  base: unknown[];
  visits: Visit[];
  snapshot: unknown;
  problem: Problem | null;
  status: DayStatus;
};

/**
 * 日ごとの覚え（モジュールに置き、画面を移っても消えない）。日付ごとに最近の数件。入力はすべて同じもの（===）のときだけ使う。
 * 訪問は visitsOn の結果（保存した回と計算した回。計算した回は同じパターン・同じ日なら同じオブジェクト）
 */
const MEMO = new Map<string, Memo[]>();
const MEMO_PER_DAY = 3;
const MEMO_DAYS = 400;
function remember(date: string, m: Memo) {
  const list = MEMO.get(date) ?? [];
  MEMO.delete(date);
  MEMO.set(date, [m, ...list].slice(0, MEMO_PER_DAY));
  // 古い日付から捨てる（Map は入れた順）
  while (MEMO.size > MEMO_DAYS) MEMO.delete(MEMO.keys().next().value as string);
}

const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** 日ごとの状態と問題 */
export type DayStatuses = Map<string, { status: DayStatus; problem: Problem | null }>;

/**
 * 日ごとの状態（月のマスの色・要対応・今月の準備と同じ数え方。lib/month の dayStatus：訪問ごとの検査と伝えた状態）。
 * 月の予定・週の予定・ホームで共通。日付・compile が読むデータ・伝えた内容で覚える（8人・約17件／日の一月で 500ms 以内）
 */
export function useDayStatuses(data: DemoData, compileInput: CompileInput, days: readonly string[]): DayStatuses {
  return useMemo(() => {
    const out: DayStatuses = new Map();
    const c = compileInput;
    // compile が読むデータのうち訪問以外のすべて（CompileInput のキーから作り、足したフィールドを漏らさない）
    const base = (Object.keys(c) as (keyof CompileInput)[])
      .filter((k) => k !== 'visits')
      .sort()
      .map((k) => c[k]);
    for (const d of days) {
      const visits = visitsOn(c, d);
      const snapshot = own(data.snapshots, d);
      const hit = MEMO.get(d)?.find(
        (x) => x.snapshot === snapshot && sameList(x.base, base) && sameList(x.visits, visits),
      );
      if (hit) {
        out.set(d, { status: hit.status, problem: hit.problem });
        continue;
      }
      const problem = visits.some((v) => !v.cancelled) ? dayProblemOf(c, d) : null;
      const status = dayStatus({ ...c, snapshots: data.snapshots }, d, problem);
      remember(d, { base, visits, snapshot, problem, status });
      out.set(d, { status, problem });
    }
    return out;
  }, [days, compileInput, data.snapshots]);
}
