// DemoData（その日の訪問・スタッフ・項目・条件・相性）→ Problem（可否・費用表・移動の行列）
import { TRAVEL_MODES, type TravelMode } from '../contracts/codes';
import type { DemoData } from '../contracts/data';
import type { Client, LatLng, Place, Staff } from '../contracts/documents';
import type { Problem, ProblemStaff, ProblemVisit, Reason } from '../contracts/problem';
import { type Condition, type Item, POINTS_PER_WEIGHT, type Rule, type Traits } from '../contracts/rules';
import { availabilityOf } from '../domain/availability';
import { estimateLeg } from '../domain/geo';
import { hhmmToMinutes } from '../domain/time';
import { conditionText, matches } from './conditions';
import { fitStart } from './timing';

const INF = Number.POSITIVE_INFINITY;
/** infeasible に載せる原因の数 */
const INFEASIBLE_REASONS = 3;

function latLngOf(p: Place): LatLng | null {
  return p.lat === null || p.lng === null ? null : { lat: p.lat, lng: p.lng };
}

/** その日の稼働時間帯（分、開始の順） */
function slotsOf(data: DemoData, s: Staff, date: string): { start: number; end: number }[] {
  const override = data.availability.find((a) => a.staffId === s.id && a.date === date);
  return availabilityOf(s, date, override)
    .slots.map((x) => ({ start: hhmmToMinutes(x.start), end: hhmmToMinutes(x.end) }))
    .filter((x) => x.start < x.end)
    .sort((a, b) => a.start - b.start);
}

/** 事業所の多数決の移動手段（同数なら TRAVEL_MODES の順） */
function majorityMode(staff: Staff[]): TravelMode {
  let best: TravelMode = 'DRIVE';
  let bestCount = 0;
  for (const m of TRAVEL_MODES) {
    const c = staff.filter((s) => s.travelMode === m).length;
    if (c > bestCount) {
      best = m;
      bestCount = c;
    }
  }
  return best;
}

/** 有効な条件（weight 0 かつ hard false は無効） */
function isActive(r: Rule): boolean {
  return r.weight > 0 || r.hard;
}

/** 条件1つの判定から理由を作る（満たせば points 0、満たさなければ 重み×10 か hard なら Infinity） */
function condReasons(
  rule: Rule,
  conds: Condition[],
  items: Map<string, Item>,
  target: 'staff' | 'client',
  traits: Traits,
  okLabel: (text: string) => string,
  ngLabel: (text: string) => string,
  out: Reason[],
): void {
  for (const c of conds) {
    const item = items.get(c.itemId);
    // 参照する項目がない（消された・相手側の項目でない）条件は無視する
    if (!item || item.target !== target) continue;
    const text = conditionText(c, item);
    if (matches(c, item, traits[c.itemId])) {
      out.push({ ruleId: rule.id, label: okLabel(text), points: 0 });
    } else {
      out.push({ ruleId: rule.id, label: ngLabel(text), points: rule.hard ? INF : rule.weight * POINTS_PER_WEIGHT });
    }
  }
}

/** 手直しで固定した訪問の、固定した担当以外の可否の原因 */
export const PIN_RULE_ID = 'pin';
export const PIN_LABEL = '固定（手直し）';

/**
 * その日の問題を作る（キャンセルした訪問・休止中のスタッフ/訪問先は入れない）。
 * pins（訪問ID → 担当ID）の訪問は、固定した担当だけを可にする（他の担当は「固定（手直し）」で外す）。
 * 固定した担当がこの日の問題にいないときは固定を無視する
 */
