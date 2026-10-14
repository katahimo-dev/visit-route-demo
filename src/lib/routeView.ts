// 担当ごとのルートの地図と選択（予定 #/plan と比較 #/compare で共通。ADR-0009）
import { useEffect, useState } from 'react';
import type { MapLine, MapPoint } from '../components/RouteMap';
import type { Client, Staff, Visit } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import { colorOf, initialOf } from './colors';
import { hasLocation, own, staffColor } from './common';

/** 「最後の訪問先 → 自宅」の区間のキーの頭（区間のキーは訪問ID か `home:<staffId>`） */
export const HOME_LEG = 'home:';
export const homeLegKey = (staffId: string) => `${HOME_LEG}${staffId}`;

/** 地図に描くルートの集まり（予定は1つ、比較は A＝点線・B＝実線の2つ） */
export type RouteSet = { key: string; routes: Record<string, string[]>; dashed?: boolean };

/** 選んだもの：訪問（id＝訪問ID）か区間（id＝訪問ID：その訪問へ来る移動、`home:<staffId>`：自宅へ帰る移動）と、どのルートの集まりか */
export type RouteSel = { id: string; set: string };

type LatLng = { lat: number; lng: number };

/**
 * 地図の点・線を作る。担当（staffOrder の順）ごと・集まりごとに、自宅 → 訪問先 → 自宅を結ぶ（線の色は担当の色）。
 * focusStaff があればその人だけ。picked の訪問先と、focusLeg の区間（と行き先の訪問先）を強調する。
 * 同じ訪問先の点は1つにまとめる。emphasize の訪問へ来る区間は太く描く（欠勤の振り直しの代行。ADR-0011）
 */
export function buildRouteMap(args: {
  sets: RouteSet[];
  staffOrder: string[];
  staffById: Map<string, Staff>;
  visitById: Map<string, Visit>;
  clientById: Map<string, Client>;
  colorOfStaff: Map<string, string>;
  focusStaff: string | null;
  picked: RouteSel | null;
  focusLeg: RouteSel | null;
  emphasize?: ReadonlySet<string>;
}): { points: MapPoint[]; lines: MapLine[] } {
  const { sets, staffOrder, staffById, visitById, clientById, colorOfStaff, focusStaff, picked, focusLeg } = args;
  const emphasize = args.emphasize ?? new Set<string>();
  const homes: MapPoint[] = [];
  /** 訪問ID → 点（同じ訪問は1つ） */
  const visitPts = new Map<string, MapPoint>();
  const lines: MapLine[] = [];
  const placeOf = (id: string): LatLng | null => {
    const c = clientById.get(visitById.get(id)?.clientId ?? '');
    return c && hasLocation(c.place) ? { lat: c.place.lat, lng: c.place.lng } : null;
  };
  const visitPoint = (id: string, at: LatLng) => {
    const c = clientById.get(visitById.get(id)?.clientId ?? '');
    const p = visitPts.get(id) ?? {
      ...at,
      label: initialOf(c?.displayName ?? ''),
      color: colorOf(c?.color ?? 0),
    };
    visitPts.set(id, p);
    return p;
  };
  for (const sid of staffOrder) {
    if (focusStaff && sid !== focusStaff) continue;
    const s = staffById.get(sid);
    const color = colorOfStaff.get(sid) ?? staffColor(0);
    const home = s && hasLocation(s.home) ? { lat: s.home.lat, lng: s.home.lng } : null;
    let homeShown = false;
    for (const set of sets) {
      const ids = own(set.routes, sid) ?? [];
      if (ids.length === 0) continue;
      const legOn = focusLeg?.set === set.key ? focusLeg.id : null;
      const path: LatLng[] = [];
      if (home) {
        path.push(home);
        if (!homeShown) homes.push({ ...home, label: '家', color });
        homeShown = true;
      }
      let lastId: string | null = null;
      for (const id of ids) {
        const at = placeOf(id);
        if (!at) continue;
        const prev = path[path.length - 1];
        if (id === legOn && prev) lines.push({ points: [prev, at], color, dashed: set.dashed, highlight: true });
        else if (emphasize.has(id) && prev) lines.push({ points: [prev, at], color, dashed: set.dashed, bold: true });
        path.push(at);
        const p = visitPoint(id, at);
        if ((picked?.id === id && picked.set === set.key) || id === legOn) p.highlight = true;
        lastId = id;
      }
      const last = path[path.length - 1];
      if (home && lastId && last) {
        if (legOn === homeLegKey(sid)) {
          lines.push({ points: [last, home], color, dashed: set.dashed, highlight: true });
          const p = visitPts.get(lastId);
          if (p) p.highlight = true;
        }
        path.push(home);
      }
      lines.push({ points: path, color, dashed: set.dashed });
    }
  }
  return { points: [...homes, ...visitPts.values()], lines };
}

