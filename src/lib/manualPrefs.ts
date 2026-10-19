// 手直しの記憶を書く・消す（PRD D260〜D262。ADR-0043）。純粋関数で、画面が store の update(fn) の中で使う
import { type AiPlan, type DemoData, MAX_MANUAL_PREFS, type ManualPrefs } from '../contracts/data';
import type { Visit } from '../contracts/documents';
import { weekday } from '../domain/time';
import { score } from '../evaluate';
import { bestInsertion, compile } from '../matching';
import { type PrefVisit, prefKey } from '../matching/manualPrefs';
import { attempt, WEEKDAY_LABELS } from './common';
import { alignPlan } from './runs';
import { editKey } from './undoEdit';

/** 新しい順に max 件まで残す（updatedAt の古いものから消す。同じ時刻はキーの順で決める） */
export function trimManualPrefs(prefs: ManualPrefs, max: number = MAX_MANUAL_PREFS): ManualPrefs {
  const keys = Object.keys(prefs);
  if (keys.length <= max) return prefs;
  const keep = keys
    .sort((a, b) => prefs[b]!.updatedAt - prefs[a]!.updatedAt || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, max);
  return Object.fromEntries(keep.map((k) => [k, prefs[k]!]));
}

/** 手で担当を変えた訪問の記憶を書く（同じキーは上書き＝最新だけ。上限を超えたら古い順に消す） */
export function recordManualPref(prefs: ManualPrefs, visit: PrefVisit, staffId: string, now: number): ManualPrefs {
  return trimManualPrefs({ ...prefs, [prefKey(visit)]: { staffId, updatedAt: now } });
}

/**
 * 手で固定を外した訪問の記憶を消す：その訪問のキーの記憶が外した担当（staffId）のときだけ消す
 * （別の日の手直しで書き直した記憶は残す）。消すものが無ければ prefs をそのまま返す
 */
export function forgetManualPref(prefs: ManualPrefs, visit: PrefVisit, staffId: string): ManualPrefs {
  const key = prefKey(visit);
  if (!Object.hasOwn(prefs, key) || prefs[key]!.staffId !== staffId) return prefs;
  const { [key]: _, ...rest } = prefs;
  return rest;
}

/**
 * データに記憶の変化を当てる（update(fn) の中で）。set は手で担当を変えた（訪問ID → 担当ID）、
 * clear は手で固定を外した（訪問ID → 外した担当ID）。訪問が見つからないものは飛ばす
 */
export function patchManualPrefs(
  d: DemoData,
  change: { set?: Record<string, string>; clear?: Record<string, string> },
  now: number,
): DemoData {
  let prefs = d.manualPrefs;
  const visitOf = (id: string) => d.visits.find((v) => v.id === id);
  for (const [vid, sid] of Object.entries(change.clear ?? {})) {
    const v = visitOf(vid);
    if (v) prefs = forgetManualPref(prefs, v, sid);
  }
  for (const [vid, sid] of Object.entries(change.set ?? {})) {
    const v = visitOf(vid);
    if (v) prefs = recordManualPref(prefs, v, sid, now);
  }
  return prefs === d.manualPrefs ? d : { ...d, manualPrefs: prefs };
}

/** 1つのキーの記憶を元の値に戻す（「元に戻す」1手。before が null なら消す） */
export function restoreManualPref(prefs: ManualPrefs, key: string, before: ManualPrefs[string] | null): ManualPrefs {
  if (before) return { ...prefs, [key]: before };
  if (!Object.hasOwn(prefs, key)) return prefs;
  const { [key]: _, ...rest } = prefs;
  return rest;
}

// ---- 来週以降の割当済みもまとめて変える（ADR-0043） ----

/** 手作業案の「未割当」の列（domain/scheduleModel の NONE と同じ） */
const NONE_COL = '__none';

/** 今日より後の同じキーの訪問で、すでに別の人が割り当たっているもの（1件） */
export type FutureAssigned = {
  date: string;
  visitId: string;
  /** 今の担当（今の案、無ければ確定した割当） */
  from: string;
  /** 変える先（記憶にした担当） */
  to: string;
  /** その日の数える案：今の案があれば 'plan'、無く確定した割当だけなら 'confirmed' */
  source: 'plan' | 'confirmed';
};

const ownerIn = (cols: Record<string, string[]> | undefined, visitId: string): string | null => {
  if (!cols) return null;
  for (const [sid, ids] of Object.entries(cols)) if (sid !== NONE_COL && ids.includes(visitId)) return sid;
  return null;
};

/**
 * 記憶にした（訪問ID → 担当ID）訪問と同じキーの訪問で、今日（today）より後の日に、今の案（無ければ確定した割当）で
 * 別の人が割り当たっているもの（日付の順）。取り消し・記憶にした訪問そのもの・未割当は入れない
 */
