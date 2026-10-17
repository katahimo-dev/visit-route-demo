// 退職・担当替えの一括振り直し（PRD D71。ADR-0015）：〈スタッフ〉に最終勤務日を入れたら、その翌日以降にその人が
// 担当する訪問（確定した割当・今の案）と、その人をいつもの担当・パターンの担当・担当できる人にしている〈利用者さん〉を
// 一覧にし、〈利用者さん〉ごとに代わりの候補を出す。選んだ人で「まとめて適用」する（訪問の案は作り直さない）。
// 純粋関数（データは書き換えず、新しい DemoData を返す）
import type { DemoData, ReassignInfo } from '../contracts/data';
import type { Client } from '../contracts/documents';
import { isOnLeave } from '../domain/leaves';
import { NONE } from '../domain/scheduleModel';
import { addDays } from '../domain/time';
import { compile } from '../matching';
import { applyPatterns, splitPattern } from '../patterns';
import { fitsOf } from '../reassign';
import { baseOf } from './absences';
import { attempt, own } from './common';

/** 候補を数える見本の期間（日。最終勤務日の翌日（今日より前なら今日）から） */
export const OFFBOARD_SAMPLE_DAYS = 28;

/** 〈利用者さん〉がその人をどう持っているか：いつもの担当／定期パターンのいつもの担当／担当できる人 */
export type OffboardRole = 'usual' | 'pattern' | 'allowed';

/** 最終勤務日の後に、その人が担当している訪問 */
export type OffboardVisit = {
  date: string;
  visitId: string;
  clientId: string;
  /** 確定した割当で担当 */
  confirmed: boolean;
  /** 今の案で担当 */
  plan: boolean;
};

/** 代わりの候補 */
export type OffboardCandidate = {
  staffId: string;
  /** 見本の訪問のうち、他の人の担当・順番・開始を変えずに入れられる回（reassign の fitsOf） */
  fits: number;
  /** 見本の期間に、いつもの担当（パターンの担当、無ければ〈利用者さん〉の担当）になっている訪問の数（少ないほど上） */
  load: number;
};

export type OffboardClient = {
  clientId: string;
  roles: OffboardRole[];
  /** その人をいつもの担当にしている定期パターン（最終勤務日の後も続くもの） */
  patternIds: string[];
  /** 見本の訪問の数（見本の期間の、その〈利用者さん〉の予定に入る訪問） */
  sample: number;
  /** 入れる回の多い順、同じなら受け持ちの少ない順、名前の順 */
  candidates: OffboardCandidate[];
};

export type OffboardScope = {
  staffId: string;
  lastDay: string;
  /** 数え始める日（最終勤務日の翌日。今日より前なら今日） */
  from: string;
  visits: OffboardVisit[];
  clients: OffboardClient[];
};

/** 数え始める日 from に勤めている利用中の人か（最終勤務日が無いか from 以降） */
const worksOn = (s: { active: boolean; lastDay: string | null }, from: string) =>
  s.active && (s.lastDay === null || s.lastDay >= from);

/**
 * その人を持っている〈利用者さん〉（終了の人は除く）と、続く定期パターン。
 * 担当できる人は、その人のほかに from に勤める人がいないときだけ数える（ほかに残る人がいれば、その人たちで担当できる。
 * まとめて適用で代わりの人を足したあとも数えない）
 */
function rolesOf(data: Pick<DemoData, 'clients' | 'patterns' | 'staff'>, staffId: string, from: string) {
  const out = new Map<string, { roles: Set<OffboardRole>; patternIds: string[] }>();
  const at = (c: Client) => {
    let x = out.get(c.id);
    if (!x) {
      x = { roles: new Set(), patternIds: [] };
      out.set(c.id, x);
    }
    return x;
  };
  const byId = new Map(data.clients.map((c) => [c.id, c]));
  const staffById = new Map(data.staff.map((s) => [s.id, s]));
  for (const c of data.clients) {
    if (c.stage === 'ended') continue;
    if (c.usualStaffId === staffId) at(c).roles.add('usual');
    const others = c.allowedStaffIds.filter((id) => id !== staffId);
    const left = others.some((id) => {
      const s = staffById.get(id);
      return !!s && worksOn(s, from);
    });
    if (c.allowedStaffIds.includes(staffId) && !left) at(c).roles.add('allowed');
  }
  for (const p of data.patterns) {
    const c = byId.get(p.clientId);
    if (!c || c.stage === 'ended' || p.usualStaffId !== staffId) continue;
    if (p.to !== null && p.to < from) continue;
    const x = at(c);
    x.roles.add('pattern');
    x.patternIds.push(p.id);
  }
  return out;
}

const ROLE_ORDER: OffboardRole[] = ['usual', 'pattern', 'allowed'];