/** その人の最後の訪問先から自宅までの移動（分）。自宅の位置が無い・計算に入れていないなら null */
export function homeTravel(
  problem: Problem | null,
  staff: Staff | undefined,
  routes: Record<string, string[]>,
): number | null {
  if (!problem || !staff || !hasLocation(staff.home)) return null;
  const lastId = own(routes, staff.id)?.at(-1);
  const st = problem.staff.find((x) => x.id === staff.id);
  const pv = lastId ? problem.visits.find((v) => v.id === lastId) : undefined;
  if (!st || !pv) return null;
  // 点の番号は compile のとおり（自宅＝スタッフの番号、訪問先＝スタッフの数＋訪問先の番号）。matching/timing.ts の帰りと同じ表
  const t = problem.travel[pv.point]?.[st.point];
  return t !== undefined && Number.isFinite(t) ? t : null;
}

/**
 * 地図で見る担当（focusStaff。null は全員）・強調する区間（focusLeg）・選んだ訪問（picked）。日付が変わったら外す。
 * ownerOf(set, 訪問ID) は、その集まりでの担当
 */
export function useRouteSelection(date: string, ownerOf: (set: string, visitId: string) => string | undefined) {
  const [focusStaff, setFocusStaff] = useState<string | null>(null);
  const [focusLeg, setFocusLeg] = useState<RouteSel | null>(null);
  const [picked, setPicked] = useState<RouteSel | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付を変えたら選んだものを外す
  useEffect(() => {
    setFocusStaff(null);
    setFocusLeg(null);
    setPicked(null);
  }, [date]);
  const ownerOfSel = (x: RouteSel) => (x.id.startsWith(HOME_LEG) ? x.id.slice(HOME_LEG.length) : ownerOf(x.set, x.id));
  /**
   * 地図で見る担当を変える（null は全員）。選んでいた区間・訪問がその人のものでなければ外す
   * （全員に戻したときも区間の強調は外す）
   */
  const focusOn = (sid: string | null) => {
    setFocusStaff(sid);
    if (focusLeg && (sid === null || ownerOfSel(focusLeg) !== sid)) setFocusLeg(null);
    if (picked && sid !== null && ownerOfSel(picked) !== sid) setPicked(null);
  };
  const same = (a: RouteSel | null, b: RouteSel) => !!a && a.id === b.id && a.set === b.set;
  /** 訪問を押した：選ぶ（その人に地図を合わせ、その人のものでない区間の強調は外す）か、もう一度押して外す */
  const togglePick = (x: RouteSel) => {
    const on = !same(picked, x);
    setPicked(on ? x : null);
    const o = ownerOfSel(x);
    if (!on || !o) return;
    setFocusStaff(o);
    if (focusLeg && ownerOfSel(focusLeg) !== o) setFocusLeg(null);
  };
  /** 区間を押した：強調する（その人に地図を合わせ、その人のものでない選んだ訪問は外す）か、もう一度押して外す */
  const toggleLeg = (x: RouteSel) => {
    const on = !same(focusLeg, x);
    setFocusLeg(on ? x : null);
    const o = ownerOfSel(x);
    if (!on || !o) return;
    setFocusStaff(o);
    if (picked && ownerOfSel(picked) !== o) setPicked(null);
  };
  /** 「全員のルートを見る」：担当の絞り込みを外す（focusOn(null) と同じ。選んだ訪問は残し、区間の強調は外す） */
  const clear = () => focusOn(null);
  /** 選んだものをすべて外す（案が入れ替わったとき・比べる案を変えたとき） */
  const reset = () => {
    setFocusStaff(null);
    setFocusLeg(null);
    setPicked(null);
  };
  /**
   * 訪問の担当が変わった（to：新しい担当、null は未割当）。その訪問を選んでいた・その訪問へ来る区間を強調していたら、
   * 絞り込みを新しい担当に合わせ、その人のものでない選択を外す。未割当にしたときは、その訪問の選択を外す
   */
  const follow = (visitId: string, to: string | null) => {
    const hit = (x: RouteSel | null) => !!x && x.id === visitId;
    if (!hit(picked) && !hit(focusLeg)) return;
    if (to === null) {
      if (hit(picked)) setPicked(null);
      if (hit(focusLeg)) setFocusLeg(null);
      return;
    }
    if (focusStaff !== null) setFocusStaff(to);
    if (focusLeg && !hit(focusLeg)) setFocusLeg(null);
    if (picked && !hit(picked)) setPicked(null);
  };
  return {
    focusStaff,
    focusLeg,
    picked,
    focusOn,
    togglePick,
    toggleLeg,
    clear,
    reset,
    follow,
    isPicked: (x: RouteSel) => same(picked, x),
    isLeg: (x: RouteSel) => same(focusLeg, x),
    /** MapDock の focusKey（選んだものが変わったら開く） */
    focusKey: [focusStaff, focusLeg && `${focusLeg.set}:${focusLeg.id}`, picked && `${picked.set}:${picked.id}`]
      .filter(Boolean)
      .join('|'),
  };
}
