// コマンドパレット（Ctrl+K。PRD D181〜D183。ADR-0027）の中身と絞り込みを決める純粋関数。
// 行き先は今ある URL だけ（画面・`?do=` の入口・人の画面）。データは書き換えない
import type { DemoData } from '../contracts/data';
import type { Client, Staff, Terms, Visit } from '../contracts/documents';
import type { Features } from '../contracts/features';
import { addDays } from '../domain/time';
import { visitsIn } from '../patterns';
import { STAGE_LABELS } from './clientStage';
import { dateText } from './common';
import { isHrefOn } from './features';
import { addMonths, ymOf } from './month';
import { absenceHref, isNavAction, type MenuItem, type NavSection } from './nav';
import { normalizeKana } from './search';

/** 候補の種類（出す順）：操作 → 画面 → 〈利用者さん〉 → 〈スタッフ〉 → 訪問（PRD D304） */
export type PaletteKind = 'action' | 'screen' | 'client' | 'staff' | 'visit';
export const PALETTE_KINDS: readonly PaletteKind[] = ['action', 'screen', 'client', 'staff', 'visit'];

/** 候補の1件 */
export type PaletteItem = {
  /** 一覧の中で一意（option の id に使う） */
  id: string;
  kind: PaletteKind;
  /** 出す名前 */
  label: string;
  /** 名前の右の小さな補足（グループ・よみ・段階） */
  hint: string;
  /** 移る先（HashRouter の中の URL） */
  to: string;
  /** 移る前に選ぶ日付（日の予定へ移るもの） */
  date?: string;
  /** 比べる形（normalizeKana）にそろえた語：名前・よみ・別名。先頭が名前 */
  keys: readonly string[];
  /** 選ぶと画面を移らずに訪問の詳細の欄を開く（訪問の候補。PRD D304） */
  visitId?: string;
  /** 選ぶと画面を移らずに行う操作（'visit-add'＝訪問の詳細の欄の新規） */
  op?: 'visit-add';
};

/** 人の候補を種類ごとにいくつまで出すか（残りは「ほか N人」） */
export const PALETTE_PEOPLE_LIMIT = 8;

/** 候補を作る（語を比べる形にそろえておく。打つたびにそろえ直さない） */
export function paletteItem(raw: Omit<PaletteItem, 'keys'> & { words?: readonly string[] }): PaletteItem {
  const { words = [], ...rest } = raw;
  const keys = [...new Set([raw.label, ...words].map(normalizeKana).filter((k) => k !== ''))];
  return { ...rest, keys };
}

/** 種類ごとの見出し（呼び方は terms） */
export function paletteKindLabel(kind: PaletteKind, terms: Pick<Terms, 'client' | 'staff'>): string {
  if (kind === 'action') return '操作';
  if (kind === 'screen') return '画面';
  if (kind === 'visit') return '訪問';
  return kind === 'client' ? terms.client : terms.staff;
}

/**
 * 画面の名前の読み・別名（ひらがなで打っても引けるように）。名前を変えた画面は前の名前も別名に残す
 * （月間・週間・予定・日の画面・稼働時間・稼働の見込み。PRD D230。ADR-0034）
 */
const SCREEN_WORDS: Record<string, readonly string[]> = {
  '/home': ['ほーむ', 'きょうやること', '今日やること'],
  '/month': ['つき', 'げつ', 'かれんだー', 'つきのよてい', '月間', 'げっかん', '月の画面'],
  '/week': ['しゅう', 'しゅうのよてい', 'じかんじく', '週間', 'しゅうかん'],
  '/plan': ['ひ', 'にち', 'ひのよてい', 'わりあて', '予定', '日の画面', 'きょう'],
  '/compare': ['ていあんをくらべる', 'あんをくらべる', 'ひかく', '比較'],
  '/vacancy': ['あきじょうきょう', 'といあわせ', '問い合わせ'],
  '/clients': ['いちらん'],
  '/compat': ['あいしょう'],
  '/staff': ['いちらん'],
  '/availability': ['きんむじかん', 'しふと', '稼働時間', 'かどうじかん'],
  '/workload': ['きんむのみこみ', '稼働の見込み', 'かどうのみこみ', 'こうつうひ'],
  '/rules': ['じょうけんのおもみ', 'ぷりせっと'],
  '/types': ['ほうもんのしゅるい'],
  '/items': ['とくせいのこうもく'],
  '/settings': ['かんりしゃせってい', 'かんりしゃ', 'せってい', 'きのう', '機能', '設定'],
  '/data': ['でーた', 'かきだし', 'よみこみ', 'ばっくあっぷ', 'えくせる', 'Excel'],
};

