// 日の画面の「案を変える ▾」の項目の文（PRD D156〜D158。ADR-0025 追記。design.md §4 pages「案を変える ▾ の項目」）と、
// 比較の画面の「もう1案作って比べる」の選択肢（PRD D159）を決める純粋関数。データは書き換えない
import type { Preset, Rule } from '../contracts/rules';
import { NONE } from '../domain/scheduleModel';
import { matchesPreset } from '../seed';

/** 担当 → 訪問ID の列から、訪問ID → 担当（未割当の列 NONE は数えない） */
function ownersOf(routes: Record<string, string[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [s, ids] of Object.entries(routes)) if (s !== NONE) for (const id of ids) out.set(id, s);
  return out;
}

/**
 * 固定していない手直しがあるか（PR #39 のレビュー）：今の案（routes）と AI が出したまま（generated）で担当の違う訪問のうち、
 * 今の担当への固定（pins）で説明できないものがあれば true。「入らなかった訪問」へ移した（unassign。固定も外れる）・
 * 動かしてから固定を外した（unpin）訪問がこれに当たる。固定を残して組み直すとこれらは消える。
 * 担当が同じで順番だけ違うのは手直しとしない（固定した訪問を入れたときの順番の変わりで、組み直すと付け直す）
 */
export function hasUnpinnedEdits(
  generated: Record<string, string[]>,
  routes: Record<string, string[]>,
  pins: Record<string, string>,
): boolean {
  const g = ownersOf(generated);
  const r = ownersOf(routes);
  for (const id of new Set([...g.keys(), ...r.keys()])) {
    const now = r.get(id);
    if (now === g.get(id)) continue;
    if (now === undefined || pins[id] !== now) return true;
  }
  return false;
}

/** 項目の文：名前・1行の説明・押せない理由（false なら押せる） */
export type MenuText = { label: string; description: string; disabled: string | false };

export type PlanMenuInput = {
  /** 今の案（AI案）がある */
  hasPlan: boolean;
  /** 手直し・固定がある（今の案が AI が出したままと違う、または固定がある） */
  edited: boolean;
  /** 固定した訪問の件数 */
  pinCount: number;
  /** 固定していない手直しがある（hasUnpinnedEdits） */
  unpinned: boolean;
  /** 計算中・計算できる訪問が無いなど、計算を始められない理由（無ければ false） */
  busy: string | false;
  /** 計算中 */
  running: boolean;
  /** この日だけ試す重み（data.rules）の名前（プリセットと一致すればその名前） */
  ruleName: string;
  /** その日の案の記録の件数 */
  runCount: number;
};

/** 手直し・固定を捨てる項目の説明の後ろに付ける文（手直しが無ければ付けない） */
const discardNote = (edited: boolean) => (edited ? '手直しとピンは消えます' : '');

/** 「AI にもう一度作らせる」（今の案が無ければ「AI に案を作らせる」） */
export function createText(i: PlanMenuInput): MenuText {
  return i.hasPlan
    ? {
        label: 'AI にもう一度作らせる',
        description: `この日の重み（${i.ruleName}）で作り直します。${discardNote(i.edited)}`,
        disabled: i.busy,
      }
    : { label: 'AI に案を作らせる', description: `この日の重み（${i.ruleName}）で作ります`, disabled: i.busy };
}

/**
 * 「固定した訪問は残して、ほかを作り直す」（固定を残して組み直す）。固定が無くても押せる（AI が出したまま（戻す先）を残すので
 * 「AI にもう一度作らせる」とは結果が違う）。固定していない手直しがあれば、消えると書く（押すと確かめる）
 */
export function resolveText(i: PlanMenuInput): MenuText {
  const head =
    i.pinCount > 0
      ? `ピンの付いた ${i.pinCount}件はそのままで、ほかを組み直します`
      : 'ピンの付いた訪問はありません。作り直したあとも「AI が出したままに戻す」で戻せます';
  return {
    label: 'ピンの付いた訪問は残して、ほかを作り直す',
    description: i.unpinned ? `${head}。ピンの無い手直しは消えます` : head,
    disabled: !i.hasPlan ? 'AI の案がまだありません' : i.busy,
  };
}

/** 「AI が出したままに戻す」 */
export function revertText(i: PlanMenuInput): MenuText {
  return {
    label: 'AI が出したままに戻す',
    description: '手直しとピンを捨てて、AI が作ったときの案に戻します',
    disabled: !i.hasPlan
      ? 'AI の案がまだありません'
      : i.running
        ? '計算中は選べません'
        : !i.edited
          ? '手直し・ピンはありません（AI が出したままです）'
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

/** 「まだ作っていない考え方をまとめて作る」の説明。今の案が無い日は、作った中で一番点の高い案を今の案にする（runBatch） */
export function batchDescription(hasPlan: boolean): string {
  return hasPlan
    ? '今の案は変えずに、比べるための案を作って残します'
    : '考え方ごとに作り、一番点の高い案を今の案にします';
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
  return x.edited ? `${what}。手直しとピンは消えます` : what;
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
 * - current：今の条件。どのプリセットとも違い、base とも違えば「試す重みで作る」（作り直し）を最後に足す
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
    out.push({ key: 'rules', kind: 'rules', label: 'この日だけの重みで作る' });
  return out;
}

/**
 * 「この割当で確定」の確認の本文の先頭に出す件数（PRD D219）。数は日の画面の1行のまとめと同じ今の案の採点
 * （dropped＝入らない訪問・hardViolations の件数＝必須の違反）。どちらも0なら空
 */
export function adoptWarnings(dropped: number, hard: number): string[] {
  const out: string[] = [];
  if (dropped > 0) out.push(`入らない訪問が ${dropped}件あります（担当なしのまま確定します）`);
  if (hard > 0) out.push(`守れない条件が ${hard}件あります（そのまま確定します）`);
  return out;
}
