// 写した元：katahimo-dev/visit-route-poc @ a46e7db web/src/features/admin/schedule/model.ts
import type { Staff, Visit } from '../contracts/documents';
import { type Slot, withinSlots } from './availability';
import { hhmmToMinutes, minutesToHhmm } from './time';

/**
 * 予定画面の手作業案（担当ごとの訪問の割当）の組み立て。画面と Firebase に依存しない。
 * 回る順番は開始時刻の順で、手では並べ替えない（PRD R3）
 */

export const NONE = '__none';
export type Cols = Record<string, string[]>;
export type View = { cols: Cols; unassigned: string[] };
type V = Visit & { id: string };

const byStart = (a: Visit, b: Visit) =>
  a.earliestStart.localeCompare(b.earliestStart) || a.latestStart.localeCompare(b.latestStart);

/** 訪問IDの列を開始時刻の順に並べる */
export function timeOrder(ids: string[], visitById: Map<string, Visit>): string[] {
  return [...ids].sort((a, b) => {
    const x = visitById.get(a);
    const y = visitById.get(b);
    return x && y ? byStart(x, y) : 0;
  });
}

/** 保存済み/編集中の割当と、いまある訪問を突き合わせる（消えた訪問を除き、新しい訪問は担当の列か未割当へ） */
export function reconcile(base: Cols, visits: V[], staffIds: string[]): View {
  // 自分のキーだけを見る（スタッフID が constructor などでも Object の組み込みを拾わない）
  const colOf = (k: string): string[] => (Object.hasOwn(base, k) ? (base[k] ?? []) : []);
  const byId = new Map(visits.map((v) => [v.id, v]));
  const placed = new Set<string>();
  const unassigned: string[] = [];
  for (const id of colOf(NONE)) {
    if (byId.has(id) && !placed.has(id)) {
      unassigned.push(id);
      placed.add(id);
    }
  }
  const cols: Cols = {};
  for (const s of staffIds) {
    cols[s] = colOf(s).filter((id) => byId.has(id) && !placed.has(id));
    for (const id of cols[s]) placed.add(id);
  }
  for (const v of visits) {
    if (placed.has(v.id)) continue;
    const col = v.staffId ? cols[v.staffId] : undefined;
    if (col) col.push(v.id);
    else unassigned.push(v.id);
  }
  for (const s of staffIds) cols[s] = timeOrder(cols[s] ?? [], byId);
  return { cols, unassigned: timeOrder(unassigned, byId) };
}

/** 担当を変える（to は staffId か NONE）。移した先でも開始時刻の順 */
export function assign(view: View, id: string, to: string, visitById: Map<string, V>): View {
  const cols: Cols = {};
  for (const [k, ids] of Object.entries(view.cols)) cols[k] = ids.filter((x) => x !== id);
  const unassigned = view.unassigned.filter((x) => x !== id);
  if (to === NONE || !visitById.has(id)) return { cols, unassigned: timeOrder([...unassigned, id], visitById) };
  cols[to] = timeOrder([...((Object.hasOwn(cols, to) ? cols[to] : undefined) ?? []), id], visitById);
  return { cols, unassigned };
}

/**
 * 列の中の訪問の時刻（移動時間は入れない目安）と、時間の重なり。
 * 前の訪問が終わるまで次は始められないとして詰め、約束の時刻（幅があれば最も遅い開始）を過ぎる訪問と、
 * その原因になった前の訪問の両方を「重なり」にする。
 * slots（その人の稼働時間帯）を渡すと、約束の幅の中で、作業が時間帯の1つに収まる最も早い時刻に寄せる
 */
export type Slotted = { start: number; end: number; overlap: boolean };
export function timesOf(ids: string[], visitById: Map<string, Visit>, slots?: Slot[]): Map<string, Slotted> {
  const out = new Map<string, Slotted>();
  let free = 0;
  let prevId: string | null = null;
  for (const id of ids) {
    const v = visitById.get(id);
    if (!v) continue;
    const start = fitInSlots(Math.max(hhmmToMinutes(v.earliestStart), free), v, slots);
    const end = start + v.durationMinutes;
    const overlap = start > hhmmToMinutes(v.latestStart);
    out.set(id, { start, end, overlap });
    const prev = prevId ? out.get(prevId) : undefined;
    if (overlap && prev) prev.overlap = true;
    free = end;
    prevId = id;
  }
  return out;
}

/** 約束の幅（最も遅い開始まで）の中で、作業が時間帯の1つに収まる最も早い開始。無ければそのまま */
function fitInSlots(start: number, v: Visit, slots: Slot[] | undefined): number {
  if (!slots) return start;
  const latest = hhmmToMinutes(v.latestStart);
  for (const s of slots) {
    const at = Math.max(start, hhmmToMinutes(s.start));
    if (at <= latest && at + v.durationMinutes <= hhmmToMinutes(s.end)) return at;
  }
  return start;
}

export const hhmm = (minutes: number) => minutesToHhmm(minutes);

/**
 * 担当の割当で気をつけること（時刻だけ）。赤い枠になる。保存は止めない。
 * デモ版では性別・NG は条件（evaluate の hardViolations）で出すので、ここでは見ない（ADR-0002）
 */
export type Warning = 'overlap' | 'outside';
export const WARNING_LABELS: Record<Warning, string> = {
  overlap: '時間が重なる',
  outside: '働ける時間の外',
};
export const isRed = (w: Warning[]) => w.length > 0;

export function warningsOf(
  staff: Staff | undefined,
  staffId: string | null,
  slots: Slot[],
  time: Slotted | undefined,
): Warning[] {
  if (!staff || !staffId) return [];
  const w: Warning[] = [];
  if (time?.overlap) w.push('overlap');
  if (time && !withinSlots(slots, time.start, time.end)) w.push('outside');
  return w;
}

/** 訪問の時間の表示（幅があれば「10:30〜11:30」に開始） */
export function windowText(v: Visit): string {
  return v.windowKind === 'window' ? `${v.earliestStart}〜${v.latestStart}` : v.earliestStart;
}
