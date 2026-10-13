// DemoData → Excel のブック（テンプレート）。データは書き換えない（ADR-0006）
import ExcelJS from 'exceljs';
import type { DemoData } from '../contracts/data';
import {
  COMPAT_LABELS,
  type CompatLevel,
  type Condition,
  HARDABLE,
  ITEM_KINDS,
  type Item,
  RULE_TYPES,
  type Traits,
} from '../contracts/rules';
import { nameKey, optionNameError } from '../lib/common';
import { scorePresetOf } from '../seed/presets';
import {
  availabilityCols,
  CLIENT_COLS,
  ITEM_COLS,
  ORG_HEADERS,
  ORG_KEYS,
  PRESET_COLS,
  prefHeader,
  presetWeightHeader,
  RULE_COLS,
  reqHeader,
  STAFF_COLS,
  traitHeader,
  visitCols,
} from './layout';
import {
  ALL_PREFIX,
  condsToCell,
  DAY_OFF,
  EMPTY_MULTI,
  FIXED_SHEETS,
  FLAG_COND_TEXTS,
  hhmmToCell,
  INDUSTRY_LABELS,
  itemKindLabels,
  personSheetNames,
  ruleTypeLabels,
  slotsCellText,
  traitToCell,
  travelModeLabels,
  WINDOW_LABELS,
  workDaysText,
  YES,
} from './text';

/** 相性（自分のキーだけを引く。ID が constructor などでも組み込みの値を拾わない） */
function compatOf(data: DemoData, cid: string, sid: string): CompatLevel {
  const row = Object.hasOwn(data.compat, cid) ? data.compat[cid] : undefined;
  return (row && Object.hasOwn(row, sid) ? row[sid] : 0) ?? 0;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 見出しの背景（淡いオレンジ） */
const HEADER_FILL = 'FFFDE3CF';
/** プルダウンを付ける行数の下限（書き足す行のぶん） */
const MIN_ROWS = 500;

type RangeValidations = { dataValidations: { add(range: string, v: ExcelJS.DataValidation): void } };

type CellIn = string | number | null;

type ListRule =
  | { col: number; values: readonly string[]; strict?: boolean }
  | { col: number; ref: string; strict?: boolean };

interface TableSpec {
  name: string;
  headers: string[];
  rows: CellIn[][];
  /** 文字列「@」の書式にする列（1始まり。日付・時刻・ID など、Excel に勝手に変換させない） */
  textCols?: number[];
  lists?: ListRule[];
  /** 左から固定する列の数 */
  freezeCols?: number;
}

/** 表示の幅（全角＝2） */
function displayWidth(v: CellIn): number {
  if (v === null) return 0;
  let w = 0;
  for (const line of String(v).split('\n')) {
    let lw = 0;
    for (const ch of line) lw += ch.charCodeAt(0) > 0xff ? 2 : 1;
    w = Math.max(w, lw);
  }
  return w;
}

/** Excel の入力規則のリスト（値の文字列は 255 文字まで。超える・「,」「"」を含むなら付けない） */
function listFormula(values: readonly string[]): string | null {
  if (values.length === 0 || values.some((v) => v.includes(',') || v.includes('"'))) return null;
  const s = `"${values.join(',')}"`;
  return s.length > 257 ? null : s;
}

/** シートの名前を数式で参照する形（'スタッフ'!$B$2:$B$500） */
export const sheetRef = (sheet: string, colLetter: string, rows: number) =>
  `'${sheet.replace(/'/g, "''")}'!$${colLetter}$2:$${colLetter}$${rows}`;

function addTable(wb: ExcelJS.Workbook, spec: TableSpec): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(spec.name, {
    views: [{ state: 'frozen', xSplit: spec.freezeCols ?? 0, ySplit: 1 }],
  });
  const text = new Set(spec.textCols ?? []);
  spec.headers.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    const w = Math.max(displayWidth(h), ...spec.rows.map((r) => displayWidth(r[i] ?? null)));
    col.width = Math.min(50, Math.max(8, w + 2));
    if (text.has(i + 1)) col.numFmt = '@';
  });
  ws.addRow(spec.headers);
  for (const r of spec.rows) {
    const row = ws.addRow(r.map((v) => (v === null ? null : v)));
    r.forEach((v, i) => {
      if (typeof v === 'string' && v.includes('\n')) row.getCell(i + 1).alignment = { wrapText: true, vertical: 'top' };
      if (text.has(i + 1)) row.getCell(i + 1).numFmt = '@';
    });
  }
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    c.font = { bold: true };
    c.alignment = { vertical: 'middle' };
    c.numFmt = '@';
  });
  const last = Math.max(MIN_ROWS, spec.rows.length + 200);
  for (const l of spec.lists ?? []) {
    const formula = 'values' in l ? listFormula(l.values) : l.ref;
    if (!formula) continue;
    const letter = ws.getColumn(l.col).letter;
    // 型定義には無いが、ExcelJS 4 の Worksheet は範囲（A2:A500）でまとめて付ける dataValidations を持つ
    (ws as unknown as RangeValidations).dataValidations.add(`${letter}2:${letter}${last}`, {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      errorStyle: l.strict === false ? 'warning' : 'stop',
      errorTitle: '入力の確認',
      error: '一覧の中から選んでください',
    });
  }
  return ws;
}

