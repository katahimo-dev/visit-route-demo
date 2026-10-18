// Excel のセルの文字と、データの値（特性・条件・時刻・日付）の変換（ADR-0006・design.md §5「Excel のブックの形」）
// ExcelJS に依存しない純粋な関数だけを置く
import type { Industry, TravelMode } from '../contracts/codes';
import type { Terms } from '../contracts/documents';
import { type Condition, type Item, RULE_TYPES, type RuleType, type TraitValue } from '../contracts/rules';
import { EMPTY_OPTION_MARK, ITEM_KIND_LABELS, ruleTypeLabel, TRAVEL_MODE_LABELS, WEEKDAY_LABELS } from '../lib/common';

/** 業種の表示名（Excel の「事業所」シートだけで使う） */
export const INDUSTRY_LABELS: Record<Industry, string> = {
  sitter: 'ベビーシッター',
  care: '介護',
  nursing: '訪問看護',
  other: 'その他',
};
/** 時間の決め方 */
export const WINDOW_LABELS = { fixed: 'ちょうど', window: '幅' } as const;
/** 「はい」の印 */
export const YES = '○';
/** 休みの日の時間帯 */
export const DAY_OFF = '休み';
/** あり/なしの条件の4つの書き方 */
export const FLAG_COND_TEXTS = ['あり', 'なし', 'なし（未確認も可）', 'あり（未確認も可）'] as const;
/** 複数の選択肢を「すべて含む」の前置き */
export const ALL_PREFIX = 'すべて：';

/** 全角の数字・記号を半角に（数・時刻・日付・決まった語を読むときだけ使う。名前には使わない） */
export const nfkc = (s: string) => s.normalize('NFKC').trim();

/** 選択肢から複数の特性で「確認済みで1つもない」（選択肢には使えない） */
export const EMPTY_MULTI = EMPTY_OPTION_MARK;

/** 「、」か改行で区切った値（空は除く。「・」「,」は区切らない＝選択肢の名前に使える） */
export const splitList = (s: string): string[] =>
  s
    .split(/[、\r\n]/)
    .map((x) => x.trim())
    .filter((x) => x !== '');

/** シート名に使えない文字を除き、31文字までにする */
function safeSheetName(s: string): string {
  const t = s.replace(/[[\]:*?/\\]/g, '').slice(0, 31);
  return t === '' ? '名前なし' : t;
}

export const FIXED_SHEETS = {
  howto: '使い方',
  org: '事業所',
  items: '項目',
  rules: '条件',
  presets: 'プリセット',
  compat: '相性',
  availability: '稼働時間',
  absences: '欠勤',
  visitTypes: '種類',
  patterns: '定期パターン',
  visits: '訪問',
  clientLeaves: '訪問先の休み',
} as const;

/** 定期パターンの間隔（ADR-0012。1＝毎週…4＝4週ごと） */
export const EVERY_WEEKS_LABELS: Record<1 | 2 | 3 | 4, string> = { 1: '毎週', 2: '隔週', 3: '3週ごと', 4: '4週ごと' };

/** 定期パターンの間隔の「毎月」（ADR-0013。毎月の第N週。第N週は別の列） */
export const MONTHLY_LABEL = '毎月';

/** 毎月の第N週の文（[3, 4] → 「3、4」） */
export const monthWeeksText = (weeks: readonly number[]): string => weeks.join('、');

/** 「3、4」「第3・第4」「3,4」（全角も）→ [3, 4]（小さい順・重なりなし）。空・1〜5 以外があれば null */
export function parseMonthWeeks(s: string): number[] | null {
  const parts = nfkc(s)
    .split(/[、,，・\s]+/)
    .map((x) => x.replace(/^第/, '').replace(/週$/, ''))
    .filter((x) => x !== '');
  if (parts.length === 0) return null;
  const out = new Set<number>();
  for (const x of parts) {
    if (!/^[1-5]$/.test(x)) return null;
    out.add(Number(x));
  }
  return [...out].sort((a, b) => a - b);
}

