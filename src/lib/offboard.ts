// 退職・担当替えの一括振り直し（PRD D71。ADR-0015・ADR-0053）：〈スタッフ〉に最終勤務日を入れたら、その翌日以降にその人が
// 担当する訪問と、その人を繰り返しの担当・担当できる人にしている〈利用者さん〉を一覧にし、〈利用者さん〉ごとに代わりの候補を出す。
// 選んだ人で「まとめて適用」する（繰り返しの担当を替え、保存した回の担当も替える）。
// 純粋関数（データは書き換えず、新しい DemoData を返す）
import type { DemoData } from '../contracts/data';
import type { Client, Visit } from '../contracts/documents';
import { isOnLeave } from '../domain/leaves';
import { addDays } from '../domain/time';
import { compile } from '../matching';
import { splitPattern, visitsIn } from '../patterns';
import { fitsOf } from '../reassign';
import { attempt, own } from './common';
import { dayRoutes } from './dayPlan';

/** 候補を数える見本の期間（日。最終勤務日の翌日（今日より前なら今日）から） */
export const OFFBOARD_SAMPLE_DAYS = 28;

/** 〈利用者さん〉がその人をどう持っているか：繰り返しの担当／担当できる人 */
export type OffboardRole = 'pattern' | 'allowed';

/** 最終勤務日の後に、その人が担当している訪問 */
export type OffboardVisit = {
  date: string;
  visitId: string;
  clientId: string;
  /** 伝えた日（確定した日）の訪問 */
  confirmed: boolean;
  /** 担当している（いつも true） */
  plan: boolean;
};

/** 代わりの候補 */
export type OffboardCandidate = {
  staffId: string;
  /** 見本の訪問のうち、他の人の担当・順番・開始を変えずに入れられる回（reassign の fitsOf） */
  fits: number;
  /** 見本の期間に、担当になっている訪問の数（少ないほど上） */
  load: number;
};

