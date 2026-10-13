// 入口（実装は seed 担当）
// 写した元：katahimo-dev/visit-route-poc @ a46e7db scripts/seedDemo.ts

import type { DemoData } from '../contracts/data';
import { DATA_VERSION } from '../contracts/data';
import type { Client, Staff } from '../contracts/documents';
import type { Compat } from '../contracts/rules';
import { DEFAULT_TERMS } from '../domain/terms';
import { datesFrom, generateDay, UNASSIGNED_KEY } from './generate';
import { CLIENT_SEEDS, INITIAL_COMPAT, INITIAL_ITEMS, INITIAL_RULES, STAFF_SEEDS } from './people';
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
  }));
}

function initialClients(): Client[] {
  return CLIENT_SEEDS.map((c, i) => ({
    id: c.id,
    displayName: c.name,
    place: { address: c.address, lat: c.lat, lng: c.lng },
    note: c.note ?? '',
    color: i % 8,
    active: true,
    traits: { pet: c.pet ?? false, smoking: c.smoking ?? false, target: c.target },
    requirements: c.requirements ?? [],
    preferences: c.preferences ?? [],
    usualStaffId: null,
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
    },
    items: INITIAL_ITEMS.map((i) => ({ ...i, options: [...i.options] })),
    rules: INITIAL_RULES.map((r) => ({ ...r })),
    staff,
    clients: initialClients(),
    compat,
    visits: [],
    availability: [],
    manualPlans: {},
    aiPlans: {},
    aiRuns: {},
    presets: initialPresets(),
    // 点数の基準は「標準」（ADR-0010）
    scorePresetId: INITIAL_PRESETS[0]!.id,
  };
  const { data: withDays, owners } = generateDays(base, today, DEMO_DAYS);
  // いつもの担当：内部で作った手作業らしい割当で最も多く担当した人（同数なら ID の小さい順）
  const clients = withDays.clients.map((c) => ({ ...c, usualStaffId: usualStaffOf(withDays, owners, c.id) }));
  return { ...withDays, clients };
}

function usualStaffOf(data: DemoData, owners: Map<string, string>, clientId: string): string | null {
  const count = new Map<string, number>();
  for (const v of data.visits) {
    const sid = owners.get(v.id);
    if (v.clientId === clientId && sid) count.set(sid, (count.get(sid) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [id, n] of [...count].sort(([a], [b]) => a.localeCompare(b))) {
    if (best === null || n > (count.get(best) ?? 0)) best = id;
  }
  return best;
}

/**
 * from から n 日分の訪問・稼働時間帯の上書きを足す。手作業の割当は入れない（訪問の担当は未割当。ADR-0005）。
 * すでに訪問か手作業案がある日は変えない（既存データを壊さない）。元のデータは書き換えない
 */
export function daysFrom(data: DemoData, from: string, n: number): DemoData {
  return generateDays(data, from, n).data;
}

/** daysFrom の本体。owners は内部で作った手作業らしい割当（訪問ID → 担当。いつもの担当を決めるのに使う） */
function generateDays(data: DemoData, from: string, n: number): { data: DemoData; owners: Map<string, string> } {
  const have = new Set([...data.visits.map((v) => v.date), ...Object.keys(data.manualPlans)]);
  const visits = [...data.visits];
  const availability = [...data.availability];
  const owners = new Map<string, string>();
  for (const date of datesFrom(from, n)) {
    if (have.has(date)) continue;
    const day = generateDay(date, data.staff, data.clients, data.compat);
    for (const v of day.visits) {
      if (v.staffId) owners.set(v.id, v.staffId);
      visits.push({ ...v, staffId: null });
    }
    availability.push(
      ...day.availability.filter((a) => !data.availability.some((x) => x.staffId === a.staffId && x.date === date)),
    );
  }
  return { data: { ...data, visits, availability }, owners };
}

export { UNASSIGNED_KEY };
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
