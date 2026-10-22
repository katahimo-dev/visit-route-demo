// 版2の日の割当（ADR-0053。design.md §5「訪問と日の割当」）。担当・開始・ピンは訪問が持ち、その日の割当は
// 「その日の訪問の担当と開始の並び」から決まる（routesOf）。AI の提案・手で替えた担当は writeRoutes で訪問に書く。
// 確定＝〈スタッフ〉に伝えた内容（DaySnapshot）で、確定したあとの変更は toldChanges で「未連絡の変更」になる。
// 要対応は訪問ごとの検査（visitIssues：担当なし・担当が休み・必須の条件に合わない・時間の約束に間に合わない）。
// どれも純粋関数（DemoData を書き換えない。今の時刻は引数）
import type { DaySnapshot, DemoData, ToldVisit } from '../contracts/data';
import type { Visit } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import type { ContactList, ContactVisit, Routes, StaffContact } from '../contracts/reassign';
import { leaveOn } from '../domain/leaves';
import { hhmmToMinutes, minutesToHhmm } from '../domain/time';
import { score } from '../evaluate';
import { type CompileInput, compile, scheduleRoute } from '../matching';
import { putVisits, visitsOn } from '../patterns';
import { attempt, own } from './common';

/** その日の訪問（保存した回＋繰り返しから計算した回。取り消し・休みも含む。開始の順） */
export const dayVisits = (data: Pick<DemoData, 'visits' | 'patterns' | 'clients'>, date: string): Visit[] =>
  visitsOn(data, date);

/**
 * その日の計算に入れる訪問（取り消し・〈利用者さん〉の休み・利用中でない〈利用者さん〉の訪問を除く。compile と同じ）
 */
export function activeDayVisits(
  data: Pick<DemoData, 'visits' | 'patterns' | 'clients' | 'clientLeaves'>,
  date: string,
): Visit[] {
  const active = new Set(data.clients.filter((c) => c.active).map((c) => c.id));
  const leaves = data.clientLeaves.filter((l) => l.from <= date && date <= l.to);
  return visitsOn(data, date).filter(
    (v) => !v.cancelled && active.has(v.clientId) && leaveOn(leaves, v.clientId, date) === null,
  );
}

/** その日の問題（作れなければ null） */
export const dayProblemOf = (data: CompileInput, date: string, pins?: Record<string, string>): Problem | null =>
  attempt(() => compile(data, date, pins)).value;

/**
 * 担当の並び（staffId → 訪問IDの列。回る順＝開始の順）。問題の訪問のうち、担当が問題にいる人の訪問だけ
 * （担当なし・休止中の人の訪問は列に入らない）
 */
export function routesOf(problem: Problem, visits: readonly Visit[]): Routes {
  const inProblem = new Set(problem.visits.map((v) => v.id));
  const staffIn = new Set(problem.staff.map((s) => s.id));
  const out: Routes = {};
  // visits は開始の順（visitsOn）
  for (const v of visits) {
    if (!inProblem.has(v.id) || v.staffId === null || !staffIn.has(v.staffId)) continue;
    const col = Object.hasOwn(out, v.staffId) ? out[v.staffId]! : [];
    if (col.length === 0) out[v.staffId] = col;
    col.push(v.id);
  }
  return out;
}

/** その日の担当の並び（problem を渡すとそれを使う） */
export function dayRoutes(data: CompileInput, date: string, problem: Problem): Routes {
  return routesOf(problem, visitsOn(data, date));
}

/** ピン（訪問ID → 担当ID）。担当のある、ピンの訪問だけ */
export function pinsOf(visits: readonly Visit[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of visits) if (v.pinned && v.staffId !== null && !v.cancelled) out[v.id] = v.staffId;
  return out;
}

/** 担当なしの訪問（問題の訪問のうち、どの列にも無いもの。問題の順） */
export function unassignedOf(problem: Problem, routes: Routes): string[] {
  const placed = new Set<string>();
  for (const s of problem.staff) for (const id of own(routes, s.id) ?? []) placed.add(id);
  return problem.visits.filter((v) => !placed.has(v.id)).map((v) => v.id);
}

