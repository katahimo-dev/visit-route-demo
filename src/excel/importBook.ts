// Excel のブック → DemoData（名前の参照を ID に直す）。データは書き換えない（ADR-0006）
// 最後は store の migrate（形の検査と repair）を通した結果を返す。画面が store の replace で入れる
import ExcelJS from 'exceljs';
import type { DemoData, ImportError } from '../contracts/data';
import {
  type Absence,
  type Availability,
  type Client,
  type ClientLeave,
  MAX_VISIT_TYPES,
  type Org,
  type Pattern,
  SPAN_LIMIT_DEFAULT_HOURS,
  type Staff,
  stageOfLegacy,
  type Visit,
  type VisitType,
} from '../contracts/documents';
import {
  type Compat,
  type Condition,
  HARDABLE,
  type Item,
  type ItemTarget,
  MAX_PRESETS,
  type Preset,
  RULE_TYPES,
  type Rule,
  type Traits,
} from '../contracts/rules';
import { slotsError } from '../domain/availability';
import { STAGE_LABELS } from '../lib/clientStage';
import { MAX_OPTIONS, nameKey, newId, optionNameError } from '../lib/common';
import { normalizeEmail } from '../lib/mailto';
import { normalizePostalCode } from '../lib/postalCode';
import { isImportError, migrate } from '../store';
import {
  absenceCols,
  availabilityCols,
  CLIENT_ALLOWED_COL,
  CLIENT_COLS,
  CLIENT_KANA_COL,
  CLIENT_POSTAL_COL,
  CLIENT_RULE_COLS,
  CLIENT_STAGE_COLS,
  CLIENT_TENTATIVE_COL,
  clientLeaveCols,
  ITEM_COLS,
  ORG_HEADERS,
  ORG_KEYS,
  PATTERN_EXTRA_COLS,
  PREF_PREFIX,
  PRESET_COLS,
  patternCols,
  prefHeader,
  presetWeightHeader,
  REQ_PREFIX,
  RULE_COLS,
  reqHeader,
  STAFF_COLS,
  STAFF_EMAIL_COL,
  STAFF_LAST_DAY_COL,
  TRAIT_PREFIX,
  TYPE_COLS,
  traitHeader,
  VISIT_PATTERN_COLS,
  VISIT_SAME_DAY_COL,
  VISIT_TYPE_COL,
  visitBaseCols,
  visitCols,
} from './layout';
import {
  dateToTime,
  dateToYmd,
  EVERY_WEEKS_LABELS,
  FIXED_SHEETS,
  INDUSTRY_LABELS,
  isTimeOnlyDate,
  itemKindLabels,
  lookup,
  MONTHLY_LABEL,
  nfkc,
  parseConds,
  parseDateText,
  parseDayTimes,
  parseEveryWeeks,
  parseMonthWeeks,
  parseNumberText,
  parseSlots,
  parseTimeText,
  parseTrait,
  parseWorkDays,
  personSheetNames,
  ruleTypeLabels,
  serialToDate,
  serialToTime,
  splitList,
  travelModeLabels,
  WINDOW_LABELS,
  YES,
} from './text';

/** まとめて返すエラーの数の上限 */
const MAX_ERRORS = 10;
/** 読み込むファイルの大きさの上限（バイト） */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** 1つのシートの行数の上限（見出しを除く、空でない行） */
export const MAX_ROWS = 10_000;
/** ID に使えない名前（JavaScript のオブジェクトの組み込みの名前。キーにすると壊れる） */
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);
/** 1人の必要条件・希望の上限（contracts/documents.ts の max） */
const MAX_CONDS = 20;
/** 定期パターンの上限（contracts/data.ts の max） */
const MAX_PATTERNS = 2000;
/** 〈利用者さん〉の休みの上限（contracts/data.ts の max） */
const MAX_LEAVES = 2000;

type Prim = string | number | boolean | Date | null;
/** 読めないセル（数式のエラー・結果の無い数式） */
type Bad = { bad: string };
const isBad = (v: Prim | Bad): v is Bad => typeof v === 'object' && v !== null && !(v instanceof Date);

/** ExcelJS のセルの値を、ふつうの値にする（リッチテキスト・数式の結果・リンクも読む） */
function prim(v: ExcelJS.CellValue | undefined): Prim | Bad {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    if ('error' in v) return { bad: `数式のエラー（${String(v.error)}）になっています` };
    if ('formula' in v || 'sharedFormula' in v) {
      const result = (v as { result?: ExcelJS.CellValue }).result;
      if (result === undefined)
        return { bad: '数式の結果が保存されていません（Excel で開いて保存し直すか、値を直接書いてください）' };
      return prim(result);
    }
    if ('richText' in v && Array.isArray(v.richText)) return prim(v.richText.map((r) => r.text).join(''));
    if ('text' in v && typeof v.text === 'string') return prim(v.text);
  }
  return null;
}

/**
 * メールアドレスの列（ADR-0017）：空・列が無いなら ''。全角・前後の空白・「mailto:」は直し、形が合わなければ行付きで止めて null
 */
function readEmail(r: Row, h: string): string | null {
  const t = r.text(h);
  const e = normalizeEmail(t);
  if (e === null) r.err(h, `メールアドレスの形ではありません（例 name@example.com。いま「${t.slice(0, 40)}」）`);
  return e;
}

/** 見出しの比べ方（全角半角・コロンの揺れ・空白を許す） */
export const headerKey = nameKey;

