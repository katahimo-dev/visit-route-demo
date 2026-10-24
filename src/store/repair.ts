// 読み込んだデータの中身の食い違いを直す（store がデータの持ち主。design.md §4）
import type { DaySnapshot, DemoData, ReassignInfo } from '../contracts/data';
import { type Absence, type Availability, MAX_VISIT_TYPES, type Pattern, type Place } from '../contracts/documents';
import { type Compat, HARDABLE, MAX_PRESETS, type Preset, RULE_TYPES } from '../contracts/rules';
import { stageFlags } from '../lib/clientStage';
import { applyPreset, initialPresets, scorePresetOf } from '../seed/presets';

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
function repairPlace<T extends Place>(p: T): T {
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
 * - 訪問の担当（staffId）が、いないスタッフなら null（担当なし）。担当の無い訪問のピンは外す
 * - 相性・稼働時間帯の上書きの、いない訪問先・スタッフの分は消す（上書きは同じ人・同じ日の最後の1件）
 * - 位置の緯度・経度が片方だけ・範囲外なら未登録にする
 * - プリセット（ADR-0008）：ID の重複は最初の1件、MAX_PRESETS を超える分は後ろを捨て、0件なら初期の3種。
 *   重みは 0〜5 に収めて 0.5 刻みに丸め（数でなければ 0）、必須にできない型の必須は外す
 * - 点数の基準（scorePresetId。ADR-0010）：無い・どのプリセットでもない id なら先頭のプリセット
 * - 条件の重み・必須（版2。ADR-0053）：いつも点数の基準のプリセットにそろえる（重みは1組）
 * - 欠勤（ADR-0011）：いない人の欠勤は消す。ID の重複は最初の1件、同じ人・同じ日は最後の1件（上書きと同じ）
 * - 振り直しの情報（reassigns）：いない人の列は消し、その日にない訪問・重複を除く。ピンはいる人だけ
 * - 伝えた内容（snapshots）：日付をキーにそろえ、いない人の担当は null
 * - 訪問の種類・繰り返し（ADR-0012）：種類の ID の重複は最初の1件、MAX_VISIT_TYPES を超える分は後ろを捨てる。
 *   パターンの ID の重複は最初の1件、いない利用者さんのパターンは消す。パターン・訪問のいない種類（typeId）は null、
 *   パターンのいない人の担当（usualStaffId）は null、パターンの曜日は重なりを除いて小さい順。
 *   訪問の pattern.id がどのパターンでもなければ pattern を null（訪問は残す）
 * - 第N曜日・曜日ごとの時刻（ADR-0013）：パターンの monthWeeks は重なりを除いて小さい順（毎週系なら []）、
 *   dayTimes はパターンの曜日にあるものだけ・同じ曜日は最初の1件・曜日の順
 * - 〈利用者さん〉の休み（ADR-0013）：いない〈利用者さん〉の休みは消し、ID の重複は最初の1件
 * - 担当できる人（ADR-0014）：いない・休止中（active=false）の〈スタッフ〉の ID と重なりを除く（全員いなくなれば [] ＝限らない）
 * - 〈利用者さん〉の段階（ADR-0015）：active・tentative を段階に合わせる（lib/clientStage の stageFlags。段階が正）
 * - 取り消しの種類（ADR-0015）：取り消していない訪問の cancelKind は null
 * 食い違いがなければ同じ中身を返す（書き出し → 読み込みで同じデータ）
 */
export function repair(d: DemoData): DemoData {
  const staff = uniqueById(d.staff).map((s) => {
    const home = repairPlace(s.home);
    return home === s.home ? s : { ...s, home };
  });
  const staffIds = new Set(staff.map((s) => s.id));
  // 担当できる人（ADR-0014）に残すのは、いる・利用中の人だけ（重なりは最初の1つ）
  const activeIds = new Set(staff.filter((s) => s.active).map((s) => s.id));
  const clients = uniqueById(d.clients).map((c) => {
    const place = repairPlace(c.place);
    const allowed = [...new Set(c.allowedStaffIds)].filter((id) => activeIds.has(id));
    const allowedStaffIds =
      allowed.length === c.allowedStaffIds.length && allowed.every((x, i) => x === c.allowedStaffIds[i])
        ? c.allowedStaffIds
        : allowed;
    // 段階が正（ADR-0015）：active・tentative を段階に合わせる
    const flags = stageFlags(c.stage, c.tentative);
    return place === c.place &&
      allowedStaffIds === c.allowedStaffIds &&
      flags.active === c.active &&
      flags.tentative === c.tentative
      ? c
      : { ...c, place, allowedStaffIds, ...flags };
  });
  const clientIds = new Set(clients.map((c) => c.id));

  // 訪問の種類・繰り返し（ADR-0012）
  const visitTypes = uniqueById(d.visitTypes).slice(0, MAX_VISIT_TYPES);
  const typeIds = new Set(visitTypes.map((t) => t.id));
  const knownType = (id: string | null) => (id !== null && typeIds.has(id) ? id : null);
  const patterns = uniqueById(d.patterns)
    .filter((p) => clientIds.has(p.clientId))
    .map((p): Pattern => {
      const typeId = knownType(p.typeId);
      const usualStaffId = p.usualStaffId !== null && staffIds.has(p.usualStaffId) ? p.usualStaffId : null;
      const weekdays = [...new Set(p.weekdays)].sort((a, b) => a - b);
      const monthWeeks = p.repeat === 'monthly' ? [...new Set(p.monthWeeks)].sort((a, b) => a - b) : [];
      const seenDays = new Set<number>();
      const dayTimes = p.dayTimes
        .filter((t) => {
          if (!weekdays.includes(t.weekday) || seenDays.has(t.weekday)) return false;
          seenDays.add(t.weekday);
          return true;
        })
        .sort((a, b) => a.weekday - b.weekday);
      const seenStarts = new Set<number>();
      const usualStarts = p.usualStarts
        ?.filter((t) => {
          if (!weekdays.includes(t.weekday) || seenStarts.has(t.weekday)) return false;
          seenStarts.add(t.weekday);
          return true;
        })
        .sort((a, b) => a.weekday - b.weekday);
      const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x, i) => x === b[i]);
      const same =
        typeId === p.typeId &&
        usualStaffId === p.usualStaffId &&
        sameList(weekdays, p.weekdays) &&
        sameList(monthWeeks, p.monthWeeks) &&
        sameList(dayTimes, p.dayTimes) &&
        (p.usualStarts === undefined || sameList(usualStarts ?? [], p.usualStarts));
      if (same) return p;
      return usualStarts === undefined
        ? { ...p, typeId, usualStaffId, weekdays, monthWeeks, dayTimes }
        : { ...p, typeId, usualStaffId, weekdays, monthWeeks, dayTimes, usualStarts };
    });
  const patternIds = new Set(patterns.map((p) => p.id));

  const visits = uniqueById(d.visits).map((v) => {
    const staffId = v.staffId !== null && !staffIds.has(v.staffId) ? null : v.staffId;
    const pinned = staffId === null ? false : v.pinned;
    const typeId = knownType(v.typeId);
    const pattern = v.pattern !== null && !patternIds.has(v.pattern.id) ? null : v.pattern;
    // 取り消していない訪問に取り消しの種類は付けない（ADR-0015）
    const cancelKind = v.cancelled ? v.cancelKind : null;
    return staffId === v.staffId &&
      pinned === v.pinned &&
      typeId === v.typeId &&
      pattern === v.pattern &&
      cancelKind === v.cancelKind
      ? v
      : { ...v, staffId, pinned, typeId, pattern, cancelKind };
  });

  const compat: Compat = {};
  for (const [cid, row] of Object.entries(d.compat)) {
    if (!clientIds.has(cid)) continue;
    compat[cid] = Object.fromEntries(Object.entries(row).filter(([sid]) => staffIds.has(sid)));
  }

  // 同じ人・同じ日の上書きは最後の1件（画面で保存したときと同じ）
  const avail = new Map<string, Availability>();
  for (const a of d.availability) if (staffIds.has(a.staffId)) avail.set(`${a.staffId}\u0000${a.date}`, a);
  const availability = d.availability.filter((a) => avail.get(`${a.staffId}\u0000${a.date}`) === a);

  // 欠勤（ADR-0011）：いない人の分は消し、ID の重複は最初の1件、同じ人・同じ日は最後の1件
  const absMap = new Map<string, Absence>();
  const absUnique = uniqueById(d.absences).filter((a) => staffIds.has(a.staffId));
  for (const a of absUnique) absMap.set(`${a.staffId}\u0000${a.date}`, a);
  const absences = absUnique.filter((a) => absMap.get(`${a.staffId}\u0000${a.date}`) === a);

  // 〈利用者さん〉の休み（ADR-0013）：いない〈利用者さん〉の分は消し、ID の重複は最初の1件
  const clientLeaves = uniqueById(d.clientLeaves).filter((l) => clientIds.has(l.clientId));

  /** 振り直しの情報の列：いない人の列は消し、どの列にも1回だけ */
  const repairRoutes = (routes: Record<string, string[]>) => {
    const seen = new Set<string>();
    const out: Record<string, string[]> = {};
    for (const [k, ids] of Object.entries(routes)) {
      if (!staffIds.has(k)) continue;
      out[k] = ids.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }
    return out;
  };
  const reassigns: Record<string, ReassignInfo> = {};
  for (const [date, r] of Object.entries(d.reassigns)) {
    reassigns[date] = {
      ...r,
      baseRoutes: repairRoutes(r.baseRoutes),
      basePins: Object.fromEntries(Object.entries(r.basePins).filter(([, sid]) => staffIds.has(sid))),
      ...(r.insertRoutes ? { insertRoutes: repairRoutes(r.insertRoutes) } : {}),
    };
  }
  const snapshots: Record<string, DaySnapshot> = {};
  for (const [date, s] of Object.entries(d.snapshots)) {
    const seen = new Set<string>();
    snapshots[date] = {
      ...s,
      date,
      visits: s.visits
        .filter((x) => {
          if (seen.has(x.id)) return false;
          seen.add(x.id);
          return true;
        })
        .map((x) => (x.staffId !== null && !staffIds.has(x.staffId) ? { ...x, staffId: null } : x)),
    };
  }

  const presets = repairPresets(d.presets);
  // 点数の基準（ADR-0010）：無い・存在しない id なら先頭のプリセット
  const scorePresetId = presets.some((p) => p.id === d.scorePresetId) ? d.scorePresetId : presets[0]?.id;
  // 条件の重み・必須は点数の基準にそろえる（版2：重みは1組。ADR-0053）
  const basis = scorePresetOf(presets, scorePresetId);
  const uniqueRules = uniqueById(d.rules);
  const rules = basis ? applyPreset(uniqueRules, basis) : uniqueRules;

  return {
    ...d,
    items: uniqueById(d.items),
    rules: JSON.stringify(rules) === JSON.stringify(d.rules) ? d.rules : rules,
    staff,
    clients,
    compat,
    visitTypes,
    patterns,
    visits,
    availability,
    absences,
    clientLeaves,
    snapshots,
    reassigns,
    presets,
    scorePresetId,
  };
}