export type OffboardClient = {
  clientId: string;
  roles: OffboardRole[];
  /** その人を担当にしている繰り返し（最終勤務日の後も続くもの） */
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

const ROLE_ORDER: OffboardRole[] = ['pattern', 'allowed'];

/**
 * 最終勤務日のある〈スタッフ〉の振り直しの範囲と候補。最終勤務日が無い・いない人は null。
 * 候補は、見本の期間（from から OFFBOARD_SAMPLE_DAYS 日）のその〈利用者さん〉の訪問ごとに、
 * その日の問題（その〈利用者さん〉の担当できる人の決まりを外したもの。必須の条件・稼働時間・種類の条件は効く）と、
 * その日の担当の並び（その人の列は除く）に fitsOf で入れられる人を数える。
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

  // ---- 最終勤務日の後に担当している訪問（見本の期間の回と、それより後の保存した回）----
  const sampleTo = addDays(from, OFFBOARD_SAMPLE_DAYS - 1);
  const live = (v: Visit) =>
    v.staffId === staffId && !v.cancelled && !isOnLeave(data.clientLeaves, v) && !!clientById.get(v.clientId)?.active;
  const found = new Map<string, OffboardVisit>();
  const take = (v: Visit) => {
    if (!live(v) || found.has(v.id)) return;
    found.set(v.id, {
      date: v.date,
      visitId: v.id,
      clientId: v.clientId,
      confirmed: !!own(data.snapshots, v.date),
      plan: true,
    });
  };
  for (const v of visitsIn(data, { from, to: sampleTo })) take(v);
  for (const v of data.visits) if (v.date > sampleTo) take(v);
  const visits = [...found.values()].sort((a, b) => a.date.localeCompare(b.date) || a.visitId.localeCompare(b.visitId));

  // ---- 〈利用者さん〉と候補 ----
  const roles = rolesOf(data, staffId, from);
  const targetIds = new Set(roles.keys());
  // 見本の期間の訪問（繰り返しの計算した回も入る。データは書き換えない）
  const inRange = visitsIn(data, { from, to: sampleTo }).filter(
    (v) => !v.cancelled && !isOnLeave(data.clientLeaves, v),
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
    const p = attempt(() => compile(hypo, date)).value;
    if (!p) continue;
    // その日の担当の並び（その人の列は除く）
    const routes: Record<string, string[]> = {};
    for (const [k, ids] of Object.entries(dayRoutes(data, date, p))) if (k !== staffId) routes[k] = [...ids];
    for (const v of dayVisits) {
      if (!targetIds.has(v.clientId) || !p.visits.some((x) => x.id === v.id)) continue;
      sample.set(v.clientId, (sample.get(v.clientId) ?? 0) + 1);
      const m = fits.get(v.clientId) ?? new Map<string, number>();
      for (const f of fitsOf(p, routes, v.id)) m.set(f.staffId, (m.get(f.staffId) ?? 0) + 1);
      fits.set(v.clientId, m);
    }
  }
  // 受け持ち：見本の期間に、担当になっている訪問の数
  const load = new Map<string, number>();
  for (const v of inRange) {
    if (!clientById.get(v.clientId)?.active || v.staffId === null) continue;
    load.set(v.staffId, (load.get(v.staffId) ?? 0) + 1);
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

/** まとめて適用の結果。renamed は分けた繰り返しの回で ID を付け替えた訪問（この回だけ変えた回）の数 */
export type OffboardApplied = { data: DemoData; renamed: number };

/**
 * まとめて適用：choices（〈利用者さん〉ID → 代わりの人。null＝だれにもしない）のとおりに、その人の受け持ちを
 * 数え始める日 from から代わりの人に移す（版2。ADR-0053）：
 * - 繰り返しの担当がその人のものは、from より前に始まって from 以降も続くなら patterns の splitPattern で from から分け
 *   （前はその人のまま、後ろは代わりの人）、from 以降に始まるならその場で代わりの人に、from より前に終わるならそのまま。
 *   分けた繰り返しの回は計算し直す（この回だけ変えていない保存した回は消え、新しい担当で出る）
 * - from 以降の保存した回で、担当がその人のもの（その〈利用者さん〉の分）は、代わりの人に替える（ピン・組んだ開始は外す）。
 *   だれにもしないなら担当なしにする
 * - 担当できる人は代わりの人を足す（その人は最終勤務日まで勤めるので残す。後の日は勤務なしで入らない）。
 *   だれにもしないなら その人を外す（ほかにいなければ限らない）
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
  let patterns = d.patterns;
  let visits = d.visits;
  let renamed = 0;
  for (const p of d.patterns) {
    const to = picked(p.clientId);
    if (to === undefined || p.usualStaffId !== staffId) continue;
    const cur = patterns.find((y) => y.id === p.id);
    if (!cur || (cur.to !== null && cur.to < from)) continue;
    if (cur.from >= from) {
      patterns = patterns.map((y) => (y.id === p.id ? { ...y, usualStaffId: to } : y));
      continue;
    }
    const { id: _id, from: _from, ...rest } = cur;
    const pid = newId();
    const r = splitPattern(
      { patterns, visits, clients: d.clients },
      p.id,
      { ...rest, usualStaffId: to },
      from,
      today,
      pid,
    );
    renamed += r.visits.filter((v) => v.pattern?.id === pid).length;
    patterns = r.patterns;
    visits = r.visits;
  }
  // from 以降の保存した回で、担当がその人のものを代わりの人に（その〈利用者さん〉を選んだときだけ）
  visits = visits.map((v) => {
    if (v.date < from || v.staffId !== staffId) return v;
    const to = picked(v.clientId);
    if (to === undefined) return v;
    return { ...v, staffId: to, start: null, pinned: false };
  });
  const clients = d.clients.map((c) => {
    const to = picked(c.id);
    if (to === undefined) return c;
    let allowedStaffIds = c.allowedStaffIds;
    if (allowedStaffIds.includes(staffId)) {
      if (to === null) allowedStaffIds = allowedStaffIds.filter((id) => id !== staffId);
      else if (!allowedStaffIds.includes(to)) allowedStaffIds = [...allowedStaffIds, to];
    }
    return allowedStaffIds === c.allowedStaffIds ? c : { ...c, allowedStaffIds };
  });
  return { data: { ...d, clients, patterns, visits }, renamed };
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
