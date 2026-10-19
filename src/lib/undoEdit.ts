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
};

/**
 * routes・pins の形のキー。担当の並び・空の列・固定の書いた順に左右されない
 * （手直し・alignPlan で列の順や空の列が変わっても、中身が同じなら同じキー）
 */
export function editKey(s: EditState): string {
  const routes = Object.keys(s.routes)
    .filter((k) => (s.routes[k] ?? []).length > 0)
    .sort()
    .map((k) => [k, s.routes[k]]);
  const pins = Object.keys(s.pins)
    .sort()
    .map((k) => [k, s.pins[k]]);
  return JSON.stringify({ routes, pins });
}

/** 手直しの前と後から控えを作る（前と後が同じなら控えない＝ null） */
export function takeSnapshot(date: string, before: EditState, after: EditState): EditSnapshot | null {
  const afterKey = editKey(after);
  if (afterKey === editKey(before)) return null;
  return {
    date,
    before: { routes: copyRoutes(before.routes), pins: { ...before.pins } },
    afterKey,
  };
}

/**
 * 控えで戻せるか：同じ日で、今の案が手直しのあとの形のまま（作り直す・別の案にする・ほかの手直し・訪問の取消などで
 * 変わっていない）
 */
export function canUndo(snap: EditSnapshot | null, date: string, now: EditState | null): snap is EditSnapshot {
  return !!snap && !!now && snap.date === date && editKey(now) === snap.afterKey;
}

/** 戻した今の案の routes・pins（控えの写し。控えそのものは渡さない） */
export function undoState(snap: EditSnapshot): EditState {
  return { routes: copyRoutes(snap.before.routes), pins: { ...snap.before.pins } };
}

function copyRoutes(r: Routes): Routes {
  return Object.fromEntries(Object.entries(r).map(([k, ids]) => [k, [...ids]]));
}