/** 値 → 文字（前後の空白は落とす。日付・時刻は 2026-10-13・9:00 の形） */
function textOf(v: Prim): string {
  if (v === null) return '';
  if (v instanceof Date) {
    if (isTimeOnlyDate(v)) {
      const t = dateToTime(v);
      return `${Number(t.slice(0, 2))}:${t.slice(3)}`;
    }
    return dateToYmd(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v).trim();
}

class Errors {
  list: string[] = [];
  add(msg: string) {
    if (this.list.length < MAX_ERRORS) this.list.push(msg);
    else this.more = true;
  }
  more = false;
  get any() {
    return this.list.length > 0;
  }
  toError(): ImportError {
    const more = this.more ? '\n（ほかにもあります。直してからもう一度読み込んでください）' : '';
    return { code: 'INVALID_ARGUMENT', message: `${this.list.join('\n')}${more}` };
  }
}

const sheetMsg = (sheet: string, msg: string) => `シート『${sheet}』：${msg}`;

/** 1行（見出しの名前で列を引き、読めない値は場所付きのエラーにする） */
class Row {
  constructor(
    readonly sheet: Sheet,
    readonly n: number,
  ) {}
  raw(h: string): Prim {
    const c = this.sheet.cols.get(headerKey(h));
    return c === undefined ? null : this.sheet.read(this.n, c, h);
  }
  text(h: string): string {
    return textOf(this.raw(h));
  }
  err(h: string, msg: string): null {
    this.sheet.errors.add(`シート『${this.sheet.name}』の ${this.n}行目・『${h}』：${msg}`);
    return null;
  }
  required(h: string, max?: number): string | null {
    const t = this.text(h);
    if (t === '') return this.err(h, '空にはできません');
    return this.limit(h, t, max);
  }
  /** 文字数の上限（contracts の max）。超えたらエラーにして null */
  limit(h: string, t: string, max?: number): string | null {
    if (max !== undefined && t.length > max) return this.err(h, `${max}文字までです（いま${t.length}文字）`);
    return t;
  }
  /** 空でもよい文字（上限を超えたらエラーにして ''） */
  optional(h: string, max: number): string {
    return this.limit(h, this.text(h), max) ?? '';
  }
  date(h: string): string | null {
    const v = this.raw(h);
    if (v === null) return this.err(h, '日付を書いてください');
    const d = v instanceof Date ? dateToYmd(v) : typeof v === 'number' ? serialToDate(v) : parseDateText(textOf(v));
    return d ?? this.err(h, '日付は 2026-10-13 の形で書いてください');
  }
  time(h: string, required = true): string | null {
    const v = this.raw(h);
    if (v === null) return required ? this.err(h, '時刻を書いてください') : null;
    const t = v instanceof Date ? dateToTime(v) : typeof v === 'number' ? serialToTime(v) : parseTimeText(textOf(v));
    return t ?? this.err(h, '時刻は 9:00 の形で書いてください');
  }
  /** 数（空は null。読めない・範囲外はエラーにして undefined） */
  num(h: string, o: { int?: boolean; min?: number; max?: number; required?: boolean } = {}): number | null | undefined {
    const v = this.raw(h);
    if (v === null) {
      if (o.required) {
        this.err(h, '数を書いてください');
        return undefined;
      }
      return null;
    }
    const n = typeof v === 'number' ? v : parseNumberText(textOf(v));
    const range =
      o.min !== undefined && o.max !== undefined
        ? `（${o.min}〜${o.max}）`
        : o.min !== undefined
          ? `（${o.min}以上）`
          : '';
    if (n === null || (o.int && !Number.isInteger(n))) {
      this.err(h, `${o.int ? '整数' : '数'}で書いてください${range}`);
      return undefined;
    }
    if ((o.min !== undefined && n < o.min) || (o.max !== undefined && n > o.max)) {
      this.err(h, `${range.slice(1, -1)}の数で書いてください`);
      return undefined;
    }
    return n;
  }
  /** ○＝はい、空＝いいえ */
  yes(h: string): boolean {
    const v = this.raw(h);
    if (v === null || v === false) return false;
    if (v === true) return true;
    const t = nfkc(textOf(v));
    if (['○', '◯', '〇', 'o', 'O', 'TRUE', 'true', 'はい'].includes(t)) return true;
    if (['FALSE', 'false', 'いいえ', '×', '-'].includes(t)) return false;
    this.err(h, `「${YES}」か空で書いてください`);
    return false;
  }
}

class Sheet {
  /** 見出しの比べ方（headerKey）→ 列番号 */
  readonly cols = new Map<string, number>();
  /** 見出しの並び（列番号の順。name は書いてあるまま） */
  readonly headers: { name: string; key: string; col: number }[] = [];
  /** 空でない行の番号（2行目から） */
  readonly rowNumbers: number[] = [];
  constructor(
    readonly name: string,
    readonly ws: ExcelJS.Worksheet,
    readonly errors: Errors,
  ) {
    for (let c = 1; c <= ws.columnCount; c++) {
      const h = textOf(this.read(1, c, `${c}列目の見出し`));
      if (h === '') continue;
      const key = headerKey(h);
      if (this.cols.has(key)) {
        errors.add(sheetMsg(name, `見出し『${h}』の列が2つあります`));
        continue;
      }
      this.cols.set(key, c);
      this.headers.push({ name: h, key, col: c });
    }
    // 値のある行だけを回す（遠くの行に空白が1つあっても、100万行を回さない）
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1 || this.rowNumbers.length > MAX_ROWS) return;
      let any = false;
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (!any && prim(cell.value) !== null) any = true;
      });
      if (any) this.rowNumbers.push(n);
    });
    if (this.rowNumbers.length > MAX_ROWS) {
      errors.add(sheetMsg(name, `行が多すぎます（${MAX_ROWS.toLocaleString()}行まで）`));
      this.rowNumbers.length = 0;
    }
  }
  /** 1つのセルを読む（数式のエラーなどは場所付きのエラーにして空とみなす） */
  read(n: number, col: number, h: string): Prim {
    const cell = this.ws.getRow(n).getCell(col);
    // 結合したセルの下・右のセルは、左上の値が入って見える。黙って同じ値を読まないよう止める
    if (cell.isMerged && cell.master !== cell) {
      this.errors.add(
        `シート『${this.name}』の ${n}行目・『${h}』：結合したセルは読めません。結合を外して1つずつ書いてください`,
      );
      return null;
    }
    const v = prim(cell.value);
    if (!isBad(v)) return v;
    this.errors.add(`シート『${this.name}』の ${n}行目・『${h}』：${v.bad}`);
    return null;
  }
  has(h: string): boolean {
    return this.cols.has(headerKey(h));
  }
  /** 必須の列があるか（無ければエラー） */
  require(hs: readonly string[]): boolean {
    let ok = true;
    for (const h of hs) {
      if (!this.has(h)) {
        this.errors.add(sheetMsg(this.name, `『${h}』の列がありません（1行目の見出しを確かめてください）`));
        ok = false;
      }
    }
    return ok;
  }
  /** 2行目からの、見出しのある列に値がある行 */
  rows(): Row[] {
    return this.rowNumbers
      .filter((n) => {
        const row = this.ws.getRow(n);
        return this.headers.some((h) => prim(row.getCell(h.col).value) !== null);
      })
      .map((n) => new Row(this, n));
  }
}

/** ID の列：空なら新しい ID、同じ ID が2行あればエラー */
function idOf(row: Row, h: string, seen: Map<string, number>, prefix: string, used: Set<string>, max: number): string {
  const t = row.text(h);
  if (t !== '') {
    if (RESERVED_IDS.has(t)) row.err(h, `「${t}」は ID に使えません`);
    row.limit(h, t, max);
    const before = seen.get(t);
    if (before !== undefined) row.err(h, `ID「${t}」が ${before}行目と重なっています`);
    seen.set(t, row.n);
    return t;
  }
  let id = newId(prefix);
  while (used.has(id) || seen.has(id)) id = newId(prefix);
  used.add(id);
  return id;
}

/** 名前の重なりを調べる（同じ名前があればエラー） */
function uniqueName(row: Row, h: string, name: string, seen: Map<string, number>) {
  // 全角半角・空白だけが違う名前も同じとみなす（見出しで区別できないため）
  const key = nameKey(name);
  const before = seen.get(key);
  if (before !== undefined)
    row.err(
      h,
      `「${name}」が ${before}行目と重なっています（全角半角・空白だけの違いも同じ名前とみなします。名前は重ならないようにしてください）`,
    );
  else seen.set(key, row.n);
}

