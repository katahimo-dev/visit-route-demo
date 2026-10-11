// 写した元：katahimo-dev/visit-route-poc @ a46e7db scripts/seedDemo.ts（スタッフ・訪問先の定義）
// スタッフ・訪問先は、仙台市の公共施設を擬人化した架空の人物（位置は施設のおおよその場所）。
// 実在の個人の情報は使わない。
import type { Condition, Item, Rule, Traits } from '../contracts/rules';

/** 項目の ID（staff 側と client 側） */
export const ITEM_ID = {
  gender: 'gender',
  qualification: 'qualification',
  experience: 'experience',
  specialty: 'specialty',
  smoker: 'smoker',
  petOk: 'petOk',
  pet: 'pet',
  smoking: 'smoking',
  target: 'target',
} as const;

export const INITIAL_ITEMS: Item[] = [
  { id: ITEM_ID.gender, name: '性別', target: 'staff', kind: 'choice', options: ['女性', '男性'] },
  {
    id: ITEM_ID.qualification,
    name: '資格',
    target: 'staff',
    kind: 'multi',
    options: ['介護福祉士', '看護師', '保育士', '初任者研修'],
  },
  { id: ITEM_ID.experience, name: '経験年数', target: 'staff', kind: 'number', options: [] },
  {
    id: ITEM_ID.specialty,
    name: '得意',
    target: 'staff',
    kind: 'multi',
    options: ['高齢', '子ども', '障害', '家事', '話し相手'],
  },
  { id: ITEM_ID.smoker, name: '喫煙者', target: 'staff', kind: 'flag', options: [] },
  { id: ITEM_ID.petOk, name: 'ペット可', target: 'staff', kind: 'flag', options: [] },
  { id: ITEM_ID.pet, name: 'ペットあり', target: 'client', kind: 'flag', options: [] },
  { id: ITEM_ID.smoking, name: '喫煙環境', target: 'client', kind: 'flag', options: [] },
  { id: ITEM_ID.target, name: '対象', target: 'client', kind: 'choice', options: ['高齢', '子ども', '障害'] },
];

/** 初期の条件（design.md §5 の既定値） */
export const INITIAL_RULES: Rule[] = [
  { id: 'clientRequirement', type: 'clientRequirement', label: '必要条件', weight: 0, hard: true },
  { id: 'clientPreference', type: 'clientPreference', label: '訪問先の希望', weight: 3, hard: false },
  { id: 'staffRequirement', type: 'staffRequirement', label: 'スタッフの条件', weight: 0, hard: true },
  { id: 'staffPreference', type: 'staffPreference', label: 'スタッフの希望', weight: 2, hard: false },
  { id: 'compatibility', type: 'compatibility', label: '相性', weight: 3, hard: false },
  { id: 'continuity', type: 'continuity', label: 'いつもの担当', weight: 2, hard: false },
  { id: 'balance', type: 'balance', label: '負担の均等', weight: 1, hard: false },
  { id: 'wait', type: 'wait', label: '待ち時間', weight: 3, hard: false },
];

export type StaffSeed = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  workDays: number[];
  shift: [string, string];
  traits: Traits;
  requirements: Condition[];
  preferences: Condition[];
};
const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL = [0, 1, 2, 3, 4, 5, 6];
const std: [string, string] = ['08:00', '18:00'];