/** 訪問ID → 担当 */
export function ownerOf(routes: Routes): Map<string, string> {
  const out = new Map<string, string>();
  for (const [s, ids] of Object.entries(routes)) for (const id of ids) if (!out.has(id)) out.set(id, s);
  return out;
}

/** 列ごとの lenient の時刻（訪問ID → { 担当, 開始（分） }）。問題に無い訪問・人は除く */
export function startsOf(problem: Problem, routes: Routes): Map<string, { staffId: string; start: number }> {
  const vIndex = new Map(problem.visits.map((v, i) => [v.id, i]));
  const out = new Map<string, { staffId: string; start: number }>();
  problem.staff.forEach((st, si) => {
    const seq: number[] = [];
    for (const id of own(routes, st.id) ?? []) {
      const j = vIndex.get(id);
      if (j === undefined || out.has(id) || seq.includes(j)) continue;
      seq.push(j);
    }
    const t = scheduleRoute(problem, si, seq, 'lenient');
    for (const stop of t?.stops ?? []) out.set(stop.visitId, { staffId: st.id, start: stop.start });
  });
  return out;
}

/** 分 → HH:mm（0:00〜23:59 に収める） */
const clockOf = (minutes: number): string => minutesToHhmm(Math.min(23 * 60 + 59, Math.max(0, Math.round(minutes))));

/**
 * 担当の並びを訪問に書く（AI の提案を当てる・手で担当を替える。ADR-0053）。問題の訪問ごとに、担当＝列の人（無ければ null）、
 * 開始＝列の lenient の時刻（担当なしは null）。pins を渡すとピンをそれにする（pins[訪問] がその担当なら ピン）、無ければ今のまま
 * （担当なしはピンを外す）。変わる訪問だけ保存した回に書く（計算した回も書いた回から保存する）。問題に無い訪問は変えない
 */
export function writeRoutes(
  data: DemoData,
  date: string,
  problem: Problem,
  routes: Routes,
  opts: { pins?: Record<string, string> } = {},
): DemoData {
  const at = startsOf(problem, routes);
  const inProblem = new Set(problem.visits.map((v) => v.id));
  const put: Visit[] = [];
  for (const v of visitsOn(data, date)) {
    if (!inProblem.has(v.id)) continue;
    const x = at.get(v.id);
    const staffId = x?.staffId ?? null;
    const start = x ? clockOf(x.start) : null;
    const pinned = staffId === null ? false : opts.pins ? opts.pins[v.id] === staffId : v.pinned;
    if (staffId === v.staffId && start === v.start && pinned === v.pinned) continue;
    put.push({ ...v, staffId, start, pinned });
  }
  return put.length > 0 ? { ...data, visits: putVisits(data.visits, put) } : data;
}

/** 今の担当の並びのまま、その日の開始を書き直す（時刻・日付を変えたあと。問題を作れなければそのまま） */
export function settleDay(data: DemoData, date: string): DemoData {
  const p = dayProblemOf(data, date);
  if (!p) return data;
  return writeRoutes(data, date, p, dayRoutes(data, date, p));
}

// ---- 訪問ごとの検査（要対応。ADR-0053）----

/** 要対応の種類：担当なし／担当が休み（休み・欠勤・最終勤務日の後・休止）／必須の条件に合わない／時間の約束に間に合わない */
export type IssueKind = 'unassigned' | 'off' | 'notAllowed' | 'late';
export type VisitIssue = { kind: IssueKind; label: string };

export const ISSUE_LABELS: Record<IssueKind, string> = {
  unassigned: '担当なし',
  off: '担当が休み',
  notAllowed: '条件に合わない',
  late: '時間に間に合わない',
};

/**
 * 訪問ごとの検査（問題の訪問だけ）。担当なし（担当が休止中・いない人も「担当が休み」）、担当の人がその日に働かない（休み・欠勤・
 * 最終勤務日の後）、必須の条件・相性×・種類・担当を限るに合わない、時間の約束・働ける時間に収まらない（前の訪問と重なるときも）
 */
