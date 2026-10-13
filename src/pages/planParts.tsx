// AI案（#/plan）と比較（#/compare）で共通に使う部品

import type { LucideIcon } from 'lucide-react';
import {
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
import { WeightSlider } from '../components/parts';
import { Hint, SectionTitle, WithIcon } from '../components/ui';
import type { HundredPart, PlanScore, Problem, ScoreScale, VisitExplain } from '../contracts/problem';
import { HARDABLE } from '../contracts/rules';
import { minutesToHhmm } from '../domain/time';
import { BALANCE_RULE_KEY, explain, toHundred } from '../evaluate';
import { attempt, deltaText, pointsText, r0, r1, weightLocked } from '../lib/common';
import { PRESETS, type Preset, presetOf } from '../seed';
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

/** 100点満点の決め方と、減点の内訳・内部の費用（説明の中） */
export function HundredHint({ cost, parts, scale }: { cost: number; parts: HundredPart[]; scale: ScoreScale }) {
  const shown = parts.filter((x) => Math.abs(x.points) >= 0.05);
  return (
    <Hint label="100点満点の決め方">
      理想（届かない下限）を100点、近い順に機械的に割り当てた案を0点として、理想にどれだけ近いかを表します（高いほど良い）。
      理想は、どの訪問もいちばん条件の合う担当にし、移動はどの訪問にもいちばん近い場所から来る（出る）とし、待ちを0にした値です。
      {shown.length > 0 && (
        <>
          <br />
          減点の内訳：
          {shown.map((x) => `${x.label} ${x.points >= 0 ? '−' : '+'}${r1(Math.abs(x.points))}点`).join('・')}
        </>
      )}
      <br />
      <span className="sub">
        費用 {r0(cost)}（内部の値。移動1分＝1、低いほど良い）・0点の案 {r0(scale.naive)}・100点 {r0(scale.lowerBound)}
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

/** 合計点（100点満点）・移動・待ち・距離・条件ごとの達成/違反の比較表 */
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
  /** 100点満点の物差し（無ければ合計点の行を出さない） */
  scale: ScoreScale | null;
}) {
  if (!manual || !ai) return <p className="sub">採点できません{error ? `（${error}）` : ''}</p>;
  /** higherIsBetter：差の色を逆にする（100点満点の合計） */
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
          {scale &&
            row(
              Gauge,
              '合計点（100点満点）',
              toHundred(manual.total, scale),
              toHundred(ai.total, scale),
              '点',
              0,
              true,
            )}
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
  const current = presetOf(data.rules);
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
            {PRESETS.map((p, i) => (
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
            disabled={weightLocked(r)}
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
