import { useState } from 'react';
import { Check, WeightSlider } from '../components/parts';
import { HARDABLE, RULE_TYPES, type Rule, type RuleType } from '../contracts/rules';
import { newId, ruleTypeHelp, ruleTypeLabel, weightLocked } from '../lib/common';
import { useDemoData } from '../store';

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
      <h2>条件</h2>
      <div className="card stack">
        <p className="sub">
          AI案は「移動時間＋条件の点」の合計がいちばん低くなる割当を探します。点は移動1分＝1点、
          <strong>重み1＝1件あたり移動10分ぶん</strong>
          （重み5＝50分ぶん）。重み0の条件は使いません。必須にした条件は、点ではなく「守らなければ担当にしない」になります。
          時間の約束と稼働時間帯はいつも必須です。
        </p>
        <div className="table-scroll">
          <table className="rules-table">
            <thead>
              <tr>
                <th>名前</th>
                <th>種類と説明</th>
                <th style={{ width: 220 }}>重み</th>
                <th>必須</th>
                <th />
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
                      <span className="chip">{ruleTypeLabel(r.type, terms)}</span>
                      <div className="sub rule-help">{ruleTypeHelp(r.type, terms)}</div>
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
                        <Check checked={r.hard} onChange={(v) => setRule(r.id, { hard: v })}>
                          必須
                        </Check>
                      ) : (
                        <span className="sub">—</span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="btn btn-small" onClick={() => remove(r)}>
                        消す
                      </button>
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
            条件を足す
          </button>
        </div>
        <p className="sub">{ruleTypeHelp(addType, terms)}</p>
      </div>

      <div className="card stack" style={{ maxWidth: 560 }}>
        <h3>乱数の種</h3>
        <p className="sub">AI案は同じデータ・同じ種からは同じ案になります。種を変えると、別の探し方で案を作ります。</p>
        <div className="row">
          <input
            style={{ maxWidth: 200 }}
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