/** グループの見出しのよみ（「せってい」で設定のタブの画面を、「よてい」で月・週・日の予定を1つずつ引ける。PRD D273・D275） */
const GROUP_WORDS: Record<string, readonly string[]> = {
  予定: ['よてい'],
  設定: ['せってい'],
  人: ['ひと'],
  当日・問い合わせ: ['とうじつ', 'といあわせ'],
};

/**
 * 呼び方の既定（domain/terms の DEFAULT_TERMS）のうち漢字を含むもののよみ。カタカナの呼び方（スタッフ・ヘルパー・シッター）は
 * そろえるとひらがなになるので要らない。事業所が呼び方を変えたときは、ここに無ければよみでは引けない（名前の漢字で引く。ADR-0027 追記）
 */
export const TERM_READINGS: Readonly<Record<string, string>> = {
  利用者さん: 'りようしゃさん',
  お客様: 'おきゃくさま',
};

/** 呼び方のよみ（既定に無い呼び方は空） */
export const termReading = (term: string): string[] => {
  const r = TERM_READINGS[term];
  return r ? [r] : [];
};

/**
 * 画面の候補：画面の一覧（lib/nav の screenSections。メニューから外した月・週・日の予定・案を比べる・勤務の見込み・設定のタブも
 * 1つずつ。PRD D273・D275）のうち操作でないもの（画面の見出しと同じ名前・同じ並び。補足はグループの見出し）。
 * 〈利用者さん〉一覧・〈スタッフ〉一覧には呼び方のよみも足す（例「りようしゃ」で〈利用者さん〉一覧）
 */
export function paletteScreens(
  sections: readonly NavSection<MenuItem>[],
  terms: Pick<Terms, 'client' | 'staff'>,
): PaletteItem[] {
  const termWords: Record<string, readonly string[]> = {
    '/clients': termReading(terms.client),
    '/staff': termReading(terms.staff),
  };
  return sections.flatMap((g) =>
    g.items
      .filter((i) => !isNavAction(i.to))
      .map((i) =>
        paletteItem({
          id: `screen:${i.to}`,
          kind: 'screen',
          label: i.label,
          hint: g.title ?? '',
          to: i.to,
          words: [
            ...(g.title ? [g.title, ...(GROUP_WORDS[g.title] ?? [])] : []),
            ...(SCREEN_WORDS[i.to] ?? []),
            ...(termWords[i.to] ?? []),
          ],
        }),
      ),
  );
}

/**
 * 操作の候補（PRD D182）：欠勤・キャンセルを登録・日の予定（今日）・今月（と来月）の担当を AI で組む・
 * 要対応・確定していない日・問い合わせに答える。today は日本時間の今日。
 * features で切った機能の操作（欠勤・キャンセル・問い合わせ）は出さない（PRD D213。lib/features の表から引く）
 */
