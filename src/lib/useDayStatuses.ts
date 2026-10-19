import { useMemo } from 'react';
import type { AiPlan, AiRun, DemoData } from '../contracts/data';
import type { Visit } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import { score } from '../evaluate';
import { type CompileInput, compile } from '../matching';
import { scoreRulesOf } from '../seed';
import { attempt, own } from './common';
import { currentRuleKeys, type DayStatus, type DayView, dayPlanOf, dayStatus, planStale, rulesStale } from './month';
import { absentLeftIds } from './requestedOff';
import { alignPlan } from './runs';
import { workStats } from './workload';

/** 日の表示の計算の覚え（日付ごと。同じ入力なら compile・採点し直さない） */
type Memo = {
  base: unknown[];
  visits: Visit[];
  plan: AiPlan | undefined;
  saved: unknown;
  runs: AiRun[] | undefined;
  /** 点数の物差しの条件のキー（JSON。画面ごとに作る配列でなく中身で比べ、画面を移っても覚えを使う） */
  rules: string;
  problem: Problem | null;
  view: DayView;
};

/**
 * 日ごとの覚え（モジュールに置き、画面を移っても消えない。PR #40 のレビュー）。日付ごとに最近の数件（月の画面と設定の画面の帯の
 * ように、少し前のデータと今のデータを同時に数えることがあるので1件にしない）。入力はすべて同じもの（===）か同じ中身のときだけ使う
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

/**
 * 作った条件（重み・必須）がいまの条件にもプリセットにも当てはまらなければ「条件が変わった」を足す（PRD D161）。
 * 覚えの外で決める（プリセットの重みは compile が読まないので、覚えの鍵に入っていない）
 */
const withRules = (view: DayView, changed: boolean): DayView => (changed ? { ...view, stale: true } : view);

/** 日ごとの状態と問題 */
export type DayStatuses = Map<string, { status: DayStatus; problem: Problem | null }>;

/**
 * 日ごとの状態（月のマスの色・要対応・今月の準備と同じ数え方。lib/month の dayStatus に、点数の物差しで compile・採点した
 * 必須の違反・条件が変わった・欠勤の人に残る訪問・拘束が上限を超える人を足す）。月の予定とホーム（PRD D141〜）で共通。
 * 日付・compile が読むデータ・案で覚える（8人・約17件／日の一月で 500ms 以内）
 */
export function useDayStatuses(data: DemoData, compileInput: CompileInput, days: readonly string[]): DayStatuses {
  /** 点数の物差しの条件（いまの条件に基準のプリセットを当てたもの。必須の違反と「条件が変わった」の判定に使う） */
  const scoreRules = useMemo(
    () => scoreRulesOf({ rules: data.rules, presets: data.presets, scorePresetId: data.scorePresetId }),
    [data.rules, data.presets, data.scorePresetId],
  );
  /** 日ごとの訪問（compile にはその日の訪問だけを渡す。compile はその日の訪問しか読まない） */
  const visitsByDate = useMemo(() => {
    const out = new Map<string, Visit[]>();
    for (const v of data.visits) {
      const list = out.get(v.date);
      if (list) list.push(v);
      else out.set(v.date, [v]);
    }
    return out;
  }, [data.visits]);
  /** いま作れる条件の組（いまの条件と各プリセット。今の案の条件がどれでもなければ「条件が変わった」。PRD D161） */
  const ruleKeys = useMemo(() => currentRuleKeys(data.rules, data.presets), [data.rules, data.presets]);
  return useMemo(() => {
    const out: DayStatuses = new Map();
    const c = compileInput;
    const rulesKey = JSON.stringify(scoreRules);
    // compile が読むデータのうち訪問以外のすべて（CompileInput のキーから作り、足したフィールドを漏らさない。休み clientLeaves など）
    const base = (Object.keys(c) as (keyof CompileInput)[])
      .filter((k) => k !== 'visits')
      .sort()
      .map((k) => c[k]);
    for (const d of days) {
      const plan = own(data.aiPlans, d);
      const saved = own(data.manualPlans, d);
      const visits = visitsByDate.get(d) ?? [];
      if ((!plan && !saved) || !visits.some((v) => !v.cancelled)) {
        out.set(d, { status: dayStatus(data, d), problem: null });
        continue;
      }
      const runs = own(data.aiRuns, d);
      const hit = MEMO.get(d)?.find(
        (x) =>
          x.plan === plan &&
          x.saved === saved &&
          x.runs === runs &&
          x.rules === rulesKey &&
          sameList(x.base, base) &&
          sameList(x.visits, visits),
      );
      if (hit) {
        out.set(d, {
          status: dayStatus(data, d, withRules(hit.view, rulesStale(data, d, ruleKeys))),
          problem: hit.problem,
        });
        continue;
      }
      const input: CompileInput = { ...c, visits };
      const sp = attempt(() => compile({ ...input, rules: scoreRules }, d)).value;
      // 欠勤（希望休も。ADR-0014）の人に残っている訪問（数える案＝今の案、無ければ確定した割当）。
      // 同じ訪問を「違反」でも数えないよう、必須の違反からは除く（「休みの人に N」に一本化）
      // 最終勤務日の後（ADR-0015）の人に残る訪問も同じく数える
      const left = new Set(
        sp && (c.absences.some((a) => a.date === d) || c.staff.some((s) => s.lastDay !== null && s.lastDay < d))
          ? absentLeftIds(sp, dayPlanOf(data, d, sp).routes)
          : [],
      );
      let view: DayView = {};
      if (sp && plan) {
        const aligned = attempt(() => alignPlan(sp, plan)).value ?? plan;
        const sc = attempt(() => score(sp, aligned.routes)).value;
        view = {
          visitIds: sp.visits.map((v) => v.id),
          hard: sc?.hardViolations.filter((h) => !left.has(h.visitId)).length ?? 0,
          stale: planStale(input, data, d, (rules, pins) =>
            Object.keys(pins).length === 0 && JSON.stringify(rules) === rulesKey ? sp : undefined,
          ),
        };
      } else if (sp) {
        view = { visitIds: sp.visits.map((v) => v.id) };
      }
      if (left.size > 0) view = { ...view, absentLeft: left.size };
      // 拘束が上限を超える人（ADR-0015）。月のマスの中は他の印と同じ数える案（dayPlanOf：今の案、無ければ確定した割当。
      // 確定した割当は開始の順に並べ済み）で数える。org（上限）は base に入っている
      if (sp) {
        const dp = dayPlanOf(data, d, sp);
        const over =
          dp.source !== null
            ? workStats(sp, dp.routes, c.org)
                .filter((x) => x.over)
                .map((x) => x.staffId)
            : [];
        if (over.length > 0) view = { ...view, overSpan: over };
      }
      remember(d, { base, visits, plan, saved, runs, rules: rulesKey, problem: sp, view });
      out.set(d, { status: dayStatus(data, d, withRules(view, rulesStale(data, d, ruleKeys))), problem: sp });
    }
    return out;
  }, [days, compileInput, data, scoreRules, visitsByDate, ruleKeys]);
}