export function compile(data: DemoData, date: string, pins?: Record<string, string>): Problem {
  const terms = data.org.terms;
  const staffDocs = data.staff.filter((s) => s.active);
  const clients = new Map<string, Client>(data.clients.filter((c) => c.active).map((c) => [c.id, c]));
  const visitDocs = data.visits.filter((v) => v.date === date && !v.cancelled && clients.has(v.clientId));
  const items = new Map(data.items.map((it) => [it.id, it]));
  const rules = data.rules.filter(isActive);

  const S = staffDocs.length;
  const staff: ProblemStaff[] = staffDocs.map((s, i) => ({
    id: s.id,
    name: s.name,
    point: i,
    slots: slotsOf(data, s, date),
  }));
  const visits: ProblemVisit[] = visitDocs.map((v, j) => {
    const earliest = hhmmToMinutes(v.earliestStart);
    return {
      id: v.id,
      clientId: v.clientId,
      point: S + j,
      earliest,
      latest: v.windowKind === 'fixed' ? earliest : hhmmToMinutes(v.latestStart),
      duration: v.durationMinutes,
    };
  });

  // --- 地点と移動の行列 ---
  const places: (LatLng | null)[] = [
    ...staffDocs.map((s) => latLngOf(s.home)),
    ...visitDocs.map((v) => latLngOf(clients.get(v.clientId)!.place)),
  ];
  const P = places.length;
  const common = majorityMode(staffDocs);
  // 自宅が絡む区間はそのスタッフの手段（出る側を優先）、訪問先どうしは多数決の手段
  const modeOf = (i: number, j: number): TravelMode =>
    i < S ? staffDocs[i]!.travelMode : j < S ? staffDocs[j]!.travelMode : common;
  const travel: number[][] = [];
  const meters: number[][] = [];
  for (let i = 0; i < P; i++) {
    const tr = new Array<number>(P).fill(0);
    const me = new Array<number>(P).fill(0);
    const a = places[i];
    for (let j = 0; j < P && a; j++) {
      const b = places[j];
      if (i === j || !b) continue;
      const leg = estimateLeg(a, b, modeOf(i, j));
      tr[j] = leg.seconds / 60;
      me[j] = leg.meters;
    }
    travel.push(tr);
    meters.push(me);
  }

  // --- 可否・割当費用・理由 ---
  const staffIds = new Set(staff.map((s) => s.id));
  const working = new Set(staff.filter((s, i) => s.slots.length > 0 && places[i]).map((s) => s.id));
  const firstCompat = rules.find((r) => r.type === 'compatibility')?.id ?? 'compatibility';
  const allowed: boolean[][] = [];
  const assignCost: number[][] = [];
  const reasons: Reason[][][] = [];
  for (let j = 0; j < visits.length; j++) {
    const pv = visits[j]!;
    const client = clients.get(pv.clientId)!;
    const rowAllowed: boolean[] = [];
    const rowCost: number[] = [];
    const rowReasons: Reason[][] = [];
    for (let i = 0; i < S; i++) {
      const s = staffDocs[i]!;
      const ps = staff[i]!;
      const out: Reason[] = [];
      if (!places[S + j]) out.push({ ruleId: 'noPlace', label: `${terms.client}の位置が未登録`, points: INF });
      if (!places[i]) out.push({ ruleId: 'noPlace', label: `${terms.staff}の自宅の位置が未登録`, points: INF });
      if (pv.earliest > pv.latest) out.push({ ruleId: 'time', label: '時間の約束の幅が正しくない', points: INF });
      if (ps.slots.length === 0) {
        out.push({ ruleId: 'slot', label: '休み', points: INF });
      } else if (pv.earliest <= pv.latest && !(fitStart(ps.slots, pv.earliest, pv.duration) <= pv.latest)) {
        out.push({ ruleId: 'slot', label: '稼働時間帯に作業が収まらない', points: INF });
      }
      const level = data.compat[client.id]?.[s.id] ?? 0;
      // 相性×は重み・hard にかかわらず外す
      if (level === -2) out.push({ ruleId: firstCompat, label: '相性×', points: INF });
      const pin = pins?.[pv.id];
      if (pin !== undefined && pin !== s.id && staffIds.has(pin)) {
        out.push({ ruleId: PIN_RULE_ID, label: PIN_LABEL, points: INF });
      }
      for (const r of rules) {
        const w = r.weight * POINTS_PER_WEIGHT;
        switch (r.type) {
          case 'clientRequirement':
            condReasons(
              r,
              client.requirements,
              items,
              'staff',
              s.traits,
              (t) => `必要条件：${t} ✓`,
              (t) => `必要条件：${t} ✗`,
              out,
            );
            break;
          case 'clientPreference':
            condReasons(
              r,
              client.preferences,
              items,
              'staff',
              s.traits,
              (t) => `希望○ ${t}`,
              (t) => `希望✗ ${t}`,
              out,
            );
            break;
          case 'staffRequirement':
            condReasons(
              r,
              s.requirements,
              items,
              'client',
              client.traits,
              (t) => `${terms.staff}の必要条件：${t} ✓`,
              (t) => `${terms.staff}の必要条件：${t} ✗`,
              out,
            );
            break;
          case 'staffPreference':
            condReasons(
              r,
              s.preferences,
              items,
              'client',
              client.traits,
              (t) => `${terms.staff}の希望○ ${t}`,
              (t) => `${terms.staff}の希望✗ ${t}`,
              out,
            );
            break;
          case 'compatibility':
            if (level === 2) out.push({ ruleId: r.id, label: '相性◎', points: 0 - w });
            else if (level === 1) out.push({ ruleId: r.id, label: '相性○', points: 0 - w / 2 });
            else if (level === -1) out.push({ ruleId: r.id, label: '相性△', points: r.hard ? INF : w });
            break;
          case 'continuity': {
            const usual = client.usualStaffId;
            // いつもの担当がその日に働かないなら、この条件は無視する
            if (!usual || !working.has(usual)) break;
            if (usual === s.id) out.push({ ruleId: r.id, label: 'いつもの担当', points: 0 });
            else out.push({ ruleId: r.id, label: 'いつもの担当でない', points: r.hard ? INF : w });
            break;
          }
          default:
            break; // balance・wait は割当費用に入らない
        }
      }
      out.sort((a, b) => b.points - a.points || 0);
      let cost = 0;
      let ok = true;
      for (const x of out) {
        if (x.points === INF) ok = false;
        else cost += x.points;
      }
      rowAllowed.push(ok);
      rowCost.push(cost);
      rowReasons.push(out);
    }
    allowed.push(rowAllowed);
    assignCost.push(rowCost);
    reasons.push(rowReasons);
  }

  // --- どの担当も可にならない訪問 ---
  const infeasible: Problem['infeasible'] = [];
  for (let j = 0; j < visits.length; j++) {
    if (allowed[j]!.some(Boolean)) continue;
    const count = new Map<string, { r: Reason; n: number }>();
    for (let i = 0; i < S; i++) {
      for (const r of reasons[j]![i]!) {
        if (r.points !== INF) continue;
        const key = `${r.ruleId}\u0000${r.label}`;
        const e = count.get(key);
        if (e) e.n++;
        else count.set(key, { r, n: 1 });
      }
    }
    const list = [...count.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, INFEASIBLE_REASONS)
      .map(({ r, n }) => ({ ruleId: r.ruleId, label: `${r.label}（${n}人）`, points: INF }));
    if (S === 0) list.push({ ruleId: 'slot', label: `この日に働ける${terms.staff}がいない`, points: INF });
    infeasible.push({ visit: j, reasons: list });
  }

  // --- 負担の均等：可になる訪問の件数を稼働分に比例して配る ---
  const balanceRules = rules.filter((r) => r.type === 'balance');
  const wBalance = balanceRules.reduce((a, r) => a + r.weight, 0);
  const hardBalance = balanceRules.some((r) => r.hard);
  let balance: Problem['balance'] = null;
  if (wBalance > 0 || hardBalance) {
    const n = visits.length - infeasible.length;
    const cap = staff.map((s) => (working.has(s.id) ? s.slots.reduce((a, x) => a + (x.end - x.start), 0) : 0));
    const total = cap.reduce((a, b) => a + b, 0);
    if (total > 0) {
      const target = cap.map((c) => (n * c) / total);
      const hi = target.map((t) => Math.ceil(t - 1e-9));
      balance = {
        perVisit: wBalance * POINTS_PER_WEIGHT,
        lo: target.map((t) => Math.floor(t + 1e-9)),
        hi,
        // 必須なら上限＝目安の上＋1（休みの人は 0＋1。休みの人はもともと可否で外れる）
        cap: hardBalance ? hi.map((h) => h + 1) : null,
      };
    }
  }
  const wWait = rules.filter((r) => r.type === 'wait').reduce((a, r) => a + r.weight, 0);

  return {
    date,
    staff,
    visits,
    travel,
    meters,
    allowed,
    assignCost,
    reasons,
    waitPerMinute: wWait * 0.1,
    balance,
    infeasible,
  };
}