export function paletteActions(today: string, { features = {} }: { features?: Features } = {}): PaletteItem[] {
  const ym = ymOf(today);
  const next = addMonths(ym, 1);
  const monthNo = (m: string) => Number(m.slice(5, 7));
  const month = (op: string, m = ym) => `/month?ym=${m}&do=${op}`;
  const all = [
    paletteItem({
      id: 'action:absence',
      kind: 'action',
      label: '欠勤・キャンセルを登録',
      hint: '日の予定（今日）',
      to: absenceHref(today),
      date: today,
      words: ['けっきん', 'きゃんせる', 'やすみ', 'きゅうなけっきん', 'とうじつのたいおう', '当日の対応', 'とうじつ'],
    }),
    paletteItem({
      id: 'action:today',
      kind: 'action',
      label: '日の予定（今日）を開く',
      hint: '日の予定',
      to: '/plan',
      date: today,
      words: ['きょうのよてい', '今日の予定', 'ひのよてい', 'きょう'],
    }),
    paletteItem({
      id: 'action:batch',
      kind: 'action',
      label: `${monthNo(ym)}月の担当を AI で組む`,
      hint: '月の予定',
      to: month('batch'),
      words: ['こんげつ', '今月', 'まとめてつくる', 'くむ', 'たんとう', 'つきをくむ', 'えーあい'],
    }),
    paletteItem({
      id: 'action:batch-next',
      kind: 'action',
      label: `${monthNo(next)}月の担当を AI で組む`,
      hint: '月の予定',
      to: month('batch', next),
      words: ['らいげつ', '来月', 'まとめてつくる', 'くむ', 'たんとう', 'つきをくむ', 'えーあい'],
    }),
    paletteItem({
      id: 'action:attention',
      kind: 'action',
      label: '要対応を見る',
      hint: '月の予定',
      to: month('attention'),
      words: ['ようたいおう'],
    }),
    paletteItem({
      id: 'action:unconfirmed',
      kind: 'action',
      label: '確定していない日を見る',
      hint: '月の予定',
      to: month('unconfirmed'),
      words: ['かくてい', 'みかくてい', '未確定'],
    }),
    paletteItem({
      id: 'action:visit-add',
      kind: 'action',
      label: '訪問を追加',
      hint: '訪問の詳細の欄',
      // 選ぶと画面を移らずに欄を開く（to は使わない。機能の表の整合のため日の予定を書く）
      to: '/plan',
      op: 'visit-add',
      words: ['ほうもんをついか', 'ついか', 'ほうもん', 'たんぱつ'],
    }),
    paletteItem({
      id: 'action:vacancy',
      kind: 'action',
      label: '問い合わせに答える',
      hint: '空き状況',
      to: '/vacancy',
      words: ['といあわせ', 'あきじょうきょう', '空き状況'],
    }),
  ];
  return all.filter((a) => isHrefOn(features, a.to));
}

/**
 * 人の候補：〈利用者さん〉（名前・よみ。利用中でなければ段階を添える）と〈スタッフ〉（名前。よみは持たない）。
 * 選ぶとその人の画面（`#/clients/:id`・`#/staff/:id`。PRD D308）
 */
export function palettePeople(
  clients: readonly Pick<Client, 'id' | 'displayName' | 'kana' | 'stage'>[],
  staff: readonly Pick<Staff, 'id' | 'name' | 'active'>[],
  terms: Pick<Terms, 'client' | 'staff'>,
): PaletteItem[] {
  return [
    ...clients.map((c) =>
      paletteItem({
        id: `client:${c.id}`,
        kind: 'client',
        label: c.displayName,
        hint: [c.kana, c.stage === 'active' ? '' : STAGE_LABELS[c.stage]].filter(Boolean).join('・'),
        to: `/clients/${encodeURIComponent(c.id)}`,
        words: [c.kana],
      }),
    ),
    ...staff.map((s) =>
      paletteItem({
        id: `staff:${s.id}`,
        kind: 'staff',
        label: s.name,
        hint: s.active ? terms.staff : `${terms.staff}・休止中`,
        to: `/staff/${encodeURIComponent(s.id)}`,
      }),
    ),
  ];
}

/**
 * 訪問の索引（打ってから引く。パレットを開いている間 memo）：〈利用者さん〉ごと・担当の〈スタッフ〉ごと・全部（どれも日付・開始の順）
 */
export type VisitIndex = {
  byClient: ReadonlyMap<string, readonly Visit[]>;
  byStaff: ReadonlyMap<string, readonly Visit[]>;
  all: readonly Visit[];
};

/** 索引に入れる期間（今日の前後。繰り返しの回は見るときに計算するので、期間を区切る。版2） */
export const PALETTE_VISIT_DAYS_BEFORE = 31;
export const PALETTE_VISIT_DAYS_AFTER = 92;

