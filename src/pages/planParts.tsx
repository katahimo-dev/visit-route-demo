// 予定（#/plan）と比較（#/compare）で共通に使う部品

import type { LucideIcon } from 'lucide-react';
import {
  BookmarkPlus,
  Car,
  CircleOff,
  Clock,
  Gauge,
  Hourglass,
  ListChecks,
  MapPin,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { WeightSlider } from '../components/parts';
import { Hint, SectionTitle, WithIcon } from '../components/ui';
import type { Terms } from '../contracts/documents';
import type { HundredPart, PlanScore, Problem, RuleAchievement, ScoreScale, VisitExplain } from '../contracts/problem';
import { HARDABLE, MAX_PRESETS, type Preset, type Rule } from '../contracts/rules';
import { minutesToHhmm } from '../domain/time';
import { BALANCE_RULE_KEY, explain, toHundred } from '../evaluate';
import { attempt, deltaText, pointsText, r0, r1, ruleTypeLabel, weightLocked } from '../lib/common';
import { addPresetError, addPresetFromRules, PRESET_NAME_MAX } from '../lib/presets';
import { presetOf } from '../seed';
import { useDemoData } from '../store';

/** routes の訪問ごとの説明（未実装なら空） */
export function explainMap(problem: Problem | null, routes: Record<string, string[]>): Map<string, VisitExplain> {
  if (!problem) return new Map();
  const r = attempt(() => explain(problem, routes));
  return new Map((r.value ?? []).map((e) => [e.visitId, e]));
}

/** 減点の内訳の短い文（大きい順に n 個。0.5点未満は省く）。例「移動 −32・担当の条件 −15」 */
export function breakdownText(parts: HundredPart[], n = 2): string {
  return parts
    .filter((x) => x.points >= 0.5)
    .slice(0, n)
    .map((x) => `${x.label} −${r0(x.points)}`)
    .join('・');
}

/** 点数の説明の文（ADR-0007 案A） */
export const SCORE_TEXT = '理想を100点として、1件あたり理想より余計にかかった分（分換算）だけ減点した点';

/** 必須を守っていない案（手作業案・手直しで必須の条件に合わない担当にした案）の点の印の説明（ADR-0007） */
export const HARD_NOTE = '必須を守っていない案の点は比べられません（参考の点です）';

/** 必須の違反がある案の点に付ける「参考」の印と説明 */
export function RefMark({ hard }: { hard: number }) {
  if (hard <= 0) return null;
  return (
    <span className="row" style={{ gap: 4, display: 'inline-flex' }}>
      <span className="chip chip-warn" data-testid="score-ref">
        参考
      </span>
      <Hint ariaLabel="参考の点の説明">{HARD_NOTE}</Hint>
    </span>
  );
}

/** 点数の決め方と、減点の内訳・内部の費用（説明の中） */
export function HundredHint({ cost, parts, scale }: { cost: number; parts: HundredPart[]; scale: ScoreScale }) {
  // 下限より良い成分（0 未満）は内訳に出さない
  const shown = parts.filter((x) => x.points >= 0.05);
  return (
    <Hint label="点数の決め方">
      {SCORE_TEXT}（高いほど良い。1件あたり10分余計なら90点）。
      理想は、どの訪問もいちばん条件の合う担当にし、移動はどの訪問にもいちばん近い場所から来る（出る）とし、待ちを0にした値です。
      {shown.length > 0 && (
        <>
          <br />
          減点の内訳：
          {shown.map((x) => `${x.label} −${r1(x.points)}点`).join('・')}
        </>
      )}
      <br />
      <span className="sub">
        費用 {r0(cost)}（内部の値。移動1分＝1、低いほど良い）・理想 {r0(scale.lowerBound)}・訪問 {scale.visits}件
      </span>
    </Hint>
  );
}

/** 訪問カードを押したときの理由（例「相性◎ −30」「移動12分 +12」） */
export function ReasonBox({ explain: e }: { explain: VisitExplain | undefined }) {
  if (!e) return <div className="reason-box sub">理由を出せませんでした</div>;
  return (
    <div className="reason-box">
      {e.reasons.length === 0 && <span className="sub">点の付く条件はありません</span>}
      {e.reasons.map((r) => (
        <div key={`${r.ruleId}:${r.label}`} className="spread">
          <span>{r.label}</span>
          <strong className={r.points < 0 ? 'ok-text' : r.points > 0 ? 'warn-text' : ''}>{pointsText(r.points)}</strong>
        </div>
      ))}
      {e.timing && (
        <span className="sub reason-timing">
          <WithIcon icon={Clock} size={13}>
            着 {minutesToHhmm(e.timing.arrival)}・開始 {minutesToHhmm(e.timing.start)}
          </WithIcon>
          {e.timing.wait > 0 && (
            <WithIcon icon={Hourglass} size={13}>
              待ち {r0(e.timing.wait)}分
            </WithIcon>
          )}
        </span>
      )}
    </div>
  );
}

/** 合計点・移動・待ち・距離・条件ごとの達成/違反の比較表 */
export function CompareTable({
  a: manual,
  b: ai,
  labels,
  rules,
  error,
  scale,
}: {
  a: PlanScore | null;
  b: PlanScore | null;
  /** 列の見出し（A・B） */
  labels: [string, string];
  rules: { id: string; label: string }[];
  error?: string | null;
  /** 点数の物差し（無ければ合計点の行を出さない） */
  scale: ScoreScale | null;
}) {
  if (!manual || !ai) return <p className="sub">採点できません{error ? `（${error}）` : ''}</p>;
  /** higherIsBetter：差の色を逆にする（合計点） */
  const row = (
    icon: LucideIcon,
    label: string,
    a: number,
    b: number,
    unit: string,
    digits = 0,
    higherIsBetter = false,
  ) => {
    const f = (n: number) => (digits ? r1(n) : r0(n));
    const d = higherIsBetter ? a - b : b - a;
    return (
      <tr key={label}>
        <th>
          <WithIcon icon={icon} size={15}>
            {label}
          </WithIcon>
        </th>
        <td className="num">
          {f(a)}
          {unit}
        </td>
        <td className="num">
          <strong>
            {f(b)}
            {unit}
          </strong>
        </td>
        <td className={`num ${d < 0 ? 'ok-text' : d > 0 ? 'warn-text' : 'sub'}`}>{deltaText(b - a, unit)}</td>
      </tr>
    );
  };
  const ruleIds = [...rules.map((r) => r.id), ...Object.keys({ ...manual.perRule, ...ai.perRule })].filter(
    (id, i, a) => a.indexOf(id) === i,
  );
  const labelOf = (id: string) =>
    rules.find((r) => r.id === id)?.label ?? (id === BALANCE_RULE_KEY ? '負担の均等' : id);
  const cell = (s: PlanScore, id: string) => {
    const p = s.perRule[id];
    if (!p) return <span className="sub">—</span>;
    return (
      <span>
        達成 {p.hits}・違反 <span className={p.misses > 0 ? 'warn-text' : ''}>{p.misses}</span>
        <span className="sub">（{pointsText(p.points)}）</span>
      </span>
    );
  };
  return (
    <div className="table-scroll">
      <table className="compare-table">
        <thead>
          <tr>
            <th />
            <th className="num">{labels[0]}</th>
            <th className="num">{labels[1]}</th>
            <th className="num">差（B−A）</th>
          </tr>
        </thead>
        <tbody>
          {scale && row(Gauge, '合計点', toHundred(manual.total, scale), toHundred(ai.total, scale), '点', 0, true)}
          {row(Car, '移動時間', manual.travelMinutes, ai.travelMinutes, '分')}
          {row(Hourglass, '待ち時間', manual.waitMinutes, ai.waitMinutes, '分')}
          {row(MapPin, '移動距離', manual.meters / 1000, ai.meters / 1000, 'km', 1)}
          {row(CircleOff, '入らなかった訪問', manual.dropped, ai.dropped, '件')}
          {row(ShieldAlert, '必須の違反', manual.hardViolations.length, ai.hardViolations.length, '件')}
          {ruleIds.map((id) => (
            <tr key={id}>
              <th>{labelOf(id)}</th>
              <td className="num">{cell(manual, id)}</td>
              <td className="num">{cell(ai, id)}</td>
              <td className="num sub">
                {deltaText((ai.perRule[id]?.points ?? 0) - (manual.perRule[id]?.points ?? 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {scale && (manual.hardViolations.length > 0 || ai.hardViolations.length > 0) && (
        <p className="sub" data-testid="score-ref">
          {manual.hardViolations.length > 0 && ai.hardViolations.length > 0
            ? 'A・B'
            : manual.hardViolations.length > 0
              ? 'A'
              : 'B'}
          の合計点は参考です：{HARD_NOTE}
        </p>
      )}
    </div>
  );
}

/** 横の小さな重みの欄（D14）。変えたらすぐ「再計算」できる */
export function WeightPanel({
  running,
  onRecalc,
  onPreset,
  canRun,
  recalcLabel = '再計算',
}: {
  running: boolean;
  onRecalc: () => void;
  /** プリセットを押した（その重みにして、すぐ作る。ADR-0005） */
  onPreset?: (p: Preset) => void;
  canRun: boolean;
  recalcLabel?: string;
}) {
  const { data, update } = useDemoData();
  const current = presetOf(data.rules, data.presets);
  return (
    <aside className="card stack side-panel">
      {onPreset && (
        <>
          <SectionTitle
            icon={ListChecks}
            aside={<Hint>押すと、その重みにしてすぐAI案を作ります（作った案は記録に残ります）。</Hint>}
          >
            プリセット
          </SectionTitle>
          <div className="stack" style={{ gap: 4 }}>
            {data.presets.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={`btn btn-small preset-btn ${current?.id === p.id ? 'is-on' : ''}`}
                disabled={running || !canRun}
                onClick={() => onPreset(p)}
                title={p.note}
              >
                <span className="preset-no">{i + 1}</span>
                {p.name}
              </button>
            ))}
          </div>
          <span className="sub">いまの重み：{current ? current.name : 'プリセットから変えた重み'}</span>
          <SavePresetForm compact disabled={running} />
          <NavLink to="/rules#presets" className="sub">
            プリセットを編集する
          </NavLink>
        </>
      )}
      <SectionTitle icon={SlidersHorizontal} aside={<Hint>重み1＝移動10分ぶん。0で無効。</Hint>}>
        条件の重み
      </SectionTitle>
      {data.rules.map((r) => (
        <div key={r.id} className={`stack side-rule ${r.weight === 0 && !r.hard ? 'is-dim' : ''}`} style={{ gap: 2 }}>
          <span className="side-rule-label">
            {r.label}
            {r.hard && HARDABLE.has(r.type) && (
              <span className="chip chip-primary">
                <ShieldAlert size={12} aria-hidden="true" />
                必須
              </span>
            )}
          </span>
          <WeightSlider
            label={r.label}
            value={r.weight}
            disabled={weightLocked(r) || running}
            onChange={(w) =>
              update((d) => ({ ...d, rules: d.rules.map((x) => (x.id === r.id ? { ...x, weight: w } : x)) }))
            }
          />
        </div>
      ))}
      <button type="button" className="btn btn-small" disabled={running || !canRun} onClick={onRecalc}>
        <WithIcon icon={RefreshCw} size={14}>
          {recalcLabel}
        </WithIcon>
      </button>
    </aside>
  );
}

/**
 * 「いまの重みをプリセットとして保存」（D24。ADR-0008）。押すと名前の欄が出て、入れて保存すると最後に足す。
 * 6つあれば押せない。compact は予定の画面の右の欄用（小さいボタン）
 */
export function SavePresetForm({ compact = false, disabled = false }: { compact?: boolean; disabled?: boolean }) {
  const { data, update } = useDemoData();
  const [name, setName] = useState<string | null>(null);
  const full = data.presets.length >= MAX_PRESETS;
  const error = name === null ? null : addPresetError(data, name);
  const save = () => {
    if (name === null || error) return;
    update((d) => addPresetFromRules(d, name));
    setName(null);
  };
  if (name === null) {
    return (
      <button
        type="button"
        className={`btn ${compact ? 'btn-small' : ''}`}
        disabled={full || disabled}
        onClick={() => setName('')}
        title={
          full ? `プリセットは${MAX_PRESETS}つまでです` : 'いまの条件の重み・必須を、新しいプリセットとして足します'
        }
      >
        <WithIcon icon={BookmarkPlus} size={14}>
          いまの重みをプリセットとして保存
        </WithIcon>
      </button>
    );
  }
  return (
    <form
      className="stack preset-save"
      style={{ gap: 4 }}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="stack" style={{ gap: 2 }}>
        <span className="sub">新しいプリセットの名前</span>
        <input
          value={name}
          maxLength={PRESET_NAME_MAX}
          // biome-ignore lint/a11y/noAutofocus: 押したらすぐ名前を入れられるように
          autoFocus
          aria-label="新しいプリセットの名前"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {error && name.trim() !== '' && <span className="error">{error}</span>}
      <div className="row" style={{ gap: 4 }}>
        <button type="submit" className="btn btn-small" disabled={!!error || disabled}>
          保存
        </button>
        <button type="button" className="btn btn-small" onClick={() => setName(null)}>
          やめる
        </button>
      </div>
    </form>
  );
}

/** 達成の件数の1行の文（例「18/20件」「◎○ 6件・△ 1件」「7/8人」） */
export function achievementText(a: RuleAchievement): string {
  if (a.compat) {
    const c = a.compat;
    const parts = [`◎○ ${c.great + c.good}件`];
    if (c.poor > 0) parts.push(`△ ${c.poor}件`);
    if (c.ng > 0) parts.push(`× ${c.ng}件`);
    return parts.join('・');
  }
  return `${a.met}/${a.total}${a.unit === 'staff' ? '人' : '件'}`;
}

/** 条件の名前（ID → 条件の名前。負担の均等のキーは「負担の均等」） */
export function achievementLabel(ruleId: string, rules: Rule[], terms: Terms): string {
  const r = rules.find((x) => x.id === ruleId);
  if (r) return r.label;
  if (ruleId === BALANCE_RULE_KEY) return ruleTypeLabel('balance', terms);
  if (ruleId === 'compatibility') return ruleTypeLabel('compatibility', terms);
  return ruleId;
}

/** 条件ごとの達成の件数（D25。ADR-0008）。重み0の条件は判定しないので出ない */
export function AchievementList({ list, rules, terms }: { list: RuleAchievement[]; rules: Rule[]; terms: Terms }) {
  if (list.length === 0) return <span className="sub">数える条件がありません</span>;
  return (
    <div className="achievements" data-testid="achievements">
      {list.map((a) => {
        const rate = a.total > 0 ? a.met / a.total : 1;
        const tone = a.compat ? (a.compat.poor + a.compat.ng > 0 ? 'warn' : 'ok') : rate >= 1 ? 'ok' : 'warn';
        return (
          <div key={a.ruleId} className={`achievement tone-${tone}`}>
            <span className="achievement-label">{achievementLabel(a.ruleId, rules, terms)}</span>
            <strong>{achievementText(a)}</strong>
          </div>
        );
      })}
    </div>
  );
}

/**
 * カード用の短い要約（希望・相性・いつもの担当の達成率）。例「希望 90%・相性◎○ 6件・継続 75%」。
 * 対象の型の条件が無ければ空
 */
export function achievementSummary(list: RuleAchievement[], rules: Rule[]): string {
  const typeOf = (id: string) => rules.find((r) => r.id === id)?.type;
  const pct = (a: RuleAchievement) => (a.total > 0 ? `${Math.round((100 * a.met) / a.total)}%` : '—');
  const out: string[] = [];
  // 希望・相性・いつもの担当の順
  for (const a of list.filter((x) => typeOf(x.ruleId) === 'clientPreference')) out.push(`希望 ${pct(a)}`);
  for (const a of list.filter((x) => typeOf(x.ruleId) === 'compatibility'))
    if (a.compat) out.push(`相性◎○ ${a.compat.great + a.compat.good}件`);
  for (const a of list.filter((x) => typeOf(x.ruleId) === 'continuity')) out.push(`いつもの担当 ${pct(a)}`);
  return out.join('・');
}
