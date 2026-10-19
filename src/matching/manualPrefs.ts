// 手直しの記憶（PRD D260〜D262。ADR-0043）：キーを作る・問題に当てる（純粋関数）。
// 記憶を当てるのは「案を作る」ときの問題だけ（採点・説明の問題には当てない）。当て方は手直しの固定（compile の pins）と同じく、
// 記憶の担当だけを可にする（費用は変えない）。記憶の担当がその日に可でなければ当てない（黙ってふつうの割当に戻す）
import type { ManualPrefs } from '../contracts/data';
import type { Visit } from '../contracts/documents';
import type { Problem, Reason } from '../contracts/problem';
import { weekday } from '../domain/time';

/** 手直しの記憶で外した組・当てた組の理由の ruleId（条件 rules の ID ではない） */
export const MANUAL_PREF_RULE_ID = 'manualPref';

/** 記憶のキーに使う訪問のフィールド */
export type PrefVisit = Pick<Visit, 'clientId' | 'date' | 'earliestStart' | 'latestStart' | 'typeId'>;

/**
 * 記憶のキー：`clientId|曜日(0=日〜6=土)|earliestStart-latestStart|typeId（種類なしは空）`。
 * 同じ〈利用者さん〉・同じ曜日・同じ時間の約束・同じ種類の訪問は同じキー（日付・所要・パターンは入れない）
 */
export function prefKey(v: PrefVisit): string {
  return `${v.clientId}|${weekday(v.date)}|${v.earliestStart}-${v.latestStart}|${v.typeId ?? ''}`;
}

/** 自分のキーだけを引く（__proto__ などを踏まない） */
const own = (o: Record<string, string>, k: string): string | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

/**
 * 問題の訪問ごとに記憶の担当を引く（訪問ID → 担当ID）。pins（手直しの固定）で担当が問題にいる訪問は飛ばす（固定が先）。
 * 可否はまだ見ない（applyPrefPins が見る）
 */
export function requestedPrefPins(
  problem: Problem,
  data: { visits: readonly (PrefVisit & { id: string })[]; manualPrefs: ManualPrefs },
  pins?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (Object.keys(data.manualPrefs).length === 0) return out;
  const staffIds = new Set(problem.staff.map((s) => s.id));
  const inProblem = new Set(problem.visits.map((v) => v.id));
  for (const v of data.visits) {
    if (!inProblem.has(v.id)) continue;
    const pin = pins ? own(pins, v.id) : undefined;
    if (pin !== undefined && staffIds.has(pin)) continue;
    const key = prefKey(v);
    const pref = Object.hasOwn(data.manualPrefs, key) ? data.manualPrefs[key] : undefined;
    if (pref) out[v.id] = pref.staffId;
  }
  return out;
}

/**
 * 問題に記憶の固定を当てる：担当（prefPins の値）が問題にいて、その組が可（稼働・欠勤・休み・相性×・担当を限る・種類・必須の条件）
 * のときだけ、その訪問はその担当だけを可にする（他の担当は理由「手直しの記憶（〈名前〉さんに固定）」で外す。費用は変えない）。
 * 当てた組には理由「手直しの記憶：前に手で〈名前〉さんにした」（0点）。applied は当てたもの。当てるものが無ければ problem をそのまま返す
 */
export function applyPrefPins(
  problem: Problem,
  prefPins: Record<string, string> | undefined,
): { problem: Problem; applied: Record<string, string> } {
  const applied: Record<string, string> = {};
  if (!prefPins || Object.keys(prefPins).length === 0) return { problem, applied };
  const vIndex = new Map(problem.visits.map((v, j) => [v.id, j]));
  const sIndex = new Map(problem.staff.map((s, i) => [s.id, i]));
  let allowed = problem.allowed;
  let reasons = problem.reasons;
  for (const [vid, sid] of Object.entries(prefPins)) {
    const j = vIndex.get(vid);
    const i = sIndex.get(sid);
    if (j === undefined || i === undefined || problem.allowed[j]?.[i] !== true) continue;
    if (allowed === problem.allowed) {
      allowed = [...problem.allowed];
      reasons = [...problem.reasons];
    }
    const name = problem.staff[i]!.name;
    allowed[j] = allowed[j]!.map((ok, k) => (k === i ? ok : false));
    reasons[j] = reasons[j]!.map((cell, k) => {
      const r: Reason =
        k === i
          ? { ruleId: MANUAL_PREF_RULE_ID, label: `手直しの記憶：前に手で${name}さんにした`, points: 0 }
          : {
              ruleId: MANUAL_PREF_RULE_ID,
              label: `手直しの記憶（${name}さんに固定）`,
              points: Number.POSITIVE_INFINITY,
            };
      // compile と同じく点の大きい順（Infinity が先）
      return [...cell, r].sort((a, b) => b.points - a.points || 0);
    });
    applied[vid] = sid;
  }
  if (allowed === problem.allowed) return { problem, applied };
  return { problem: { ...problem, allowed, reasons }, applied };
}

/** requestedPrefPins と applyPrefPins を続けて（案を作るときの問題。pins は手直しの固定で、その訪問には当てない） */
export function withManualPrefs(
  problem: Problem,
  data: { visits: readonly (PrefVisit & { id: string })[]; manualPrefs: ManualPrefs },
  pins?: Record<string, string>,
): { problem: Problem; applied: Record<string, string> } {
  return applyPrefPins(problem, requestedPrefPins(problem, data, pins));
}
