// Excel のブック → DemoData（名前の参照を ID に直す）。データは書き換えない（ADR-0006）
// 最後は store の migrate（形の検査と repair）を通した結果を返す。画面が store の replace で入れる
import ExcelJS from 'exceljs';
import type { DemoData, ImportError } from '../contracts/data';
import type { Availability, Client, Org, Staff, Visit } from '../contracts/documents';
import type { Compat, Condition, Item, ItemTarget, Rule, Traits } from '../contracts/rules';
import { slotsError } from '../domain/availability';
import { newId } from '../lib/common';
import { isImportError, migrate } from '../store';
import {
  availabilityCols,
  CLIENT_COLS,
  ITEM_COLS,
  ORG_HEADERS,
  ORG_KEYS,
  PREF_PREFIX,
  REQ_PREFIX,
  RULE_COLS,
  STAFF_COLS,
  TRAIT_PREFIX,
  visitCols,
} from './layout';
import {
  dateToTime,
  dateToYmd,
  FIXED_SHEETS,
  INDUSTRY_LABELS,
  isTimeOnlyDate,
  itemKindLabels,
  lookup,
  nfkc,
  parseConds,
  parseDateText,
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
/** 1人の必要条件・希望の上限（contracts/documents.ts の max） */
const MAX_CONDS = 20;

type Prim = string | number | boolean | Date | null;

/** ExcelJS のセルの値を、ふつうの値にする（リッチテキスト・数式の結果・リンクも読む） */
function prim(v: ExcelJS.CellValue | undefined): Prim {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return prim(v.richText.map((r) => r.text).join(''));
    if ('result' in v) return prim(v.result as ExcelJS.CellValue);
    if ('text' in v && typeof v.text === 'string') return prim(v.text);
  }
  return null;
}

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
    const c = this.sheet.cols.get(h);
    return c === undefined ? null : prim(this.sheet.ws.getRow(this.n).getCell(c).value);
  }
  text(h: string): string {
    return textOf(this.raw(h));
  }
  err(h: string, msg: string): null {
    this.sheet.errors.add(`シート『${this.sheet.name}』の ${this.n}行目・『${h}』：${msg}`);
    return null;
  }
  required(h: string): string | null {
    const t = this.text(h);
    return t === '' ? this.err(h, '空にはできません') : t;
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
  readonly cols = new Map<string, number>();
  /** 見出しの並び（列番号の順） */
  readonly headers: { name: string; col: number }[] = [];
  constructor(
    readonly name: string,
    readonly ws: ExcelJS.Worksheet,
    readonly errors: Errors,
  ) {
    const head = ws.getRow(1);
    for (let c = 1; c <= ws.columnCount; c++) {
      const h = textOf(prim(head.getCell(c).value));
      if (h === '') continue;
      if (this.cols.has(h)) {
        errors.add(sheetMsg(name, `見出し『${h}』の列が2つあります`));
        continue;
      }
      this.cols.set(h, c);
      this.headers.push({ name: h, col: c });
    }
  }
  /** 必須の列があるか（無ければエラー） */
  require(hs: readonly string[]): boolean {
    let ok = true;
    for (const h of hs) {
      if (!this.cols.has(h)) {
        this.errors.add(sheetMsg(this.name, `『${h}』の列がありません（1行目の見出しを確かめてください）`));
        ok = false;
      }
    }
    return ok;
  }
  /** 2行目からの、空でない行 */
  rows(): Row[] {
    const out: Row[] = [];
    for (let n = 2; n <= this.ws.rowCount; n++) {
      const row = this.ws.getRow(n);
      if (this.headers.some((h) => prim(row.getCell(h.col).value) !== null)) out.push(new Row(this, n));
    }
    return out;
  }
}

