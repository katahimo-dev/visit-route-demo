// 条件の重みの画面（#/rules）の下書き（PRD D286。ADR-0048）：表の重みのスライダー・必須の切り替えは、動かしても保存せず
// 画面の中の下書き（型ごとの重み・必須）に置き、「変更を確定」で点数の基準のプリセットにまとめて書く。
// ここは下書きの差分・確定の中身・影響する日を数える純粋関数。データを書き換えるのは画面の update(fn) だけ
import type { DemoData } from '../contracts/data';
import { HARDABLE, type Rule, type RuleType } from '../contracts/rules';
import { scoreRulesOf } from '../seed/presets';
import { own, weightLocked } from './common';
import { currentRuleKeys, rulesStale } from './month';
import { setBasisWeight } from './presets';
import { rebuildDays } from './rebuildBand';

/** 型ごとの重み・必須（必須にできない型は hard を false にそろえる） */
export type WeightValue = { weight: number; hard: boolean };
/** 型ごとの保存済みの値 */
export type SavedWeights = Partial<Record<RuleType, WeightValue>>;
/**
 * 下書き：型ごとに、触った欄（重み・必須）のうち保存済みと違うものだけを持つ（同じ値に戻したら消す）。
 * 当てるときは保存済みに重ねる（触っていない欄は、別のタブで変わってもその値を使う。確定で上書きしない）
 */
export type WeightDraft = Partial<Record<RuleType, Partial<WeightValue>>>;

const norm = (type: RuleType, v: WeightValue): WeightValue => ({
  weight: v.weight,
  hard: HARDABLE.has(type) && v.hard,
});
const same = (a: WeightValue, b: WeightValue) => a.weight === b.weight && a.hard === b.hard;

/** 表に出す条件（基準のプリセットを当てたもの）から、型ごとの保存済みの値（型の最初の条件。同じ型は同じ重み） */
export function savedWeights(rules: readonly Rule[]): SavedWeights {
  const out: SavedWeights = {};
  for (const r of rules) if (!out[r.type]) out[r.type] = norm(r.type, r);
  return out;
}

/** 保存済みに下書きの欄を重ねた値 */
const over = (type: RuleType, base: WeightValue, part: Partial<WeightValue> | undefined): WeightValue =>
  norm(type, { ...base, ...part });

/** 保存済みと違う欄だけ残す（無ければ null） */
function diffPart(type: RuleType, base: WeightValue, part: Partial<WeightValue>): Partial<WeightValue> | null {
  const v = over(type, base, part);
  const out: Partial<WeightValue> = {};
  if (part.weight !== undefined && v.weight !== base.weight) out.weight = v.weight;
  if (part.hard !== undefined && v.hard !== base.hard) out.hard = v.hard;
  return out.weight === undefined && out.hard === undefined ? null : out;
}

/** 下書きを直す：触った欄を足し、保存済みの値と同じになった欄・型は下書きから外す。その型の条件が無ければ何もしない */
export function editDraft(
  draft: WeightDraft,
  saved: SavedWeights,
  type: RuleType,
  patch: Partial<WeightValue>,
): WeightDraft {
  const base = saved[type];
  if (!base) return draft;
  const next = diffPart(type, base, { ...draft[type], ...patch });
  const out = { ...draft };
  if (next) out[type] = next;
  else delete out[type];
  return out;
}

/**
 * 下書きを今のデータに合わせる：条件を消してその型の条件が無くなった型・保存済みと同じ値になった欄（プリセットの節で同じ値にした・
 * 別のタブで同じ値にした等）は外す。変わらなければ同じオブジェクトを返す（画面の state を書き直さない）
 */
export function pruneDraft(draft: WeightDraft, saved: SavedWeights): WeightDraft {
  let changed = false;
  const out: WeightDraft = {};
  for (const [t, v] of Object.entries(draft) as [RuleType, Partial<WeightValue>][]) {
    const base = saved[t];
    const next = base ? diffPart(t, base, v) : null;
    if (!next) {
      changed = true;
      continue;
    }
    if (next.weight !== v.weight || next.hard !== v.hard) changed = true;
    out[t] = next;
  }
  return changed ? out : draft;
}

/** 表に出す条件に下書きを当てる（型ごと。同じ型の条件はどれも保存済みに下書きの欄を重ねた値） */
export function withDraft(rules: readonly Rule[], draft: WeightDraft): Rule[] {
  const saved = savedWeights(rules);
  return rules.map((r) => {
    const part = draft[r.type];
    const base = saved[r.type];
    if (!part || !base) return r;
    const v = over(r.type, base, part);
    return { ...r, weight: v.weight, hard: v.hard };
  });
}

/** 下書きの変更（1つの型＝1件） */
export type WeightChange = {
  type: RuleType;
  /** その型の条件の名前（表の並び） */
  labels: string[];
  before: WeightValue;
  after: WeightValue;
};