const yes = (b: boolean) => (b ? YES : '');
const nullable = (n: number | null) => (n === null ? null : n);

/** 項目の列（特性 or 条件）のプルダウン */
function traitList(it: Item, col: number): ListRule | null {
  if (it.kind === 'flag') return { col, values: ['あり', 'なし'] };
  if (it.kind === 'choice') return { col, values: it.options };
  return null;
}
function condList(it: Item, col: number): ListRule | null {
  if (it.kind === 'flag') return { col, values: FLAG_COND_TEXTS };
  return null;
}

/** 使い方のシート（読み込みでは見ない） */
function howtoLines(data: DemoData, names: { staff: string; client: string }): string[] {
  const t = data.org.terms;
  return [
    '訪問ルートAI デモ版：データの一覧（Excel）',
    '',
    'このブックの使い方',
    '・このブックを直して「データ」の画面の「Excel を読み込む」で読み込むと、いまのデータがすべてこのブックの内容に置き換わります。',
    '・読み込むと、AI案・AI案の記録・手作業の割当は消えます（控えが要るときは、先に「控え（JSON）」を書き出してください）。',
    '・1行目は見出しです。見出しの名前は変えないでください。列の順番は入れ替えてもかまいません。',
    '・「ID」の列：空の行は新しく足します。いまある行の ID は変えないでください。行を消すと、その人・訪問などは消えます。',
    `・人や項目は名前で書きます（${t.staff}の名前・${t.client}の表示名、同じ対象の項目の名前は、それぞれ重ならないようにしてください）。`,
    '・○ は「はい」、空は「いいえ」です。日付は 2026-10-13、時刻は 9:00 の形で書きます。',
    '・プルダウンがある欄は、一覧から選んでください。',
    '',
    'シート',
    `・${FIXED_SHEETS.org}：事業所名・業種・呼び方など。「項目」と「値」の2列です。`,
    `・${FIXED_SHEETS.items}：${t.staff}・${t.client}の特性の項目。種類は「${ITEM_KINDS.map((k) => itemKindLabels[k]).join('」「')}」。選択肢は「、」か改行で区切ります（選択肢の名前に「、」と改行、「${EMPTY_MULTI}」は使えません）。`,
    `・${FIXED_SHEETS.rules}：AI案を作るときの条件（重み 0〜5、0.5刻み。必須は ○）。`,
    `・${FIXED_SHEETS.presets}：条件のプリセット（1〜6行）。「重み：〈条件の種類〉」の列に重み（0〜5、0.5刻み。空は0）、「必須」の列に必須にする条件の種類を「、」区切りで書きます。「点数の基準」の列は、画面の点数（100点満点）を付けるプリセットに ○ を1つだけ付けます（無印なら先頭のプリセット）。このシートが無いブックを読み込むと、いまのプリセットのままです。`,
    `・${names.staff}：${t.staff}の一覧。勤務する曜日は「月火水木金」のように書きます。`,
    `・${names.client}：${t.client}の一覧。色は 1〜8 の番号です。いつもの担当は${t.staff}の名前で書きます。`,
    `・${FIXED_SHEETS.compat}：行が${t.client}、列が${t.staff}です。◎・○・△・× か空で書きます（× は担当にしません）。`,
    `・${FIXED_SHEETS.availability}：その日だけの稼働時間。時間帯は「9:00-12:00、13:00-18:00」のように30分単位で書き、休みは「${DAY_OFF}」と書きます。`,
    `・${FIXED_SHEETS.visits}：訪問の予定。時間の決め方は「ちょうど」（開始（早）に始める）か「幅」（開始（早）〜開始（遅）のあいだに始める）。担当は${t.staff}の名前で、空なら未割当です。`,
    '',
    '特性の書き方（「特性：項目名」の列。空は未確認）',
    '・あり/なし：「あり」「なし」',
    '・選択肢から1つ：選択肢そのもの（例：女性）',
    `・選択肢から複数：「、」か改行で区切る（例：看護師、保育士）。「${EMPTY_MULTI}」と書くと、確認済みで1つもない`,
    '・数値：数（例：5）',
    '',
    '条件の書き方（「必要条件：項目名」「希望：項目名」の列。相手の特性に対する条件です。空は問わない）',
    '・あり/なし：「あり」「なし」「なし（未確認も可）」「あり（未確認も可）」',
    '・選択肢から1つ：「女性」（その1つ）、「高齢、子ども」（どれか）、「男性以外」',
    `・選択肢から複数：「看護師、保育士」（どれかを含む）、「${ALL_PREFIX}看護師、保育士」（すべて含む）`,
    '・数値：「3以上」「5以下」「3〜5」「3」（等しい）「3以外」',
    '・同じ項目に条件を2つ以上つけるときは、セルの中で改行して1行に1つずつ書きます。',
    '・選択肢の区切りは「、」だけです（「・」「,」は選択肢の名前の一部として読みます）。1人の必要条件・希望は、それぞれ20件までです。',
    '・セル全体が1つの選択肢の名前と同じなら、その選択肢として読みます（「…以外」で終わる名前の選択肢でも）。',
    '',
    '読み込めないとき',
    '・名前の重なり、いない人の名前、読めない日付・時刻・数、選択肢にない値があると、場所（シート・行・列）を示して止まります。いまのデータは変わりません。',
  ];
}

