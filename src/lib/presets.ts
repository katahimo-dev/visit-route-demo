// 条件のプリセットの編集（ADR-0008）。データを書き換えるのは store の update(fn) を通した画面だけ。ここは新しい DemoData を返す純粋関数
import type { DemoData } from '../contracts/data';
import { HARDABLE, MAX_PRESETS, type Preset, RULE_TYPES, type Rule, type RuleType } from '../contracts/rules';
import { initialPresets, matchesPreset, presetOf, scorePresetOf, scoreRulesOf } from '../seed';
import { newId } from './common';

/**
 * AI案を作る条件（ADR-0028。PRD D214）：「条件の重みとプリセット」（rules）が切なら、この日だけ試す重みに点数の基準のプリセットの重みを
 * 当てたもの（月まとめ作成と同じ。切ると基準のプリセットだけで作る）。入ならこの日だけ試す重みそのもの
 */
export function planRulesOf(d: Pick<DemoData, 'rules' | 'presets' | 'scorePresetId'>, rulesOn: boolean): Rule[] {
  return rulesOn ? d.rules : scoreRulesOf(d);
}

/** プリセットの名前の上限（contracts の presetSchema と同じ） */
export const PRESET_NAME_MAX = 20;
export const PRESET_NOTE_MAX = 60;

/**
 * この日だけ試す重みの重み・必須からプリセットの重みを作る。型ごとに最初の条件の重み・必須を写す
 * （同じ型の条件が2つ以上あっても、プリセットは型ごとの重みなので最初の1つだけ）。その型の条件が無ければ 重み0
 */
export function weightsFromRules(rules: Rule[]): Preset['weights'] {
  return Object.fromEntries(
    RULE_TYPES.map((t) => {
      const r = rules.find((x) => x.type === t);
      return [t, r ? { weight: r.weight, hard: HARDABLE.has(t) && r.hard } : { weight: 0, hard: false }];
    }),
  ) as Preset['weights'];
}

/** プリセットの重みの深い写し（型ごとの { weight, hard } も写す。元のプリセットと中身を共有しない） */
function copyWeights(w: Preset['weights']): Preset['weights'] {
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, { ...v }])) as Preset['weights'];
}

/** 足せない理由（足せるなら null） */
export function addPresetError(d: DemoData, name: string): string | null {
  const n = name.trim();
  if (n === '') return '名前を入れてください';
  if (n.length > PRESET_NAME_MAX) return `名前は${PRESET_NAME_MAX}文字までです`;
  if (d.presets.length >= MAX_PRESETS) return `プリセットは${MAX_PRESETS}つまでです。使わないものを消してください`;
  return null;
}

/**
 * 条件の重みを、新しいプリセットとして最後に足す（足せなければそのまま返す）。from が 'trial' なら この日だけ試す重み（data.rules）、
 * 'basis' なら点数の基準の重み（条件の重みの画面。ADR-0035）
 */
export function addPresetFromRules(d: DemoData, name: string, note = '', from: 'trial' | 'basis' = 'trial'): DemoData {
  if (addPresetError(d, name)) return d;
  const used = new Set(d.presets.map((p) => p.id));
  let id = newId('p');
  while (used.has(id)) id = newId('p');
  const preset: Preset = {
    id,
    name: name.trim(),
    note: note.trim().slice(0, PRESET_NOTE_MAX),
    weights:
      from === 'basis'
        ? copyWeights(scorePresetOf(d.presets, d.scorePresetId)?.weights ?? weightsFromRules(d.rules))
        : weightsFromRules(d.rules),
  };
  return { ...d, presets: [...d.presets, preset] };
}

/**
 * この日だけ試す重み（data.rules）を点数の基準の重みにそろえる（ADR-0035）。基準（ふだんの考え方）の重み・必須が変わったら呼ぶ。
 * 条件の追加・削除・名前はそのまま。基準と同じなら同じものを返す
 */
export function withBasisRules(d: DemoData): DemoData {
  const rules = scoreRulesOf(d);
  return JSON.stringify(rules) === JSON.stringify(d.rules) ? d : { ...d, rules };
}