export function futureAssigned(
  d: Pick<DemoData, 'visits' | 'aiPlans' | 'manualPlans'>,
  items: Record<string, string>,
  today: string,
): FutureAssigned[] {
  const want = new Map<string, string>();
  const self = new Set(Object.keys(items));
  for (const [vid, sid] of Object.entries(items)) {
    const v = d.visits.find((x) => x.id === vid);
    if (v) want.set(prefKey(v), sid);
  }
  if (want.size === 0) return [];
  const out: FutureAssigned[] = [];
  for (const v of d.visits) {
    if (v.date <= today || v.cancelled || self.has(v.id)) continue;
    const to = want.get(prefKey(v));
    if (to === undefined) continue;
    const plan = Object.hasOwn(d.aiPlans, v.date) ? d.aiPlans[v.date] : undefined;
    const cols = Object.hasOwn(d.manualPlans, v.date) ? d.manualPlans[v.date] : undefined;
    const from = plan ? ownerIn(plan.routes, v.id) : ownerIn(cols, v.id);
    if (from === null || from === to) continue;
    out.push({ date: v.date, visitId: v.id, from, to, source: plan ? 'plan' : 'confirmed' });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** まとめて変えられなかった1件と理由 */
export type BulkFail = FutureAssigned & { why: string };

/**
 * まとめて変える：その日の今の案で担当を差し替えて固定（pins）にする（手直しの「担当を移す」と同じく最も費用の少ない位置に入れる）。
 * 今の案が無い日（確定した割当だけ）は確定を勝手に変えないので変えない。担当がその日の問題にいない・可否が不可（欠勤・休み・
 * 時間帯外・相性×・担当を限る・種類・必須の条件。今の案の条件で作った問題）なら変えない。確定した日でも今の案は変える
 * （日の画面で「未確定の変更あり」になる）。before は変えた日の元の今の案（「元に戻す」で戻す）
 */
export function applyFutureAssigned(
  d: DemoData,
  list: readonly FutureAssigned[],
): { data: DemoData; changed: FutureAssigned[]; failed: BulkFail[]; before: Record<string, AiPlan> } {
  const changed: FutureAssigned[] = [];
  const failed: BulkFail[] = [];
  const before: Record<string, AiPlan> = {};
  const byDate = new Map<string, FutureAssigned[]>();
  for (const x of list) byDate.set(x.date, [...(byDate.get(x.date) ?? []), x]);
  let aiPlans = d.aiPlans;
  for (const [date, xs] of byDate) {
    const plan = Object.hasOwn(d.aiPlans, date) ? d.aiPlans[date] : undefined;
    if (!plan) {
      for (const x of xs) failed.push({ ...x, why: '確定した割当だけの日' });
      continue;
    }
    const problem = attempt(() => compile({ ...d, rules: plan.rules }, date)).value;
    if (!problem) {
      for (const x of xs) failed.push({ ...x, why: 'その日の問題を作れません' });
      continue;
    }
    let cur = alignPlan(problem, plan);
    let any = false;
    for (const x of xs) {
      const j = problem.visits.findIndex((v) => v.id === x.visitId);
      const i = problem.staff.findIndex((s) => s.id === x.to);
      if (j < 0 || i < 0 || problem.allowed[j]?.[i] !== true) {
        failed.push({ ...x, why: i < 0 ? 'その日は働かない' : 'その日は担当できない' });
        continue;
      }
      const routes = bestInsertion(problem, cur.routes, x.visitId, x.to);
      const placed = new Set(Object.values(routes).flat());
      cur = {
        ...cur,
        routes,
        unassigned: problem.visits.map((v) => v.id).filter((id) => !placed.has(id)),
        score: score(problem, routes).total,
        pins: { ...cur.pins, [x.visitId]: x.to },
      };
      changed.push(x);
      any = true;
    }
    if (!any) continue;
    before[date] = plan;
    aiPlans = { ...aiPlans, [date]: cur };
  }
  return { data: aiPlans === d.aiPlans ? d : { ...d, aiPlans }, changed, failed, before };
}

/** 今の案が同じ手直しの形か（routes・pins で見る。まとめて変えた日を「元に戻す」で戻せるか） */
export function samePlanEdit(a: AiPlan | undefined, b: AiPlan | undefined): boolean {
  if (!a || !b) return a === b;
  return editKey({ routes: a.routes, pins: a.pins }) === editKey({ routes: b.routes, pins: b.pins });
}

// ---- 確認の文（PRD D261） ----

/** 「火曜 10:00」（時間の約束に幅があれば「火曜 10:00〜10:30」） */
export function prefWhenText(v: Pick<Visit, 'date' | 'earliestStart' | 'latestStart'>): string {
  const time = v.earliestStart === v.latestStart ? v.earliestStart : `${v.earliestStart}〜${v.latestStart}`;
  return `${WEEKDAY_LABELS[weekday(v.date)]}曜 ${time}`;
}

/** 「10/28・11/4 …」（日付を重ねずに先頭 max 日。残りは「ほか N日」） */
export function prefDatesText(dates: readonly string[], max = 4): string {
  const uniq = [...new Set(dates)];
  const shown = uniq.slice(0, max).map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`);
  return uniq.length > max ? `${shown.join('・')} ほか${uniq.length - max}日` : shown.join('・');
}

/**
 * 「元に戻す」（1手）で、同じ1手で書いた手直しの記憶（prefs：キーと前の値。書いた順）と
 * まとめて変えたほかの日の今の案（others：前の今の案）を戻す（ADR-0043）
 */
export function undoPrefExtras(
  d: DemoData,
  x: { prefs?: { key: string; before: ManualPrefs[string] | null }[]; others?: { date: string; before: AiPlan }[] },
): DemoData {
  let out = d;
  if (x.prefs?.length) {
    let prefs = out.manualPrefs;
    for (const e of [...x.prefs].reverse()) prefs = restoreManualPref(prefs, e.key, e.before);
    out = { ...out, manualPrefs: prefs };
  }
  if (x.others?.length) {
    out = { ...out, aiPlans: { ...out.aiPlans, ...Object.fromEntries(x.others.map((o) => [o.date, o.before])) } };
  }
  return out;
}
