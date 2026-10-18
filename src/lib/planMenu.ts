// 日の画面の「案を変える ▾」の項目の文（PRD D156〜D158。ADR-0025 追記。design.md §4 pages「案を変える ▾ の項目」）と、
// 比較の画面の「もう1案作って比べる」の選択肢（PRD D159）を決める純粋関数。データは書き換えない
import type { Preset, Rule } from '../contracts/rules';
import { matchesPreset } from '../seed';

/** 項目の文：名前・1行の説明・押せない理由（false なら押せる） */
export type MenuText = { label: string; description: string; disabled: string | false };

export type PlanMenuInput = {
  /** 今の案（AI案）がある */
  hasPlan: boolean;
  /** 手直し・固定がある（今の案が AI が出したままと違う、または固定がある） */
  edited: boolean;
  /** 固定した訪問の件数 */
  pinCount: number;
  /** 計算中・計算できる訪問が無いなど、計算を始められない理由（無ければ false） */
  busy: string | false;
  /** 計算中 */
  running: boolean;
  /** 今の条件の名前（プリセットと一致すればその名前、違えば「今の重み」） */
  ruleName: string;
  /** その日の案の記録の件数 */
  runCount: number;
};

/** 手直し・固定を捨てる項目の説明の後ろに付ける文（手直しが無ければ付けない） */
const discardNote = (edited: boolean) => (edited ? '手直しと固定は消えます（確かめてから）' : '');

/** 「AI にもう一度作らせる」（今の案が無ければ「AI に案を作らせる」） */
export function createText(i: PlanMenuInput): MenuText {
  return i.hasPlan
    ? {
        label: 'AI にもう一度作らせる',
        description: `今の条件（${i.ruleName}）で作り直します。${discardNote(i.edited)}`,
        disabled: i.busy,
      }
    : { label: 'AI に案を作らせる', description: `今の条件（${i.ruleName}）で作ります`, disabled: i.busy };
}

/** 「手で動かした所は残して、ほかを作り直す」（固定を残して組み直す） */
export function resolveText(i: PlanMenuInput): MenuText {
  return {
    label: '手で動かした所は残して、ほかを作り直す',
    description: `固定した ${i.pinCount}件の担当はそのままで、ほかを今の条件で組み直します`,
    disabled: !i.hasPlan
      ? 'AI の案がまだありません'
      : i.pinCount === 0
        ? '固定した訪問がありません（訪問を手で動かすと固定になります）'
        : i.busy,
  };
}

/** 「AI が出したままに戻す」 */
export function revertText(i: PlanMenuInput): MenuText {
  return {
    label: 'AI が出したままに戻す',
    description: '手直しと固定を捨てて、AI が作ったときの案に戻します（確かめてから）',
    disabled: !i.hasPlan
      ? 'AI の案がまだありません'
      : i.running
        ? '計算中は選べません'
        : !i.edited
          ? '手直し・固定はありません（AI が出したままです）'
          : false,
  };
}

/** 「2つの案を比べる」（押せないことは無い。案が1つなら比較の画面でもう1案作れる。D159） */
export function compareText(i: PlanMenuInput): MenuText {
  return {
    label: '2つの案を比べる',
    description:
      i.runCount >= 2
        ? `この日に作った案（${i.runCount}件）から2つ選び、点数・移動・担当の違いを並べます`
        : '案がまだ1つです。比較の画面で、もう1案作って比べられます',
    disabled: false,
  };
}

/** プリセットの項目の説明（押すと何が起きるか） */
export function presetDescription(x: {
  isCurrent: boolean;
  making: boolean;
  hasRun: boolean;
  remake: boolean;
  edited: boolean;
}): string {
  if (x.isCurrent) return '今の案です';
  if (x.making) return 'この考え方で作っています';
  const what = !x.hasRun
    ? 'この考え方で作って切り替えます'
    : x.remake
      ? 'データが変わったので、作り直して切り替えます'
      : '作ってある案に切り替えます（計算しません）';
  return x.edited ? `${what}。手直しと固定は消えます` : what;
}

/** 比較の画面の「もう1案作って比べる」の選択肢（D159） */
export type AnotherOption =
  | { key: string; kind: 'preset'; presetId: string; label: string }
  | { key: 'rules'; kind: 'rules'; label: string };

const weightsKey = (rs: readonly Rule[]) => JSON.stringify(rs.map((r) => [r.id, r.weight, !!r.hard]));

/**
 * 比較の画面で案が1つだけのとき、2つめの案を作る選択肢。
 * - base：今ある1つの案の条件。AI が出したままの記録（固定なし）なら、その条件と同じプリセットは出さない（同じ問題・同じ種からは同じ案になる）。
 *   手直しを含む今の案・欠勤前の案など、AI が出したままでないときは null（どのプリセットでも別の案になる）
 * - current：今の条件。どのプリセットとも違い、base とも違えば「今の条件（重み）で作る」（作り直し）を最後に足す
 * 並びはプリセットの順。空なら作れない（呼ぶ側で理由を出す）
 */
export function anotherPlanOptions(
  presets: readonly Preset[],
  base: readonly Rule[] | null,
  current: Rule[],
): AnotherOption[] {
  const out: AnotherOption[] = presets
    .filter((p) => !base || !matchesPreset([...base], p))
    .map((p) => ({ key: `preset-${p.id}`, kind: 'preset', presetId: p.id, label: `${p.name}で作る` }));
  const custom = !presets.some((p) => matchesPreset(current, p));
  if (custom && (!base || weightsKey(base) !== weightsKey(current)))
    out.push({ key: 'rules', kind: 'rules', label: '今の条件（重み）で作る' });
  return out;
}
