// 読み込んだデータの中身の食い違いを直す（store がデータの持ち主。design.md §4）
import { type AiPlan, type AiRun, type DemoData, MAX_RUNS_PER_DAY } from '../contracts/data';
import type { Availability, Place } from '../contracts/documents';
import { type Compat, HARDABLE, MAX_PRESETS, type Preset, RULE_TYPES } from '../contracts/rules';
import { initialPresets } from '../seed/presets';

/** 手作業案の「未割当」の列（domain/scheduleModel の NONE と同じ） */
const NONE = '__none';

/** 同じ ID が2件以上あれば、最初の1件だけ残す */
function uniqueById<T extends { id: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    if (seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  });
}

/** 位置は「緯度・経度とも範囲内の数」か「両方 null」。どちらかが欠けた・範囲外なら未登録（両方 null）にする */
function repairPlace(p: Place): Place {
  if (p.lat === null && p.lng === null) return p;
  const ok =
    p.lat !== null &&
    p.lng !== null &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180;
  return ok ? p : { ...p, lat: null, lng: null };
}

/** 重みを 0〜5・0.5刻みにする（数でなければ 0） */
export function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 0;
  return Math.min(5, Math.max(0, Math.round(w * 2) / 2));
}

function repairPresets(presets: Preset[]): Preset[] {
  const out = uniqueById(presets)
    .slice(0, MAX_PRESETS)
    .map((p) => {
      const weights = Object.fromEntries(
        RULE_TYPES.map((t) => {
          const w = p.weights[t];
          return [t, { weight: clampWeight(w.weight), hard: HARDABLE.has(t) && w.hard }];
        }),
      ) as Preset['weights'];
      return JSON.stringify(weights) === JSON.stringify(p.weights) ? p : { ...p, weights };
    });
  return out.length > 0 ? out : initialPresets();
}

/**
 * 契約（zod）は通るが、中身が食い違うデータを直す。直すのは「どこからも参照できないもの」だけで、
 * 項目が消えた条件（無効として残す。design.md §4 matching）・取り消した訪問は残す。
 * - 同じ ID の重複（スタッフ・訪問先・項目・条件・訪問）は最初の1件
 * - 訪問の担当（staffId）・訪問先のいつもの担当（usualStaffId）が、いないスタッフなら null
 * - 相性・稼働時間帯の上書きの、いない訪問先・スタッフの分は消す（上書きは同じ人・同じ日の最後の1件）
 * - 手作業案（manualPlans）：いないスタッフの列は消し（訪問は担当か未割当に入り直す）、その日にない訪問・重複を除く
 * - AI案（aiPlans）・AI案の記録（aiRuns）：いないスタッフの列の訪問は未割当へ。その日にない訪問・重複を除き、固定はいる訪問・スタッフだけ。
 *   記録の ID の重複は最初の1件、1日 MAX_RUNS_PER_DAY 件を超える分は古いものから捨てる
 * - 位置の緯度・経度が片方だけ・範囲外なら未登録にする
 * - プリセット（ADR-0008）：ID の重複は最初の1件、MAX_PRESETS を超える分は後ろを捨て、0件なら初期の3種。
 *   重みは 0〜5 に収めて 0.5 刻みに丸め（数でなければ 0）、必須にできない型の必須は外す
 * - 点数の基準（scorePresetId。ADR-0010）：無い・どのプリセットでもない id なら先頭のプリセット
 * 食い違いがなければ同じ中身を返す（書き出し → 読み込みで同じデータ）
 */