export function visitIssues(problem: Problem, routes: Routes, visits: readonly Visit[]): Map<string, VisitIssue[]> {
  const out = new Map<string, VisitIssue[]>();
  const add = (id: string, x: VisitIssue) => {
    const list = out.get(id);
    if (list) {
      if (!list.some((y) => y.kind === x.kind && y.label === x.label)) list.push(x);
    } else out.set(id, [x]);
  };
  const owner = ownerOf(routes);
  const byId = new Map(visits.map((v) => [v.id, v]));
  for (const pv of problem.visits) {
    if (owner.has(pv.id)) continue;
    const v = byId.get(pv.id);
    if (v?.staffId) add(pv.id, { kind: 'off', label: '担当が休止中' });
    else add(pv.id, { kind: 'unassigned', label: ISSUE_LABELS.unassigned });
  }
  const sc = attempt(() => score(problem, routes)).value;
  const staffIndex = new Map(problem.staff.map((s, i) => [s.id, i]));
  const vIndex = new Map(problem.visits.map((v, i) => [v.id, i]));
  for (const h of sc?.hardViolations ?? []) {
    if (h.kind === 'notAllowed') {
      const si = staffIndex.get(h.staffId);
      const vi = vIndex.get(h.visitId);
      const offReason =
        si !== undefined && vi !== undefined
          ? problem.reasons[vi]?.[si]?.find((r) => r.ruleId === 'slot' && r.points === Number.POSITIVE_INFINITY)
          : undefined;
      if (si !== undefined && problem.staff[si]!.slots.length === 0) {
        add(h.visitId, { kind: 'off', label: offReason?.label ?? ISSUE_LABELS.off });
      } else {
        add(h.visitId, { kind: 'notAllowed', label: h.label });
      }
    } else {
      add(h.visitId, { kind: 'late', label: h.label });
    }
  }
  // 担当が休みの訪問は、時間に間に合わない（働ける時間が無い）を重ねて出さない
  for (const [id, list] of out)
    if (list.some((x) => x.kind === 'off') && list.some((x) => x.kind === 'late'))
      out.set(
        id,
        list.filter((x) => x.kind !== 'late'),
      );
  return out;
}

// ---- 確定＝伝えた内容（ADR-0053）----

/** 今の担当・開始（伝える内容。問題の訪問だけ。開始は lenient を分に丸めた時刻） */
export function toldOf(problem: Problem, routes: Routes): ToldVisit[] {
  const at = startsOf(problem, routes);
  return problem.visits.map((v) => {
    const x = at.get(v.id);
    return { id: v.id, clientId: v.clientId, staffId: x?.staffId ?? null, start: x ? clockOf(x.start) : null };
  });
}

/** その日を確定する（今の担当・開始を伝えた内容として残す） */
export function tellDay(data: DemoData, date: string, problem: Problem, at: number): DemoData {
  const snap: DaySnapshot = { date, at, visits: toldOf(problem, dayRoutes(data, date, problem)) };
  return { ...data, snapshots: { ...data.snapshots, [date]: snap } };
}

/** 伝えた状態：まだ伝えていない／伝えた／伝えたあとに変わった（未連絡の変更あり） */
export type ToldState = 'none' | 'told' | 'changed';

type Placed = { clientId: string; staffId: string | null; start: number | null };

/**
 * 2つの割当（訪問ID → 担当・開始）の差を連絡の一覧にする（reassign の contactsOf と同じ規則：開始の変化は四捨五入で1分以上）。
 * staffOrder は〈スタッフ〉の並び
 */
