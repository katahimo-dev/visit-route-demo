// 点数の理由を一言（PRD D173。ADR-0025 追記）：今の案の点を下げているいちばん大きい理由を短い文にする純粋関数。
// 新しい採点は足さない。evaluate の減点の内訳（hundredBreakdown）・採点（score）・下限の条件ごとの内訳（ruleLowerBounds）・
// 条件ごとの達成（achievements）から選ぶだけ
import type { HundredPart, PlanScore, Reason, RuleAchievement } from '../contracts/problem';
import type { Rule } from '../contracts/rules';

/** 理由を出さない減点の合計（これ未満なら「点を下げている理由」は無いとみなす。点は整数に丸めるので 0.5） */
export const REASON_MIN_POINTS = 0.5;

/**
 * 次の一手（PRD D229）：いちばんの理由の下に1行で出す操作。
 * shortTravel＝「移動を短く」のプリセットで作る（「案を変える ▾」の項目と同じ）、candidates＝入らなかった訪問の「受けられる人」を見る、
 * compat＝相性の表を開く
 */
export type NextStep = { kind: 'shortTravel' | 'candidates' | 'compat'; text: string };

export type ScoreReason = {
  /** 減点の成分（hundredBreakdown の key）か、必須の違反（'hard'） */
  key: HundredPart['key'] | 'hard';
  /** 短い文。例「移動が長め（190分）」「相性△が1件」「入らない訪問 1件」「必須の違反 1件」 */
  text: string;
  /** その成分の減点（1件あたり。点数と同じ物差し。必須の違反・入らない訪問を先に出したときは内訳の値か 0） */
  points: number;
  /** 次の一手（移動が長い・入らない・相性△ のときだけ） */
  nextStep?: NextStep;
};

/** 次の一手の文 */
export const NEXT_STEP_TEXT: Record<NextStep['kind'], string> = {
  shortTravel: '「移動を短く」で組む',
  candidates: '受けられる人を見る',
  compat: '相性の表を開く',
};
const step = (kind: NextStep['kind']): NextStep => ({ kind, text: NEXT_STEP_TEXT[kind] });

export type ScoreReasonOptions = {
  /** 条件ごとの達成（相性の △・× の件数、負担の均等の目安から外れた人数） */
  achievements?: readonly RuleAchievement[];
  /** 点数の基準の条件（名前・型・必須） */
  rules?: readonly Rule[];
  /** 下限の条件ごとの内訳（evaluate の ruleLowerBounds）。無ければ 0 とみなす */
  ruleLower?: Readonly<Record<string, number>>;
};

/** 負担の均等の achievements のキー（evaluate の BALANCE_RULE_KEY と同じ値。evaluate を読み込まずに済むよう写す） */
const BALANCE_KEY = 'balance';

/**
 * 「担当の条件」の減点のうち、いちばん効いている条件を一言にする（PR #42 のレビュー）：
 * 条件ごとの点（perRule の points）の下限（ruleLower）からの超過がいちばん大きい条件。必須の条件は割当の点に入らないので外す
 * （違反は必須の違反として先に出す）。負担の均等・内部の理由（可否・固定など、rules に無い ID）も外す。
 * 文：外れた訪問がある（misses）なら「相性△が N件」「いつもの担当でない訪問 N件」「「名前」に合わない訪問 N件」、
 * 外れは無く加点を取り逃しただけなら「相性◎を取り逃した訪問がある」「「名前」の加点を取り逃した訪問がある」
 */
function assignText(
  sc: Pick<PlanScore, 'perRule'>,
  opts: ScoreReasonOptions,
): { text: string; compat: boolean } | null {
  const ruleById = new Map((opts.rules ?? []).map((r) => [r.id, r]));
  let best: { id: string; rule: Rule; excess: number } | null = null;
  for (const [id, e] of Object.entries(sc.perRule)) {
    const rule = ruleById.get(id);
    if (!rule || rule.hard || id === BALANCE_KEY || rule.type === 'balance') continue;
    const excess = e.points - (opts.ruleLower?.[id] ?? 0);
    if (excess <= 0) continue;
    if (!best || excess > best.excess) best = { id, rule, excess };
  }
  if (!best) return null;
  const misses = sc.perRule[best.id]?.misses ?? 0;
  if (best.rule.type === 'compatibility') {
    const c = (opts.achievements ?? []).find((a) => a.ruleId === best.id)?.compat;
    const bad = c ? c.poor + c.ng : misses;
    if (bad > 0) {
      const marks = c && c.ng > 0 ? (c.poor > 0 ? '△・×' : '×') : '△';
      return { text: `相性${marks}が${bad}件`, compat: true };
    }
    return { text: '相性◎を取り逃した訪問がある', compat: true };
  }
  if (misses > 0) {
    return {
      text:
        best.rule.type === 'continuity'
          ? `いつもの担当でない訪問 ${misses}件`
          : `「${best.rule.label}」に合わない訪問 ${misses}件`,
      compat: false,
    };
  }
  return { text: `「${best.rule.label}」の加点を取り逃した訪問がある`, compat: false };
}

/**
 * 点を下げているいちばん大きい理由（PRD D173。PR #42 のレビューで決め直した）：
 * 1. 必須の違反があれば、点の大きさに関わらず「必須の違反 N件」（点は参考になるので先に知らせる）
 * 2. 入らない訪問があれば、点の大きさに関わらず「入らない訪問 N件」
 * 3. 減点の合計（0 より大きい成分の和）が REASON_MIN_POINTS 未満なら null（ほぼ理想）
 * 4. それ以外は減点の内訳 parts（hundredBreakdown）のいちばん大きい成分：移動＝「移動が長め（N分）」、
 *    空き時間（待ち）＝「空き時間（待ち）が長め（N分）」、担当の条件＝assignText（分からなければ「担当の条件に合わない訪問がある」）、
 *    負担の均等＝「件数の偏り（目安から外れた人 N人）」
 * 次の一手（nextStep。PRD D229）：移動＝「移動を短く」で組む、入らない訪問＝受けられる人を見る、相性＝相性の表を開く
 */