/** 曜日ごとの時刻の文（「月 9:30、木 15:00〜15:30」。ちょうどは開始（早）だけ） */
export function dayTimesText(
  dayTimes: readonly { weekday: number; earliestStart: string; latestStart: string }[],
  windowKind: 'fixed' | 'window',
): string {
  const t = (h: string) => h.replace(/^0(\d)/, '$1');
  return dayTimes
    .map((x) =>
      windowKind === 'fixed' || x.earliestStart === x.latestStart
        ? `${WEEKDAY_LABELS[x.weekday]} ${t(x.earliestStart)}`
        : `${WEEKDAY_LABELS[x.weekday]} ${t(x.earliestStart)}〜${t(x.latestStart)}`,
    )
    .join('、');
}

/**
 * 「月 9:30、木 15:00〜15:30」→ 曜日ごとの時刻（曜日の順）。区切りは「、」か改行。読めなければ理由の文。
 * 開始（遅）を省いたら開始（早）と同じ
 */
export function parseDayTimes(s: string): { weekday: number; earliestStart: string; latestStart: string }[] | string {
  const out: { weekday: number; earliestStart: string; latestStart: string }[] = [];
  for (const raw of s.split(/[、\r\n]/)) {
    const x = nfkc(raw);
    if (x === '') continue;
    const m = /^(.)曜?\s*(\d{1,2}[:：]\d{2})\s*(?:[〜~\-－ー]\s*(\d{1,2}[:：]\d{2}))?$/.exec(x);
    const wd = m ? (WEEKDAY_LABELS as readonly string[]).indexOf(m[1]!) : -1;
    if (!m || wd < 0) return `「${x}」は「月 9:30」「木 15:00〜15:30」の形で書いてください`;
    const a = parseTimeText(m[2]!);
    const b = m[3] ? parseTimeText(m[3]) : a;
    if (!a || !b) return `「${x}」の時刻が読めません`;
    if (a > b) return `「${x}」の開始（遅）が開始（早）より前です`;
    if (out.some((y) => y.weekday === wd)) return `「${WEEKDAY_LABELS[wd]}」の時刻が2つあります`;
    out.push({ weekday: wd, earliestStart: a, latestStart: b });
  }
  return out.sort((p, q) => p.weekday - q.weekday);
}

/** 「毎週」「隔週」「3週ごと」「4週ごと」（全角の数字も）→ 1〜4。読めなければ null */
export function parseEveryWeeks(s: string): 1 | 2 | 3 | 4 | null {
  const t = nfkc(s).replace(/\s/g, '');
  for (const [k, v] of Object.entries(EVERY_WEEKS_LABELS)) if (nfkc(v) === t) return Number(k) as 1 | 2 | 3 | 4;
  return null;
}

/** 〈スタッフ〉〈利用者さん〉のシート名（決まったシート名・互いと重なるときは後ろに役割を足す） */
export function personSheetNames(t: Terms): { staff: string; client: string } {
  const fixed = new Set<string>(Object.values(FIXED_SHEETS));
  let staff = safeSheetName(t.staff);
  if (fixed.has(staff)) staff = safeSheetName(`${t.staff}（訪問する人）`);
  let client = safeSheetName(t.client);
  if (fixed.has(client) || client === staff) client = safeSheetName(`${t.client}（訪問先）`);
  return { staff, client };
}

// ---- 時刻・日付 ----

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "09:00" → "9:00"（Excel に書く形） */
export const hhmmToCell = (hhmm: string) => `${Number(hhmm.slice(0, 2))}:${hhmm.slice(3, 5)}`;

/** 「9:00」「09:00」「9:00:00」→ "09:00"。読めなければ null */
export function parseTimeText(s: string): string | null {
  const m = /^(\d{1,2})[:：](\d{2})(?::\d{2})?$/.exec(nfkc(s));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

/** 分（0〜1439）→ "HH:mm" */
const minutesToHhmm = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

/** Excel の時刻のシリアル値（0 以上 1 未満の日の割合）→ "HH:mm"。1 以上（日付つき・「9」のような数）は読まない */
export function serialToTime(n: number): string | null {
  if (!Number.isFinite(n) || n < 0 || n >= 1) return null;
  const m = Math.round(n * 1440);
  return m >= 1440 ? null : minutesToHhmm(m);
}

/** Excel の日付の起点（1899-12-30。ExcelJS は日付セルをこの起点の UTC の Date で返す） */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** ExcelJS が返した Date を時刻として読む（日付の部分は見ない） */
export function dateToTime(d: Date): string {
  const minutes = Math.round((d.getTime() - EXCEL_EPOCH) / 60_000);
  return minutesToHhmm(((minutes % 1440) + 1440) % 1440);
}

/** 時刻だけのセル（1900年より前の Date）か */
export const isTimeOnlyDate = (d: Date) => d.getTime() < Date.UTC(1900, 0, 1);

const validYmd = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** ExcelJS が返した Date（UTC）→ "YYYY-MM-DD" */
export const dateToYmd = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

/** 「2026-10-13」「2026/10/13」「2026年10月13日」→ "2026-10-13"。読めなければ null */
export function parseDateText(s: string): string | null {
  const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(nfkc(s));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return validYmd(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
}

/** Excel の日付のシリアル値 → "YYYY-MM-DD" */
export function serialToDate(n: number): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 2_958_465) return null;
  return dateToYmd(new Date(EXCEL_EPOCH + Math.floor(n) * DAY_MS));
}