/**
 * プリセットを消す（最後の1つは消さない）。点数の基準のプリセットを消したら、基準は残りの先頭に移り、
 * 試す重みも新しい基準にそろえる（ADR-0010・ADR-0035）
 */
export function removePreset(d: DemoData, id: string): DemoData {
  if (d.presets.length <= 1) return d;
  const presets = d.presets.filter((p) => p.id !== id);
  const scorePresetId = presets.some((p) => p.id === d.scorePresetId) ? d.scorePresetId : presets[0]?.id;
  const next = { ...d, presets, scorePresetId };
  return scorePresetId === d.scorePresetId ? next : withBasisRules(next);
}

/** 点数の基準のプリセットを変える（ADR-0010。無い id なら変えない）。試す重みも新しい基準にそろえる（ADR-0035） */
export function setScorePreset(d: DemoData, id: string): DemoData {
  if (!d.presets.some((p) => p.id === id) || d.scorePresetId === id) return d;
  return withBasisRules({ ...d, scorePresetId: id });
}

/**
 * プリセットの名前・一言・重みを変える。点数の基準のプリセットの重み・必須を変えたら、試す重みも基準にそろえる（ADR-0035。
 * まとめて作る・自動作成・日の作り直しの既定がそろう）
 */
export function patchPreset(d: DemoData, id: string, patch: Partial<Omit<Preset, 'id'>>): DemoData {
  const next = { ...d, presets: d.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
  const basis = scorePresetOf(d.presets, d.scorePresetId);
  return patch.weights && basis?.id === id ? withBasisRules(next) : next;
}

/**
 * 条件の重みの画面（＝点数の基準の重みを直す画面。ADR-0035）で、型の重み・必須を変える：基準のプリセットのその型を変え、
 * 試す重みも基準にそろえる。プリセットが0件（ありえない）なら、その型の条件をそのまま変える
 */
export function setBasisWeight(
  d: DemoData,
  type: RuleType,
  patch: Partial<{ weight: number; hard: boolean }>,
): DemoData {
  const basis = scorePresetOf(d.presets, d.scorePresetId);
  if (!basis) return { ...d, rules: d.rules.map((r) => (r.type === type ? { ...r, ...patch } : r)) };
  return patchPreset(d, basis.id, { weights: { ...basis.weights, [type]: { ...basis.weights[type], ...patch } } });
}

/**
 * この日だけ試す重みが当てはまるプリセット（ADR-0035）。基準に当てはまれば基準を先に（同じ重みのプリセットが2つあっても基準を出す）、
 * 無ければほかのプリセット（並びの先）、どれでもなければ null
 */
export function trialPresetOf(d: Pick<DemoData, 'rules' | 'presets' | 'scorePresetId'>): Preset | null {
  const ruler = scorePresetOf(d.presets, d.scorePresetId);
  return ruler && matchesPreset(d.rules, ruler) ? ruler : presetOf(d.rules, d.presets);
}

/**
 * 条件を足す（条件の重みの画面。ADR-0035）。重み・必須は、試す重みが当てはまるプリセット（無ければ基準のプリセット）のその型。
 * 試す重みが当てはまるプリセットのまま、基準と同じなら基準のままになる。プリセットが0件（ありえない）なら fallback。
 * 必須にできない型は必須にしない
 */
export function addRule(
  d: DemoData,
  rule: Pick<Rule, 'id' | 'type' | 'label'>,
  fallback: { weight: number; hard: boolean },
): DemoData {
  const p = trialPresetOf(d) ?? scorePresetOf(d.presets, d.scorePresetId);
  const w = p?.weights[rule.type] ?? fallback;
  const added: Rule = { ...rule, weight: w.weight, hard: HARDABLE.has(rule.type) && w.hard };
  return { ...d, rules: [...d.rules, added] };
}

/** 初期の3種に戻す（点数の基準も先頭の「標準」に戻し、試す重みもそろえる） */
export function resetPresets(d: DemoData): DemoData {
  const presets = initialPresets();
  return withBasisRules({ ...d, presets, scorePresetId: presets[0]?.id });
}