/** 索引に入れる訪問（今日の前後の期間の、保存した回と計算した回） */
export function paletteVisitList(data: Pick<DemoData, 'visits' | 'patterns' | 'clients'>, today: string): Visit[] {
  return visitsIn(data, {
    from: addDays(today, -PALETTE_VISIT_DAYS_BEFORE),
    to: addDays(today, PALETTE_VISIT_DAYS_AFTER),
  });
}

const visitKey = (v: Visit) => `${v.date} ${v.earliestStart}`;
const byTime = (a: Visit, b: Visit) => (visitKey(a) < visitKey(b) ? -1 : visitKey(a) > visitKey(b) ? 1 : 0);

export function visitIndex(visits: readonly Visit[]): VisitIndex {
  const byClient = new Map<string, Visit[]>();
  const byStaff = new Map<string, Visit[]>();
  const put = (m: Map<string, Visit[]>, k: string, v: Visit) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  const all = [...visits].sort(byTime);
  for (const v of all) {
    put(byClient, v.clientId, v);
    if (v.staffId) put(byStaff, v.staffId, v);
  }
  return { byClient, byStaff, all };
}

/** 「担当なし」の語（比べる形） */
const UNASSIGNED_WORDS = ['担当なし', '担当無し', 'たんとうなし', '未割当'].map(normalizeKana);
/** 「要対応」の語（比べる形） */
const ATTENTION_WORDS = ['要対応', 'ようたいおう'].map(normalizeKana);

/** 要対応を探すときに、日付の語が無ければ今日から何日先まで見るか（1日ずつ検査するので、索引の期間より短く区切る） */
export const PALETTE_ATTENTION_DAYS = 31;

/** 日付の語（「10/28」「10月28日」「2026-10-28」「今日・きょう」「明日・あした」「あさって」）を日付に。日付でなければ null */
export function paletteDate(term: string, today: string): string | null {
  const t = term.normalize('NFKC').trim();
  if (/^(今日|きょう)$/.test(t)) return today;
  if (/^(明日|あした|あす)$/.test(t)) return addDays(today, 1);
  if (/^(明後日|あさって)$/.test(t)) return addDays(today, 2);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const md = iso ? null : /^(\d{1,2})(?:\/|月)(\d{1,2})日?$/.exec(t);
  if (!iso && !md) return null;
  const y = iso ? Number(iso[1]) : Number(today.slice(0, 4));
  const m = Number(iso ? iso[2] : md?.[1]);
  const d = Number(iso ? iso[3] : md?.[2]);
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const valid = (x: string) => {
    const back = new Date(`${x}T00:00:00Z`);
    return !Number.isNaN(back.getTime()) && back.toISOString().slice(0, 10) === x;
  };
  if (iso) {
    const date = `${y}-${pad(m)}-${pad(d)}`;
    return valid(date) ? date : null;
  }
  // 年を書かない日付は、去年・今年・来年のうち今日に近い方（12月に「1/5」は来年、1月に「12/28」は去年）
  const far = (x: string) => Math.abs(Date.parse(`${x}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`));
  const cands = [y - 1, y, y + 1].map((yy) => `${yy}-${pad(m)}-${pad(d)}`).filter(valid);
  if (cands.length === 0) return null;
  return cands.reduce((a, b) => (far(b) < far(a) ? b : a));
}

/** 訪問の語：日付・「担当なし」・「要対応」・名前の語（比べる形） */
export type VisitQuery = { date: string | null; unassigned: boolean; care: boolean; names: string[] };

/**
 * 打った語を訪問の語に分ける。日付の語は最初の1つを使い、2つ目からは捨てる（名前にしない）。
 * 「あす」「きょう」などのかなの日付の語しか無ければ、名前（「あすか」の打ちかけ）として読む
 */
