// 入口（実装は seed 担当）
// 写した元：katahimo-dev/visit-route-poc @ a46e7db scripts/seedDemo.ts

import type { DemoData } from '../contracts/data';
import { DATA_VERSION } from '../contracts/data';
import { type Client, EMPTY_REFERRER, SPAN_LIMIT_DEFAULT_HOURS, type Staff } from '../contracts/documents';
import type { Compat } from '../contracts/rules';
import { DEFAULT_TERMS } from '../domain/terms';
import { addDays } from '../domain/time';
import { expandPattern } from '../patterns';
import { datesFrom, generateDay, UNASSIGNED_KEY } from './generate';
import { INITIAL_VISIT_TYPES, seedPatterns } from './patterns';
import {
  CLIENT_SEEDS,
  INITIAL_COMPAT,
  INITIAL_ITEMS,
  INITIAL_RULES,
  REFERRER_SEEDS,
  STAFF_EMAIL_SEEDS,
  STAFF_SEEDS,
  VISIT_RULE_SEEDS,
} from './people';
import { INITIAL_PRESETS, initialPresets } from './presets';

/** 初期の日数（今日から） */
export const DEMO_DAYS = 14;

function initialStaff(): Staff[] {
  return STAFF_SEEDS.map((s) => ({
    id: s.id,
    name: s.name,
    home: { address: s.address, lat: s.lat, lng: s.lng },
    travelMode: 'DRIVE' as const,
    workDays: s.workDays,
    shiftStart: s.shift[0],
    shiftEnd: s.shift[1],
    active: true,
    traits: s.traits,
    requirements: s.requirements,
    preferences: s.preferences,
    lastDay: null,
    email: STAFF_EMAIL_SEEDS[s.id] ?? '',
    icon: '',
  }));
}

function initialClients(): Client[] {
  return CLIENT_SEEDS.map((c, i) => ({
    id: c.id,
    displayName: c.name,
    kana: c.kana,
    place: { address: c.address, lat: c.lat, lng: c.lng, postalCode: '' },
    note: c.note ?? '',
    color: i % 8,
    active: true,
    traits: { pet: c.pet ?? false, smoking: c.smoking ?? false, target: c.target },
    requirements: c.requirements ?? [],
    preferences: c.preferences ?? [],
    tentative: false,
    entryNote: VISIT_RULE_SEEDS[c.id]?.entryNote ?? '',
    keyNote: VISIT_RULE_SEEDS[c.id]?.keyNote ?? '',
    parkingNote: VISIT_RULE_SEEDS[c.id]?.parkingNote ?? '',
    cautionNote: VISIT_RULE_SEEDS[c.id]?.cautionNote ?? '',
    allowedStaffIds: [],
    stage: 'active' as const,
    referrer: REFERRER_SEEDS[c.id] ?? { ...EMPTY_REFERRER },
  }));
}

/** today（YYYY-MM-DD）から14日分。同じ日付なら同じデータ */
export function createDemoData(today: string): DemoData {
  const staff = initialStaff();
  const compat: Compat = JSON.parse(JSON.stringify(INITIAL_COMPAT));
  const base: DemoData = {
    version: DATA_VERSION,
    baseDate: today,
    seed: 1,
    org: {
      name: 'デモ訪問サービス（架空）',
      industry: 'care',
      terms: { client: DEFAULT_TERMS.care.client, staff: 'スタッフ' },
      fareYenPerKm: 10,
      spanLimitHours: SPAN_LIMIT_DEFAULT_HOURS,
      // 機能の入り切り（ADR-0028）：初期データはすべて入
      features: {},
    },
    items: INITIAL_ITEMS.map((i) => ({ ...i, options: [...i.options] })),
    rules: INITIAL_RULES.map((r) => ({ ...r })),
    staff,
    clients: initialClients(),
    compat,
    visits: [],
    availability: [],
    absences: [],
    clientLeaves: [],
    visitTypes: INITIAL_VISIT_TYPES.map((t) => ({ ...t, requirements: t.requirements.map((c) => ({ ...c })) })),
    patterns: seedPatterns(today),
    snapshots: {},
    reassigns: {},
    presets: initialPresets(),
    // 点数の基準は「標準」（ADR-0010）
    scorePresetId: INITIAL_PRESETS[0]!.id,
  };
  const { availability, owners } = generateDays(base, today, DEMO_DAYS);
  return { ...base, availability, patterns: withUsualStaff(base.patterns, owners, staff) };
}