/** 数（「1,000」「３」も読む）。読めなければ null */
export function parseNumberText(s: string): number | null {
  const t = nfkc(s).replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ---- 曜日・時間帯 ----

/** [1,2,3,4,5] → "月火水木金" */
export const workDaysText = (days: number[]) => days.map((d) => WEEKDAY_LABELS[d] ?? '').join('');

/** "月火水木金" → [1..5]（区切りの記号・空白は無視）。知らない文字があれば null */
export function parseWorkDays(s: string): number[] | null {
  const out: number[] = [];
  for (const ch of s.replace(/[、,，・\s曜]/g, '')) {
    const i = (WEEKDAY_LABELS as readonly string[]).indexOf(ch);
    if (i < 0) return null;
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

/** 時間帯の列 → "9:00-12:00、13:00-18:00"（空は「休み」） */
export const slotsCellText = (slots: { start: string; end: string }[]) =>
  slots.length === 0 ? DAY_OFF : slots.map((s) => `${hhmmToCell(s.start)}-${hhmmToCell(s.end)}`).join('、');

/** "9:00-12:00、13:00-18:00" / 「休み」→ 時間帯の列。読めなければ null */
export function parseSlots(s: string): { start: string; end: string }[] | null {
  const t = s.trim();
  if (t === DAY_OFF) return [];
  const parts = t.split(/[、,，\n]/).map((x) => x.trim());
  const out: { start: string; end: string }[] = [];
  for (const p of parts) {
    if (p === '') continue;
    const m = /^(.+?)\s*[-~〜]\s*(.+)$/.exec(nfkc(p));
    if (!m) return null;
    const start = parseTimeText(m[1] ?? '');
    const end = parseTimeText(m[2] ?? '');
    if (!start || !end) return null;
    out.push({ start, end });
  }
  return out.length === 0 ? null : out;
}

// ---- 名前の表と逆引き ----

/** 表示名 → 値（NFKC でも引く） */
export function lookup<T extends string>(labels: Record<T, string>, text: string, alsoKeys = true): T | null {
  const t = nfkc(text);
  for (const [k, v] of Object.entries(labels) as [T, string][]) {
    if (v === text.trim() || nfkc(v) === t || (alsoKeys && k === t)) return k;
  }
  return null;
}

/**
 * Excel の条件の種類の名前（プリセットのシートの「重み：〈名前〉」「必須」の見出し・値）。画面の名前（ruleTypeLabel）は
 * PRD D174 で「空き時間（待ち）」に言い換えたが、書き出し・読み込みのブックの形は変えないので「待ち時間」のまま
 */
export const ruleTypeLabels = (t: Terms) =>
  Object.fromEntries(RULE_TYPES.map((r) => [r, r === 'wait' ? '待ち時間' : ruleTypeLabel(r, t)])) as Record<
    RuleType,
    string
  >;
export const itemKindLabels = ITEM_KIND_LABELS;
export const travelModeLabels: Record<TravelMode, string> = TRAVEL_MODE_LABELS;

// ---- 特性 ----

/** 特性の値 → セル（空＝未確認）。数値は数のまま */
export function traitToCell(item: Item, v: TraitValue | undefined): string | number {
  if (v === undefined || v === null) return '';
  switch (item.kind) {
    case 'flag':
      return v === true ? 'あり' : v === false ? 'なし' : String(v);
    case 'multi':
      if (Array.isArray(v)) return v.length === 0 ? EMPTY_MULTI : v.join('、');
      return String(v);
    case 'number':
      return typeof v === 'number' ? v : String(v);
    case 'choice':
      return Array.isArray(v) ? v.join('、') : String(v);
  }
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const ng = <T>(error: string): Parsed<T> => ({ ok: false, error });

/** 選択肢に合う元の名前（そのまま→全角半角をそろえて） */
function matchOption(options: string[], token: string): string | null {
  if (options.includes(token)) return token;
  const t = nfkc(token);
  return options.find((o) => nfkc(o) === t) ?? null;
}

function matchOptions(item: Item, tokens: string[]): Parsed<string[]> {
  const out: string[] = [];
  for (const tok of tokens) {
    const o = matchOption(item.options, tok);
    if (o === null)
      return ng(`「${tok}」は「${item.name}」の選択肢にありません（選択肢：${item.options.join('、') || 'なし'}）`);
    out.push(o);
  }
  return ok(out);
}

/** セルの文字 → 特性の値。空は undefined（未確認） */
export function parseTrait(item: Item, cell: string | number | boolean): Parsed<TraitValue | undefined> {
  if (cell === '') return ok(undefined);
  const s = String(cell).trim();
  switch (item.kind) {
    case 'flag': {
      if (cell === true || nfkc(s) === 'あり') return ok(true);
      if (cell === false || nfkc(s) === 'なし') return ok(false);
      return ng('「あり」「なし」か空（未確認）で書いてください');
    }
    case 'choice': {
      const o = matchOption(item.options, s);
      return o === null
        ? ng(`「${s}」は「${item.name}」の選択肢にありません（選択肢：${item.options.join('、') || 'なし'}）`)
        : ok(o);
    }
    case 'multi': {
      // セル全体が1つの選択肢と同じなら、その1つ（区切りの記号を含む名前でも読む）
      const whole = matchOption(item.options, s);
      if (whole !== null) return ok([whole]);
      if (nfkc(s) === nfkc(EMPTY_MULTI)) return ok([]);
      return matchOptions(item, splitList(s));
    }
    case 'number': {
      const n = typeof cell === 'number' ? cell : parseNumberText(s);
      return n === null ? ng('数で書いてください') : ok(n);
    }
  }
}

// ---- 条件 ----

/** 数 → 文字（指数表記「1e-7」にしない。読み戻すと同じ数になる最短の小数） */
export function plainNumber(n: number): string {
  const s = String(n);
  if (!/e/i.test(s)) return s;
  if (Number.isInteger(n)) return BigInt(n).toString();
  for (let d = 1; d <= 100; d++) {
    const t = n.toFixed(d);
    if (Number(t) === n) return t;
  }
  return n.toFixed(100);
}
const numText = (v: TraitValue) => (typeof v === 'number' ? plainNumber(v) : String(v));
const listOf = (v: TraitValue): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);

/** 1つの条件の書き方（書けない形は null） */
function condLine(item: Item, c: Condition): string | null {
  switch (item.kind) {
    case 'flag':
      if (typeof c.value !== 'boolean') return null;
      if (c.op === 'is') return c.value ? 'あり' : 'なし';
      if (c.op === 'not') return c.value ? 'なし（未確認も可）' : 'あり（未確認も可）';
      return null;
    case 'choice':
      if (c.op === 'is' && typeof c.value === 'string') return c.value;
      if (c.op === 'in' && listOf(c.value).length > 0) return listOf(c.value).join('、');
      if (c.op === 'not' && typeof c.value === 'string') return `${c.value}以外`;
      return null;
    case 'multi':
      if (listOf(c.value).length === 0) return null;
      if (c.op === 'hasAny') return listOf(c.value).join('、');
      if (c.op === 'hasAll') return `${ALL_PREFIX}${listOf(c.value).join('、')}`;
      return null;
    case 'number':
      if (typeof c.value !== 'number') return null;
      if (c.op === 'gte') return `${numText(c.value)}以上`;
      if (c.op === 'lte') return `${numText(c.value)}以下`;
      if (c.op === 'is') return numText(c.value);
      if (c.op === 'not') return `${numText(c.value)}以外`;
      return null;
  }
}

/**
 * 1つの項目にかかる条件 → セル（空＝問わない）。数値の「以上」「以下」の2つは「3〜5」にまとめる。
 * 1つのセルに書けない組み合わせ（同じ項目の条件が複数）は、1行に1つずつ改行で並べる
 */
export function condsToCell(item: Item, conds: Condition[]): string {
  const [a, b] = conds;
  if (
    item.kind === 'number' &&
    conds.length === 2 &&
    a?.op === 'gte' &&
    b?.op === 'lte' &&
    typeof a.value === 'number' &&
    typeof b.value === 'number'
  ) {
    return `${numText(a.value)}〜${numText(b.value)}`;
  }
  return conds
    .map((c) => condLine(item, c))
    .filter((x): x is string => x !== null)
    .join('\n');
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;

function parseCondLine(item: Item, line: string): Parsed<Condition[]> {
  const n = nfkc(line).replace(/\s/g, '');
  const id = item.id;
  switch (item.kind) {
    case 'flag': {
      if (n === 'あり') return ok([{ itemId: id, op: 'is', value: true }]);
      if (n === 'なし') return ok([{ itemId: id, op: 'is', value: false }]);
      if (n === nfkc('なし（未確認も可）')) return ok([{ itemId: id, op: 'not', value: true }]);
      if (n === nfkc('あり（未確認も可）')) return ok([{ itemId: id, op: 'not', value: false }]);
      return ng(`${FLAG_COND_TEXTS.map((x) => `「${x}」`).join('')}のどれかか、空（問わない）で書いてください`);
    }
    case 'choice': {
      const t = line.trim();
      // 行全体が選択肢と同じなら、その1つ（「…以外」で終わる名前の選択肢でも読む）
      const whole = matchOption(item.options, t);
      if (whole !== null) return ok([{ itemId: id, op: 'is', value: whole }]);
      if (t.endsWith('以外')) {
        const r = matchOptions(item, [t.slice(0, -2).trim()]);
        return r.ok ? ok([{ itemId: id, op: 'not', value: r.value[0] ?? '' }]) : r;
      }
      const r = matchOptions(item, splitList(t));
      if (!r.ok) return r;
      if (r.value.length === 0) return ng('選択肢を書いてください');
      return ok([
        r.value.length === 1
          ? { itemId: id, op: 'is', value: r.value[0] ?? '' }
          : { itemId: id, op: 'in', value: r.value },
      ]);
    }
    case 'multi': {
      const whole = matchOption(item.options, line.trim());
      if (whole !== null) return ok([{ itemId: id, op: 'hasAny', value: [whole] }]);
      const m = /^すべて[:：](.*)$/.exec(line.trim()) ?? /^すべて:(.*)$/.exec(nfkc(line));
      const r = matchOptions(item, splitList(m ? (m[1] ?? '') : line));
      if (!r.ok) return r;
      if (r.value.length === 0) return ng('選択肢を書いてください');
      return ok([{ itemId: id, op: m ? 'hasAll' : 'hasAny', value: r.value }]);
    }
    case 'number': {
      let m = new RegExp(`^(${NUM})以上$`).exec(n);
      if (m) return ok([{ itemId: id, op: 'gte', value: Number(m[1]) }]);
      m = new RegExp(`^(${NUM})以下$`).exec(n);
      if (m) return ok([{ itemId: id, op: 'lte', value: Number(m[1]) }]);
      m = new RegExp(`^(${NUM})以外$`).exec(n);
      if (m) return ok([{ itemId: id, op: 'not', value: Number(m[1]) }]);
      m = new RegExp(`^(${NUM})[〜~](${NUM})$`).exec(n);
      if (m)
        return ok([
          { itemId: id, op: 'gte', value: Number(m[1]) },
          { itemId: id, op: 'lte', value: Number(m[2]) },
        ]);
      m = new RegExp(`^(${NUM})$`).exec(n);
      if (m) return ok([{ itemId: id, op: 'is', value: Number(m[1]) }]);
      return ng('「3以上」「5以下」「3〜5」「3」「3以外」の形で書いてください');
    }
  }
}

/** セル → 1つの項目にかかる条件（空＝問わない。改行で区切ると、1行が1つの条件） */
export function parseConds(item: Item, cell: string): Parsed<Condition[]> {
  const out: Condition[] = [];
  for (const line of cell.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const r = parseCondLine(item, line);
    if (!r.ok) return r;
    out.push(...r.value);
  }
  return ok(out);
}

export type { Parsed };