/**
 * 最終勤務日のある〈スタッフ〉の振り直しの範囲と候補。最終勤務日が無い・いない人は null。
 * 候補は、見本の期間（from から OFFBOARD_SAMPLE_DAYS 日。定期パターンの未展開の回も入れる）のその〈利用者さん〉の訪問ごとに、
 * その日の問題（その〈利用者さん〉の担当できる人の決まりを外したもの。必須の条件・稼働時間・種類の条件は効く）と、
 * その日の案（確定した割当、無ければ今の案。その人の列は除く）に fitsOf で入れられる人を数える。
 * withCandidates が false なら候補を数えない（candidates は空・sample は 0。件数だけ見たいとき）
 */
export function offboardScope(
  data: DemoData,
  staffId: string,
  today: string,
  withCandidates = true,
): OffboardScope | null {
  const s = data.staff.find((x) => x.id === staffId);
  if (!s || s.lastDay === null) return null;
  const lastDay = s.lastDay;
  const next = addDays(lastDay, 1);
  const from = next < today ? today : next;
  const clientById = new Map(data.clients.map((c) => [c.id, c]));

  // ---- 最終勤務日の後に担当している訪問 ----
  const visitById = new Map(data.visits.map((v) => [v.id, v]));
  const found = new Map<string, OffboardVisit>();
  const take = (date: string, ids: readonly string[] | undefined, kind: 'confirmed' | 'plan') => {
    for (const id of ids ?? []) {
      const v = visitById.get(id);
      if (!v || v.date !== date || v.cancelled || isOnLeave(data.clientLeaves, v)) continue;
      if (!clientById.get(v.clientId)?.active) continue;
      const x = found.get(id) ?? { date, visitId: id, clientId: v.clientId, confirmed: false, plan: false };
      x[kind] = true;
      found.set(id, x);
    }
  };
  for (const [date, cols] of Object.entries(data.manualPlans))
    if (date >= from) take(date, own(cols, staffId), 'confirmed');
  for (const [date, plan] of Object.entries(data.aiPlans))
    if (date >= from) take(date, own(plan.routes, staffId), 'plan');
  const visits = [...found.values()].sort((a, b) => a.date.localeCompare(b.date) || a.visitId.localeCompare(b.visitId));

  // ---- 〈利用者さん〉と候補 ----
  const roles = rolesOf(data, staffId, from);
  const targetIds = new Set(roles.keys());
  const to = addDays(from, OFFBOARD_SAMPLE_DAYS - 1);
  // 見本の期間の訪問（定期パターンの未展開の回も入れる。データは書き換えない）
  const expanded = applyPatterns(data, { from, to }, today).visits;
  const inRange = expanded.filter(
    (v) => v.date >= from && v.date <= to && !v.cancelled && !isOnLeave(data.clientLeaves, v),
  );
  // 担当できる人の決まりを外す（置き換えるので）。ほかの必須の条件はそのまま効く
  const hypo: DemoData = {
    ...data,
    clients: data.clients.map((c) => (targetIds.has(c.id) ? { ...c, allowedStaffIds: [] } : c)),
  };
  const fits = new Map<string, Map<string, number>>();
  const sample = new Map<string, number>();
  const dates = withCandidates
    ? [...new Set(inRange.filter((v) => targetIds.has(v.clientId)).map((v) => v.date))].sort()
    : [];
  for (const date of dates) {
    const dayVisits = inRange.filter((v) => v.date === date);
    const p = attempt(() => compile({ ...hypo, visits: dayVisits }, date)).value;
    if (!p) continue;
    // その日の案：確定した割当は開始の順に並べる（strict で回れる順。振り直しの元の案と同じ lib/absences の baseOf）
    const base = baseOf(data, date, p);
    const routes: Record<string, string[]> = {};
    for (const [k, ids] of Object.entries(base?.routes ?? {})) if (k !== staffId && k !== NONE) routes[k] = [...ids];
    for (const v of dayVisits) {
      if (!targetIds.has(v.clientId) || !p.visits.some((x) => x.id === v.id)) continue;
      sample.set(v.clientId, (sample.get(v.clientId) ?? 0) + 1);
      const m = fits.get(v.clientId) ?? new Map<string, number>();
      for (const f of fitsOf(p, routes, v.id)) m.set(f.staffId, (m.get(f.staffId) ?? 0) + 1);
      fits.set(v.clientId, m);
    }
  }
  // 受け持ち：見本の期間に、いつもの担当になっている訪問の数
  const patternById = new Map(data.patterns.map((p) => [p.id, p]));
  const load = new Map<string, number>();
  for (const v of inRange) {
    const c = clientById.get(v.clientId);
    if (!c?.active) continue;
    const p = v.pattern ? patternById.get(v.pattern.id) : undefined;
    const usual = p?.usualStaffId ?? c.usualStaffId;
    if (usual) load.set(usual, (load.get(usual) ?? 0) + 1);
  }
  const nameOf = new Map(data.staff.map((x) => [x.id, x.name]));
  // 候補にするのは、利用中で、数え始める日にまだ勤めている人
  const pool = data.staff.filter((x) => x.id !== staffId && worksOn(x, from));
  const clients: OffboardClient[] = [...roles]
    .map(([clientId, r]) => {
      const m = fits.get(clientId) ?? new Map<string, number>();
      const candidates = !withCandidates
        ? []
        : pool
            .map((x) => ({ staffId: x.id, fits: m.get(x.id) ?? 0, load: load.get(x.id) ?? 0 }))
            .sort(
              (a, b) =>
                b.fits - a.fits ||
                a.load - b.load ||
                (nameOf.get(a.staffId) ?? '').localeCompare(nameOf.get(b.staffId) ?? '', 'ja'),
            );
      return {
        clientId,
        roles: ROLE_ORDER.filter((x) => r.roles.has(x)),
        patternIds: r.patternIds,
        sample: sample.get(clientId) ?? 0,
        candidates,
      };
    })
    .sort((a, b) =>
      (clientById.get(a.clientId)?.displayName ?? '').localeCompare(
        clientById.get(b.clientId)?.displayName ?? '',
        'ja',
      ),
    );
  return { staffId, lastDay, from, visits, clients };
}

