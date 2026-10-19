// テスト用の小さな手作りデータと、乱数で作る大きめのデータ（matching・solver・evaluate のテストで使う）
import type { DemoData } from '../contracts/data';
import type { Client, Staff, Visit } from '../contracts/documents';
import type { Item, Rule } from '../contracts/rules';
import { minutesToHhmm } from '../domain/time';

/** 月曜 */
export const DATE = '2026-10-12';

export const ITEMS: Item[] = [
  { id: 'gender', name: '性別', target: 'staff', kind: 'choice', options: ['女性', '男性'] },
  { id: 'license', name: '資格', target: 'staff', kind: 'multi', options: ['介護福祉士', '看護師', '保育士', 'なし'] },
  { id: 'years', name: '経験年数', target: 'staff', kind: 'number', options: [] },
  { id: 'pet', name: 'ペット', target: 'client', kind: 'flag', options: [] },
];

export function rule(id: string, type: Rule['type'], weight: number, hard = false): Rule {
  return { id, type, label: id, weight, hard };
}

export function staff(id: string, lat: number, lng: number, over: Partial<Staff> = {}): Staff {
  return {
    id,
    name: id,
    home: { address: '', lat, lng },
    travelMode: 'DRIVE',
    workDays: [1, 2, 3, 4, 5],
    shiftStart: '08:00',
    shiftEnd: '18:00',
    active: true,
    traits: {},
    requirements: [],
    preferences: [],
    lastDay: null,
    email: '',
    ...over,
  };
}

export function client(id: string, lat: number, lng: number, over: Partial<Client> = {}): Client {
  return {
    id,
    displayName: id,
    kana: '',
    place: { address: '', lat, lng, postalCode: '' },
    note: '',
    color: 0,
    active: true,
    traits: {},
    requirements: [],
    preferences: [],
    usualStaffId: null,
    tentative: false,
    entryNote: '',
    keyNote: '',
    parkingNote: '',
    cautionNote: '',
    allowedStaffIds: [],
    stage: 'active',
    referrer: { name: '', contact: '', note: '', email: '' },
    ...over,
  };
}

export function visit(
  id: string,
  clientId: string,
  earliest: string,
  latest: string,
  over: Partial<Visit> = {},
): Visit {
  return {
    id,
    date: DATE,
    clientId,
    windowKind: 'window',
    earliestStart: earliest,
    latestStart: latest,
    durationMinutes: 60,
    staffId: null,
    cancelled: false,
    note: '',
    typeId: null,
    pattern: null,
    cancelKind: null,
    ...over,
  };
}

export function makeData(over: Partial<DemoData> = {}): DemoData {
  return {
    version: 1,
    baseDate: DATE,
    seed: 1,
    org: {
      name: 'テスト',
      industry: 'care',
      terms: { client: '利用者さん', staff: 'ヘルパー' },
      fareYenPerKm: 0,
      spanLimitHours: 10,
      features: {},
    },
    items: ITEMS,
    rules: [],
    staff: [],
    clients: [],
    compat: {},
    visits: [],
    availability: [],
    absences: [],
    clientLeaves: [],
    visitTypes: [],
    patterns: [],
    manualPrefs: {},
    manualPlans: {},
    aiPlans: {},
    aiRuns: {},
    presets: [],
    ...over,
  };
}

/** 乱数で作る仙台あたりのデータ（nStaff 人・nVisits 件）。同じ seed なら同じ */
export function randomData(nStaff: number, nVisits: number, seed: number, rules: Rule[] = []): DemoData {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const lat = () => 38.26 + (rand() - 0.5) * 0.12;
  const lng = () => 140.87 + (rand() - 0.5) * 0.15;
  const st = Array.from({ length: nStaff }, (_, i) =>
    staff(`s${i + 1}`, lat(), lng(), {
      traits: { gender: rand() < 0.6 ? '女性' : '男性', years: Math.floor(rand() * 10) },
      shiftStart: rand() < 0.3 ? '09:00' : '08:00',
      shiftEnd: rand() < 0.3 ? '15:00' : '18:00',
    }),
  );
  const cl = Array.from({ length: nVisits }, (_, i) => client(`c${i + 1}`, lat(), lng()));
  const vs = cl.map((c, i) => {
    const e = 8 * 60 + 30 + Math.floor(rand() * 16) * 30; // 8:30〜16:00
    const fixed = rand() < 0.3;
    const width = fixed ? 0 : 60 + Math.floor(rand() * 3) * 30;
    return visit(`v${i + 1}`, c.id, minutesToHhmm(e), minutesToHhmm(Math.min(e + width, 23 * 60)), {
      windowKind: fixed ? 'fixed' : 'window',
      durationMinutes: 30 + Math.floor(rand() * 4) * 15,
    });
  });
  return makeData({ staff: st, clients: cl, visits: vs, rules });
}
