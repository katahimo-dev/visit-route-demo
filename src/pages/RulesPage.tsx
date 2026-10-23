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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useConfirm } from '../components/ConfirmDialog';
import { WeightSlider } from '../components/parts';
import { Term } from '../components/Term';
import { useToast } from '../components/Toast';
import { Hint, IconButton, PageHeader, SectionTitle, WithIcon } from '../components/ui';
import { useLeaveGuard } from '../components/useLeaveGuard';
import { HARDABLE, MAX_PRESETS, type Preset, RULE_TYPES, type Rule, type RuleType } from '../contracts/rules';
import { newId, ruleTypeHelp, ruleTypeLabel, weightLocked } from '../lib/common';
import {
  addRule,
  PRESET_NAME_MAX,
  PRESET_NOTE_MAX,
  patchPreset,
  removePreset,
  resetPresets,
  setScorePreset,
  trialPresetOf,
} from '../lib/presets';
import { useFeature } from '../lib/useFeature';
import {
  applyDraft,
  changeText,
  confirmBody,
  confirmedText,
  confirmTitle,
  draftChanges,
  editDraft,
  leaveDialog,
  pruneDraft,
  savedWeights,
  type WeightDraft,
  withDraft,
} from '../lib/weightDraft';
import { scorePresetOf, scoreRulesOf } from '../seed';
import { useDemoData } from '../store';
import { SavePresetForm, SCORE_TEXT } from './planParts';
import './settings.css';
import { SettingsTabs } from '../components/SettingsTabs';
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
 * この画面の重み・必須は点数の基準のプリセット（ふだんの考え方）のもの（ADR-0035。PRD D233）：確定すると基準のプリセットの
 * その型を直し、条件（data.rules）も基準にそろえる。AI で組む・点数・検査はこの重みで計算する（版2：重みは1組）。
 * 表の重み・必須は動かしても保存せず、画面の中の下書きに置く（PRD D286。ADR-0048）。保存済みと違う行は注意の色と「変更あり 3→4」、
 * 「変更を確定（N件）」で確認（変わる重みと影響する日）のあとまとめて書く。「取り消す」で捨てる。下書きのまま画面を離れるときは確かめる
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
  const toast = useToast();

  /** 点数の基準のプリセット（この画面で重みを直す相手。ADR-0035） */
  const basis = scorePresetOf(data.presets, data.scorePresetId);
  /** 保存済みの条件：名前・種類は条件のまま、重み・必須は基準のプリセットのもの */
  const savedRules = useMemo(() => scoreRulesOf(data), [data]);
  const saved = useMemo(() => savedWeights(savedRules), [savedRules]);
  /**
   * 重みの下書き（PRD D286）。直している基準のプリセットの id と組にし、基準が替わったら（ラジオ・基準のプリセットを消す）捨てる。
   * その型の条件が無くなった型・保存済みと同じ値になった型は外す（pruneDraft）
   */
  const [rawDraft, setRawDraft] = useState<{ basisId: string | null; values: WeightDraft }>({
    basisId: null,
    values: {},
  });
  const basisId = basis?.id ?? null;
  /** 最新の基準（確認を待つ間に別のタブで替わったかを見る） */
  const basisRef = useRef(basisId);
  basisRef.current = basisId;
  const draft = useMemo(
    () => (rawDraft.basisId === basisId ? pruneDraft(rawDraft.values, saved) : NO_DRAFT),
    [rawDraft, basisId, saved],
  );
  // 外した型は state からも消す（同じ型の条件をあとで足しても古い下書きが戻らない）
  useEffect(() => {
    if (draft !== rawDraft.values) setRawDraft({ basisId, values: draft });
  }, [draft, rawDraft.values, basisId]);
  /** 表に出す条件（下書きを当てたもの） */
  const shownRules = useMemo(() => withDraft(savedRules, draft), [savedRules, draft]);
  const changes = useMemo(() => draftChanges(savedRules, draft), [savedRules, draft]);
  const changeOf = (type: RuleType) => changes.find((c) => c.type === type);
  const setLabel = (id: string, label: string) =>
    update((d) => ({ ...d, rules: d.rules.map((r) => (r.id === id ? { ...r, label } : r)) }), '条件の名前');
  const setWeight = (type: RuleType, patch: Partial<{ weight: number; hard: boolean }>) =>
    setRawDraft({ basisId, values: editDraft(draft, saved, type, patch) });
  /** 確定・取り消しのあと、押したボタンが消えるのでフォーカスを画面の見出しへ（確認が閉じて裏の inert が外れてから） */
  const [focusHead, setFocusHead] = useState(0);
  useEffect(() => {
    if (focusHead === 0) return;
    const id = requestAnimationFrame(() => {
      const h = document.querySelector<HTMLElement>('.app-main h1');
      if (!h) return;
      if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [focusHead]);
  const discard = () => {
    setRawDraft({ basisId, values: {} });
    setFocusHead((n) => n + 1);
    toast('重みの変更を取り消しました');
  };
  const confirmDraft = async () => {
    const list = changes;
    const values = draft;
    if (list.length === 0) return;
    const name = basis?.name ?? '点数の基準';
    const ok = await confirmDialog({
      title: confirmTitle(list.length),
      body: confirmBody(list, name),
      confirmLabel: '確定する',
      cancelLabel: '編集を続ける',
    });
    if (!ok) return;
    // 確認の間に別のタブで点数の基準が替わったら書かない（下書きは前の基準の重み。替わった基準では捨てられる）
    if (basisRef.current !== basisId) {
      toast('点数の基準が替わったので、重みの変更は確定しませんでした');
      return;
    }
    update(
      (d) => (scorePresetOf(d.presets, d.scorePresetId)?.id === basisId ? applyDraft(d, values) : d),
      '条件の重みを確定',
    );
    setRawDraft({ basisId, values: {} });
    setFocusHead((n) => n + 1);
    toast(confirmedText(list.length, name));
  };
  // 下書きのまま画面を離れる（リンク・パレット・再読込・タブを閉じる）ときは確かめる
  useLeaveGuard(changes.length > 0, leaveDialog(changes.length));
  const add = () => {
    // 足す条件の重み・必須は、押した時点のデータで決める（試す重みが当てはまるプリセット、無ければ基準のその型。lib/presets の addRule）
    const rule = { id: newId('r'), type: addType, label: ruleTypeLabel(addType, terms) };
    update((d) => addRule(d, rule, DEFAULTS[addType]), '条件を足す');
  };
  const remove = async (r: Rule) => {
    // 必須の条件は、消すと「守らなければ担当にしない」が無くなることを本文で伝える（PRD D271）
    const hard = HARDABLE.has(r.type) && savedRules.find((x) => x.id === r.id)?.hard === true;
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
    update((d) => ({ ...d, rules: d.rules.filter((x) => x.id !== r.id) }), '条件を消す');
  };
  const seedValue = seedText ?? String(data.seed);
  /** 打った乱数の種を書く（整数でなければ書かない） */
  const commitSeed = () => {
    const t = seedText;
    if (t === null || !/^-?\d+$/.test(t.trim()) || !Number.isSafeInteger(Number(t))) return;
    const n = Number(t);
    update((d) => (d.seed === n ? d : { ...d, seed: n }), '乱数の種');
  };
  const seedOk = /^-?\d+$/.test(seedValue.trim()) && Number.isSafeInteger(Number(seedValue));

  return (
    <div className="stack">
      <PageHeader
        nav={<SettingsTabs />}
        icon={SlidersHorizontal}
        title="条件の重み"
        lead="ふだん使う重みを決めます。AI で組む・点数・要対応の検査に、この重みを使います"
      />
      <div className="card stack">
        <Hint label="点のしくみ">
          <ul className="hint-list">
            <li>AI は、移動と条件の点の合計がいちばん少ない割当を探します。</li>
            <li>
              移動1分が1点です。<strong>重み1は、訪問1件あたり移動10分ぶん</strong>です（重み5なら50分ぶん）。
            </li>
            <li>重み0の条件は使いません。</li>
            <li>「必須」にした条件は、守れない人を担当にしません。約束の時間と働ける時間は、いつも必須です。</li>
            <li>画面の点数は、{SCORE_TEXT}です。高いほど良い組み方です。</li>
          </ul>
        </Hint>
        <p className="sub" data-testid="rules-basis">
          直しているのは
          <Term k="scoreBase" testId="term-score-base" />
          の「<strong>{basis?.name ?? '—'}</strong>
          」の重みです。基準は下のプリセットの節で替えられます。同じ種類の条件は同じ重みになります。
        </p>
        <p className="sub" data-testid="rules-trial-note">
          重みを変えても今の担当は変わりません。日の予定の「AI
          で組む」で、この重みの提案（点の差つき）を出して反映できます。
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
                  const change = changeOf(r.type);
                  const cls = [r.weight === 0 && !hard ? 'is-dim' : '', change ? 'is-draft' : ''].filter(Boolean);
                  return (
                    <tr
                      {...narrowRole.row}
                      key={r.id}
                      className={cls.join(' ') || undefined}
                      data-draft={change ? 1 : undefined}
                    >
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
                        {/* 保存済みと違う行は色だけでなく文字でも（PRD D286） */}
                        {change && (
                          <span className="chip chip-warn draft-mark" data-testid="rules-draft-mark">
                            変更あり {changeText(change)}
                          </span>
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
          {/* 主ボタンは画面に1つ：重みの下書きがある間は「変更を確定」を主にし、こちらは枠にする（AGENTS.md） */}
          <button
            type="button"
            className={changes.length > 0 ? 'btn' : 'btn btn-primary'}
            style={{ alignSelf: 'flex-end' }}
            onClick={add}
          >
            <WithIcon icon={Plus}>条件を足す</WithIcon>
          </button>
        </div>
        <Hint label="この種類の説明">{ruleTypeHelp(addType, terms)}</Hint>
      </div>

      <PresetSection draftCount={changes.length} onReset={() => setRawDraft({ basisId, values: {} })} />

      {/* 乱数の種はふだん使わないので「詳細設定」に畳む（PRD D174。開いたかどうかは保存しない） */}
      <details className="card seed-card rules-advanced" data-testid="rules-advanced">
        <summary className="rules-advanced-summary">
          <Dices size={16} aria-hidden="true" />
          詳細設定
          <span className="sub">（乱数の種）</span>
        </summary>
        <p className="sub">
          <Term k="seed" testId="term-seed" />
          ：AI
          は同じデータ・同じ種からは同じ提案を出します。種を変えると、別の探し方で組みます。ふだんは変えなくてかまいません。
        </p>
        <div className="row">
          <input
            className="seed-input"
            inputMode="numeric"
            value={seedValue}
            aria-label="乱数の種"
            onChange={(e) => setSeedText(e.target.value)}
            // 書くのは確定したとき（離れる・Enter）の1回だけ（全体の「元に戻す」の1手。打つたびに積まない。PRD D329）
            onBlur={() => {
              commitSeed();
              setSeedText(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitSeed();
            }}
          />
          {!seedOk && <span className="error">整数で入れてください</span>}
        </div>
      </details>

      {/* 重みの下書きがある間だけ：画面の下に貼り付く確定の帯（下のタブの上。巻いても押せる。印刷では出さない） */}
      {changes.length > 0 && (
        <section className="rules-draft-bar" aria-label="確定していない重みの変更" data-testid="rules-draft-bar">
          <p className="rules-draft-text">
            <span className="chip chip-warn">変更あり</span>
            <span>重みの変更は、確定するまで保存しません</span>
          </p>
          <span className="rules-draft-actions">
            <button type="button" className="btn btn-text" onClick={discard} data-testid="rules-draft-discard">
              取り消す
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void confirmDraft()}
              data-testid="rules-draft-confirm"
            >
              変更を確定（{changes.length}件）
            </button>
          </span>
        </section>
      )}
    </div>
  );
}

/** 下書きが無いとき（基準が替わったとき）の空の下書き */
const NO_DRAFT: WeightDraft = {};

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
    const next = t ? t.slice(0, 40) : fallback;
    // 名前が変わっていなければ書かない
    if (next !== value) onChange(next);
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
        // 変換中の Enter（確定）・Esc（取り消し）は変換のもの（ほかの部品と同じ）
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
function PresetSection({ draftCount, onReset }: { draftCount: number; onReset: () => void }) {
  const { shownTypes } = useShownTypes();
  const { data, update } = useDemoData();
  const confirmDialog = useConfirm();
  const terms = data.org.terms;
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  /** 条件の重みが当てはまるプリセット（基準を先に見る。版2ではいつも基準） */
  const current = trialPresetOf(data);
  /** 点数の基準のプリセット（ADR-0010） */
  const ruler = scorePresetOf(data.presets, data.scorePresetId);
  // 予定の画面の「プリセットを編集する」（#/rules#presets）から来たら、この節を見せる
  useEffect(() => {
    if (location.hash === '#presets') ref.current?.scrollIntoView({ block: 'start' });
  }, [location.hash]);
  const set = (id: string, patch: Partial<Omit<Preset, 'id'>>) => update((d) => patchPreset(d, id, patch));
  /** 確定していない重みの変更を捨てることの断り（基準を替える・基準のプリセットを消すとき） */
  const dropNote = draftCount > 0 ? `\n確定していない重みの変更（${draftCount}件）は捨てます。` : '';
  /** 点数の基準を替える。重みの下書きがあれば、捨てることを確かめてから（黙って捨てない。PRD D286） */
  const choose = async (p: Preset) => {
    if (ruler?.id === p.id) return;
    if (draftCount > 0) {
      const ok = await confirmDialog({
        title: `点数の基準を「${p.name}」に替えますか？`,
        body: `確定していない重みの変更（${draftCount}件）は捨てます。`,
        confirmLabel: '捨てて替える',
        cancelLabel: '編集を続ける',
        tone: 'danger',
      });
      if (!ok) return;
    }
    update((d) => setScorePreset(d, p.id), '点数の基準のプリセット');
  };
  const setWeight = (p: Preset, t: RuleType, w: Partial<{ weight: number; hard: boolean }>) =>
    set(p.id, { weights: { ...p.weights, [t]: { ...p.weights[t], ...w } } });
  const remove = async (p: Preset) => {
    if (data.presets.length <= 1) return;
    const next = data.presets.find((x) => x.id !== p.id);
    const moved =
      ruler?.id === p.id && next ? `\n点数の基準は「${next.name}」に移り、点数が変わります。${dropNote}` : '';
    const ok = await confirmDialog({
      title: `プリセット「${p.name}」を消しますか？`,
      body: `今の担当はそのままです。${moved}`,
      confirmLabel: '消す',
      tone: 'danger',
    });
    if (!ok) return;
    update((d) => removePreset(d, p.id), 'プリセットを消す');
  };
  const reset = async () => {
    const ok = await confirmDialog({
      title: 'プリセットを初期の3つに戻しますか？',
      body: `初期の3つ（標準・移動を短く・人の組み合わせ重視）に戻します。足したプリセットは消え、点数の基準は「標準」になります。${dropNote}`,
      confirmLabel: '初期の3つに戻す',
      tone: 'danger',
    });
    if (!ok) return;
    update(resetPresets, 'プリセットを初めに戻す');
    // 初期の3つに戻したら、表の重みの下書きも捨てる（戻した重みと比べる下書きは意味が変わるので）
    onReset();
  };
  return (
    <div className="card stack" ref={ref} data-testid="preset-section">
      <SectionTitle
        icon={LayoutGrid}
        aside={
          <Hint>
            <ul className="hint-list">
              <li>日の予定で、プリセットで試して提案を比べられます（比べた提案は保存しません）。</li>
              <li>点数の基準に選んだプリセットの重みで、AI で組みます。</li>
              <li>{MAX_PRESETS}つまで作れます。変えるとすぐ保存します。</li>
            </ul>
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
            <ul className="hint-list">
              <li>ここで選んだプリセットが、ふだん使う重みです。</li>
              <li>AI で組む・点数・要対応の検査に、この重みを使います。</li>
              <li>上の表で直すのは、このプリセットの重みです。</li>
            </ul>
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
                onChange={() => void choose(p)}
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
              {current?.id === p.id && ruler?.id !== p.id && (
                <span className="chip chip-primary">日の予定で使用中</span>
              )}
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