/** DemoData → Excel のブック（.xlsx の Blob） */
/**
 * 書き出せないデータ（読み込み直せないもの）を見つける。あれば場所付きの文、なければ null。
 * 選択肢の名前の「、」・改行・「（なし）」（区切り・空の印と区別できない）と、同じ2つの呼び方（項目の対象を区別できない）
 */
export function exportProblem(data: DemoData): string | null {
  const t = data.org.terms;
  if (t.staff.trim() === '' || t.client.trim() === '')
    return '呼び方が空なので書き出せません。データの画面の「呼び方」で入れてください';
  if (t.staff.trim() === t.client.trim())
    return `呼び方（訪問する人・訪問先）が同じ「${t.staff}」なので書き出せません。データの画面の「呼び方」で変えてください`;
  // 全角半角・空白だけが違う名前は、見出し（相性・特性の列）で区別できないので止める
  const groups: [string, string[]][] = [
    [t.staff, data.staff.map((s) => s.name)],
    [t.client, data.clients.map((c) => c.displayName)],
    [`${t.staff}の項目`, data.items.filter((i) => i.target === 'staff').map((i) => i.name)],
    [`${t.client}の項目`, data.items.filter((i) => i.target === 'client').map((i) => i.name)],
  ];
  for (const [what, names] of groups) {
    const seen = new Map<string, string>();
    for (const n of names) {
      const before = seen.get(nameKey(n));
      if (before !== undefined)
        return `${what}の「${before}」と「${n}」は、全角半角・空白だけが違うので Excel では区別できません。どちらかの名前を変えてから書き出してください`;
      seen.set(nameKey(n), n);
    }
  }
  for (const it of data.items) {
    for (const o of it.options) {
      const e = optionNameError(o);
      if (e) return `項目「${it.name}」の選択肢「${o}」：${e}。項目の画面で名前を変えてから書き出してください`;
    }
  }
  return null;
}