export const STAFF_SEEDS: StaffSeed[] = [
  {
    id: 's1',
    name: '市役所 まち子',
    address: '仙台市青葉区国分町3丁目（仙台市役所）',
    lat: 38.2683,
    lng: 140.8694,
    workDays: WEEKDAYS,
    shift: std,
    traits: {
      gender: '女性',
      qualification: ['介護福祉士', '看護師'],
      experience: 12,
      specialty: ['高齢', '話し相手'],
      smoker: false,
      petOk: true,
    },
    requirements: [],
    preferences: [{ itemId: 'smoking', op: 'is', value: false }],
  },
  {
    id: 's2',
    name: '長町 小太郎',
    address: '仙台市太白区長町（長町小学校）',
    lat: 38.2264,
    lng: 140.8853,
    workDays: WEEKDAYS,
    shift: std,
    traits: {
      gender: '男性',
      qualification: ['初任者研修'],
      experience: 2,
      specialty: ['家事', '障害'],
      smoker: true,
      petOk: true,
    },
    requirements: [],
    preferences: [],
  },
  {
    id: 's3',
    name: '榴岡 さくら',
    address: '仙台市宮城野区榴岡（榴岡小学校）',
    lat: 38.2593,
    lng: 140.893,
    workDays: ALL,
    shift: std,
    traits: {
      gender: '女性',
      qualification: ['保育士', '初任者研修'],
      experience: 5,
      specialty: ['子ども', '家事'],
      smoker: false,
      petOk: true,
    },
    requirements: [],
    preferences: [{ itemId: 'target', op: 'in', value: ['子ども', '高齢'] }],
  },
  {
    id: 's4',
    name: '消防 まもる',
    address: '仙台市青葉区堤通雨宮町（仙台市消防局）',
    lat: 38.2753,
    lng: 140.8721,
    workDays: WEEKDAYS,
    shift: std,
    traits: {
      gender: '男性',
      qualification: ['介護福祉士'],
      experience: 8,
      specialty: ['高齢', '障害'],
      smoker: false,
      petOk: false,
    },
    requirements: [{ itemId: 'pet', op: 'is', value: false }],
    preferences: [],
  },
  {
    id: 's5',
    name: '体育館 つよし',
    address: '仙台市太白区富沢（仙台市体育館）',
    lat: 38.2203,
    lng: 140.87,
    workDays: [1, 2, 3, 4, 6],
    shift: ['09:00', '17:00'],
    traits: {
      gender: '男性',
      qualification: ['初任者研修'],
      experience: 1,
      specialty: ['家事'],
      smoker: true,
      petOk: true,
    },
    requirements: [],
    preferences: [],
  },
  {
    id: 's6',
    name: '文化 かなで',
    address: '仙台市青葉区旭ケ丘（青年文化センター）',
    lat: 38.2875,
    lng: 140.8797,
    workDays: [2, 3, 4, 5, 6],
    shift: std,
    traits: {
      gender: '女性',
      qualification: ['保育士', '看護師'],
      experience: 6,
      specialty: ['子ども', '障害'],
      smoker: false,
      petOk: true,
    },
    requirements: [],
    preferences: [{ itemId: 'smoking', op: 'is', value: false }],
  },
  {
    id: 's7',
    name: '野草園 すみれ',
    address: '仙台市太白区茂ケ崎（仙台市野草園）',
    lat: 38.2408,
    lng: 140.874,
    workDays: [0, 1, 3, 5],
    shift: ['08:30', '16:30'],
    traits: {
      gender: '女性',
      qualification: ['介護福祉士', '初任者研修'],
      experience: 15,
      specialty: ['高齢', '話し相手', '家事'],
      smoker: false,
      petOk: false,
    },
    requirements: [{ itemId: 'pet', op: 'is', value: false }],
    preferences: [],
  },
  {
    id: 's8',
    name: '宮城野 はぎお',
    address: '仙台市宮城野区五輪（宮城野区役所）',
    lat: 38.2601,
    lng: 140.9013,
    workDays: [0, 1, 2, 4, 5],
    shift: std,
    traits: {
      gender: '男性',
      qualification: ['初任者研修'],
      experience: 3,
      specialty: ['障害', '話し相手'],
      smoker: true,
      petOk: true,
    },
    requirements: [],
    preferences: [],
  },
];

export type ClientSeed = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** 平日の約束：[時間の約束, 開始(最早), 開始(最遅), 分] */
  slot: ['fixed' | 'window', string, string, number];
  note?: string;
  /** 土日も訪問する */
  weekend?: boolean;
  /** 対象・ペットあり・喫煙環境 */
  target: '高齢' | '子ども' | '障害';
  pet?: boolean;
  smoking?: boolean;
  requirements?: Condition[];
  preferences?: Condition[];
};