/** ID の列：空なら新しい ID、同じ ID が2行あればエラー */
function idOf(row: Row, h: string, seen: Map<string, number>, prefix: string, used: Set<string>): string {
  const t = row.text(h);
  if (t !== '') {
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
  const before = seen.get(name);
  if (before !== undefined)
    row.err(h, `「${name}」が ${before}行目と重なっています（名前は重ならないようにしてください）`);
  else seen.set(name, row.n);
}

/** 特性・必要条件・希望の列を項目に結びつける */
interface PersonCols {
  traits: { h: string; item: Item }[];
  reqs: { h: string; item: Item }[];
  prefs: { h: string; item: Item }[];
}
function personCols(sheet: Sheet, items: Item[], own: ItemTarget, fixed: Set<string>): PersonCols {
  const out: PersonCols = { traits: [], reqs: [], prefs: [] };
  const other: ItemTarget = own === 'staff' ? 'client' : 'staff';
  for (const { name } of sheet.headers) {
    if (fixed.has(name)) continue;
    const kind = name.startsWith(TRAIT_PREFIX)
      ? 'traits'
      : name.startsWith(REQ_PREFIX)
        ? 'reqs'
        : name.startsWith(PREF_PREFIX)
          ? 'prefs'
          : null;
    if (!kind) continue; // 知らない列は読まない（メモ書きの列など）
    const prefix = kind === 'traits' ? TRAIT_PREFIX : kind === 'reqs' ? REQ_PREFIX : PREF_PREFIX;
    const itemName = name.slice(prefix.length).trim();
    const target = kind === 'traits' ? own : other;
    const item = items.find((i) => i.target === target && i.name === itemName);
    if (!item) {
      sheet.errors.add(
        sheetMsg(sheet.name, `見出し『${name}』の項目「${itemName}」が、シート『${FIXED_SHEETS.items}』にありません`),
      );
      continue;
    }
    out[kind].push({ h: name, item });
  }
  return out;
}

function readPerson(
  row: Row,
  cols: PersonCols,
): { traits: Traits; requirements: Condition[]; preferences: Condition[] } {
  const traits: Traits = {};
  for (const { h, item } of cols.traits) {
    const v = row.raw(h);
    const cell = v === null ? '' : typeof v === 'number' || typeof v === 'boolean' ? v : textOf(v);
    const r = parseTrait(item, cell);
    if (!r.ok) row.err(h, r.error);
    else if (r.value !== undefined) traits[item.id] = r.value;
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
  return { traits, requirements: conds(cols.reqs, '必要条件'), preferences: conds(cols.prefs, '希望') };
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
  if (errors.any || staffTerm === null || clientTerm === null) return errors.toError();
  const terms = { staff: staffTerm, client: clientTerm };
  const orgName = nameRow?.required(V) ?? '';
  const industryText = industryRow?.required(V) ?? null;
  const industry = industryText === null ? null : lookup(INDUSTRY_LABELS, industryText);
  if (industryText !== null && industry === null)
    industryRow?.err(V, `「${Object.values(INDUSTRY_LABELS).join('」「')}」のどれかで書いてください`);
  const fare = fareRow?.num(V, { min: 0, max: 1000, required: true });
  const seed = seedRow?.num(V, { int: true, required: true });

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
    visitSheet?.require(Object.values(vc)),
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
  ]);

  // 項目
  const items: Item[] = [];
  {
    const ids = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const r of itemSheet.rows()) {
      const id = idOf(r, ITEM_COLS.id, ids, 'i', used);
      const name = r.required(ITEM_COLS.name);
      if (name !== null) uniqueName(r, ITEM_COLS.name, name, seen);
      const tText = r.required(ITEM_COLS.target);
      const target = tText === null ? null : lookup({ staff: terms.staff, client: terms.client }, tText);
      if (tText !== null && target === null)
        r.err(ITEM_COLS.target, `「${terms.staff}」か「${terms.client}」で書いてください`);
      const kText = r.required(ITEM_COLS.kind);
      const kind = kText === null ? null : lookup(itemKindLabels, kText);
      if (kText !== null && kind === null)
        r.err(ITEM_COLS.kind, `「${Object.values(itemKindLabels).join('」「')}」のどれかで書いてください`);
      const options = kind === 'choice' || kind === 'multi' ? splitList(r.text(ITEM_COLS.options)) : [];
      if (new Set(options).size !== options.length) r.err(ITEM_COLS.options, '同じ選択肢が2つあります');
      if (name !== null && target && kind) items.push({ id, name, target, kind, options });
    }
  }

  // 条件
  const rules: Rule[] = [];
  {
    const labels = ruleTypeLabels(terms);
    const ids = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const r of ruleSheet.rows()) {
      const id = idOf(r, RULE_COLS.id, ids, 'r', used);
      const label = r.required(RULE_COLS.label);
      if (label !== null) uniqueName(r, RULE_COLS.label, label, seen);
      if (label !== null && label.length > 40) r.err(RULE_COLS.label, '名前は40文字までです');
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

  // スタッフ
  const staff: Staff[] = [];
  const staffByName = new Map<string, string>();
  {
    const cols = personCols(staffSheet, items, 'staff', new Set(Object.values(STAFF_COLS)));
    const ids = new Map<string, number>();
    const seen = new Map<string, number>();
    const C = STAFF_COLS;
    for (const r of staffSheet.rows()) {
      const id = idOf(r, C.id, ids, 's', used);
      const name = r.required(C.name);
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
      const address = r.text(C.address);
      const lat = r.num(C.lat, { min: -90, max: 90 });
      const lng = r.num(C.lng, { min: -180, max: 180 });
      const p = readPerson(r, cols);
      if (name !== null && travelMode && workDays && shiftStart && shiftEnd && lat !== undefined && lng !== undefined) {
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
    const cols = personCols(clientSheet, items, 'client', new Set(Object.values(CLIENT_COLS)));
    const ids = new Map<string, number>();
    const seen = new Map<string, number>();
    const C = CLIENT_COLS;
    for (const r of clientSheet.rows()) {
      const id = idOf(r, C.id, ids, 'c', used);
      const displayName = r.required(C.name);
      if (displayName !== null) {
        uniqueName(r, C.name, displayName, seen);
        clientByName.set(displayName, id);
      }
      const color = r.num(C.color, { int: true, min: 1, max: 8, required: true });
      const active = r.yes(C.active);
      const address = r.text(C.address);
      const lat = r.num(C.lat, { min: -90, max: 90 });
      const lng = r.num(C.lng, { min: -180, max: 180 });
      const usualStaffId = staffId(r, C.usualStaff, false);
      const note = r.text(C.note);
      const p = readPerson(r, cols);
      if (
        displayName !== null &&
        typeof color === 'number' &&
        lat !== undefined &&
        lng !== undefined &&
        usualStaffId !== undefined
      ) {
        clients.push({
          id,
          displayName,
          place: { address, lat, lng },
          note,
          color: color - 1,
          active,
          ...p,
          usualStaffId,
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
  const compat: Compat = {};
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
    for (let n = 2; n <= compatSheet.ws.rowCount; n++) {
      const wsRow = compatSheet.ws.getRow(n);
      const name = textOf(prim(wsRow.getCell(1).value));
      const cells = staffCols.map((s) => ({ s, v: textOf(prim(wsRow.getCell(s.col).value)) }));
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
      const out: Record<string, 2 | 1 | -1 | -2> = {};
      for (const { s, v } of cells) {
        if (v === '') continue;
        const level = COMPAT_SYMBOLS[v] ?? COMPAT_SYMBOLS[nfkc(v)];
        if (level === undefined) row.err(s.name, '◎・○・△・× か空で書いてください');
        else out[s.id] = level;
      }
      if (Object.keys(out).length > 0) compat[cid] = out;
    }
  }

  // 稼働時間
  const availability: Availability[] = [];
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
      else if (sid && date) availability.push({ staffId: sid, date, slots });
    }
  }

  // 訪問
  const visits: Visit[] = [];
  {
    const ids = new Map<string, number>();
    for (const r of visitSheet.rows()) {
      const id = idOf(r, vc.id, ids, 'v', used);
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
      const note = r.text(vc.note);
      if (
        date &&
        cid &&
        windowKind &&
        earliestStart &&
        latestStart &&
        typeof duration === 'number' &&
        sid !== undefined
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
        });
      }
    }
  }

  if (errors.any || industry === null || typeof fare !== 'number' || typeof seed !== 'number') return errors.toError();

  const org: Org = { name: orgName, industry, terms, fareYenPerKm: fare };
  const next: DemoData = {
    version: base.version,
    baseDate: base.baseDate,
    seed,
    org,
    items,
    rules,
    staff,
    clients,
    compat,
    visits,
    availability,
    manualPlans: {},
    aiPlans: {},
    aiRuns: {},
  };
  const r = migrate(next);
  return isImportError(r) ? { ...r, message: `読み込んだ内容に問題があります：${r.message}` } : r;
}