export function repair(d: DemoData): DemoData {
  const staff = uniqueById(d.staff).map((s) => {
    const home = repairPlace(s.home);
    return home === s.home ? s : { ...s, home };
  });
  const staffIds = new Set(staff.map((s) => s.id));
  const clients = uniqueById(d.clients).map((c) => {
    const place = repairPlace(c.place);
    const usualStaffId = c.usualStaffId !== null && staffIds.has(c.usualStaffId) ? c.usualStaffId : null;
    return place === c.place && usualStaffId === c.usualStaffId ? c : { ...c, place, usualStaffId };
  });
  const clientIds = new Set(clients.map((c) => c.id));
  const visits = uniqueById(d.visits).map((v) =>
    v.staffId !== null && !staffIds.has(v.staffId) ? { ...v, staffId: null } : v,
  );
  const dateOf = new Map(visits.map((v) => [v.id, v.date]));

  const compat: Compat = {};
  for (const [cid, row] of Object.entries(d.compat)) {
    if (!clientIds.has(cid)) continue;
    compat[cid] = Object.fromEntries(Object.entries(row).filter(([sid]) => staffIds.has(sid)));
  }

  // 同じ人・同じ日の上書きは最後の1件（画面で保存したときと同じ）
  const avail = new Map<string, Availability>();
  for (const a of d.availability) if (staffIds.has(a.staffId)) avail.set(`${a.staffId}\u0000${a.date}`, a);
  const availability = d.availability.filter((a) => avail.get(`${a.staffId}\u0000${a.date}`) === a);

  /** その日の訪問だけ・どの列にも1回だけ */
  const onDate = (date: string, seen: Set<string>) => (id: string) => {
    if (dateOf.get(id) !== date || seen.has(id)) return false;
    seen.add(id);
    return true;
  };

  const manualPlans: DemoData['manualPlans'] = {};
  for (const [date, cols] of Object.entries(d.manualPlans)) {
    const keep = onDate(date, new Set());
    const out: Record<string, string[]> = {};
    for (const [k, ids] of Object.entries(cols)) {
      if (k !== NONE && !staffIds.has(k)) continue;
      out[k] = ids.filter(keep);
    }
    manualPlans[date] = out;
  }

  /** AI案の routes・unassigned：いないスタッフの列の訪問は未割当へ */
  const repairRoutes = (date: string, routes: Record<string, string[]>, unassigned: string[]) => {
    const keep = onDate(date, new Set());
    const out: Record<string, string[]> = {};
    const lost: string[] = [];
    for (const [k, ids] of Object.entries(routes)) {
      if (staffIds.has(k)) out[k] = ids.filter(keep);
      else lost.push(...ids);
    }
    return { routes: out, unassigned: [...unassigned, ...lost].filter(keep) };
  };
  const repairPlan = (date: string, p: AiPlan): AiPlan => {
    const cur = repairRoutes(date, p.routes, p.unassigned);
    const gen = repairRoutes(date, p.generated.routes, p.generated.unassigned);
    const pins = Object.fromEntries(
      Object.entries(p.pins).filter(([vid, sid]) => dateOf.get(vid) === date && staffIds.has(sid)),
    );
    return { ...p, date, ...cur, generated: { ...p.generated, ...gen }, pins };
  };
  const repairPlans = (plans: DemoData['aiPlans']) =>
    Object.fromEntries(Object.entries(plans).map(([date, p]) => [date, repairPlan(date, p)]));
  const repairRun = (date: string, r: AiRun): AiRun => {
    const cur = repairRoutes(date, r.routes, r.unassigned);
    const pins = Object.fromEntries(
      Object.entries(r.pins).filter(([vid, sid]) => dateOf.get(vid) === date && staffIds.has(sid)),
    );
    return { ...r, date, ...cur, pins };
  };
  const aiRuns: DemoData['aiRuns'] = Object.fromEntries(
    Object.entries(d.aiRuns).map(([date, runs]) => [
      date,
      uniqueById(runs)
        .slice(-MAX_RUNS_PER_DAY)
        .map((r) => repairRun(date, r)),
    ]),
  );

  const presets = repairPresets(d.presets);
  // 点数の基準（ADR-0010）：無い・存在しない id なら先頭のプリセット
  const scorePresetId = presets.some((p) => p.id === d.scorePresetId) ? d.scorePresetId : presets[0]?.id;

  return {
    ...d,
    items: uniqueById(d.items),
    rules: uniqueById(d.rules),
    staff,
    clients,
    compat,
    visits,
    availability,
    manualPlans,
    aiPlans: repairPlans(d.aiPlans),
    aiRuns,
    presets,
    scorePresetId,
  };
}
