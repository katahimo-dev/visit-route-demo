// 入口（実装は seed 担当）
// 写した元：katahimo-dev/visit-route-poc @ a46e7db scripts/seedDemo.ts

import type { DemoData } from '../contracts/data';
import { DATA_VERSION } from '../contracts/data';
import type { Client, Staff } from '../contracts/documents';
import type { Compat } from '../contracts/rules';
import { DEFAULT_TERMS } from '../domain/terms';
import { datesFrom, generateDay, UNASSIGNED_KEY } from './generate';
import { CLIENT_SEEDS, INITIAL_COMPAT, INITIAL_ITEMS, INITIAL_RULES, STAFF_SEEDS } from './people';

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
    org: { name: 'デモ訪問サービス（架空）', industry: 'care', terms: { ...DEFAULT_TERMS.care }, fareYenPerKm: 10 },
    items: INITIAL_ITEMS.map((i) => ({ ...i, options: [...i.options] })),
    rules: INITIAL_RULES.map((r) => ({ ...r })),
    staff,
    clients: initialClients(),
    compat,
    visits: [],
    availability: [],
    manualPlans: {},
    aiPlans: {},
    prevAiPlans: {},
  };
  const withDays = daysFrom(base, today, DEMO_DAYS);
  // いつもの担当：手作業案で最も多く担当した人（同数なら ID の小さい順）
  const clients = withDays.clients.map((c) => ({ ...c, usualStaffId: usualStaffOf(withDays, c.id) }));
  return { ...withDays, clients };
}

function usualStaffOf(data: DemoData, clientId: string): string | null {
  const count = new Map<string, number>();
  for (const v of data.visits)
    if (v.clientId === clientId && v.staffId) count.set(v.staffId, (count.get(v.staffId) ?? 0) + 1);
  let best: string | null = null;
  for (const [id, n] of [...count].sort(([a], [b]) => a.localeCompare(b))) {
    if (best === null || n > (count.get(best) ?? 0)) best = id;
  }
  return best;
}

/**
 * from から n 日分の訪問・稼働時間帯の上書き・手作業案を足す。
 * すでに訪問か手作業案がある日は変えない（既存データを壊さない）。元のデータは書き換えない
 */
export function daysFrom(data: DemoData, from: string, n: number): DemoData {
  const have = new Set([...data.visits.map((v) => v.date), ...Object.keys(data.manualPlans)]);
  const visits = [...data.visits];
  const availability = [...data.availability];
  const manualPlans = { ...data.manualPlans };
  for (const date of datesFrom(from, n)) {
    if (have.has(date)) continue;
    const day = generateDay(date, data.staff, data.clients, data.compat);
    visits.push(...day.visits);
    availability.push(
      ...day.availability.filter((a) => !data.availability.some((x) => x.staffId === a.staffId && x.date === date)),
    );
    manualPlans[date] = day.manualRoutes;
  }
  return { ...data, visits, availability, manualPlans };
}

export { UNASSIGNED_KEY };