/** 繰り返しの担当を決めるときの、前後の訪問との間（分。移動の目安） */
const USUAL_GAP_MINUTES = 30;

/**
 * 繰り返しの担当（いつもの担当。版2：〈利用者さん〉は担当を持たない。ADR-0053）：内部で作った手作業らしい割当で多く担当した人の順に、
 * 繰り返しの曜日にみな勤務し、同じ曜日のその人のほかの繰り返しと時間（前後 USUAL_GAP_MINUTES 分）が重ならない人。
 * 入る人がいなければ担当なし（AI で組む）。開始の早い繰り返しから決める。リハビリの繰り返しは seed/patterns の担当のまま
 */
function withUsualStaff(
  patterns: DemoData['patterns'],
  owners: Map<string, { clientId: string; staffId: string }>,
  staff: readonly Staff[],
): DemoData['patterns'] {
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const span = (p: DemoData['patterns'][number]) => ({
    start: toMin(p.earliestStart),
    end: toMin(p.latestStart) + p.durationMinutes,
  });
  const taken = new Map<string, DemoData['patterns'][number][]>();
  const fits = (sid: string, p: DemoData['patterns'][number]) => {
    const s = staff.find((x) => x.id === sid);
    if (!s || !p.weekdays.every((w) => s.workDays.includes(w))) return false;
    const a = span(p);
    return (taken.get(sid) ?? []).every((q) => {
      if (!q.weekdays.some((w) => p.weekdays.includes(w))) return true;
      const b = span(q);
      return a.end + USUAL_GAP_MINUTES <= b.start || b.end + USUAL_GAP_MINUTES <= a.start;
    });
  };
  for (const p of patterns)
    if (p.usualStaffId !== null) taken.set(p.usualStaffId, [...(taken.get(p.usualStaffId) ?? []), p]);
  const order = [...patterns]
    .filter((p) => p.usualStaffId === null)
    .sort((a, b) => a.earliestStart.localeCompare(b.earliestStart) || a.id.localeCompare(b.id));
  const chosen = new Map<string, string | null>();
  for (const p of order) {
    const count = new Map<string, number>();
    for (const o of owners.values())
      if (o.clientId === p.clientId) count.set(o.staffId, (count.get(o.staffId) ?? 0) + 1);
    const candidates = [...count].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([id]) => id);
    const pick = candidates.find((sid) => fits(sid, p)) ?? null;
    chosen.set(p.id, pick);
    if (pick) taken.set(pick, [...(taken.get(pick) ?? []), p]);
  }
  return patterns.map((p) => (chosen.has(p.id) ? { ...p, usualStaffId: chosen.get(p.id) ?? null } : p));
}

/**
 * from から n 日分の稼働時間帯の上書きと、内部で作った手作業らしい割当（訪問ID → 〈利用者さん〉・担当。繰り返しの担当を決めるのに使う）。
 * 訪問は初期の繰り返し（seedPatterns(from)）の回（〈利用者さん〉の繰り返しだけ。リハビリは入れない）。元のデータは書き換えない
 */
function generateDays(
  data: DemoData,
  from: string,
  n: number,
): { availability: DemoData['availability']; owners: Map<string, { clientId: string; staffId: string }> } {
  const patterns = seedPatterns(from).filter((p) => p.id === p.clientId);
  const range = { from, to: addDays(from, n - 1) };
  const expanded = patterns.flatMap((p) => expandPattern(p, range));
  const availability = [...data.availability];
  const owners = new Map<string, { clientId: string; staffId: string }>();
  for (const date of datesFrom(from, n)) {
    const dayVisits = expanded
      .filter((v) => v.date === date)
      .map((v) => ({ ...v, staffId: null }))
      .sort((a, b) => a.earliestStart.localeCompare(b.earliestStart) || a.id.localeCompare(b.id));
    const day = generateDay(date, dayVisits, data.staff, data.clients, data.compat);
    for (const v of day.visits) if (v.staffId) owners.set(v.id, { clientId: v.clientId, staffId: v.staffId });
    availability.push(
      ...day.availability.filter((a) => !data.availability.some((x) => x.staffId === a.staffId && x.date === date)),
    );
  }
  return { availability, owners };
}

export { UNASSIGNED_KEY };
export { INITIAL_VISIT_TYPES, REHAB_SEEDS, rehabPatternId, seedPatterns, VISIT_TYPE_ID } from './patterns';
export {
  applyPreset,
  INITIAL_PRESETS,
  initialPresets,
  matchesPreset,
  type Preset,
  presetOf,
  scorePresetOf,
  scoreRulesOf,
} from './presets';