export function contactsBetween(
  before: ReadonlyMap<string, Placed>,
  after: ReadonlyMap<string, Placed>,
  staffOrder: readonly string[],
): ContactList {
  const ids = [...new Set([...after.keys(), ...before.keys()])];
  const staffChanged: ContactVisit[] = [];
  const timeChanged: ContactVisit[] = [];
  const byStaff = new Map<string, StaffContact>();
  const of = (staffId: string) => {
    let c = byStaff.get(staffId);
    if (!c) {
      c = { staffId, added: [], removed: [], shifted: [] };
      byStaff.set(staffId, c);
    }
    return c;
  };
  for (const id of ids) {
    const x = before.get(id);
    const y = after.get(id);
    const from = x?.staffId ?? null;
    const to = y?.staffId ?? null;
    if (from === null && to === null) continue;
    const item: ContactVisit = {
      visitId: id,
      clientId: (y ?? x)!.clientId,
      fromStaffId: from,
      toStaffId: to,
      fromStart: from === null ? null : (x?.start ?? null),
      toStart: to === null ? null : (y?.start ?? null),
    };
    if (from !== to) {
      staffChanged.push(item);
      if (from) of(from).removed.push(item);
      if (to) of(to).added.push(item);
      continue;
    }
    if (item.fromStart !== null && item.toStart !== null && Math.round(item.toStart - item.fromStart) !== 0) {
      timeChanged.push(item);
      of(to!).shifted.push(item);
    }
  }
  const when = (c: ContactVisit) => c.toStart ?? c.fromStart ?? 0;
  const sort = (xs: ContactVisit[]) => xs.sort((p, q) => when(p) - when(q) || p.visitId.localeCompare(q.visitId));
  const byFrom = (xs: ContactVisit[]) =>
    xs.sort((p, q) => (p.fromStart ?? 0) - (q.fromStart ?? 0) || p.visitId.localeCompare(q.visitId));
  const order = [...new Set([...staffOrder, ...byStaff.keys()])];
  const staff = order
    .filter((id) => byStaff.has(id))
    .map((id) => {
      const c = byStaff.get(id)!;
      return { staffId: id, added: sort(c.added), removed: byFrom(c.removed), shifted: sort(c.shifted) };
    });
  return { staffChanged: sort(staffChanged), timeChanged: sort(timeChanged), staff };
}

/** 伝えた内容の割当 */
function placedOfSnapshot(s: DaySnapshot): Map<string, Placed> {
  return new Map(
    s.visits.map((x) => [
      x.id,
      { clientId: x.clientId, staffId: x.staffId, start: x.start === null ? null : hhmmToMinutes(x.start) },
    ]),
  );
}

/** 今の割当（問題の訪問。開始は分に丸める） */
export function placedOf(problem: Problem, routes: Routes): Map<string, Placed> {
  const at = startsOf(problem, routes);
  return new Map(
    problem.visits.map((v) => {
      const x = at.get(v.id);
      return [
        v.id,
        { clientId: v.clientId, staffId: x?.staffId ?? null, start: x ? Math.round(x.start) : null },
      ] as const;
    }),
  );
}

/**
 * 伝えた内容と今の違い（未連絡の変更。連絡の一覧と同じ形）。伝えていない日は null。
 * 伝えたあとに取り消した・休みになった訪問は「外れる」（今の担当は null）
 */
export function toldChanges(
  data: Pick<DemoData, 'snapshots' | 'staff'>,
  date: string,
  problem: Problem,
  routes: Routes,
): ContactList | null {
  const snap = own(data.snapshots, date);
  if (!snap) return null;
  return contactsBetween(
    placedOfSnapshot(snap),
    placedOf(problem, routes),
    data.staff.map((s) => s.id),
  );
}

/** 連絡の一覧の件数（担当が変わる訪問＋開始が変わる訪問） */
export const changeCount = (c: ContactList | null): number => (c ? c.staffChanged.length + c.timeChanged.length : 0);

/** 伝えた状態 */
export function toldStateOf(data: Pick<DemoData, 'snapshots'>, date: string, changes: ContactList | null): ToldState {
  if (!own(data.snapshots, date)) return 'none';
  return changeCount(changes) > 0 ? 'changed' : 'told';
}

/** 未連絡の変更のある訪問の ID */
export function changedVisitIds(c: ContactList | null): Set<string> {
  return new Set([...(c?.staffChanged ?? []), ...(c?.timeChanged ?? [])].map((x) => x.visitId));
}