/** 下書きの変更の一覧（表の並び。型ごとに1件） */
export function draftChanges(rules: readonly Rule[], draft: WeightDraft): WeightChange[] {
  const saved = savedWeights(rules);
  const out: WeightChange[] = [];
  for (const r of rules) {
    const part = draft[r.type];
    const before = saved[r.type];
    if (!part || !before) continue;
    const after = over(r.type, before, part);
    if (same(after, before)) continue;
    const hit = out.find((c) => c.type === r.type);
    if (hit) hit.labels.push(r.label);
    else out.push({ type: r.type, labels: [r.label], before, after });
  }
  return out;
}

/** 重み・必須の短い文（「3」「0（使わない）」「必須」。重みを使わない必須は「必須」だけ、バランスの必須は「3・必須」） */
export function weightText(type: RuleType, v: WeightValue): string {
  if (weightLocked({ type, hard: v.hard })) return '必須';
  const w = v.weight === 0 ? '0（使わない）' : String(v.weight);
  return v.hard ? `${w}・必須` : w;
}

/** 前→後の文（行の印と確認の本文。例「3→4」「3→必須」） */
export const changeText = (c: Pick<WeightChange, 'type' | 'before' | 'after'>): string =>
  `${weightText(c.type, c.before)}→${weightText(c.type, c.after)}`;

/**
 * 確定：下書きの型ごとに点数の基準のプリセットを直す（試す重みも基準にそろう。ADR-0035 の setBasisWeight）。
 * 書くのは触った欄だけで、ほかの欄は d の保存済みの値のまま（別のタブで変わった必須などを上書きしない）
 */
export function applyDraft(d: DemoData, draft: WeightDraft): DemoData {
  const saved = savedWeights(scoreRulesOf(d));
  let out = d;
  for (const [t, part] of Object.entries(draft) as [RuleType, Partial<WeightValue>][]) {
    const base = saved[t];
    if (!base) continue;
    const v = over(t, base, part);
    if (!same(v, base)) out = setBasisWeight(out, t, v);
  }
  return out;
}

/** 確定したら「条件が変わった」になる日（今日以降・案と取り消しでない訪問のある日。確定した割当の有無で分ける） */
export type DraftStale = { days: string[]; unconfirmed: string[]; confirmed: string[] };

/**
 * 確定したあとのデータ next で、作った重みがどこにも無くなる日（lib/month の rulesStale。作り直しの帯・月の要対応の
 * 「条件が変わった」のうち重みによるもの）。compile しないので確認を出す前に数えられる
 */
export function draftStaleDays(next: DemoData, today: string): DraftStale {
  const keys = currentRuleKeys(next.rules, next.presets);
  const withVisits = new Set(next.visits.filter((v) => !v.cancelled).map((v) => v.date));
  const days = rebuildDays(next.aiPlans, today).filter((d) => withVisits.has(d) && rulesStale(next, d, keys));
  const confirmed = days.filter((d) => own(next.manualPlans, d) !== undefined);
  return { days, unconfirmed: days.filter((d) => !confirmed.includes(d)), confirmed };
}

/** 確認の見出し（PRD D286） */
export const confirmTitle = (n: number): string => `重みの変更（${n}件）を確定しますか？`;

/**
 * 確認の本文（PRD D286）：変わる条件と重み（前→後）、確定するとどうなるか（基準のプリセットの重みになり、月のまとめて作る・
 * 自動作成・作り直し・点数に使う）、影響する日（作り直しの帯と月の要対応に出る・確定済みの日は作り直さない）
 */
export function confirmBody(changes: readonly WeightChange[], basis: string, stale: DraftStale): string {
  const lines = changes.map((c) => `・${c.labels.join('・')}：${changeText(c)}`);
  const effect =
    stale.days.length > 0
      ? `今日以降の案のある日のうち ${stale.days.length}日（未確定 ${stale.unconfirmed.length}日・確定済み ${stale.confirmed.length}日）は作った重みが無くなるので「条件が変わった」になり、作り直しの帯と月の予定の要対応に出ます。作り直すのは未確定の日だけで、確定済みの日は作り直しません。`
      : '今日以降の案のある日で「条件が変わった」になる日はありません。';
  return [
    '変わる条件：',
    ...lines,
    '',
    `点数の基準のプリセット「${basis}」の重みになります。月のまとめて作る・開いた日の自動作成・作り直しはこの重みで作り、画面の点数もこの重みで付けます。日の予定の「この日だけ試す重み」も基準に戻ります。`,
    effect,
  ].join('\n');
}

/** 確定のあとの知らせ */
export const confirmedText = (n: number, basis: string): string => `「${basis}」の重みを確定しました（${n}件）`;

/** 画面を離れるときの確認（〈スタッフ〉の編集の欄の「変更を捨てる」と同じ形。lib/viewMode の discardDialog） */
export function leaveDialog(n: number) {
  return {
    title: '重みの変更を捨てて、画面を移りますか？',
    body: `確定していない重みの変更（${n}件）があります。移ると捨てます。`,
    confirmLabel: '捨てて移る',
    cancelLabel: '編集を続ける',
    tone: 'danger' as const,
  };
}
