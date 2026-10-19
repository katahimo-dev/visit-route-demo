// 日の画面の手直しを1手だけ戻す（PRD D218。ADR-0030）の純粋な部分。
// 控えは画面の状態だけ（DemoData・localStorage には入れない）。戻せるのは直前の1手だけ（2手前へは戻れない）

/** 担当ごとの訪問の列（staffId → 訪問ID の列。回る順） */
type Routes = Record<string, string[]>;
/** 固定（訪問ID → 担当ID） */
type Pins = Record<string, string>;
/** 今の案のうち、手直しが書き換えるもの（unassigned・score は routes から付け直す） */
export type EditState = { routes: Routes; pins: Pins };

/** 手直しの1手ぶんの控え */
export type EditSnapshot = {
  /** 手直しをした日 */
  date: string;
  /** 戻す先（手直しの前の routes・pins） */
  before: EditState;
  /** 手直しのあとの形のキー（今の案がこの形のままのときだけ戻せる。ほかの操作で変わったら戻さない） */
  afterKey: string;
  /** 手直しのときの確定した割当（manualPlans[date]）のキー（confirmedKey）。そのあと確定したら戻さない */
  confirmed: string;
};

/**
 * routes・pins の形のキー。担当の並び・空の列・固定の書いた順に左右されない
 * （手直し・alignPlan で列の順や空の列が変わっても、中身が同じなら同じキー）
 */
export function editKey(s: EditState): string {
  return JSON.stringify({ routes: routesEntries(s.routes), pins: sortedEntries(s.pins) });
}

/** 確定した割当（manualPlans[date]。無ければ null）のキー。担当の並び・空の列に左右されない */
export function confirmedKey(cols: Routes | null | undefined): string {
  return cols ? JSON.stringify(routesEntries(cols)) : 'null';
}

/** 手直しの前と後から控えを作る（前と後が同じなら控えない＝ null）。confirmed は手直しのときの confirmedKey */
export function takeSnapshot(
  date: string,
  before: EditState,
  after: EditState,
  confirmed: string,
): EditSnapshot | null {
  const afterKey = editKey(after);
  if (afterKey === editKey(before)) return null;
  return {
    date,
    before: { routes: copyRoutes(before.routes), pins: { ...before.pins } },
    afterKey,
    confirmed,
  };
}

/**
 * 戻せない理由（戻せるなら null）。文はトースト・操作の行の「元に戻す」の title で共通（「戻せません：」に続ける）。
 * 計算中・控えが無い・別の日・手直しのあとに確定した・手直しのあとに今の案が変わった（作り直す・別の案・ほかの手直し・訪問の取消など）
 */
export function undoBlockReason(
  snap: EditSnapshot | null,
  date: string,
  now: EditState | null,
  confirmed: string,
  running: boolean,
): string | null {
  if (running) return '計算中です';
  if (!snap || !now) return '戻せる手直しがありません';
  if (snap.date !== date) return '別の日の手直しです';
  if (snap.confirmed !== confirmed) return '手直しのあとに確定しました';
  if (editKey(now) !== snap.afterKey) return '手直しのあとに案が変わりました';
  return null;
}

/** 控えで戻せるか（undoBlockReason が null。計算中かどうかは見ない） */
export function canUndo(
  snap: EditSnapshot | null,
  date: string,
  now: EditState | null,
  confirmed: string,
): snap is EditSnapshot {
  return undoBlockReason(snap, date, now, confirmed, false) === null;
}

/** 戻した今の案の routes・pins（控えの写し。控えそのものは渡さない） */
export function undoState(snap: EditSnapshot): EditState {
  return { routes: copyRoutes(snap.before.routes), pins: { ...snap.before.pins } };
}

function routesEntries(r: Routes): [string, string[] | undefined][] {
  return Object.keys(r)
    .filter((k) => (r[k] ?? []).length > 0)
    .sort()
    .map((k) => [k, r[k]]);
}

function sortedEntries(p: Pins): [string, string | undefined][] {
  return Object.keys(p)
    .sort()
    .map((k) => [k, p[k]]);
}

function copyRoutes(r: Routes): Routes {
  return Object.fromEntries(Object.entries(r).map(([k, ids]) => [k, [...ids]]));
}
