import {
  Dices,
  Heart,
  HeartHandshake,
  Hourglass,
  LayoutGrid,
  type LucideIcon,
  Plus,
  Repeat,
  RotateCcw,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { WeightSlider } from '../components/parts';
import { Hint, IconButton, PageHeader, SectionTitle, WithIcon } from '../components/ui';
import { HARDABLE, MAX_PRESETS, type Preset, RULE_TYPES, type Rule, type RuleType } from '../contracts/rules';
import { newId, ruleTypeHelp, ruleTypeLabel, weightLocked } from '../lib/common';
import { PRESET_NAME_MAX, PRESET_NOTE_MAX, patchPreset, removePreset, resetPresets } from '../lib/presets';
import { presetOf } from '../seed';
import { useDemoData } from '../store';
import { SavePresetForm, SCORE_TEXT } from './planParts';
import './settings.css';

/** 条件の種類ごとのアイコン（必要条件=盾、希望=ハート／いいね など） */
const RULE_ICONS: Record<RuleType, LucideIcon> = {
  clientRequirement: ShieldCheck,
  staffRequirement: ShieldCheck,
  clientPreference: Heart,
  staffPreference: ThumbsUp,
  compatibility: HeartHandshake,
  continuity: Repeat,
  balance: Scale,
  wait: Hourglass,
};

/** 型ごとの既定（design.md §5 の表）。足したときの初期値 */
const DEFAULTS: Record<RuleType, { weight: number; hard: boolean }> = {
  clientRequirement: { weight: 3, hard: true },
  clientPreference: { weight: 3, hard: false },
  staffRequirement: { weight: 3, hard: true },
  staffPreference: { weight: 2, hard: false },
  compatibility: { weight: 3, hard: false },
  continuity: { weight: 2, hard: false },
  balance: { weight: 3, hard: false },
  wait: { weight: 3, hard: false },
};

/**
 * 条件（ルール）の一覧。ClassClassify の Setup にならい、重み 0〜5（0.5刻み、0 で半透明＝無効）と必須の切り替え
 */
export default function RulesPage() {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const [addType, setAddType] = useState<RuleType>('clientPreference');
  const [seedText, setSeedText] = useState<string | null>(null);

  const setRule = (id: string, patch: Partial<Rule>) =>
    update((d) => ({ ...d, rules: d.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const add = () => {
    const rule: Rule = { id: newId('r'), type: addType, label: ruleTypeLabel(addType, terms), ...DEFAULTS[addType] };
    if (!HARDABLE.has(addType)) rule.hard = false;
    update((d) => ({ ...d, rules: [...d.rules, rule] }));
  };
  const remove = (r: Rule) => {
    if (!confirm(`条件「${r.label}」を消しますか？`)) return;
    update((d) => ({ ...d, rules: d.rules.filter((x) => x.id !== r.id) }));
  };
  const seedValue = seedText ?? String(data.seed);
  const seedOk = /^-?\d+$/.test(seedValue.trim()) && Number.isSafeInteger(Number(seedValue));

  return (
    <div className="stack">
      <PageHeader
        icon={SlidersHorizontal}
        title="条件"
        lead="重み1＝1件あたり移動10分ぶん。必須は守れなければ担当にしません"
      />
      <div className="card stack">
        <Hint label="点のしくみ">
          AI案は「移動時間＋条件の点」の合計がいちばん低くなる割当を探します。点は移動1分＝1点、
          <strong>重み1＝1件あたり移動10分ぶん</strong>
          （重み5＝50分ぶん）。重み0の条件は使いません。必須にした条件は、点ではなく「守らなければ担当にしない」になります。
          時間の約束と稼働時間帯はいつも必須です。 画面の合計点は、この合計を高いほど良い点数（{SCORE_TEXT}
          。機械的に割り当てた案＝0点）に直して出します。
        </Hint>
        <div className="table-scroll">
          <table className="rules-table">
            <thead>
              <tr>
                <th>名前</th>
                <th>種類</th>
                <th style={{ width: 220 }}>重み</th>
                <th>必須</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {data.rules.map((r) => {
                const hardable = HARDABLE.has(r.type);
                const hard = hardable && r.hard;
                const locked = weightLocked(r);
                return (
                  <tr key={r.id} className={r.weight === 0 && !hard ? 'is-dim' : ''}>
                    <td style={{ minWidth: 160 }}>
                      <LabelInput
                        value={r.label}
                        onChange={(label) => setRule(r.id, { label })}
                        fallback={ruleTypeLabel(r.type, terms)}
                      />
                    </td>
                    <td>
                      <span className="chip chip-type">
                        <WithIcon icon={RULE_ICONS[r.type]} size={14}>
                          {ruleTypeLabel(r.type, terms)}
                        </WithIcon>
                      </span>
                      <Hint ariaLabel={`${r.label}の説明`}>{ruleTypeHelp(r.type, terms)}</Hint>
                    </td>
                    <td>
                      <WeightSlider
                        label={r.label}
                        value={r.weight}
                        disabled={locked}
                        onChange={(w) => setRule(r.id, { weight: w })}
                      />
                      {!locked && <span className="sub">{r.weight === 0 ? '無効' : `移動${r.weight * 10}分ぶん`}</span>}
                    </td>
                    <td className="nowrap">
                      {hardable ? (
                        <label className={`hard-toggle${r.hard ? ' is-on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={r.hard}
                            onChange={(e) => setRule(r.id, { hard: e.target.checked })}
                          />
                          <WithIcon icon={ShieldCheck} size={14}>
                            必須
                          </WithIcon>
                        </label>
                      ) : (
                        <span className="sub">—</span>
                      )}
                    </td>
                    <td>
                      <IconButton
                        icon={Trash2}
                        label={`条件「${r.label}」を消す`}
                        tone="danger"
                        onClick={() => remove(r)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.rules.length === 0 && <p className="sub">条件がありません。移動時間だけで割り当てます。</p>}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label style={{ maxWidth: 260 }}>
            足す条件の種類
            <select value={addType} onChange={(e) => setAddType(e.target.value as RuleType)}>
              {RULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ruleTypeLabel(t, terms)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-end' }} onClick={add}>
            <WithIcon icon={Plus}>条件を足す</WithIcon>
          </button>
        </div>
        <Hint label="この種類の説明">{ruleTypeHelp(addType, terms)}</Hint>
      </div>

      <PresetSection />

      <div className="card seed-card">
        <SectionTitle icon={Dices}>乱数の種</SectionTitle>
        <Hint label="説明">
          AI案は同じデータ・同じ種からは同じ案になります。種を変えると、別の探し方で案を作ります。
        </Hint>
        <div className="row">
          <input
            className="seed-input"
            inputMode="numeric"
            value={seedValue}
            aria-label="乱数の種"
            onChange={(e) => {
              const t = e.target.value;
              setSeedText(t);
              if (/^-?\d+$/.test(t.trim()) && Number.isSafeInteger(Number(t))) {
                update((d) => ({ ...d, seed: Number(t) }));
              }
            }}
            onBlur={() => setSeedText(null)}
          />
          {!seedOk && <span className="error">整数で入れてください</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * 条件の名前の入力。空の名前は保存しない（契約は1文字以上。空のまま保存されると、次に開いたとき
 * データ全体が読めずに初期状態へ戻ってしまう）。空のまま離れたら型の名前に戻す
 */
function LabelInput({ value, onChange, fallback }: { value: string; onChange: (v: string) => void; fallback: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      value={draft ?? value}
      maxLength={40}
      aria-label="条件の名前"
      onChange={(e) => {
        const t = e.target.value;
        setDraft(t);
        if (t.trim()) onChange(t.slice(0, 40));
      }}
      onBlur={() => {
        if (draft !== null && !draft.trim()) onChange(fallback);
        setDraft(null);
      }}
    />
  );
}

/**
 * 条件のプリセット（D20・D24。ADR-0008）。名前・一言・型ごとの重み・必須を変えるとすぐ保存。
 * 消す（最後の1つは消せない）・いまの重みを保存（6つまで）・初期値に戻す
 */
function PresetSection() {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const current = presetOf(data.rules, data.presets);
  // AI案の画面の「プリセットを編集する」（#/rules#presets）から来たら、この節を見せる
  useEffect(() => {
    if (location.hash === '#presets') ref.current?.scrollIntoView({ block: 'start' });
  }, [location.hash]);
  const set = (id: string, patch: Partial<Omit<Preset, 'id'>>) => update((d) => patchPreset(d, id, patch));
  const setWeight = (p: Preset, t: RuleType, w: Partial<{ weight: number; hard: boolean }>) =>
    set(p.id, { weights: { ...p.weights, [t]: { ...p.weights[t], ...w } } });
  const remove = (p: Preset) => {
    if (data.presets.length <= 1) return;
    if (!confirm(`プリセット「${p.name}」を消しますか？（作った案の記録は残ります）`)) return;
    update((d) => removePreset(d, p.id));
  };
  const reset = () => {
    if (
      !confirm(
        'プリセットを初期の3つ（標準・移動を短く・人の組み合わせ重視）に戻します。足したプリセットは消えます。よろしいですか？',
      )
    )
      return;
    update(resetPresets);
  };
  return (
    <div className="card stack" ref={ref} data-testid="preset-section">
      <SectionTitle
        icon={LayoutGrid}
        aside={
          <Hint>
            AI案の画面のプリセットのボタンと、開いた日に自動で作る案に使います。条件の種類ごとに重み・必須を決め、押すとその日の条件の同じ種類に当てます。
            {MAX_PRESETS}つまで。変えるとすぐ保存します。
          </Hint>
        }
      >
        プリセット（{data.presets.length}/{MAX_PRESETS}）
      </SectionTitle>
      <div className="stack" style={{ gap: 8 }}>
        {data.presets.map((p, i) => (
          <details key={p.id} className="preset-edit" data-testid="preset-edit">
            <summary>
              <span className="preset-no">{i + 1}</span>
              <strong>{p.name}</strong>
              {current?.id === p.id && <span className="chip chip-primary">いまの重み</span>}
              <span className="sub ellipsis">{p.note}</span>
            </summary>
            <div className="stack" style={{ gap: 8, paddingTop: 8 }}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <div className="stack" style={{ maxWidth: 220, gap: 2 }}>
                  <span>名前</span>
                  <PresetText
                    value={p.name}
                    max={PRESET_NAME_MAX}
                    required
                    ariaLabel="プリセットの名前"
                    onChange={(name) => set(p.id, { name })}
                  />
                </div>
                <div className="stack" style={{ flex: 1, minWidth: 200, gap: 2 }}>
                  <span>一言</span>
                  <PresetText
                    value={p.note}
                    max={PRESET_NOTE_MAX}
                    ariaLabel="プリセットの一言"
                    onChange={(note) => set(p.id, { note })}
                  />
                </div>
              </div>
              <div className="table-scroll">
                <table className="rules-table">
                  <thead>
                    <tr>
                      <th>条件の種類</th>
                      <th style={{ width: 220 }}>重み</th>
                      <th>必須</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RULE_TYPES.map((t) => {
                      const w = p.weights[t];
                      const hardable = HARDABLE.has(t);
                      const locked = hardable && w.hard && t !== 'balance';
                      return (
                        <tr key={t} className={w.weight === 0 && !w.hard ? 'is-dim' : ''}>
                          <td>
                            <WithIcon icon={RULE_ICONS[t]} size={14}>
                              {ruleTypeLabel(t, terms)}
                            </WithIcon>
                          </td>
                          <td>
                            <WeightSlider
                              label={`${p.name}の${ruleTypeLabel(t, terms)}`}
                              value={w.weight}
                              disabled={locked}
                              onChange={(weight) => setWeight(p, t, { weight })}
                            />
                          </td>
                          <td className="nowrap">
                            {hardable ? (
                              <label className={`hard-toggle${w.hard ? ' is-on' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={w.hard}
                                  onChange={(e) => setWeight(p, t, { hard: e.target.checked })}
                                />
                                <WithIcon icon={ShieldCheck} size={14}>
                                  必須
                                </WithIcon>
                              </label>
                            ) : (
                              <span className="sub">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={data.presets.length <= 1}
                  title={data.presets.length <= 1 ? '最後の1つは消せません' : undefined}
                  onClick={() => remove(p)}
                >
                  <WithIcon icon={Trash2} size={14}>
                    このプリセットを消す
                  </WithIcon>
                </button>
              </div>
            </div>
          </details>
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <SavePresetForm />
        <button type="button" className="btn" onClick={reset}>
          <WithIcon icon={RotateCcw}>初期値に戻す</WithIcon>
        </button>
      </div>
    </div>
  );
}

/** プリセットの名前・一言の入力（名前は空のまま保存しない。空のまま離れたら元に戻す） */
function PresetText({
  value,
  max,
  required = false,
  ariaLabel,
  onChange,
}: {
  value: string;
  max: number;
  required?: boolean;
  ariaLabel: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      value={draft ?? value}
      maxLength={max}
      aria-label={ariaLabel}
      onChange={(e) => {
        const t = e.target.value;
        setDraft(t);
        if (!required || t.trim()) onChange(t.slice(0, max));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