export function parseVisitQuery(query: string, today: string): VisitQuery {
  const raw = query.split(/[\s　]+/).filter((x) => x !== '');
  let date: string | null = null;
  let dateWord: string | null = null;
  let unassigned = false;
  let care = false;
  const names: string[] = [];
  for (const r of raw) {
    const d = paletteDate(r, today);
    const n = normalizeKana(r);
    if (d) {
      if (date === null) {
        date = d;
        dateWord = r;
      }
    } else if (UNASSIGNED_WORDS.includes(n)) unassigned = true;
    else if (ATTENTION_WORDS.includes(n)) care = true;
    else if (n) names.push(n);
  }
  if (names.length === 0 && !unassigned && !care && dateWord && /^[ぁ-ん]+$/.test(normalizeKana(dateWord))) {
    names.push(normalizeKana(dateWord));
    date = null;
  }
  return { date, unassigned, care, names };
}

/**
 * 「要対応」で引くときに検査する日（打った語に「要対応」が無ければ空）：日付の語があればその日、無ければ今日から
 * PALETTE_ATTENTION_DAYS 日先まで（画面は1日ずつ間を空けて検査し、結果を順に出す）
 */
export function paletteAttentionDays(query: string, today: string): string[] {
  const q = parseVisitQuery(query, today);
  if (!q.care) return [];
  if (q.date !== null) return [q.date];
  return Array.from({ length: PALETTE_ATTENTION_DAYS + 1 }, (_, i) => addDays(today, i));
}

/** 訪問の候補をいくつまで出すか */
export const PALETTE_VISITS_LIMIT = 6;

/**
 * 訪問の候補（PRD D304・D337）：打った語を日付の語・「担当なし」「要対応」の語・名前の語に分ける。
 * 名前の語がすべて〈利用者さん〉の名前・よみに含まれる人の訪問と、すべて〈スタッフ〉の名前・よみに含まれる人が担当の訪問（「消防 明日」）。
 * 名前の語が無く「担当なし」「要対応」の語があれば、全部の訪問から。日付があればその日の回（取り消しも）、無ければ今日以降の近い回
 * （取り消しを除く）。「担当なし」は担当の無い回、「要対応」は attention（訪問ごとの検査。無ければ担当なしと同じ）で当たる回
 * （日付が無ければ今日から PALETTE_ATTENTION_DAYS 日先まで）。名前の語も「担当なし」「要対応」の語も無ければ出さない。
 * people は palettePeople の候補（語をそろえ済み）。describe は補足（担当・取り消し）
 */
export function paletteVisits(
  query: string,
  people: readonly PaletteItem[],
  index: VisitIndex,
  today: string,
  describe: (v: Visit) => string,
  limit: number = PALETTE_VISITS_LIMIT,
  attention?: (v: Visit) => boolean,
): PaletteItem[] {
  const { date, unassigned, care, names } = parseVisitQuery(query, today);
  if (names.length === 0 && !unassigned && !care) return [];
  const clientName = new Map(
    people.filter((c) => c.kind === 'client').map((c) => [c.id.slice('client:'.length), c.label] as const),
  );
  /** 調べる訪問の並び（それぞれ日付・開始の順） */
  const lists: (readonly Visit[])[] = [];
  if (names.length === 0) lists.push(index.all);
  else {
    const hit = (kind: 'client' | 'staff') =>
      people.filter((c) => c.kind === kind && names.every((t) => c.keys.some((k) => k.includes(t)))).slice(0, 20);
    for (const c of hit('client')) lists.push(index.byClient.get(c.id.slice('client:'.length)) ?? []);
    for (const s of hit('staff')) lists.push(index.byStaff.get(s.id.slice('staff:'.length)) ?? []);
  }
  const until = date === null && care ? addDays(today, PALETTE_ATTENTION_DAYS) : null;
  const isCare = attention ?? ((v: Visit) => v.staffId === null);
  const found = new Map<string, Visit>();
  for (const list of lists) {
    let n = 0;
    for (const v of list) {
      if (date !== null ? v.date !== date : v.date < today || v.cancelled) continue;
      if (until !== null && v.date > until) break;
      if (unassigned && (v.cancelled || v.staffId !== null)) continue;
      if (care && (v.cancelled || !isCare(v))) continue;
      if (!found.has(v.id)) found.set(v.id, v);
      n++;
      if (date === null && n >= limit) break;
    }
  }
  return [...found.values()]
    .sort(byTime)
    .slice(0, limit)
    .map((v) => ({
      id: `visit:${v.id}`,
      kind: 'visit' as const,
      label: `${clientName.get(v.clientId) ?? '（不明）'} ${dateText(v.date)} ${v.earliestStart}`,
      hint: describe(v),
      to: '',
      keys: [],
      visitId: v.id,
    }));
}