/** 特性・必要条件・希望の列を項目に結びつける */
interface PersonCols {
  traits: { h: string; item: Item }[];
  reqs: { h: string; item: Item }[];
  prefs: { h: string; item: Item }[];
}
/**
 * kinds：読む列の種類（種類のシートは必要条件だけ。ADR-0012）。読まない種類の見出しは知らない列として読まない
 */
function personCols(
  sheet: Sheet,
  items: Item[],
  own: ItemTarget,
  fixed: readonly string[],
  kinds: readonly (keyof PersonCols)[] = ['traits', 'reqs', 'prefs'],
): PersonCols {
  const out: PersonCols = { traits: [], reqs: [], prefs: [] };
  const other: ItemTarget = own === 'staff' ? 'client' : 'staff';
  const fixedKeys = new Set(fixed.map(headerKey));
  const prefixes = (
    [
      ['traits', headerKey(TRAIT_PREFIX), own],
      ['reqs', headerKey(REQ_PREFIX), other],
      ['prefs', headerKey(PREF_PREFIX), other],
    ] as const
  ).filter(([kind]) => kinds.includes(kind));
  for (const { name, key } of sheet.headers) {
    if (fixedKeys.has(key)) continue;
    const hit = prefixes.find(([, p]) => key.startsWith(p));
    if (!hit) continue; // 知らない列は読まない（メモ書きの列など）
    const [kind, prefix, target] = hit;
    const itemKey = key.slice(prefix.length);
    const item = items.find((i) => i.target === target && headerKey(i.name) === itemKey);
    if (!item) {
      sheet.errors.add(sheetMsg(sheet.name, `見出し『${name}』の項目が、シート『${FIXED_SHEETS.items}』にありません`));
      continue;
    }
    out[kind].push({ h: name, item });
  }
  // 項目のシートにある項目の列が無ければ止める（列を消すと特性・条件が黙って消えるため）
  for (const [kind, , target] of prefixes) {
    const header = kind === 'traits' ? traitHeader : kind === 'reqs' ? reqHeader : prefHeader;
    for (const it of items.filter((i) => i.target === target)) {
      if (!out[kind].some((c) => c.item === it))
        sheet.errors.add(`シート『${sheet.name}』に列『${header(it)}』がありません`);
    }
  }
  return out;
}

function readPerson(
  row: Row,
  cols: PersonCols,
): { traits: Traits; requirements: Condition[]; preferences: Condition[] } {
  const traits = new Map<string, Traits[string]>();
  for (const { h, item } of cols.traits) {
    const v = row.raw(h);
    const cell = v === null ? '' : typeof v === 'number' || typeof v === 'boolean' ? v : textOf(v);
    const r = parseTrait(item, cell);
    if (!r.ok) row.err(h, r.error);
    else if (r.value !== undefined) traits.set(item.id, r.value);
  }
  const conds = (list: { h: string; item: Item }[], label: string) => {
    const out: Condition[] = [];
    for (const { h, item } of list) {
      const r = parseConds(item, row.text(h));
      if (!r.ok) row.err(h, r.error);
      else out.push(...r.value);
    }
    if (out.length > MAX_CONDS)
      row.err(list[0]?.h ?? label, `${label}は1人${MAX_CONDS}件までです（いま${out.length}件）`);
    return out;
  };
  return {
    traits: Object.fromEntries(traits),
    requirements: conds(cols.reqs, '必要条件'),
    preferences: conds(cols.prefs, '希望'),
  };
}

const COMPAT_SYMBOLS: Record<string, 2 | 1 | -1 | -2> = {
  '◎': 2,
  '○': 1,
  '◯': 1,
  〇: 1,
  '△': -1,
  '×': -2,
  '✕': -2,
  x: -2,
  X: -2,
};