/** 既定の選び：入れる回が1回以上ある先頭の候補（無ければ null＝だれにもしない） */
export function defaultChoice(c: OffboardClient): string | null {
  return c.candidates.find((x) => x.fits > 0)?.staffId ?? null;
}

/** まとめて適用の結果。renamed は分けたパターンの回で ID を付け替えた訪問の数 */
export type OffboardApplied = { data: DemoData; renamed: number };

/** 訪問 ID を付け替える（列・未割当・固定・振り直しの元の案など、訪問 ID を持つ所すべて） */
function renameVisitIds(d: DemoData, map: ReadonlyMap<string, string>): DemoData {
  if (map.size === 0) return d;
  const id = (x: string) => map.get(x) ?? x;
  const list = (xs: readonly string[]) => xs.map(id);
  const routes = (r: Record<string, string[]>) =>
    Object.fromEntries(Object.entries(r).map(([k, xs]) => [k, list(xs)])) as Record<string, string[]>;
  const pins = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [id(k), v]));
  const reassign = <T extends { reassign?: ReassignInfo }>(x: T): T => {
    const r = x.reassign;
    if (!r) return x;
    return {
      ...x,
      reassign: {
        ...r,
        baseRoutes: routes(r.baseRoutes),
        basePins: pins(r.basePins),
        ...(r.baseGenerated
          ? {
              baseGenerated: {
                ...r.baseGenerated,
                routes: routes(r.baseGenerated.routes),
                unassigned: list(r.baseGenerated.unassigned),
              },
            }
          : {}),
        ...(r.insertRoutes ? { insertRoutes: routes(r.insertRoutes) } : {}),
      },
    };
  };
  return {
    ...d,
    manualPlans: Object.fromEntries(Object.entries(d.manualPlans).map(([k, r]) => [k, routes(r)])),
    aiPlans: Object.fromEntries(
      Object.entries(d.aiPlans).map(([k, p]) => [
        k,
        reassign({
          ...p,
          routes: routes(p.routes),
          unassigned: list(p.unassigned),
          generated: { ...p.generated, routes: routes(p.generated.routes), unassigned: list(p.generated.unassigned) },
          pins: pins(p.pins),
        }),
      ]),
    ),
    aiRuns: Object.fromEntries(
      Object.entries(d.aiRuns).map(([k, runs]) => [
        k,
        runs.map((r) =>
          reassign({ ...r, routes: routes(r.routes), unassigned: list(r.unassigned), pins: pins(r.pins) }),
        ),
      ]),
    ),
  };
}