/** 絞り込んだ結果：種類ごとのまとまり（空のまとまりは出さない）と、上から順の並び（矢印で動く順） */
export type PaletteResult = {
  groups: { kind: PaletteKind; items: PaletteItem[]; rest: number }[];
  flat: PaletteItem[];
};

/** 打った文字を語に分ける（空白で区切り、比べる形にそろえる） */
export function paletteTerms(query: string): string[] {
  return query
    .split(/[\s　]+/)
    .map(normalizeKana)
    .filter((t) => t !== '');
}

/**
 * 絞り込む（PRD D182）：語がすべて、どれかの語（名前・よみ・別名）に含まれるもの。
 * 種類の順（操作 → 画面 → 〈利用者さん〉 → 〈スタッフ〉）に、種類の中は先頭が一致するもの → それ以外（同じ組は渡した順）。
 * 打っていないときは操作と画面だけ（人は出さない）。人は種類ごと limit 人まで（残りは rest に数だけ）
 */
export function filterPalette(
  items: readonly PaletteItem[],
  query: string,
  limit: number = PALETTE_PEOPLE_LIMIT,
): PaletteResult {
  const terms = paletteTerms(query);
  const whole = terms.join('');
  const groups: PaletteResult['groups'] = [];
  for (const kind of PALETTE_KINDS) {
    if (kind === 'visit') continue;
    const people = kind === 'client' || kind === 'staff';
    if (people && terms.length === 0) continue;
    const head: PaletteItem[] = [];
    const tail: PaletteItem[] = [];
    for (const it of items) {
      if (it.kind !== kind) continue;
      if (!terms.every((t) => it.keys.some((k) => k.includes(t)))) continue;
      if (whole !== '' && it.keys.some((k) => k.startsWith(whole))) head.push(it);
      else tail.push(it);
    }
    const all = head.concat(tail);
    if (all.length === 0) continue;
    const shown = people ? all.slice(0, limit) : all;
    groups.push({ kind, items: shown, rest: all.length - shown.length });
  }
  return { groups, flat: groups.flatMap((g) => g.items) };
}

/** 矢印で選ぶ位置を動かす（端で反対の端へ回る。候補が無ければ -1） */
export function moveActive(index: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  if (index < 0) return delta === 1 ? 0 : count - 1;
  return (index + delta + count) % count;
}

/** キーの押し方（KeyboardEvent の必要なところだけ） */
export type ShortcutKey = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
};

/**
 * パレットを開く・閉じるキーか（PRD D181）：mac は ⌘K、ほかは Ctrl+K（Shift・Alt が付いていたら違う）。
 * mac の Ctrl+K（入力欄で行末まで消す）は横取りしない。日本語の変換中は違う
 */
export function isPaletteShortcut(e: ShortcutKey, isMac: boolean): boolean {
  if (e.isComposing || e.altKey || e.shiftKey) return false;
  if (e.key !== 'k' && e.key !== 'K') return false;
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** HashRouter の hash（`#/workload?ym=…`）の画面のパス（`/workload`）。hash が空なら `/` */
export function hashPathname(hash: string): string {
  const p = hash.replace(/^#/, '').split(/[?#]/)[0] ?? '';
  return p === '' ? '/' : p;
}

/**
 * 画面を移ったあとも開いたままにするか。openFor は開いたときの画面のパス（URL の hash から。閉じていれば null）。
 * 移ったら閉じる（移った先の画面でもう開き直していれば閉じない：画面を移ってすぐの Ctrl+K で、
 * 新しい画面の描画が終わる前に開いたパレットを、あとから来た「画面を移った」で閉じない）
 */
export function keepPaletteOn(openFor: string | null, pathname: string): string | null {
  return openFor !== null && openFor === pathname ? openFor : null;
}

/** mac か（キーの印「⌘K」と、⌘ と Ctrl のどちらで開くか） */
export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}
