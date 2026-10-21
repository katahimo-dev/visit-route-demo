import {
  Dices,
  Heart,
  HeartHandshake,
  Hourglass,
  LayoutGrid,
  type LucideIcon,
  Pencil,
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
import { useConfirm } from '../components/ConfirmDialog';
import { WeightSlider } from '../components/parts';
import { Term } from '../components/Term';
import { Hint, IconButton, PageHeader, SectionTitle, WithIcon } from '../components/ui';
import { HARDABLE, MAX_PRESETS, type Preset, RULE_TYPES, type Rule, type RuleType } from '../contracts/rules';
import { newId, ruleTypeHelp, ruleTypeLabel, weightLocked } from '../lib/common';
import {
  addRule,
  PRESET_NAME_MAX,
  PRESET_NOTE_MAX,
  patchPreset,
  removePreset,
  resetPresets,
  setBasisWeight,
  setScorePreset,
  trialPresetOf,
} from '../lib/presets';
import { useFeature } from '../lib/useFeature';
import { scorePresetOf, scoreRulesOf } from '../seed';
import { useDemoData } from '../store';
import { SavePresetForm, SCORE_TEXT } from './planParts';
import './settings.css';
import { narrowRole } from '../lib/narrowRoles';

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
 * 条件（ルール）の一覧。ClassClassify の Setup にならい、重み 0〜5（0.5刻み、0 で半透明＝無効）と必須の切り替え。
 * この画面の重み・必須は点数の基準のプリセット（ふだんの考え方）のもの（ADR-0035。PRD D233）：変えると基準のプリセットの
 * その型を直し、この日だけ試す重み（data.rules）も基準にそろえる。月のまとめて作る・自動作成・作り直しはこの重みで作る
 */
/**
 * 相性（ADR-0028 の compat）を切っているときは「相性」の条件を出さない（計算からも外れる。条件のデータは消さない）
 */
function useShownTypes(): { compatOn: boolean; shownTypes: readonly RuleType[] } {
  const compatOn = useFeature('compat');
  return { compatOn, shownTypes: compatOn ? RULE_TYPES : RULE_TYPES.filter((t) => t !== 'compatibility') };
}

export default function RulesPage() {
  const { data, update } = useDemoData();
  const { compatOn, shownTypes } = useShownTypes();
  const confirmDialog = useConfirm();
  const terms = data.org.terms;
  const [addType, setAddType] = useState<RuleType>('clientPreference');
  const [seedText, setSeedText] = useState<string | null>(null);

  /** 点数の基準のプリセット（この画面で重みを直す相手。ADR-0035） */
  const basis = scorePresetOf(data.presets, data.scorePresetId);
  /** 表に出す条件：名前・種類は条件のまま、重み・必須は基準のプリセットのもの */
  const shownRules = scoreRulesOf(data);
  const setLabel = (id: string, label: string) =>
    update((d) => ({ ...d, rules: d.rules.map((r) => (r.id === id ? { ...r, label } : r)) }));
  const setWeight = (type: RuleType, patch: Partial<{ weight: number; hard: boolean }>) =>
    update((d) => setBasisWeight(d, type, patch));
  const add = () => {
    // 足す条件の重み・必須は、押した時点のデータで決める（試す重みが当てはまるプリセット、無ければ基準のその型。lib/presets の addRule）
    const rule = { id: newId('r'), type: addType, label: ruleTypeLabel(addType, terms) };
    update((d) => addRule(d, rule, DEFAULTS[addType]));
  };
  const remove = async (r: Rule) => {
    // 必須の条件は、消すと「守らなければ担当にしない」が無くなることを本文で伝える（PRD D271）
    const hard = HARDABLE.has(r.type) && shownRules.find((x) => x.id === r.id)?.hard === true;
    if (
      !(await confirmDialog({
        title: `条件「${r.label}」を消しますか？`,
        body: hard
          ? '必須の条件です。消すと「守らなければ担当にしない」決まりが無くなり、合わない人にも担当が入ることがあります。'
          : undefined,
        confirmLabel: '消す',
        tone: 'danger',
      }))
    )
      return;
    update((d) => ({ ...d, rules: d.rules.filter((x) => x.id !== r.id) }));
  };
  const seedValue = seedText ?? String(data.seed);
  const seedOk = /^-?\d+$/.test(seedValue.trim()) && Number.isSafeInteger(Number(seedValue));

  return (
    <div className="stack">
      <PageHeader
        icon={SlidersHorizontal}
        title="条件の重み"
        lead="ふだんの考え方（点数の基準）の重み。月のまとめて作る・自動作成・作り直しはこの重みで作ります"
      />
      <div className="card stack">
        <Hint label="点のしくみ">
          AI案は「移動時間＋条件の点」の合計がいちばん低くなる割当を探します。点は移動1分＝1点、
          <strong>重み1＝1件あたり移動10分ぶん</strong>
          （重み5＝50分ぶん）。重み0の条件は使いません。必須にした条件は、点ではなく「守らなければ担当にしない」になります。
          時間の約束と稼働時間帯はいつも必須です。 画面の合計点は、この合計を高いほど良い点数（{SCORE_TEXT}
          ）に直して出します。
        </Hint>
        <p className="sub" data-testid="rules-basis">
          直しているのは
          <Term k="scoreBase" testId="term-score-base" />
          のプリセット「<strong>{basis?.name ?? '—'}</strong>
          」の重みです（基準は下のプリセットの節で替えられます）。同じ種類の条件は同じ重みになります。
        </p>
        <p className="sub" data-testid="rules-trial-note">
          {
            '日の予定の右の欄の「この日だけ試す重み」は、その日の「AI にもう一度作らせる」だけに使い、ここで直すと基準に戻ります。'
          }
        </p>
        {/* 狭い画面（600px 以下）では行をカードにする（PRD D220。名前と必須が1行目、種類・重みは見出し付きの行、消すは右下） */}
        <div className="table-scroll">
          <table {...narrowRole.table} className="rules-table narrow-cards" data-testid="narrow-rules">
            <thead {...narrowRole.rowgroup}>
              <tr {...narrowRole.row}>
                <th {...narrowRole.columnheader}>名前</th>
                <th {...narrowRole.columnheader}>種類</th>
                <th {...narrowRole.columnheader} style={{ width: 220 }}>
                  重み
                </th>
                <th {...narrowRole.columnheader}>必須</th>
                <th {...narrowRole.columnheader} aria-label="操作" />
              </tr>
            </thead>
            <tbody {...narrowRole.rowgroup}>
              {shownRules
                .filter((r) => compatOn || r.type !== 'compatibility')
                .map((r) => {
                  const hardable = HARDABLE.has(r.type);
                  const hard = hardable && r.hard;
                  const locked = weightLocked(r);
                  return (
                    <tr {...narrowRole.row} key={r.id} className={r.weight === 0 && !hard ? 'is-dim' : ''}>
                      <td {...narrowRole.cell} style={{ minWidth: 160 }} className="narrow-title" data-label="名前">
                        <RuleName
                          value={r.label}
                          onChange={(label) => setLabel(r.id, label)}
                          fallback={ruleTypeLabel(r.type, terms)}
                        />
                      </td>
                      <td {...narrowRole.cell} data-label="種類">
                        <span className="chip chip-type">
                          <WithIcon icon={RULE_ICONS[r.type]} size={14}>
                            {ruleTypeLabel(r.type, terms)}
                          </WithIcon>
                        </span>
                        <Hint ariaLabel={`${r.label}の説明`}>{ruleTypeHelp(r.type, terms)}</Hint>
                      </td>
                      <td {...narrowRole.cell} data-label="重み">
                        <WeightSlider
                          label={r.label}
                          value={r.weight}
                          disabled={locked}
                          onChange={(w) => setWeight(r.type, { weight: w })}
                        />
                        {!locked && (
                          <span className="sub">{r.weight === 0 ? '無効' : `移動${r.weight * 10}分ぶん`}</span>
                        )}
                      </td>
                      <td {...narrowRole.cell} className={hardable ? 'nowrap narrow-head' : 'nowrap'} data-label="必須">
                        {hardable ? (
                          <label className={`hard-toggle${r.hard ? ' is-on' : ''}`}>
                            <input
                              type="checkbox"
                              checked={r.hard}
                              onChange={(e) => setWeight(r.type, { hard: e.target.checked })}
                            />
                            <WithIcon icon={ShieldCheck} size={14}>
                              必須
                            </WithIcon>
                          </label>
                        ) : (
                          <span className="sub">—</span>
                        )}
                      </td>
                      <td {...narrowRole.cell} className="narrow-act">
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
              {shownTypes.map((t) => (
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

      {/* 乱数の種はふだん使わないので「詳細設定」に畳む（PRD D174。開いたかどうかは保存しない） */}
      <details className="card seed-card rules-advanced" data-testid="rules-advanced">
        <summary className="rules-advanced-summary">
          <Dices size={16} aria-hidden="true" />
          詳細設定
          <span className="sub">（乱数の種）</span>
        </summary>
        <p className="sub">
          <Term k="seed" testId="term-seed" />
          ：AI案は同じデータ・同じ種からは同じ案になります。種を変えると、別の探し方で案を作ります。ふだんは変えなくてかまいません。
        </p>
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
      </details>
    </div>
  );
}

/**
 * 条件の名前（PRD D271）：ふだんは文字で出し、［名前を変える］で入力欄にする（誤って書き換えない）。Enter・欄を離れると
 * 決め、Esc で取り消す。空の名前は保存しない（契約は1文字以上。空のまま保存されると、次に開いたときデータ全体が読めずに
 * 初期状態へ戻ってしまう）。空のまま決めたら型の名前に戻す
 */
function RuleName({ value, onChange, fallback }: { value: string; onChange: (v: string) => void; fallback: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  /** 閉じたあと（Esc・Enter）に来る blur で、もう一度決めない */
  const closing = useRef(false);
  /** 入力をやめる。キーで閉じたら［名前を変える］へフォーカスを戻す（描き直したあと。欄を離れたときは移った先のまま） */
  const close = (focusBack: boolean) => {
    closing.current = true;
    setDraft(null);
    if (focusBack) requestAnimationFrame(() => btnRef.current?.focus());
  };
  const commit = (focusBack: boolean) => {
    if (draft === null || closing.current) return;
    const t = draft.trim();
    onChange(t ? t.slice(0, 40) : fallback);
    close(focusBack);
  };
  if (draft === null)
    return (
      <span className="rule-name">
        <strong className="rule-name-text" data-testid="rule-name">
          {value}
        </strong>
        <button
          ref={btnRef}
          type="button"
          className="btn btn-text btn-small rule-rename"
          onClick={() => {
            closing.current = false;
            setDraft(value);
          }}
          aria-label={`条件「${value}」の名前を変える`}
          data-testid="rule-rename"
        >
          <WithIcon icon={Pencil} size={14}>
            名前を変える
          </WithIcon>
        </button>
      </span>
    );
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: ［名前を変える］を押した直後に打てるよう、出した入力欄へ移す
      autoFocus
      value={draft}
      maxLength={40}
      aria-label="条件の名前"
      data-testid="rule-name-input"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(true);
        } else if (e.key === 'Escape') {
          // 右の欄などの Esc に渡さない
          e.preventDefault();
          e.stopPropagation();
          close(true);
        }
      }}
      onBlur={() => commit(false)}
    />
  );
}

/**
 * 条件のプリセット（D20・D24・D235。ADR-0008・ADR-0035）。名前・一言・型ごとの重み・必須を変えるとすぐ保存。
 * 消す（最後の1つは消せない）・基準の重みを写して保存（6つまで）・初期値に戻す
 */
function PresetSection() {
  const { shownTypes } = useShownTypes();
  const { data, update } = useDemoData();
  const confirmDialog = useConfirm();
  const terms = data.org.terms;
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  /** この日だけ試す重みが当てはまるプリセット（基準を先に見る） */
  const current = trialPresetOf(data);
  /** 点数の基準のプリセット（ADR-0010） */
  const ruler = scorePresetOf(data.presets, data.scorePresetId);
  // 予定の画面の「プリセットを編集する」（#/rules#presets）から来たら、この節を見せる
  useEffect(() => {
    if (location.hash === '#presets') ref.current?.scrollIntoView({ block: 'start' });
  }, [location.hash]);
  const set = (id: string, patch: Partial<Omit<Preset, 'id'>>) => update((d) => patchPreset(d, id, patch));
  const setWeight = (p: Preset, t: RuleType, w: Partial<{ weight: number; hard: boolean }>) =>
    set(p.id, { weights: { ...p.weights, [t]: { ...p.weights[t], ...w } } });
  const remove = async (p: Preset) => {
    if (data.presets.length <= 1) return;
    const next = data.presets.find((x) => x.id !== p.id);
    const moved =
      ruler?.id === p.id && next
        ? `\n点数の基準は「${next.name}」に移ります（点数が変わります）。この日だけ試す重みも基準に戻ります。`
        : '';
    const ok = await confirmDialog({
      title: `プリセット「${p.name}」を消しますか？`,
      body: `作った案の記録は残ります。${moved}`,
      confirmLabel: '消す',
      tone: 'danger',
    });
    if (!ok) return;
    update((d) => removePreset(d, p.id));
  };
  const reset = async () => {
    const ok = await confirmDialog({
      title: 'プリセットを初期の3つに戻しますか？',
      body: '初期の3つ（標準・移動を短く・人の組み合わせ重視）に戻します。足したプリセットは消え、点数の基準は「標準」になります。この日だけ試す重みも基準に戻ります。',
      confirmLabel: '初期の3つに戻す',
      tone: 'danger',
    });
    if (!ok) return;
    update(resetPresets);
  };
  return (
    <div className="card stack" ref={ref} data-testid="preset-section">
      <SectionTitle
        icon={LayoutGrid}
        aside={
          <Hint>
            日の予定のプリセットごとの案のカードに使い、点数の基準に選んだプリセットは月のまとめて作る・開いた日の自動作成・作り直しにも使います。条件の種類ごとに重み・必須を決め、カードを押すとその日の条件の同じ種類に当てます。
            {MAX_PRESETS}つまで。変えるとすぐ保存します。
          </Hint>
        }
      >
        <span>
          <Term k="preset" />（{data.presets.length}/{MAX_PRESETS}）
        </span>
      </SectionTitle>
      <fieldset className="score-ruler" data-testid="score-ruler-choice">
        <legend>
          点数の基準
          <Hint ariaLabel="点数の基準の説明">
            ここで選んだプリセットが、ふだんの考え方です。月のまとめて作る・自動作成・作り直しはこの重み・必須で作り、画面の点数（100点満点）もこの重み・必須で付けます。上の条件の重みの表は、このプリセットの重みを直します。日の予定でプリセットを押して試す重みを変えても、点数の付け方は変わりません。基準を替える・基準のプリセットの重みを変えると、試す重みも基準に戻ります。基準のプリセットを消すと、先頭のプリセットが基準になります。
          </Hint>
        </legend>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          {data.presets.map((p) => (
            <label key={p.id} className="score-ruler-option">
              <input
                type="radio"
                name="score-preset"
                value={p.id}
                checked={ruler?.id === p.id}
                onChange={() => update((d) => setScorePreset(d, p.id))}
              />
              {p.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="stack" style={{ gap: 8 }}>
        {data.presets.map((p, i) => (
          <details key={p.id} className="preset-edit" data-testid="preset-edit">
            <summary className="narrow-preset-summary">
              <span className="preset-no">{i + 1}</span>
              <strong>{p.name}</strong>
              {/* 日の予定で試している重みが基準と違うプリセットに当たるときだけ（ADR-0035） */}
              {current?.id === p.id && ruler?.id !== p.id && <span className="chip chip-primary">試す重み</span>}
              {ruler?.id === p.id && <span className="chip">点数の基準</span>}
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
                <table {...narrowRole.table} className="rules-table narrow-cards">
                  <thead {...narrowRole.rowgroup}>
                    <tr {...narrowRole.row}>
                      <th {...narrowRole.columnheader}>条件の種類</th>
                      <th {...narrowRole.columnheader} style={{ width: 220 }}>
                        重み
                      </th>
                      <th {...narrowRole.columnheader}>必須</th>
                    </tr>
                  </thead>
                  <tbody {...narrowRole.rowgroup}>
                    {shownTypes.map((t) => {
                      const w = p.weights[t];
                      const hardable = HARDABLE.has(t);
                      const locked = hardable && w.hard && t !== 'balance';
                      return (
                        <tr {...narrowRole.row} key={t} className={w.weight === 0 && !w.hard ? 'is-dim' : ''}>
                          <td {...narrowRole.cell} className="narrow-title" data-label="条件の種類">
                            <WithIcon icon={RULE_ICONS[t]} size={14}>
                              {ruleTypeLabel(t, terms)}
                            </WithIcon>
                          </td>
                          <td {...narrowRole.cell} data-label="重み">
                            <WeightSlider
                              label={`${p.name}の${ruleTypeLabel(t, terms)}`}
                              value={w.weight}
                              disabled={locked}
                              onChange={(weight) => setWeight(p, t, { weight })}
                            />
                          </td>
                          <td
                            {...narrowRole.cell}
                            className={hardable ? 'nowrap narrow-head' : 'nowrap'}
                            data-label="必須"
                          >
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
      <div className="row narrow-stack" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <SavePresetForm from="basis" />
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