/**
 * まとめて適用：choices（〈利用者さん〉ID → 代わりの人。null＝だれにもしない）のとおりに、その人の受け持ちを
 * 数え始める日 from から代わりの人に移す。from より前の日の「いつもの担当」は変えない（その人が勤める日の案を
 * 「条件が変わった」にしない）：
 * - 〈利用者さん〉のいつもの担当がその人なら、代わりの人にする
 * - 定期パターンのいつもの担当（無ければ〈利用者さん〉のいつもの担当）がその人のものは、from より前に始まって from 以降も
 *   続くなら patterns の splitPattern で from から分け（前は その人と書く＝〈利用者さん〉のいつもの担当を変えても前の日は
 *   変わらない。後ろは 代わりの人（パターンに無かったなら無いまま＝〈利用者さん〉のいつもの担当））、from 以降に始まるなら
 *   その場で代わりの人に、from より前に終わるならその人と書く
 * - 分けたパターンの回（元の日 pattern.date が from 以降。この回だけの変更・取り消しの回も）は、中身（担当・メモ・時刻）を
 *   そのままに、パターンを新しいパターンに・ID を「元の日_新しいパターンID」に付け替え、確定した割当・今の案・記録の列・未割当・
 *   固定・振り直しの元の案の古い ID も同じに置き換える（訪問を作り直さないので、ほかの人に確定していた日も崩れない）
 * - 担当できる人は代わりの人を足す（その人は最終勤務日まで勤めるので残す。後の日は勤務なしで入らない）。
 *   だれにもしないなら その人を外す（ほかにいなければ限らない）
 * 訪問の担当（案・確定した割当）は変えない（最終勤務日の後はその人が勤務なしになり、「条件が変わった」で知らせる）
 */
export function applyOffboardWith(
  d: DemoData,
  staffId: string,
  choices: Readonly<Record<string, string | null>>,
  from: string,
  today: string,
  newId: () => string,
): OffboardApplied {
  const picked = (clientId: string): string | null | undefined =>
    Object.hasOwn(choices, clientId) ? choices[clientId] : undefined;
  const before = new Map(d.clients.map((c) => [c.id, c]));
  let patterns = d.patterns;
  let visits = d.visits;
  const rename = new Map<string, string>();
  for (const p of d.patterns) {
    const to = picked(p.clientId);
    const c = before.get(p.clientId);
    if (to === undefined || !c) continue;
    // いまの実際の「いつもの担当」（パターンに無ければ〈利用者さん〉の）
    if ((p.usualStaffId ?? c.usualStaffId) !== staffId) continue;
    const after = p.usualStaffId === staffId ? to : null;
    const cur = patterns.find((y) => y.id === p.id);
    if (!cur) continue;
    if (cur.to !== null && cur.to < from) {
      // from より前に終わる：その人と書いておく（〈利用者さん〉のいつもの担当を変えても前の日は変わらない）
      patterns = patterns.map((y) => (y.id === p.id ? { ...y, usualStaffId: staffId } : y));
    } else if (cur.from >= from) {
      patterns = patterns.map((y) => (y.id === p.id ? { ...y, usualStaffId: after } : y));
    } else {
      const { id: _id, from: _from, ...rest } = cur;
      const pid = newId();
      // パターンだけ分ける（訪問は作り直さず、下で付け替える）
      const r = splitPattern(
        { patterns, visits: [], clients: d.clients },
        p.id,
        { ...rest, usualStaffId: after },
        from,
        today,
        pid,
      );
      patterns = r.patterns.map((y) => (y.id === p.id ? { ...y, usualStaffId: staffId } : y));
      visits = visits.map((v) => {
        if (v.pattern?.id !== p.id || v.pattern.date < from) return v;
        const nid = `${v.pattern.date}_${pid}`;
        rename.set(v.id, nid);
        return { ...v, id: nid, pattern: { ...v.pattern, id: pid } };
      });
    }
  }
  const clients = d.clients.map((c) => {
    const to = picked(c.id);
    if (to === undefined) return c;
    const usualStaffId = c.usualStaffId === staffId ? to : c.usualStaffId;
    let allowedStaffIds = c.allowedStaffIds;
    if (allowedStaffIds.includes(staffId)) {
      if (to === null) allowedStaffIds = allowedStaffIds.filter((id) => id !== staffId);
      else if (!allowedStaffIds.includes(to)) allowedStaffIds = [...allowedStaffIds, to];
    }
    return usualStaffId === c.usualStaffId && allowedStaffIds === c.allowedStaffIds
      ? c
      : { ...c, usualStaffId, allowedStaffIds };
  });
  return { data: renameVisitIds({ ...d, clients, patterns, visits }, rename), renamed: rename.size };
}

/** applyOffboardWith のデータだけ */
export function applyOffboard(
  d: DemoData,
  staffId: string,
  choices: Readonly<Record<string, string | null>>,
  from: string,
  today: string,
  newId: () => string,
): DemoData {
  return applyOffboardWith(d, staffId, choices, from, today, newId).data;
}

/** 「だれにもしない」で担当できる人が空になる（担当を限らなくなる）〈利用者さん〉 */
export function unlimitedBy(
  d: Pick<DemoData, 'clients'>,
  staffId: string,
  choices: Readonly<Record<string, string | null>>,
): string[] {
  return d.clients
    .filter(
      (c) =>
        Object.hasOwn(choices, c.id) &&
        choices[c.id] === null &&
        c.allowedStaffIds.length > 0 &&
        c.allowedStaffIds.every((id) => id === staffId),
    )
    .map((c) => c.id);
}