export function scoreReason(
  parts: readonly HundredPart[],
  sc: Pick<PlanScore, 'travelMinutes' | 'waitMinutes' | 'dropped' | 'perRule' | 'hardViolations'>,
  opts: ScoreReasonOptions = {},
): ScoreReason | null {
  const pointsOf = (key: HundredPart['key']) => parts.find((p) => p.key === key)?.points ?? 0;
  if (sc.hardViolations.length > 0)
    return { key: 'hard', text: `守れない条件 ${sc.hardViolations.length}件`, points: 0 };
  if (sc.dropped > 0)
    return {
      key: 'dropped',
      text: `入らない訪問 ${sc.dropped}件`,
      points: pointsOf('dropped'),
      nextStep: step('candidates'),
    };
  let top: HundredPart | null = null;
  let sum = 0;
  for (const p of parts) {
    if (p.points > 0) sum += p.points;
    if (!top || p.points > top.points) top = p;
  }
  if (!top || sum < REASON_MIN_POINTS || !(top.points > 0)) return null;
  const at = (text: string, next?: NextStep): ScoreReason => ({
    key: top.key,
    text,
    points: top.points,
    ...(next ? { nextStep: next } : {}),
  });
  switch (top.key) {
    case 'dropped':
      return at(`入らない訪問 ${sc.dropped}件`, step('candidates'));
    case 'travel':
      return at(`移動が長め（${Math.round(sc.travelMinutes)}分）`, step('shortTravel'));
    case 'wait':
      return at(`空き時間（待ち）が長め（${Math.round(sc.waitMinutes)}分）`);
    case 'assign': {
      const a = assignText(sc, opts);
      return a ? at(a.text, a.compat ? step('compat') : undefined) : at('担当の条件に合わない訪問がある');
    }
    case 'balance': {
      const b = (opts.achievements ?? []).find((a) => a.ruleId === BALANCE_KEY);
      const out = b ? b.total - b.met : 0;
      return at(out > 0 ? `件数の偏り（目安から外れた人 ${out}人）` : '件数の偏り');
    }
  }
}

/** 読み上げ・title 用の文：「点を下げているいちばんの理由：…」 */
export const scoreReasonLabel = (r: ScoreReason): string => `点を下げているいちばんの理由：${r.text}`;

// ---- 訪問ごとの理由の見せ方（PRD D229）----

/** 移動がこの分以下なら「近い」、これより長ければ「やや遠い」 */
export const TRAVEL_NEAR_MINUTES = 10;
/** 移動がこの分より長ければ「遠い」 */
export const TRAVEL_FAR_MINUTES = 20;

/**
 * 訪問ごとの理由1つの見せ方。tone：good＝選ばれやすい・満たしている（✓）、bad＝選ばれにくい・合わない（!）。
 * text は理由の名前（「相性◎」「移動12分」）、note は（　）の中の言葉（「選ばれやすい」「やや遠い」）。
 * 内部の値（費用の符号つきの数）は画面に出さず title にだけ置く（符号は 100点の点数と向きが逆で、誤読を招くため）
 */
export type ReasonFace = { tone: 'good' | 'bad'; mark: '✓' | '!'; text: string; note: string; title: string };

/** 理由のおおよその言葉（相性・移動・待ち・いつもの担当・条件） */
function noteOf(r: Reason): { tone: 'good' | 'bad'; note: string } {
  if (!Number.isFinite(r.points)) return { tone: 'bad', note: '担当にできない' };
  if (r.ruleId === 'travel') {
    const m = r.points;
    if (m <= TRAVEL_NEAR_MINUTES) return { tone: 'good', note: '近い' };
    return { tone: 'bad', note: m > TRAVEL_FAR_MINUTES ? '遠い' : 'やや遠い' };
  }
  if (r.ruleId === 'wait') return { tone: 'bad', note: '空き時間がある' };
  if (r.level === 2) return { tone: 'good', note: '選ばれやすい' };
  if (r.level === 1) return { tone: 'good', note: 'やや選ばれやすい' };
  if (r.level === -1) return { tone: 'bad', note: '選ばれにくい' };
  if (r.points < 0) return { tone: 'good', note: '加点' };
  if (r.points > 0) return { tone: 'bad', note: '合わない' };
  return { tone: 'good', note: '' };
}

/** 内部の値の文（title だけ）。例「内部の値 −30（移動1分＝1。小さいほど選ばれやすい）」 */
function internalText(points: number): string {
  if (!Number.isFinite(points)) return '担当にできない理由';
  const v = Math.round(points * 10) / 10;
  const n = v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0';
  return `内部の値 ${n}（移動1分＝1。小さいほど選ばれやすい）`;
}

/**
 * 訪問ごとの理由を、符号の無い言葉にする（PRD D229）：「✓ 相性◎（選ばれやすい）」「! 移動12分（やや遠い）」。
 * 名前にもう同じ言葉がある（「いつもの担当でない」「〜 ✗」）ときは（　）を付けない
 */
export function reasonFace(r: Reason): ReasonFace {
  const { tone, note } = noteOf(r);
  const plain = note === '' || note === '合わない' || note === '加点';
  return {
    tone,
    mark: tone === 'good' ? '✓' : '!',
    text: r.label,
    note: plain ? '' : note,
    title: internalText(r.points),
  };
}