const needChildcare: Condition = { itemId: 'qualification', op: 'hasAny', value: ['保育士'] };
const exp = (n: number): Condition => ({ itemId: 'experience', op: 'gte', value: n });
const talk: Condition = { itemId: 'specialty', op: 'hasAny', value: ['話し相手'] };
const female: Condition = { itemId: 'gender', op: 'is', value: '女性' };
const male: Condition = { itemId: 'gender', op: 'is', value: '男性' };

export const CLIENT_SEEDS: ClientSeed[] = [
  {
    id: 'c1',
    name: '図書館 ふみ',
    address: '仙台市青葉区春日町（せんだいメディアテーク）',
    lat: 38.2654,
    lng: 140.8656,
    slot: ['fixed', '09:00', '09:00', 60],
    note: '本の返却日を気にしています',
    weekend: true,
    target: '高齢',
    preferences: [exp(3)],
  },
  {
    id: 'c2',
    name: '動物公園 やぎお',
    address: '仙台市太白区八木山本町（八木山動物公園）',
    lat: 38.2489,
    lng: 140.8467,
    slot: ['window', '10:30', '11:30', 60],
    note: '坂の上です。冬は路面に注意',
    target: '高齢',
    pet: true,
  },
  {
    id: 'c3',
    name: '泉図書館 いずみ',
    address: '仙台市泉区泉中央（泉図書館）',
    lat: 38.3245,
    lng: 140.8805,
    slot: ['fixed', '13:00', '13:00', 90],
    target: '高齢',
    preferences: [talk],
  },
  {
    id: 'c4',
    name: '若林図書館 わかば',
    address: '仙台市若林区南小泉（若林図書館）',
    lat: 38.2404,
    lng: 140.9024,
    slot: ['window', '09:30', '10:30', 60],
    note: 'かぎはポストへ',
    weekend: true,
    target: '子ども',
    requirements: [needChildcare],
  },
  {
    id: 'c5',
    name: '博物館 れきこ',
    address: '仙台市青葉区川内（仙台市博物館）',
    lat: 38.2558,
    lng: 140.8611,
    slot: ['window', '11:00', '12:00', 60],
    note: 'うす味が好き',
    target: '高齢',
    smoking: true,
    preferences: [exp(5), talk],
  },
  {
    id: 'c6',
    name: '科学館 ひかる',
    address: '仙台市青葉区台原森林公園（仙台市科学館）',
    lat: 38.2925,
    lng: 140.8781,
    slot: ['fixed', '14:00', '14:00', 60],
    note: '香りにびんかん',
    weekend: true,
    target: '障害',
    requirements: [female],
  },
  {
    id: 'c7',
    name: '天文台 ほしみ',
    address: '仙台市青葉区錦ケ丘（仙台市天文台）',
    lat: 38.2557,
    lng: 140.7716,
    slot: ['fixed', '10:00', '10:00', 45],
    note: '夜ふかしなので午前はゆっくり',
    target: '高齢',
  },
  {
    id: 'c8',
    name: '文学館 しおり',
    address: '仙台市青葉区北根（仙台文学館）',
    lat: 38.2935,
    lng: 140.8691,
    slot: ['window', '13:30', '14:30', 60],
    target: '子ども',
    requirements: [needChildcare],
  },
  {
    id: 'c9',
    name: '地底の森 もりお',
    address: '仙台市太白区長町南（地底の森ミュージアム）',
    lat: 38.2195,
    lng: 140.8783,
    slot: ['fixed', '09:00', '09:00', 30],
    weekend: true,
    target: '障害',
    preferences: [{ itemId: 'specialty', op: 'hasAny', value: ['障害'] }],
  },
  {
    id: 'c10',
    name: '市民会館 ひびき',
    address: '仙台市青葉区桜ケ岡公園（仙台市民会館）',
    lat: 38.2648,
    lng: 140.8627,
    slot: ['window', '15:00', '16:00', 45],
    note: '音に敏感。チャイムは1回',
    target: '障害',
    preferences: [exp(3)],
  },
  {
    id: 'c11',
    name: '市場 うおすけ',
    address: '仙台市若林区卸町（中央卸売市場）',
    lat: 38.2556,
    lng: 140.929,
    slot: ['fixed', '08:30', '08:30', 30],
    note: '朝が早い',
    target: '高齢',
    smoking: true,
    requirements: [male],
  },
  {
    id: 'c12',
    name: '荒浜 なぎさ',
    address: '仙台市若林区荒浜（震災遺構 荒浜小学校）',
    lat: 38.223,
    lng: 140.98,
    slot: ['window', '10:00', '11:00', 60],
    weekend: true,
    target: '高齢',
  },
  {
    id: 'c13',
    name: 'メモリアル あかり',
    address: '仙台市若林区荒井（せんだい3.11メモリアル交流館）',
    lat: 38.239,
    lng: 140.942,
    slot: ['fixed', '14:30', '14:30', 60],
    target: '子ども',
    pet: true,
    preferences: [exp(3)],
  },
  {
    id: 'c14',
    name: '城跡 ほまれ',
    address: '仙台市青葉区川内（仙台城跡）',
    lat: 38.2526,
    lng: 140.856,
    slot: ['window', '09:00', '10:00', 45],
    note: '階段が多い家',
    target: '高齢',
    preferences: [exp(3)],
  },
  {
    id: 'c15',
    name: '七北田公園 ななこ',
    address: '仙台市泉区七北田（七北田公園）',
    lat: 38.3215,
    lng: 140.8885,
    slot: ['fixed', '15:30', '15:30', 60],
    weekend: true,
    target: '子ども',
    requirements: [needChildcare],
  },
  {
    id: 'c16',
    name: '陸上競技場 かける',
    address: '仙台市宮城野区宮城野（仙台市陸上競技場）',
    lat: 38.2596,
    lng: 140.9045,
    slot: ['window', '13:00', '14:00', 30],
    target: '子ども',
    preferences: [{ itemId: 'specialty', op: 'hasAny', value: ['子ども'] }],
  },
  {
    id: 'c17',
    name: '交通局 のりこ',
    address: '仙台市青葉区木町通（仙台市交通局）',
    lat: 38.2706,
    lng: 140.8668,
    slot: ['fixed', '11:30', '11:30', 45],
    target: '高齢',
    pet: true,
  },
  {
    id: 'c18',
    name: '福祉プラザ やすら',
    address: '仙台市青葉区五橋（仙台市福祉プラザ）',
    lat: 38.254,
    lng: 140.8772,
    slot: ['window', '16:00', '16:30', 60],
    weekend: true,
    target: '高齢',
    requirements: [female],
  },
  {
    id: 'c19',
    name: '文化センター うたお',
    address: '仙台市宮城野区五輪（宮城野区文化センター）',
    lat: 38.258,
    lng: 140.911,
    slot: ['fixed', '10:30', '10:30', 60],
    note: '歌が好き',
    target: '障害',
    smoking: true,
  },
  {
    id: 'c20',
    name: '中田 みのり',
    address: '仙台市太白区中田（中田市民センター）',
    lat: 38.1985,
    lng: 140.8815,
    slot: ['window', '13:00', '15:00', 60],
    weekend: true,
    target: '高齢',
    pet: true,
    smoking: true,
  },
];

/** 相性の初期値（clientId → staffId → 2=◎ 1=○ -1=△ -2=×）。× は PoC本体の NG（c2→s2、c12→s7） */
export const INITIAL_COMPAT: Record<string, Record<string, 2 | 1 | -1 | -2>> = {
  c1: { s1: 2, s7: 1 },
  c2: { s2: -2 },
  c3: { s7: 2 },
  c4: { s3: 2, s6: 1 },
  c5: { s1: 1, s4: -1 },
  c6: { s6: 2, s3: 1 },
  c8: { s6: 2 },
  c9: { s8: 1 },
  c10: { s4: -1, s5: -1 },
  c12: { s7: -2 },
  c13: { s3: 2 },
  c14: { s4: 1 },
  c15: { s3: 1 },
  c16: { s5: 1 },
  c17: { s1: 2 },
  c19: { s8: 2 },
  c20: { s2: -1 },
};