/** Excel のブック → DemoData。読めなければ、場所付きの日本語の ImportError */
export async function importWorkbook(buf: ArrayBuffer, base: DemoData): Promise<DemoData | ImportError> {
  if (buf.byteLength > MAX_FILE_BYTES) {
    return { code: 'INVALID_ARGUMENT', message: `ファイルが大きすぎます（${MAX_FILE_BYTES / 1024 / 1024}MB まで）` };
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch {
    return { code: 'INVALID_ARGUMENT', message: 'Excel のファイル（.xlsx）として読めませんでした' };
  }
  const errors = new Errors();
  const sheetOf = (name: string): Sheet | null => {
    const ws = wb.getWorksheet(name);
    if (!ws) {
      errors.add(`シート『${name}』がありません（書き出したブックのシート名を変えないでください）`);
      return null;
    }
    return new Sheet(name, ws, errors);
  };

  // 事業所（呼び方でシート名・見出しが決まるので最初に読む）
  const orgSheet = sheetOf(FIXED_SHEETS.org);
  if (!orgSheet || !orgSheet.require(ORG_HEADERS)) return errors.toError();
  const orgRows = new Map<string, Row>();
  for (const r of orgSheet.rows()) {
    const k = r.text(ORG_HEADERS[0]);
    if (k !== '') orgRows.set(k, r);
  }
  const orgVal = (k: string): Row | null => {
    const r = orgRows.get(k);
    if (!r) errors.add(sheetMsg(FIXED_SHEETS.org, `「${k}」の行がありません`));
    return r ?? null;
  };
  const V = ORG_HEADERS[1];
  const nameRow = orgVal(ORG_KEYS.name);
  const industryRow = orgVal(ORG_KEYS.industry);
  const staffTermRow = orgVal(ORG_KEYS.staffTerm);
  const clientTermRow = orgVal(ORG_KEYS.clientTerm);
  const fareRow = orgVal(ORG_KEYS.fare);
  const seedRow = orgVal(ORG_KEYS.seed);
  const termOf = (r: Row | null) => {
    const t = r?.required(V) ?? null;
    if (t !== null && t.length > 10) return r?.err(V, '呼び方は10文字までです') ?? null;
    return t;
  };
  const staffTerm = termOf(staffTermRow);
  const clientTerm = termOf(clientTermRow);
  if (staffTerm !== null && staffTerm === clientTerm)
    clientTermRow?.err(V, '呼び方（訪問する人）と同じです。別の呼び方にしてください');
  if (errors.any || staffTerm === null || clientTerm === null) return errors.toError();
  const terms = { staff: staffTerm, client: clientTerm };
  const orgName = nameRow?.required(V, 100) ?? '';
  const industryText = industryRow?.required(V) ?? null;
  const industry = industryText === null ? null : lookup(INDUSTRY_LABELS, industryText);
  if (industryText !== null && industry === null)
    industryRow?.err(V, `「${Object.values(INDUSTRY_LABELS).join('」「')}」のどれかで書いてください`);
  const fare = fareRow?.num(V, { min: 0, max: 1000, required: true });
  const seed = seedRow?.num(V, { int: true, required: true });
  // 拘束の上限（ADR-0015）：行が無い古いブックは既定（10時間）。0.5刻み
  const spanRow = orgRows.get(ORG_KEYS.spanLimit);
  let spanLimit = spanRow ? spanRow.num(V, { min: 0, max: 24 }) : null;
  if (typeof spanLimit === 'number' && !Number.isInteger(spanLimit * 2)) {
    spanRow?.err(V, '0.5刻みで書いてください');
    spanLimit = undefined;
  }

  const names = personSheetNames(terms);
  const itemSheet = sheetOf(FIXED_SHEETS.items);
  const ruleSheet = sheetOf(FIXED_SHEETS.rules);
  const staffSheet = sheetOf(names.staff);
  const clientSheet = sheetOf(names.client);
  const compatSheet = sheetOf(FIXED_SHEETS.compat);
  const availSheet = sheetOf(FIXED_SHEETS.availability);
  const visitSheet = sheetOf(FIXED_SHEETS.visits);
  const ac = availabilityCols(terms);
  const vc = visitCols(terms);
  // 見つかったシートの必須の列も、まとめて確かめる
  const columnsOk = [
    itemSheet?.require(Object.values(ITEM_COLS)),
    ruleSheet?.require(Object.values(RULE_COLS)),
    staffSheet?.require(Object.values(STAFF_COLS)),
    clientSheet?.require(Object.values(CLIENT_COLS)),
    availSheet?.require(Object.values(ac)),
    visitSheet?.require(Object.values(visitBaseCols(terms))),
  ].every((x) => x !== false);
  if (
    !itemSheet ||
    !ruleSheet ||
    !staffSheet ||
    !clientSheet ||
    !compatSheet ||
    !availSheet ||
    !visitSheet ||
    !columnsOk
  ) {
    return errors.toError();
  }

  /** いまある ID（新しい ID と重ならないように） */
  const used = new Set<string>([
    ...base.items.map((x) => x.id),
    ...base.rules.map((x) => x.id),
    ...base.staff.map((x) => x.id),
    ...base.clients.map((x) => x.id),
    ...base.visits.map((x) => x.id),
    ...base.absences.map((x) => x.id),
    ...base.visitTypes.map((x) => x.id),
    ...base.patterns.map((x) => x.id),
    ...base.clientLeaves.map((x) => x.id),
  ]);

  // 項目
  const items: Item[] = [];
  {
    const ids = new Map<string, number>();
    // 項目の名前は対象ごとに重ならない（対象が違えば同じ名前でもよい）
    const seen = { staff: new Map<string, number>(), client: new Map<string, number>() };
    for (const r of itemSheet.rows()) {
      const id = idOf(r, ITEM_COLS.id, ids, 'i', used, 50);
      const name = r.required(ITEM_COLS.name, 30);
      const tText = r.required(ITEM_COLS.target);
      const target = tText === null ? null : lookup({ staff: terms.staff, client: terms.client }, tText);
      if (tText !== null && target === null)
        r.err(ITEM_COLS.target, `「${terms.staff}」か「${terms.client}」で書いてください`);
      if (name !== null && target) uniqueName(r, ITEM_COLS.name, name, seen[target]);
      const kText = r.required(ITEM_COLS.kind);
      const kind = kText === null ? null : lookup(itemKindLabels, kText);
      if (kText !== null && kind === null)
        r.err(ITEM_COLS.kind, `「${Object.values(itemKindLabels).join('」「')}」のどれかで書いてください`);
      const options = kind === 'choice' || kind === 'multi' ? splitList(r.text(ITEM_COLS.options)) : [];
      if (new Set(options).size !== options.length) r.err(ITEM_COLS.options, '同じ選択肢が2つあります');
      if (options.length > MAX_OPTIONS) r.err(ITEM_COLS.options, `選択肢は${MAX_OPTIONS}個までです`);
      for (const o of options) {
        const e = optionNameError(o);
        if (e) r.err(ITEM_COLS.options, `「${o}」：${e}`);
      }
      if (name !== null && target && kind) items.push({ id, name, target, kind, options });
    }
  }

  // 条件
  const rules: Rule[] = [];
  {
    const labels = ruleTypeLabels(terms);
    const ids = new Map<string, number>();
    // 条件の名前はどこからも参照しないので、重なってもよい
    for (const r of ruleSheet.rows()) {
      const id = idOf(r, RULE_COLS.id, ids, 'r', used, 50);
      const label = r.required(RULE_COLS.label, 40);
      const tText = r.required(RULE_COLS.type);
      const type = tText === null ? null : lookup(labels, tText);
      if (tText !== null && type === null) r.err(RULE_COLS.type, '一覧にない種類です（プルダウンから選んでください）');
      const weight = r.num(RULE_COLS.weight, { min: 0, max: 5, required: true });
      if (typeof weight === 'number' && !Number.isInteger(weight * 2))
        r.err(RULE_COLS.weight, '重みは0.5刻みで書いてください');
      const hard = r.yes(RULE_COLS.hard);
      if (label !== null && type && typeof weight === 'number') rules.push({ id, type, label, weight, hard });
    }
  }
  if (errors.any) return errors.toError();

  // プリセット（ADR-0008）。シートが無い古いブックは、いまのプリセット・点数の基準のまま
  let presets: Preset[] = base.presets;
  let scorePresetId = base.scorePresetId;
  const presetWs = wb.getWorksheet(FIXED_SHEETS.presets);
  if (presetWs) {
    const sheet = new Sheet(FIXED_SHEETS.presets, presetWs, errors);
    const labels = ruleTypeLabels(terms);
    const weightCols = RULE_TYPES.map((t) => ({ t, h: presetWeightHeader(labels[t]) }));
    if (
      !sheet.require([
        PRESET_COLS.id,
        PRESET_COLS.name,
        PRESET_COLS.note,
        ...weightCols.map((c) => c.h),
        PRESET_COLS.hard,
      ])
    )
      return errors.toError();
    const ids = new Map<string, number>();
    const presetIds = new Set(base.presets.map((p) => p.id));
    const read: Preset[] = [];
    /** 点数の基準（ADR-0010）に ○ を付けた行（列が無い・無印なら先頭。migrate の repair が補う） */
    const marked: { id: string; n: number }[] = [];
    const rows = sheet.rows();
    if (rows.length === 0) errors.add(sheetMsg(FIXED_SHEETS.presets, 'プリセットを1行以上書いてください'));
    if (rows.length > MAX_PRESETS)
      errors.add(sheetMsg(FIXED_SHEETS.presets, `プリセットは${MAX_PRESETS}つまでです（いま${rows.length}行）`));
    for (const r of rows) {
      const id = idOf(r, PRESET_COLS.id, ids, 'p', presetIds, 50);
      const name = r.required(PRESET_COLS.name, 20);
      const note = r.optional(PRESET_COLS.note, 60);
      const hardTypes = new Set<string>();
      for (const part of splitList(r.text(PRESET_COLS.hard))) {
        const t = lookup(labels, part);
        if (t === null) r.err(PRESET_COLS.hard, `「${part}」は条件の種類の名前ではありません`);
        else if (!HARDABLE.has(t)) r.err(PRESET_COLS.hard, `「${part}」は必須にできません`);
        else hardTypes.add(t);
      }
      const weights: Partial<Preset['weights']> = {};
      let ok = true;
      for (const { t, h } of weightCols) {
        const w = r.num(h, { min: 0, max: 5 });
        if (w === undefined) ok = false;
        else if (w !== null && !Number.isInteger(w * 2)) {
          r.err(h, '重みは0.5刻みで書いてください');
          ok = false;
        } else weights[t] = { weight: w ?? 0, hard: hardTypes.has(t) };
      }
      if (r.yes(PRESET_COLS.scoreBase)) {
        const first = marked[0];
        if (first) r.err(PRESET_COLS.scoreBase, `${YES} は1行だけにしてください（${first.n}行目にもあります）`);
        marked.push({ id, n: r.n });
      }
      if (name !== null && ok) read.push({ id, name, note, weights: weights as Preset['weights'] });
    }
    if (errors.any) return errors.toError();
    presets = read;
    scorePresetId = marked[0]?.id;
  }

  // スタッフ
  const staff: Staff[] = [];
  const staffByName = new Map<string, string>();
  {
    const cols = personCols(staffSheet, items, 'staff', [
      ...Object.values(STAFF_COLS),
      STAFF_LAST_DAY_COL,
      STAFF_EMAIL_COL,
    ]);
    const ids = new Map<string, number>();
    const seen = new Map<string, number>();
    const C = STAFF_COLS;
    for (const r of staffSheet.rows()) {
      const id = idOf(r, C.id, ids, 's', used, 100);
      const name = r.required(C.name, 50);
      if (name !== null) {
        uniqueName(r, C.name, name, seen);
        staffByName.set(name, id);
      }
      const mText = r.required(C.travelMode);
      const travelMode = mText === null ? null : lookup(travelModeLabels, mText);
      if (mText !== null && travelMode === null)
        r.err(C.travelMode, `「${Object.values(travelModeLabels).join('」「')}」のどれかで書いてください`);
      const workDays = parseWorkDays(r.text(C.workDays));
      if (workDays === null) r.err(C.workDays, '曜日は「月火水木金」のように書いてください');
      const shiftStart = r.time(C.shiftStart);
      const shiftEnd = r.time(C.shiftEnd);
      const active = r.yes(C.active);
      const address = r.optional(C.address, 200);
      const lat = r.num(C.lat, { min: -90, max: 90 });
      const lng = r.num(C.lng, { min: -180, max: 180 });
      // 最終勤務日（ADR-0015）：列が無い古いブック・空はなし
      const lastDay = r.text(STAFF_LAST_DAY_COL) === '' ? null : r.date(STAFF_LAST_DAY_COL);
      // メールアドレス（ADR-0017）：列が無い古いブック・空は ''。全角は直し、形の合わない値は止める
      const email = readEmail(r, STAFF_EMAIL_COL);
      const p = readPerson(r, cols);
      if (
        email !== null &&
        name !== null &&
        travelMode &&
        workDays &&
        shiftStart &&
        shiftEnd &&
        lat !== undefined &&
        lng !== undefined &&
        (lastDay !== null || r.text(STAFF_LAST_DAY_COL) === '')
      ) {
        staff.push({
          id,
          name,
          home: { address, lat, lng },
          travelMode,
          workDays,
          shiftStart,
          shiftEnd,
          active,
          ...p,
          lastDay,
          email,
        });
      }
    }
  }
  const staffId = (r: Row, h: string, required: boolean): string | null | undefined => {
    const t = r.text(h);
    if (t === '') {
      if (required) r.err(h, `${terms.staff}の名前を書いてください`);
      return required ? undefined : null;
    }
    const id = staffByName.get(t);
    if (id === undefined) {
      r.err(h, `「${t}」という${terms.staff}は、シート『${names.staff}』にいません`);
      return undefined;
    }
    return id;
  };

  // 利用者さん
  const clients: Client[] = [];
  const clientByName = new Map<string, string>();
  {
    const cols = personCols(clientSheet, items, 'client', [
      ...Object.values(CLIENT_COLS),
      CLIENT_TENTATIVE_COL,
      CLIENT_KANA_COL,
      CLIENT_POSTAL_COL,
      CLIENT_ALLOWED_COL,
      ...Object.values(CLIENT_RULE_COLS),
      ...Object.values(CLIENT_STAGE_COLS),
    ]);
    const ids = new Map<string, number>();
    const seen = new Map<string, number>();
    const C = CLIENT_COLS;
    for (const r of clientSheet.rows()) {
      const id = idOf(r, C.id, ids, 'c', used, 100);
      const displayName = r.required(C.name, 50);
      if (displayName !== null) {
        uniqueName(r, C.name, displayName, seen);
        clientByName.set(displayName, id);
      }
      // よみ（PRD D61）：列が無い古いブックは空
      const kana = r.optional(CLIENT_KANA_COL, 50);
      const color = r.num(C.color, { int: true, min: 1, max: 8, required: true });
      const active = r.yes(C.active);
      // 仮押さえ（ADR-0012 追記）：列が無い古いブックは false
      const tentative = r.yes(CLIENT_TENTATIVE_COL);
      // 郵便番号（ADR-0016）：列が無い古いブック・空は ''。ハイフン・全角は7桁に直し、直せなければ止める
      // 数値のセル（文字列の書式でない列に 0380000 と書くと 38000 になる）は、0〜9999999 の整数なら先頭を0で埋めて7桁にする
      const postalRaw = r.raw(CLIENT_POSTAL_COL);
      const postalCode = normalizePostalCode(
        typeof postalRaw === 'number' && Number.isInteger(postalRaw) && postalRaw >= 0 && postalRaw <= 9_999_999
          ? String(postalRaw).padStart(7, '0')
          : r.text(CLIENT_POSTAL_COL),
      );
      if (postalCode === null)
        r.err(CLIENT_POSTAL_COL, '7桁の数字で書いてください（ハイフンは有っても無くても構いません）');
      const address = r.optional(C.address, 200);
      const lat = r.num(C.lat, { min: -90, max: 90 });
      const lng = r.num(C.lng, { min: -180, max: 180 });
      const usualStaffId = staffId(r, C.usualStaff, false);
      // 担当できる人（ADR-0014）：列が無い古いブック・空は限らない。いない名前は止める
      const allowedStaffIds: string[] = [];
      let allowedOk = true;
      for (const name of splitList(r.text(CLIENT_ALLOWED_COL))) {
        const sid = staffByName.get(name);
        if (sid === undefined) {
          r.err(CLIENT_ALLOWED_COL, `「${name}」という${terms.staff}は、シート『${names.staff}』にいません`);
          allowedOk = false;
        } else if (!allowedStaffIds.includes(sid)) allowedStaffIds.push(sid);
      }
      const note = r.optional(C.note, 500);
      // 訪問先の決まりごと（ADR-0013）：列が無い古いブックは空
      const entryNote = r.optional(CLIENT_RULE_COLS.entry, 200);
      const keyNote = r.optional(CLIENT_RULE_COLS.key, 200);
      const parkingNote = r.optional(CLIENT_RULE_COLS.parking, 200);
      const cautionNote = r.optional(CLIENT_RULE_COLS.caution, 200);
      // 段階（ADR-0015）：列が無い古いブック・空は「利用中」「仮押さえ」から読み替える。active・tentative は repair が段階に合わせる
      const stageText = r.text(CLIENT_STAGE_COLS.stage);
      const stage = stageText === '' ? stageOfLegacy({ active, tentative }) : lookup(STAGE_LABELS, stageText);
      if (stage === null)
        r.err(CLIENT_STAGE_COLS.stage, `「${Object.values(STAGE_LABELS).join('」「')}」のどれかで書いてください`);
      const referrer = {
        name: r.optional(CLIENT_STAGE_COLS.referrer, 50),
        contact: r.optional(CLIENT_STAGE_COLS.referrerContact, 100),
        note: r.optional(CLIENT_STAGE_COLS.referrerNote, 200),
      };
      // 紹介元のメールアドレス（ADR-0017）：列が無い古いブック・空は ''
      const referrerEmail = readEmail(r, CLIENT_STAGE_COLS.referrerEmail);
      const p = readPerson(r, cols);
      if (
        referrerEmail !== null &&
        stage !== null &&
        postalCode !== null &&
        displayName !== null &&
        typeof color === 'number' &&
        lat !== undefined &&
        lng !== undefined &&
        usualStaffId !== undefined &&
        allowedOk
      ) {
        clients.push({
          id,
          displayName,
          kana,
          place: { address, lat, lng, postalCode },
          note,
          color: color - 1,
          active,
          ...p,
          usualStaffId,
          tentative,
          entryNote,
          keyNote,
          parkingNote,
          cautionNote,
          allowedStaffIds,
          stage,
          referrer: { ...referrer, email: referrerEmail ?? '' },
        });
      }
    }
  }
  const clientId = (r: Row, h: string): string | undefined => {
    const t = r.text(h);
    if (t === '') {
      r.err(h, `${terms.client}の表示名を書いてください`);
      return undefined;
    }
    const id = clientByName.get(t);
    if (id === undefined) r.err(h, `「${t}」という${terms.client}は、シート『${names.client}』にいません`);
    return id;
  };

  // 相性（行＝利用者さん、列＝スタッフ）
  const compat = new Map<string, Compat[string]>();
  {
    const staffCols: { col: number; id: string; name: string }[] = [];
    for (const h of compatSheet.headers) {
      if (h.col === 1) continue;
      const id = staffByName.get(h.name);
      if (id === undefined)
        errors.add(
          sheetMsg(
            FIXED_SHEETS.compat,
            `見出しの「${h.name}」という${terms.staff}は、シート『${names.staff}』にいません`,
          ),
        );
      else staffCols.push({ col: h.col, id, name: h.name });
    }
    const firstHeader = compatSheet.headers.find((h) => h.col === 1)?.name ?? `${terms.client}`;
    const seen = new Map<string, number>();
    for (const n of compatSheet.rowNumbers) {
      const name = textOf(compatSheet.read(n, 1, firstHeader));
      const cells = staffCols.map((s) => ({ s, v: textOf(compatSheet.read(n, s.col, s.name)) }));
      if (name === '' && cells.every((c) => c.v === '')) continue;
      const row = new Row(compatSheet, n);
      if (name === '') {
        row.err(firstHeader, `${terms.client}の表示名を書いてください`);
        continue;
      }
      const cid = clientByName.get(name);
      if (cid === undefined) {
        row.err(firstHeader, `「${name}」という${terms.client}は、シート『${names.client}』にいません`);
        continue;
      }
      uniqueName(row, firstHeader, name, seen);
      const out = new Map<string, 2 | 1 | -1 | -2>();
      for (const { s, v } of cells) {
        if (v === '') continue;
        const level = COMPAT_SYMBOLS[v] ?? COMPAT_SYMBOLS[nfkc(v)];
        if (level === undefined) row.err(s.name, '◎・○・△・× か空で書いてください');
        else out.set(s.id, level);
      }
      if (out.size > 0) compat.set(cid, Object.fromEntries(out));
    }
  }

  // 稼働時間
  const availability: Availability[] = [];
  const availSeen = new Map<string, number>();
  for (const r of availSheet.rows()) {
    const sid = staffId(r, ac.staff, true);
    const date = r.date(ac.date);
    const text = r.text(ac.slots);
    const slots = text === '' ? null : parseSlots(text);
    if (slots === null) r.err(ac.slots, '時間帯は「9:00-12:00、13:00-18:00」の形か「休み」で書いてください');
    else {
      const bad = slots.some((s) => !/:[03]0$/.test(s.start) || !/:[03]0$/.test(s.end))
        ? '時間は30分単位で書いてください'
        : slotsError(slots);
      if (bad) r.err(ac.slots, bad);
      else if (sid && date) {
        const key = `${sid}\u0000${date}`;
        const before = availSeen.get(key);
        if (before !== undefined)
          r.err(ac.date, `同じ${terms.staff}・同じ日の行が ${before}行目にもあります（1日1行にしてください）`);
        else {
          availSeen.set(key, r.n);
          availability.push({ staffId: sid, date, slots });
        }
      }
    }
  }

  // 欠勤（ADR-0011）。シートが無い古いブックは欠勤なし
  const absences: Absence[] = [];
  const absWs = wb.getWorksheet(FIXED_SHEETS.absences);
  if (absWs) {
    const sheet = new Sheet(FIXED_SHEETS.absences, absWs, errors);
    const bc = absenceCols(terms);
    if (sheet.require(Object.values(bc))) {
      const ids = new Map<string, number>();
      const seen = new Map<string, number>();
      const half = (r: Row, h: string): string | null | undefined => {
        if (r.text(h) === '') return null;
        const t = r.time(h, false);
        if (t === null) return undefined;
        if (!/:[03]0$/.test(t)) {
          r.err(h, '時間は30分単位で書いてください');
          return undefined;
        }
        return t;
      };
      for (const r of sheet.rows()) {
        const id = idOf(r, bc.id, ids, 'a', used, 100);
        const sid = staffId(r, bc.staff, true);
        const date = r.date(bc.date);
        const from = half(r, bc.from);
        const to = half(r, bc.to);
        const note = r.optional(bc.note, 100);
        if (typeof from === 'string' && typeof to === 'string' && from >= to) {
          r.err(bc.to, '終了は開始より後にしてください');
          continue;
        }
        if (!sid || !date || from === undefined || to === undefined) continue;
        const key = `${sid}\u0000${date}`;
        const before = seen.get(key);
        if (before !== undefined) {
          r.err(bc.date, `同じ${terms.staff}・同じ日の行が ${before}行目にもあります（欠勤は1人1日1行にしてください）`);
          continue;
        }
        seen.set(key, r.n);
        absences.push({ id, staffId: sid, date, from, to, note });
      }
    }
  }

  // 種類（ADR-0012）。シートが無い古いブックは種類なし（訪問の種類も空）
  const visitTypes: VisitType[] = [];
  const typeByName = new Map<string, string>();
  const typeWs = wb.getWorksheet(FIXED_SHEETS.visitTypes);
  if (typeWs) {
    const sheet = new Sheet(FIXED_SHEETS.visitTypes, typeWs, errors);
    const C = TYPE_COLS;
    if (sheet.require(Object.values(C))) {
      const cols = personCols(sheet, items, 'client', Object.values(C), ['reqs']);
      const rows = sheet.rows();
      if (rows.length > MAX_VISIT_TYPES)
        errors.add(sheetMsg(FIXED_SHEETS.visitTypes, `種類は${MAX_VISIT_TYPES}行までです（いま${rows.length}行）`));
      const ids = new Map<string, number>();
      const seen = new Map<string, number>();
      for (const r of rows) {
        const id = idOf(r, C.id, ids, 't', used, 100);
        const name = r.required(C.name, 20);
        if (name !== null) {
          uniqueName(r, C.name, name, seen);
          typeByName.set(name, id);
        }
        const color = r.num(C.color, { int: true, min: 1, max: 8, required: true });
        const duration = r.num(C.duration, { int: true, min: 5, max: 720, required: true });
        const note = r.optional(C.note, 200);
        const { requirements } = readPerson(r, cols);
        if (name !== null && typeof color === 'number' && typeof duration === 'number')
          visitTypes.push({ id, name, color: color - 1, durationMinutes: duration, requirements, note });
      }
    }
  }
  const hasTypes = typeWs !== undefined;
  /** 種類の名前 → ID（空＝null。いない名前はエラーにして undefined） */
  const typeId = (r: Row, h: string): string | null | undefined => {
    const t = r.text(h);
    if (t === '') return null;
    const id = typeByName.get(t);
    if (id === undefined) {
      r.err(
        h,
        hasTypes
          ? `「${t}」という種類は、シート『${FIXED_SHEETS.visitTypes}』にありません`
          : `「${t}」という種類はありません（シート『${FIXED_SHEETS.visitTypes}』がありません）`,
      );
      return undefined;
    }
    return id;
  };

  // 定期パターン（ADR-0012）。シートが無い古いブックはパターンなし（訪問のパターンも空）
  const patterns: Pattern[] = [];
  const patternWs = wb.getWorksheet(FIXED_SHEETS.patterns);
  /** 読めたパターンの ID（訪問の参照を確かめる） */
  const patternIds = new Set<string>();
  if (patternWs) {
    const sheet = new Sheet(FIXED_SHEETS.patterns, patternWs, errors);
    const pc = patternCols(terms);
    if (sheet.require(Object.values(pc))) {
      const rows = sheet.rows();
      if (rows.length > MAX_PATTERNS)
        errors.add(sheetMsg(FIXED_SHEETS.patterns, `定期パターンは${MAX_PATTERNS}行までです（いま${rows.length}行）`));
      const ids = new Map<string, number>();
      for (const r of rows) {
        const id = idOf(r, pc.id, ids, 'pt', used, 100);
        patternIds.add(id);
        const cid = clientId(r, pc.client);
        const tid = typeId(r, pc.type);
        const wText = r.text(pc.weekdays);
        const parsedDays = parseWorkDays(wText);
        const weekdays = parsedDays === null ? null : [...parsedDays].sort((a, b) => a - b);
        if (wText === '' || weekdays === null || weekdays.length === 0) {
          r.err(pc.weekdays, '曜日は「月木」のように1つ以上書いてください');
        }
        const eText = r.required(pc.every);
        // 間隔「毎月」（ADR-0013）は第N週の列で第何週かを読む（列が無い古いブックは毎週系だけ）
        const monthly = eText !== null && nfkc(eText).replace(/\s/g, '') === MONTHLY_LABEL;
        const everyWeeks = eText === null ? null : monthly ? 1 : parseEveryWeeks(eText);
        if (eText !== null && everyWeeks === null)
          r.err(
            pc.every,
            `「${[...Object.values(EVERY_WEEKS_LABELS), MONTHLY_LABEL].join('」「')}」のどれかで書いてください`,
          );
        const mText = r.text(PATTERN_EXTRA_COLS.monthWeeks);
        let monthWeeks: number[] | null = [];
        if (monthly) {
          monthWeeks = mText === '' ? null : parseMonthWeeks(mText);
          if (monthWeeks === null)
            r.err(
              PATTERN_EXTRA_COLS.monthWeeks,
              '間隔が「毎月」のときは、第何週かを「3、4」のように 1〜5 で書いてください',
            );
        }
        const kText = r.required(pc.windowKind);
        const windowKind = kText === null ? null : lookup(WINDOW_LABELS, kText);
        if (kText !== null && windowKind === null) r.err(pc.windowKind, '「ちょうど」か「幅」で書いてください');
        const earliestStart = r.time(pc.earliest);
        const latestRaw = r.time(pc.latest, windowKind !== 'fixed');
        const latestStart = latestRaw ?? (windowKind === 'fixed' ? earliestStart : null);
        let timesOk = true;
        if (earliestStart && latestStart && latestStart < earliestStart) {
          r.err(pc.latest, '開始（遅）は開始（早）以降にしてください');
          timesOk = false;
        }
        const duration = r.num(pc.duration, { int: true, min: 5, max: 720, required: true });
        const from = r.date(pc.from);
        const to = r.text(pc.to) === '' ? null : r.date(pc.to);
        let datesOk = true;
        if (from && to && to < from) {
          r.err(pc.to, '終了日は開始日以降にしてください');
          datesOk = false;
        }
        const sid = staffId(r, pc.usualStaff, false);
        const note = r.optional(pc.note, 200);
        // 曜日ごとの時刻（ADR-0013）：列が無い・空なら上書きなし。ちょうどの時刻は開始（遅）＝開始（早）
        const dtText = r.text(PATTERN_EXTRA_COLS.dayTimes);
        const dtParsed = dtText === '' ? [] : parseDayTimes(dtText);
        let dayTimes: Pattern['dayTimes'] | null = null;
        if (typeof dtParsed === 'string') r.err(PATTERN_EXTRA_COLS.dayTimes, dtParsed);
        else if (weekdays && dtParsed.some((t) => !weekdays.includes(t.weekday)))
          r.err(PATTERN_EXTRA_COLS.dayTimes, '「曜日」の列に無い曜日の時刻があります');
        else dayTimes = dtParsed.map((t) => (windowKind === 'fixed' ? { ...t, latestStart: t.earliestStart } : t));
        if (
          cid &&
          tid !== undefined &&
          weekdays &&
          weekdays.length > 0 &&
          everyWeeks &&
          windowKind &&
          earliestStart &&
          latestStart &&
          timesOk &&
          typeof duration === 'number' &&
          from &&
          (r.text(pc.to) === '' || to) &&
          datesOk &&
          sid !== undefined &&
          monthWeeks !== null &&
          dayTimes !== null
        ) {
          patterns.push({
            id,
            clientId: cid,
            typeId: tid,
            weekdays,
            everyWeeks,
            repeat: monthly ? 'monthly' : 'weekly',
            monthWeeks,
            dayTimes,
            windowKind,
            earliestStart,
            latestStart,
            durationMinutes: duration,
            from,
            to,
            usualStaffId: sid,
            note,
          });
        }
      }
    }
  }
  const hasPatterns = patternWs !== undefined;
  // 種類・定期パターンのシートがあるブックは、訪問の対応する列も要る（列を消すと種類・パターンが黙って消えるため）
  if (hasTypes) visitSheet.require([VISIT_TYPE_COL]);
  if (hasPatterns) visitSheet.require(Object.values(VISIT_PATTERN_COLS));
  if (errors.any) return errors.toError();

  /** 訪問の定期パターン・元の日・この回だけ変更（パターンが空なら単発。読めなければエラーにして undefined） */
  function visitPattern(r: Row, c: ReturnType<typeof visitCols>): Visit['pattern'] | undefined {
    const pid = r.text(c.pattern);
    if (pid === '') {
      if (r.text(c.patternDate) !== '' || r.yes(c.edited)) {
        r.err(c.pattern, `単発の訪問（${c.pattern}が空）では、${c.patternDate}・${c.edited}は空にしてください`);
        return undefined;
      }
      return null;
    }
    const date = r.date(c.patternDate);
    const edited = r.yes(c.edited);
    if (!patternIds.has(pid)) {
      r.err(c.pattern, `ID「${pid}」の定期パターンは、シート『${FIXED_SHEETS.patterns}』にありません`);
      return undefined;
    }
    return date ? { id: pid, date, edited } : undefined;
  }

  // 訪問
  const visits: Visit[] = [];
  {
    const ids = new Map<string, number>();
    for (const r of visitSheet.rows()) {
      const id = idOf(r, vc.id, ids, 'v', used, 100);
      const date = r.date(vc.date);
      const cid = clientId(r, vc.client);
      const kText = r.required(vc.windowKind);
      const windowKind = kText === null ? null : lookup(WINDOW_LABELS, kText);
      if (kText !== null && windowKind === null) r.err(vc.windowKind, '「ちょうど」か「幅」で書いてください');
      const earliestStart = r.time(vc.earliest);
      const latestRaw = r.time(vc.latest, windowKind !== 'fixed');
      const latestStart = latestRaw ?? (windowKind === 'fixed' ? earliestStart : null);
      if (earliestStart && latestStart && latestStart < earliestStart)
        r.err(vc.latest, '開始（遅）は開始（早）と同じか後にしてください');
      const duration = r.num(vc.duration, { int: true, min: 5, max: 720, required: true });
      const sid = staffId(r, vc.staff, false);
      const cancelled = r.yes(vc.cancelled);
      // 当日キャンセル（ADR-0015）：列が無い古いブックはふつうの取り消し。取り消していない訪問に ○ は止める
      const sameDay = r.yes(VISIT_SAME_DAY_COL);
      if (sameDay && !cancelled) r.err(VISIT_SAME_DAY_COL, `「${vc.cancelled}」に ○ の無い訪問には付けられません`);
      const note = r.optional(vc.note, 200);
      // 種類・定期パターン（ADR-0012）。シートが無い古いブックは空
      const tid = hasTypes ? typeId(r, vc.type) : null;
      const pattern = hasPatterns ? visitPattern(r, vc) : null;
      // パターンの訪問の ID は「元の日_パターンID」（ADR-0012。違うと展開で同じ回が二重になる。空の ID も止める）
      if (pattern && r.text(vc.id) !== `${pattern.date}_${pattern.id}`)
        r.err(vc.id, `定期パターンの訪問の ID は「${pattern.date}_${pattern.id}」（元の日_パターンID）にしてください`);
      if (
        date &&
        cid &&
        windowKind &&
        earliestStart &&
        latestStart &&
        typeof duration === 'number' &&
        sid !== undefined &&
        tid !== undefined &&
        pattern !== undefined
      ) {
        visits.push({
          id,
          date,
          clientId: cid,
          windowKind,
          earliestStart,
          latestStart,
          durationMinutes: duration,
          staffId: sid,
          cancelled,
          note,
          typeId: tid,
          pattern,
          cancelKind: cancelled && sameDay ? 'sameDay' : null,
        });
      }
    }
  }

  // 〈利用者さん〉の休み（ADR-0013）。シートが無い古いブックは休みなし
  const clientLeaves: ClientLeave[] = [];
  const leaveWs = wb.getWorksheet(FIXED_SHEETS.clientLeaves);
  if (leaveWs) {
    const sheet = new Sheet(FIXED_SHEETS.clientLeaves, leaveWs, errors);
    const lc = clientLeaveCols(terms);
    if (sheet.require(Object.values(lc))) {
      const rows = sheet.rows();
      if (rows.length > MAX_LEAVES)
        errors.add(sheetMsg(FIXED_SHEETS.clientLeaves, `休みは${MAX_LEAVES}行までです（いま${rows.length}行）`));
      const ids = new Map<string, number>();
      for (const r of rows) {
        const id = idOf(r, lc.id, ids, 'l', used, 100);
        const cid = clientId(r, lc.client);
        const from = r.date(lc.from);
        const to = r.date(lc.to);
        const note = r.optional(lc.note, 100);
        if (from && to && to < from) {
          r.err(lc.to, '終了日は開始日以降にしてください');
          continue;
        }
        if (cid && from && to) clientLeaves.push({ id, clientId: cid, from, to, note });
      }
    }
  }

  if (
    errors.any ||
    industry === null ||
    typeof fare !== 'number' ||
    typeof seed !== 'number' ||
    spanLimit === undefined
  )
    return errors.toError();

  const org: Org = {
    name: orgName,
    industry,
    terms,
    fareYenPerKm: fare,
    spanLimitHours: spanLimit ?? SPAN_LIMIT_DEFAULT_HOURS,
  };
  const next: DemoData = {
    version: base.version,
    baseDate: base.baseDate,
    seed,
    org,
    items,
    rules,
    staff,
    clients,
    compat: Object.fromEntries(compat),
    visits,
    availability,
    absences,
    visitTypes,
    patterns,
    clientLeaves,
    manualPlans: {},
    aiPlans: {},
    aiRuns: {},
    presets,
    scorePresetId,
  };
  const r = migrate(next);
  return isImportError(r) ? { ...r, message: `読み込んだ内容に問題があります：${r.message}` } : r;
}