export async function exportWorkbook(data: DemoData): Promise<Blob> {
  const problem = exportProblem(data);
  if (problem) throw new Error(problem);
  const t = data.org.terms;
  const names = personSheetNames(t);
  const wb = new ExcelJS.Workbook();
  wb.creator = '訪問ルートAI デモ版';

  // 使い方
  const howto = wb.addWorksheet(FIXED_SHEETS.howto);
  howto.getColumn(1).width = 110;
  howtoLines(data, names).forEach((line, i) => {
    const row = howto.addRow([line]);
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    // 「・」で始まらない行は見出し（1行目は表題）
    if (line !== '' && !line.startsWith('・')) row.font = { bold: true, size: i === 0 ? 14 : 11 };
  });

  // 事業所
  addTable(wb, {
    name: FIXED_SHEETS.org,
    headers: [...ORG_HEADERS],
    rows: [
      [ORG_KEYS.name, data.org.name],
      [ORG_KEYS.industry, INDUSTRY_LABELS[data.org.industry]],
      [ORG_KEYS.staffTerm, t.staff],
      [ORG_KEYS.clientTerm, t.client],
      [ORG_KEYS.fare, data.org.fareYenPerKm],
      [ORG_KEYS.seed, data.seed],
    ],
    freezeCols: 1,
  });
  // 業種の値のセルだけにプルダウン
  const orgWs = wb.getWorksheet(FIXED_SHEETS.org);
  if (orgWs) {
    orgWs.getCell('B3').dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [listFormula(Object.values(INDUSTRY_LABELS)) ?? '""'],
      showErrorMessage: true,
      error: '一覧の中から選んでください',
    };
  }

  // 項目
  addTable(wb, {
    name: FIXED_SHEETS.items,
    headers: Object.values(ITEM_COLS),
    rows: data.items.map((it) => [
      it.id,
      it.target === 'staff' ? t.staff : t.client,
      it.name,
      itemKindLabels[it.kind],
      it.options.join('、'),
    ]),
    textCols: [1],
    lists: [
      { col: 2, values: [t.staff, t.client] },
      { col: 4, values: ITEM_KINDS.map((k) => itemKindLabels[k]) },
    ],
    freezeCols: 1,
  });

  // 条件
  const ruleLabels = ruleTypeLabels(t);
  addTable(wb, {
    name: FIXED_SHEETS.rules,
    headers: Object.values(RULE_COLS),
    rows: data.rules.map((r) => [r.id, r.label, ruleLabels[r.type], r.weight, yes(r.hard)]),
    textCols: [1],
    lists: [
      { col: 3, values: RULE_TYPES.map((k) => ruleLabels[k]) },
      { col: 4, values: Array.from({ length: 11 }, (_, i) => String(i / 2)) },
      { col: 5, values: [YES] },
    ],
    freezeCols: 2,
  });

  // プリセット（ADR-0008）。点数の基準（ADR-0010）に ○
  const rulerId = scorePresetOf(data.presets, data.scorePresetId)?.id;
  addTable(wb, {
    name: FIXED_SHEETS.presets,
    headers: [
      PRESET_COLS.id,
      PRESET_COLS.name,
      PRESET_COLS.note,
      ...RULE_TYPES.map((k) => presetWeightHeader(ruleLabels[k])),
      PRESET_COLS.hard,
      PRESET_COLS.scoreBase,
    ],
    rows: data.presets.map((p) => [
      p.id,
      p.name,
      p.note,
      ...RULE_TYPES.map((k) => p.weights[k].weight),
      RULE_TYPES.filter((k) => HARDABLE.has(k) && p.weights[k].hard)
        .map((k) => ruleLabels[k])
        .join('、'),
      yes(p.id === rulerId),
    ]),
    textCols: [1],
    lists: [
      ...RULE_TYPES.map((_, i) => ({ col: 4 + i, values: Array.from({ length: 11 }, (_, j) => String(j / 2)) })),
      { col: 4 + RULE_TYPES.length + 1, values: [YES] },
    ],
    freezeCols: 2,
  });

  const staffItems = data.items.filter((i) => i.target === 'staff');
  const clientItems = data.items.filter((i) => i.target === 'client');

  /** 特性・必要条件・希望の列（見出し・値・プルダウン） */
  const personCols = (base: number, own: Item[], other: Item[]) => {
    const headers = [...own.map(traitHeader), ...other.map(reqHeader), ...other.map(prefHeader)];
    const lists: ListRule[] = [];
    own.forEach((it, i) => {
      const l = traitList(it, base + i + 1);
      if (l) lists.push(l);
    });
    other.forEach((it, i) => {
      for (const col of [base + own.length + i + 1, base + own.length + other.length + i + 1]) {
        const l = condList(it, col);
        if (l) lists.push(l);
      }
    });
    const cells = (p: { traits: Traits; requirements: Condition[]; preferences: Condition[] }): CellIn[] => [
      ...own.map((it) => traitToCell(it, Object.hasOwn(p.traits, it.id) ? p.traits[it.id] : undefined)),
      ...other.map((it) =>
        condsToCell(
          it,
          p.requirements.filter((c) => c.itemId === it.id),
        ),
      ),
      ...other.map((it) =>
        condsToCell(
          it,
          p.preferences.filter((c) => c.itemId === it.id),
        ),
      ),
    ];
    return { headers, lists, cells };
  };

  // スタッフ
  const staffBase = Object.values(STAFF_COLS);
  const sp = personCols(staffBase.length, staffItems, clientItems);
  addTable(wb, {
    name: names.staff,
    headers: [...staffBase, ...sp.headers],
    rows: data.staff.map((s) => [
      s.id,
      s.name,
      travelModeLabels[s.travelMode],
      workDaysText(s.workDays),
      hhmmToCell(s.shiftStart),
      hhmmToCell(s.shiftEnd),
      yes(s.active),
      s.home.address,
      nullable(s.home.lat),
      nullable(s.home.lng),
      ...sp.cells(s),
    ]),
    textCols: [1, 4, 5, 6],
    lists: [{ col: 3, values: Object.values(travelModeLabels) }, { col: 7, values: [YES] }, ...sp.lists],
    freezeCols: 2,
  });

  const staffRows = Math.max(MIN_ROWS, data.staff.length + 200);
  const staffNameRef = sheetRef(names.staff, 'B', staffRows);
  const clientRows = Math.max(MIN_ROWS, data.clients.length + 200);
  const clientNameRef = sheetRef(names.client, 'B', clientRows);
  const staffName = new Map(data.staff.map((s) => [s.id, s.name]));
  const clientName = new Map(data.clients.map((c) => [c.id, c.displayName]));

  // 利用者さん
  const clientBase = Object.values(CLIENT_COLS);
  const cp = personCols(clientBase.length, clientItems, staffItems);
  addTable(wb, {
    name: names.client,
    headers: [...clientBase, ...cp.headers],
    rows: data.clients.map((c) => [
      c.id,
      c.displayName,
      c.color + 1,
      yes(c.active),
      c.place.address,
      nullable(c.place.lat),
      nullable(c.place.lng),
      c.usualStaffId === null ? '' : (staffName.get(c.usualStaffId) ?? ''),
      c.note,
      ...cp.cells(c),
    ]),
    textCols: [1],
    lists: [
      { col: 3, values: ['1', '2', '3', '4', '5', '6', '7', '8'] },
      { col: 4, values: [YES] },
      { col: 8, ref: staffNameRef, strict: false },
      ...cp.lists,
    ],
    freezeCols: 2,
  });

  // 相性
  addTable(wb, {
    name: FIXED_SHEETS.compat,
    headers: [`${t.client}＼${t.staff}`, ...data.staff.map((s) => s.name)],
    rows: data.clients.map((c) => [
      c.displayName,
      ...data.staff.map((s) => COMPAT_LABELS[compatOf(data, c.id, s.id)] ?? ''),
    ]),
    lists: data.staff.map((_, i) => ({ col: i + 2, values: ['◎', '○', '△', '×'] })),
    freezeCols: 1,
  });

  // 稼働時間
  const ac = availabilityCols(t);
  addTable(wb, {
    name: FIXED_SHEETS.availability,
    headers: Object.values(ac),
    rows: data.availability.map((a) => [staffName.get(a.staffId) ?? '', a.date, slotsCellText(a.slots)]),
    textCols: [2, 3],
    lists: [{ col: 1, ref: staffNameRef, strict: false }],
    freezeCols: 1,
  });

  // 訪問
  const vc = visitCols(t);
  addTable(wb, {
    name: FIXED_SHEETS.visits,
    headers: Object.values(vc),
    rows: data.visits.map((v) => [
      v.id,
      v.date,
      clientName.get(v.clientId) ?? '',
      WINDOW_LABELS[v.windowKind],
      hhmmToCell(v.earliestStart),
      hhmmToCell(v.latestStart),
      v.durationMinutes,
      v.staffId === null ? '' : (staffName.get(v.staffId) ?? ''),
      yes(v.cancelled),
      v.note,
    ]),
    textCols: [1, 2, 5, 6],
    lists: [
      { col: 3, ref: clientNameRef, strict: false },
      { col: 4, values: Object.values(WINDOW_LABELS) },
      { col: 8, ref: staffNameRef, strict: false },
      { col: 9, values: [YES] },
    ],
    freezeCols: 3,
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf as ArrayBuffer], { type: XLSX_MIME });
}
