import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { DemoData, ImportError, RosterImportResult, RosterKind, RosterMode } from '../contracts/data';
import type { Condition, Item } from '../contracts/rules';
import { visitsOn } from '../patterns';
import { createDemoData } from '../seed';
import { withSeedPlans } from '../seed/plans';
import { isImportError, migrate } from '../store';
import { MAX_FILE_BYTES, MAX_ROWS, prim } from './importBook';
import {
  exportRosterWorkbook,
  exportWorkbook,
  importRoster,
  importWorkbook,
  rosterSummary,
  rosterWarning,
} from './index';
import {
  condsToCell,
  parseConds,
  parseDateText,
  parseSlots,
  parseTimeText,
  parseTrait,
  personSheetNames,
  plainNumber,
  serialToTime,
  traitToCell,
} from './text';

/** seed のデータ（種類・定期パターン入り。ADR-0012。7日分の担当を書いた回が保存した訪問になる。版2） */
const BASE = withSeedPlans(createDemoData('2026-10-13'), '2026-10-13', 7);
const base = (): DemoData => structuredClone(BASE);
/** 読み込みで消えるもの（版2は無い。伝えた内容は base から引き継ぐ） */
const withoutPlans = (d: DemoData): DemoData => d;

async function toBuffer(d: DemoData): Promise<ArrayBuffer> {
  return (await exportWorkbook(d)).arrayBuffer();
}

/** 書き出したブックを ExcelJS で直してから読み込む */
async function editAndImport(d: DemoData, fn: (wb: ExcelJS.Workbook) => void): Promise<DemoData | ImportError> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await toBuffer(d));
  fn(wb);
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return importWorkbook(buf, d);
}

const ok = (r: DemoData | ImportError): DemoData => {
  if (isImportError(r)) throw new Error(`読み込めなかった：${r.message}`);
  return r;
};
const fail = (r: DemoData | ImportError): string => {
  if (!isImportError(r)) throw new Error('エラーになるはずが読み込めた');
  return r.message;
};

/** 見出しの名前から列番号 */
function col(ws: ExcelJS.Worksheet, header: string): number {
  for (let c = 1; c <= ws.columnCount; c++) if (ws.getRow(1).getCell(c).value === header) return c;
  throw new Error(`見出し ${header} がない`);
}
function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`シート ${name} がない`);
  return ws;
}

describe('書き出し → 読み込み', () => {
  it('seed のデータは同じデータに戻る（ID・並び順も）', async () => {
    const d = base();
    const r = ok(await importWorkbook(await toBuffer(d), d));
    expect(r).toEqual(d);
    expect(r.staff.map((s) => s.id)).toEqual(d.staff.map((s) => s.id));
    expect(r.visits.map((v) => v.id)).toEqual(d.visits.map((v) => v.id));
  });

  it('伝えた内容（確定）・振り直しの情報・版・基準日は base から引き継ぐ（ブックには書かない）', async () => {
    const d = base();
    const told: DemoData = { ...d, snapshots: { [d.baseDate]: { date: d.baseDate, at: 1, visits: [] } } };
    expect(ok(await importWorkbook(await toBuffer(told), d)).snapshots).toEqual({});
    const r = ok(await importWorkbook(await toBuffer(d), told));
    expect(r.snapshots).toEqual(told.snapshots);
    expect(r.version).toBe(d.version);
    expect(r.baseDate).toBe(d.baseDate);
  });

  it('いろいろな条件・特性・呼び方を変えたデータも戻る', async () => {
    const d = base();
    const changed: DemoData = {
      ...d,
      org: { ...d.org, terms: { staff: 'シッター', client: 'お客様' }, industry: 'sitter', fareYenPerKm: 15 },
      seed: 42,
      staff: d.staff.map((s, i) =>
        i === 0
          ? {
              ...s,
              travelMode: 'BICYCLE',
              active: false,
              home: { ...s.home, lat: null, lng: null },
              traits: { ...s.traits, qualification: [], experience: 2.5 },
              requirements: [
                { itemId: 'pet', op: 'not', value: true },
                { itemId: 'target', op: 'not', value: '子ども' },
              ],
              preferences: [{ itemId: 'smoking', op: 'not', value: false }],
            }
          : s,
      ),
      clients: d.clients.map((c, i) =>
        i === 0
          ? {
              ...c,
              color: 7,
              traits: { pet: true },
              // 条件は項目の列の順（項目のシートの順）に並ぶ
              requirements: [
                { itemId: 'qualification', op: 'hasAll', value: ['看護師', '保育士'] },
                { itemId: 'experience', op: 'gte', value: 3 },
                { itemId: 'experience', op: 'lte', value: 10 },
              ],
              preferences: [
                { itemId: 'gender', op: 'in', value: ['女性', '男性'] },
                { itemId: 'experience', op: 'not', value: 4 },
              ],
            }
          : c,
      ),
      visits: d.visits.map((v, i) => (i === 0 ? { ...v, cancelled: true, note: 'メモ\n2行目' } : v)),
      availability: [
        { staffId: d.staff[0]?.id ?? '', date: '2026-10-14', slots: [] },
        {
          staffId: d.staff[1]?.id ?? '',
          date: '2026-10-15',
          slots: [
            { start: '09:00', end: '12:00' },
            { start: '13:30', end: '18:00' },
          ],
        },
      ],
    };
    const r = ok(await importWorkbook(await toBuffer(changed), changed));
    expect(r).toEqual(withoutPlans(changed));
  });

  it('シート名・見出しは呼び方から作る', async () => {
    const d = base();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toBuffer(d));
    const names = personSheetNames(d.org.terms);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      '使い方',
      '事業所',
      '項目',
      '条件',
      'プリセット',
      names.staff,
      names.client,
      '相性',
      '稼働時間',
      '欠勤',
      '種類',
      '定期パターン',
      '訪問',
      '訪問先の休み',
      '稼働の見込み',
    ]);
    expect(col(sheet(wb, '訪問'), d.org.terms.client)).toBe(3);
    // 見出しは固定・太字
    const ws = sheet(wb, names.staff);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.getRow(1).getCell(1).font?.bold).toBe(true);
  });
});

describe('行を足す・消す', () => {
  it('ID が空の行は新しく足され、行を消すとその人・訪問は消える', async () => {
    const d = base();
    const names = personSheetNames(d.org.terms);
    const removed = d.staff[1];
    const removedVisit = d.visits[0];
    const r = ok(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, names.staff);
        // 2人目（3行目）を消す
        ws.spliceRows(3, 1);
        const row = ws.addRow([]);
        row.getCell(col(ws, '名前')).value = '新人 たろう';
        row.getCell(col(ws, '移動手段')).value = '徒歩';
        row.getCell(col(ws, '勤務する曜日')).value = '月水金';
        row.getCell(col(ws, '勤務開始')).value = '9:00';
        row.getCell(col(ws, '勤務終了')).value = '17:30';
        row.getCell(col(ws, '利用中')).value = '○';
        row.getCell(col(ws, '特性：性別')).value = '男性';
        // 消した人の名前を参照するところは消しておく（繰り返しの担当・相性の列・稼働時間・訪問の担当）
        const pws = sheet(wb, '定期パターン');
        const usualCol = col(pws, '担当');
        for (let n = 2; n <= pws.rowCount; n++) {
          if (pws.getRow(n).getCell(usualCol).value === removed?.name) pws.getRow(n).getCell(usualCol).value = null;
        }
        const cws = sheet(wb, '相性');
        for (let c = 2; c <= cws.columnCount; c++) {
          if (cws.getRow(1).getCell(c).value === removed?.name) cws.spliceColumns(c, 1);
        }
        const vws = sheet(wb, '訪問');
        const staffCol = col(vws, '担当');
        for (let n = 2; n <= vws.rowCount; n++) {
          if (vws.getRow(n).getCell(staffCol).value === removed?.name) vws.getRow(n).getCell(staffCol).value = null;
        }
        const aws = sheet(wb, '稼働時間');
        for (let n = aws.rowCount; n >= 2; n--) {
          if (aws.getRow(n).getCell(1).value === removed?.name) aws.spliceRows(n, 1);
        }
        // 訪問の1件目を消し、新しい訪問を足す
        vws.spliceRows(2, 1);
        const v = vws.addRow([]);
        v.getCell(col(vws, '日付')).value = '2026/10/20';
        v.getCell(col(vws, d.org.terms.client)).value = d.clients[0]?.displayName;
        v.getCell(col(vws, '時間の決め方')).value = 'ちょうど';
        v.getCell(col(vws, '開始（早）')).value = 0.375; // Excel の時刻のシリアル値（9:00）
        v.getCell(col(vws, '所要（分）')).value = 60;
        v.getCell(col(vws, '担当')).value = '新人 たろう';
      }),
    );
    expect(r.staff.some((s) => s.id === removed?.id)).toBe(false);
    expect(r.staff).toHaveLength(d.staff.length);
    const added = r.staff.at(-1);
    expect(added?.name).toBe('新人 たろう');
    expect(added?.id).toMatch(/^s-[0-9a-f]{8}$/);
    expect(added).toMatchObject({
      travelMode: 'WALK',
      workDays: [1, 3, 5],
      shiftStart: '09:00',
      shiftEnd: '17:30',
      active: true,
      traits: { gender: '男性' },
      requirements: [],
      preferences: [],
      home: { address: '', lat: null, lng: null },
    });
    expect(r.visits.some((v) => v.id === removedVisit?.id)).toBe(false);
    const nv = r.visits.at(-1);
    expect(nv).toMatchObject({
      date: '2026-10-20',
      clientId: d.clients[0]?.id,
      windowKind: 'fixed',
      earliestStart: '09:00',
      latestStart: '09:00',
      durationMinutes: 60,
      staffId: added?.id,
      cancelled: false,
    });
    expect(nv?.id).toMatch(/^v-/);
  });

  it('日付・時刻のセルが Excel の日付・時刻（Date）でも読む', async () => {
    const d = base();
    const r = ok(
      await editAndImport(d, (wb) => {
        const vws = sheet(wb, '訪問');
        vws.getRow(2).getCell(col(vws, '日付')).value = new Date(Date.UTC(2026, 9, 21));
        vws.getRow(2).getCell(col(vws, '開始（早）')).value = new Date(Date.UTC(1899, 11, 30, 8, 30));
        vws.getRow(2).getCell(col(vws, '開始（遅）')).value = '  10:00 ';
        vws.getRow(2).getCell(col(vws, '時間の決め方')).value = '幅';
      }),
    );
    expect(r.visits[0]).toMatchObject({ date: '2026-10-21', earliestStart: '08:30', latestStart: '10:00' });
  });
});

describe('読み込みのエラー（シート名と行番号付き）', () => {
  it('同じ名前の人', async () => {
    const d = base();
    const names = personSheetNames(d.org.terms);
    const msg = fail(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, names.staff);
        ws.getRow(3).getCell(col(ws, '名前')).value = d.staff[0]?.name;
      }),
    );
    expect(msg).toContain(`シート『${names.staff}』の 3行目・『名前』`);
    expect(msg).toContain('2行目と重なっています');
  });

  it('いない名前の参照', async () => {
    const d = base();
    const msg = fail(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, '訪問');
        ws.getRow(5).getCell(col(ws, '担当')).value = 'いない人';
      }),
    );
    expect(msg).toContain('シート『訪問』の 5行目・『担当』');
    expect(msg).toContain('「いない人」');
  });

  it('読めない時刻・日付', async () => {
    const d = base();
    const msg = fail(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, '訪問');
        ws.getRow(12).getCell(col(ws, '開始（早）')).value = '25:00';
        ws.getRow(13).getCell(col(ws, '日付')).value = '10月13日';
      }),
    );
    expect(msg).toContain('シート『訪問』の 12行目・『開始（早）』：時刻は 9:00 の形で書いてください');
    expect(msg).toContain('シート『訪問』の 13行目・『日付』：日付は 2026-10-13 の形で書いてください');
  });

  it('選択肢にない値', async () => {
    const d = base();
    const names = personSheetNames(d.org.terms);
    const msg = fail(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, names.staff);
        ws.getRow(2).getCell(col(ws, '特性：性別')).value = 'その他';
        ws.getRow(4).getCell(col(ws, '移動手段')).value = '飛行機';
      }),
    );
    expect(msg).toContain(`シート『${names.staff}』の 2行目・『特性：性別』：「その他」は「性別」の選択肢にありません`);
    expect(msg).toContain(`シート『${names.staff}』の 4行目・『移動手段』`);
  });

  it('必須の列が無い・シートが無い', async () => {
    const d = base();
    const msg = fail(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, '訪問');
        ws.spliceColumns(col(ws, '所要（分）'), 1);
        wb.removeWorksheet(sheet(wb, '相性').id);
      }),
    );
    expect(msg).toContain('シート『相性』がありません');
    expect(msg).toContain('シート『訪問』：『所要（分）』の列がありません');
  });

  it('1人の条件が20件を超える', async () => {
    const d = base();
    const names = personSheetNames(d.org.terms);
    const msg = fail(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, names.client);
        ws.getRow(2).getCell(col(ws, '希望：経験年数')).value = Array.from({ length: 21 }, (_, i) => `${i}以上`).join(
          '\n',
        );
      }),
    );
    expect(msg).toContain(`シート『${names.client}』の 2行目`);
    expect(msg).toContain('希望は1人20件までです');
  });

  it('Excel でないファイル', async () => {
    const r = await importWorkbook(new TextEncoder().encode('not xlsx').buffer as ArrayBuffer, base());
    expect(fail(r)).toContain('Excel のファイル');
  });
});

describe('条件のセルの書き方', () => {
  const flag: Item = { id: 'pet', name: 'ペット', target: 'client', kind: 'flag', options: [] };
  const choice: Item = { id: 'g', name: '性別', target: 'staff', kind: 'choice', options: ['女性', '男性', 'その他'] };
  const multi: Item = {
    id: 'q',
    name: '資格',
    target: 'staff',
    kind: 'multi',
    options: ['看護師', '保育士', '介護福祉士'],
  };
  const num: Item = { id: 'e', name: '経験', target: 'staff', kind: 'number', options: [] };
  const c = (itemId: string, op: Condition['op'], value: Condition['value']): Condition => ({ itemId, op, value });

  const cases: [Item, Condition[], string][] = [
    [flag, [c('pet', 'is', true)], 'あり'],
    [flag, [c('pet', 'is', false)], 'なし'],
    [flag, [c('pet', 'not', true)], 'なし（未確認も可）'],
    [flag, [c('pet', 'not', false)], 'あり（未確認も可）'],
    [choice, [c('g', 'is', '女性')], '女性'],
    [choice, [c('g', 'in', ['女性', 'その他'])], '女性、その他'],
    [choice, [c('g', 'not', '男性')], '男性以外'],
    [multi, [c('q', 'hasAny', ['看護師', '保育士'])], '看護師、保育士'],
    [multi, [c('q', 'hasAll', ['看護師', '保育士'])], 'すべて：看護師、保育士'],
    [multi, [c('q', 'hasAll', ['看護師'])], 'すべて：看護師'],
    [num, [c('e', 'gte', 3)], '3以上'],
    [num, [c('e', 'lte', 5)], '5以下'],
    [num, [c('e', 'gte', 3), c('e', 'lte', 5)], '3〜5'],
    [num, [c('e', 'is', 3)], '3'],
    [num, [c('e', 'not', 3)], '3以外'],
    [num, [c('e', 'gte', 1.5)], '1.5以上'],
    [num, [c('e', 'lte', 5), c('e', 'gte', 3)], '5以下\n3以上'],
    [flag, [], ''],
  ];
  it.each(cases)('%#：書き出して読むと同じ条件に戻る', (item, conds, text) => {
    expect(condsToCell(item, conds)).toBe(text);
    const r = parseConds(item, text);
    expect(r).toEqual({ ok: true, value: conds });
  });

  it('区切りは「、」と改行だけ（「・」「,」は選択肢の名前の一部）。全角の数字・括弧も読む', () => {
    expect(parseConds(multi, '看護師、保育士')).toEqual({ ok: true, value: [c('q', 'hasAny', ['看護師', '保育士'])] });
    expect(parseConds(multi, '看護師,保育士').ok).toBe(false);
    expect(parseConds(multi, '看護師・保育士').ok).toBe(false);
    const dot: Item = { ...multi, options: ['洗濯・掃除', 'A,B'] };
    expect(parseConds(dot, '洗濯・掃除、A,B')).toEqual({ ok: true, value: [c('q', 'hasAny', ['洗濯・掃除', 'A,B'])] });
    expect(parseTrait(multi, '看護師\n保育士')).toEqual({ ok: true, value: ['看護師', '保育士'] });
    expect(parseConds(num, '３～５')).toEqual({ ok: true, value: [c('e', 'gte', 3), c('e', 'lte', 5)] });
    expect(parseConds(flag, 'なし(未確認も可)')).toEqual({ ok: true, value: [c('pet', 'not', true)] });
    expect(parseConds(multi, 'すべて:看護師、保育士')).toEqual({
      ok: true,
      value: [c('q', 'hasAll', ['看護師', '保育士'])],
    });
  });

  it('セル全体が選択肢と同じなら、その選択肢（印と同じ形の名前でも）', () => {
    const ch: Item = { ...choice, options: ['子ども', '子ども以外'] };
    expect(parseConds(ch, '子ども以外')).toEqual({ ok: true, value: [c('g', 'is', '子ども以外')] });
    expect(condsToCell(ch, [c('g', 'not', '子ども以外')])).toBe('子ども以外以外');
    expect(parseConds(ch, '子ども以外以外')).toEqual({ ok: true, value: [c('g', 'not', '子ども以外')] });
    const mu: Item = { ...multi, options: ['すべて：x', 'x', 'なし'] };
    expect(parseConds(mu, 'すべて：x')).toEqual({ ok: true, value: [c('q', 'hasAny', ['すべて：x'])] });
    expect(parseConds(mu, 'すべて：すべて：x')).toEqual({ ok: true, value: [c('q', 'hasAll', ['すべて：x'])] });
    // 選択肢から複数の特性：[] は「（なし）」、「なし」は選択肢の「なし」
    expect(traitToCell(mu, [])).toBe('（なし）');
    expect(parseTrait(mu, '（なし）')).toEqual({ ok: true, value: [] });
    expect(parseTrait(mu, '(なし)')).toEqual({ ok: true, value: [] });
    expect(parseTrait(mu, 'なし')).toEqual({ ok: true, value: ['なし'] });
  });

  it('数は指数表記にしない（読み戻せる形）', () => {
    expect(plainNumber(1e-7)).toBe('0.0000001');
    expect(plainNumber(1e21)).toBe('1000000000000000000000');
    expect(plainNumber(-2.5)).toBe('-2.5');
    for (const v of [1e-7, 1e21, 0.1 + 0.2, -1.5]) {
      const conds = [c('e', 'gte', v)];
      expect(parseConds(num, condsToCell(num, conds))).toEqual({ ok: true, value: conds });
    }
  });

  it('読めない書き方はエラー', () => {
    expect(parseConds(flag, 'たぶん').ok).toBe(false);
    expect(parseConds(choice, '女性、不明').ok).toBe(false);
    expect(parseConds(num, '3より上').ok).toBe(false);
  });
});

describe('値の読み取り', () => {
  it('時刻・日付・時間帯', () => {
    expect(parseTimeText('9:00')).toBe('09:00');
    expect(parseTimeText('09:00')).toBe('09:00');
    expect(parseTimeText('９：３０')).toBe('09:30');
    expect(parseTimeText('24:00')).toBeNull();
    expect(serialToTime(0.375)).toBe('09:00');
    expect(serialToTime(0.5 + 1 / 1440)).toBe('12:01');
    // 1 以上（「9」と書いた・日付つき）は時刻として読まない
    expect(serialToTime(9)).toBeNull();
    expect(serialToTime(1)).toBeNull();
    expect(parseDateText('2026-10-13')).toBe('2026-10-13');
    expect(parseDateText('2026/1/3')).toBe('2026-01-03');
    expect(parseDateText('2026/2/30')).toBeNull();
    expect(parseSlots('9:00-12:00、13:00〜18:00')).toEqual([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '18:00' },
    ]);
    expect(parseSlots('休み')).toEqual([]);
    expect(parseSlots('朝だけ')).toBeNull();
  });
});

describe('レビューの指摘（ブック）', () => {
  it('選択肢に「、」があると書き出さない（場所を示す）。「・」「,」の選択肢と（なし）は往復する', async () => {
    const d = base();
    const bad: DemoData = {
      ...d,
      items: d.items.map((i) => (i.id === 'specialty' ? { ...i, options: [...i.options, '洗濯、掃除'] } : i)),
    };
    await expect(exportWorkbook(bad)).rejects.toThrow('項目「得意」の選択肢「洗濯、掃除」');
    const good: DemoData = {
      ...d,
      items: d.items.map((i) => (i.id === 'specialty' ? { ...i, options: [...i.options, '洗濯・掃除', 'A,B'] } : i)),
      staff: d.staff.map((s, i) =>
        i === 0
          ? { ...s, traits: { ...s.traits, specialty: ['洗濯・掃除', 'A,B'] } }
          : i === 1
            ? { ...s, traits: { ...s.traits, specialty: [] } }
            : s,
      ),
    };
    expect(ok(await importWorkbook(await toBuffer(good), good))).toEqual(withoutPlans(good));
  });

  it('見出しは全角半角・コロンの揺れを許す。項目の列が無ければ止める', async () => {
    const d = base();
    const names = personSheetNames(d.org.terms);
    const r = ok(
      await editAndImport(d, (wb) => {
        const v = sheet(wb, '訪問');
        v.getRow(1).getCell(col(v, '開始（早）')).value = '開始(早)';
        const s = sheet(wb, names.staff);
        s.getRow(1).getCell(col(s, '特性：性別')).value = '特性:性別';
      }),
    );
    expect(r).toEqual(withoutPlans(d));
    const msg = fail(
      await editAndImport(d, (wb) => {
        const s = sheet(wb, names.staff);
        s.spliceColumns(col(s, '特性：性別'), 1);
      }),
    );
    expect(msg).toContain(`シート『${names.staff}』に列『特性：性別』がありません`);
    const msg2 = fail(
      await editAndImport(d, (wb) => {
        const s = sheet(wb, names.staff);
        s.getRow(1).getCell(s.columnCount + 1).value = '特性：身長';
      }),
    );
    expect(msg2).toContain('見出し『特性：身長』の項目が');
  });

  it('数式のエラー・結果の無い数式は場所付きのエラー', async () => {
    const d = base();
    const msg = fail(
      await editAndImport(d, (wb) => {
        const v = sheet(wb, '訪問');
        v.getRow(2).getCell(col(v, '担当')).value = { formula: 'VLOOKUP(1,A:A,1,0)', result: { error: '#N/A' } };
        v.getRow(3).getCell(col(v, 'メモ')).value = { formula: 'B2' } as ExcelJS.CellValue;
      }),
    );
    expect(msg).toContain('シート『訪問』の 2行目・『担当』：数式のエラー（#N/A）');
    expect(msg).toContain('シート『訪問』の 3行目・『メモ』：数式の結果が保存されていません');
  });

  it('遠くの行の空白は無視し、行数・ファイルの大きさの上限を超えたら止める', async () => {
    const d = base();
    ok(
      await editAndImport(d, (wb) => {
        sheet(wb, '訪問').getRow(1_048_000).getCell(30).value = ' ';
      }),
    );
    const msg = fail(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, '稼働時間');
        for (let n = 2; n <= MAX_ROWS + 2; n++) ws.getRow(n).getCell(3).value = 'x';
      }),
    );
    expect(msg).toContain('シート『稼働時間』：行が多すぎます');
    expect(fail(await importWorkbook(new ArrayBuffer(MAX_FILE_BYTES + 1), d))).toContain('ファイルが大きすぎます');
  }, 30_000);

  it('条件の名前は重なってよい。項目の名前は対象ごとに一意（対象をまたぐのはよい）', async () => {
    const d = base();
    const dupRule: DemoData = {
      ...d,
      rules: d.rules.map((r, i) => (i === 1 ? { ...r, label: d.rules[0]?.label ?? '' } : r)),
    };
    expect(ok(await importWorkbook(await toBuffer(dupRule), dupRule))).toEqual(withoutPlans(dupRule));
    // 訪問先の項目「対象」をスタッフの項目「性別」と同じ名前に
    const cross: DemoData = { ...d, items: d.items.map((i) => (i.id === 'target' ? { ...i, name: '性別' } : i)) };
    expect(ok(await importWorkbook(await toBuffer(cross), cross))).toEqual(withoutPlans(cross));
    const msg = fail(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, '項目');
        ws.getRow(3).getCell(col(ws, '名前')).value = '性別';
      }),
    );
    expect(msg).toContain('シート『項目』の 3行目・『名前』：「性別」が 2行目と重なっています');
  });

  it('ID に __proto__ などは使えない・長さの上限・稼働時間の同じ人と日の重なり', async () => {
    const d = base();
    const names = personSheetNames(d.org.terms);
    const withAvail: DemoData = {
      ...d,
      availability: [{ staffId: d.staff[0]?.id ?? '', date: '2026-10-14', slots: [] }],
    };
    const msg = fail(
      await editAndImport(withAvail, (wb) => {
        sheet(wb, names.client).getRow(2).getCell(1).value = '__proto__';
        const s = sheet(wb, names.staff);
        s.getRow(3).getCell(col(s, '名前')).value = 'x'.repeat(51);
        const c = sheet(wb, names.client);
        c.getRow(3).getCell(col(c, 'メモ')).value = 'x'.repeat(501);
        sheet(wb, '稼働時間').addRow([d.staff[0]?.name, '2026-10-14', '9:00-12:00']);
      }),
    );
    expect(msg).toContain(`シート『${names.client}』の 2行目・『ID』：「__proto__」は ID に使えません`);
    expect(msg).toContain(`シート『${names.staff}』の 3行目・『名前』：50文字までです`);
    expect(msg).toContain(`シート『${names.client}』の 3行目・『メモ』：500文字までです`);
    expect(msg).toContain('シート『稼働時間』の 3行目・『日付』：同じスタッフ・同じ日の行が 2行目にもあります');
  });

  it('呼び方が2つ同じなら書き出さない・読み込まない', async () => {
    const d = base();
    const same: DemoData = { ...d, org: { ...d.org, terms: { staff: 'スタッフ', client: 'スタッフ' } } };
    await expect(exportWorkbook(same)).rejects.toThrow('呼び方');
    const msg = fail(
      await editAndImport(d, (wb) => {
        sheet(wb, '事業所').getRow(5).getCell(2).value = d.org.terms.staff;
      }),
    );
    expect(msg).toContain('シート『事業所』の 5行目・『値』：呼び方（訪問する人）と同じです');
  });

  it('結合したセルは黙って読まずに場所付きのエラー', async () => {
    const d = base();
    const msg = fail(
      await editAndImport(d, (wb) => {
        const v = sheet(wb, '訪問');
        const c = col(v, '担当');
        v.mergeCells(2, c, 3, c);
      }),
    );
    expect(msg).toContain('シート『訪問』の 3行目・『担当』：結合したセルは読めません');
  });

  it('全角半角・空白だけが違う名前は書き出しで止め、読み込みでも重なりとして止める', async () => {
    const d = base();
    const s0 = d.staff[0];
    const s1 = d.staff[1];
    if (!s0 || !s1) throw new Error('seed にスタッフがいない');
    const near = { ...d, staff: d.staff.map((s) => (s.id === s1.id ? { ...s, name: s0.name.replace(' ', '　') } : s)) };
    await expect(exportWorkbook(near)).rejects.toThrow('全角半角・空白だけが違う');
    const msg = fail(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, d.org.terms.staff);
        ws.getRow(3).getCell(col(ws, '名前')).value = s0.name.replace(' ', '');
      }),
    );
    expect(msg).toContain('2行目と重なっています');
  });
});

describe('欠勤のシート（ADR-0011）', () => {
  const withAbsences = (d: DemoData): DemoData => ({
    ...d,
    absences: [
      { id: 'a1', staffId: d.staff[0]!.id, date: '2026-10-14', from: '09:00', to: '12:00', note: '病院の付き添い' },
      { id: 'a2', staffId: d.staff[1]!.id, date: '2026-10-14', from: null, to: null, note: '' },
      { id: 'a3', staffId: d.staff[2]!.id, date: '2026-10-15', from: '15:00', to: null, note: '早退' },
    ],
  });
  it('欠勤が 書き出し → 読み込み で同じに戻る', async () => {
    const d = withAbsences(base());
    const r = ok(await importWorkbook(await toBuffer(d), d));
    expect(r.absences).toEqual(d.absences);
    expect(r).toEqual(withoutPlans(d));
  });
  it('「欠勤」シートが無いブックは欠勤なし', async () => {
    const d = withAbsences(base());
    const r = ok(
      await editAndImport(d, (wb) => {
        wb.removeWorksheet(sheet(wb, '欠勤').id);
      }),
    );
    expect(r.absences).toEqual([]);
  });
  it('同じ人・同じ日の2行、30分単位でない時刻、終了 ≤ 開始、いない人の名前はシート名と行番号付きで止める', async () => {
    const d = withAbsences(base());
    const msg = fail(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, '欠勤');
        ws.addRow(['', d.staff[0]!.name, '2026-10-14', '13:00', '', '']);
        ws.addRow(['', d.staff[3]!.name, '2026-10-14', '10:15', '', '']);
        ws.addRow(['', d.staff[4]!.name, '2026-10-14', '12:00', '10:00', '']);
        ws.addRow(['', 'いない人', '2026-10-14', '', '', '']);
      }),
    );
    expect(msg).toContain('シート『欠勤』の 5行目・『日付』：同じスタッフ・同じ日の行が 2行目にもあります');
    expect(msg).toContain('シート『欠勤』の 6行目・『開始』：時間は30分単位で書いてください');
    expect(msg).toContain('シート『欠勤』の 7行目・『終了』：終了は開始より後にしてください');
    expect(msg).toContain('シート『欠勤』の 8行目・『スタッフ』：「いない人」というスタッフは');
  });
});

describe('種類・定期パターンのシート（ADR-0012）', () => {
  /** seed に、いろいろな形の種類・パターン・訪問を足したデータ */
  const varied = (): DemoData => {
    const d = base();
    const c0 = d.clients[0]!;
    const s0 = d.staff[0]!;
    return {
      ...d,
      visitTypes: [
        ...d.visitTypes,
        {
          id: 't-extra',
          name: '見守り',
          color: 7,
          durationMinutes: 30,
          requirements: [
            { itemId: 'gender', op: 'is', value: '女性' },
            { itemId: 'experience', op: 'gte', value: 2 },
          ],
          note: '夜間のみ\n2行目',
        },
      ],
      patterns: [
        ...d.patterns,
        {
          id: 'pt-extra',
          clientId: c0.id,
          typeId: null,
          weekdays: [2, 6],
          everyWeeks: 3,
          repeat: 'weekly',
          monthWeeks: [],
          dayTimes: [],
          windowKind: 'window',
          earliestStart: '13:00',
          latestStart: '14:30',
          durationMinutes: 45,
          from: '2026-10-01',
          to: '2026-12-31',
          usualStaffId: s0.id,
          note: 'メモ',
        },
      ],
      visits: d.visits.map((v, i) =>
        i === 0
          ? { ...v, pattern: v.pattern ? { ...v.pattern, edited: true } : v.pattern, earliestStart: '08:00' }
          : i === 1
            ? {
                ...v,
                id: '2026-10-13_pt-extra',
                typeId: 't-extra',
                pattern: { id: 'pt-extra', date: '2026-10-13', edited: false },
              }
            : v,
      ),
    };
  };

  it('種類・パターン・訪問の種類・定期パターン・元の日・この回だけ変更が 書き出し → 読み込み で同じに戻る', async () => {
    const d = varied();
    expect(d.visitTypes.length).toBeGreaterThan(0);
    expect(d.visits.some((v) => v.pattern?.edited)).toBe(true);
    const r = ok(await importWorkbook(await toBuffer(d), d));
    expect(r.visitTypes).toEqual(d.visitTypes);
    expect(r.patterns).toEqual(d.patterns);
    expect(r.visits).toEqual(d.visits);
    expect(r).toEqual(withoutPlans(d));
  });

  it('「種類」「定期パターン」シートが無いブックは種類・パターンなし（訪問の種類・パターンは空）', async () => {
    const d = varied();
    const r = ok(
      await editAndImport(d, (wb) => {
        wb.removeWorksheet(sheet(wb, '種類').id);
        wb.removeWorksheet(sheet(wb, '定期パターン').id);
        // 古いブックの「訪問」シートには種類・パターンの列が無い
        const vws = sheet(wb, '訪問');
        for (const h of ['この回だけ変更', '元の日', '定期パターン', '種類']) vws.spliceColumns(col(vws, h), 1);
      }),
    );
    expect(r.visitTypes).toEqual([]);
    expect(r.patterns).toEqual([]);
    expect(r.visits).toHaveLength(d.visits.length);
    expect(r.visits.every((v) => v.typeId === null && v.pattern === null)).toBe(true);
  });

  it('シートが無ければ、訪問に種類・パターンの列が残っていても空にする', async () => {
    const d = varied();
    const r = ok(
      await editAndImport(d, (wb) => {
        wb.removeWorksheet(sheet(wb, '種類').id);
        wb.removeWorksheet(sheet(wb, '定期パターン').id);
      }),
    );
    expect(r.visitTypes).toEqual([]);
    expect(r.patterns).toEqual([]);
    expect(r.visits.every((v) => v.typeId === null && v.pattern === null)).toBe(true);
  });

  it('ID が空の種類・パターンは新しく足される', async () => {
    const d = varied();
    const r = ok(
      await editAndImport(d, (wb) => {
        const tws = sheet(wb, '種類');
        const t = tws.addRow([]);
        t.getCell(col(tws, '名前')).value = '家事';
        t.getCell(col(tws, '色（1〜8）')).value = 2;
        t.getCell(col(tws, '標準の所要（分）')).value = 90;
        const pws = sheet(wb, '定期パターン');
        const p = pws.addRow([]);
        p.getCell(col(pws, d.org.terms.client)).value = d.clients[1]!.displayName;
        p.getCell(col(pws, '種類')).value = '家事';
        p.getCell(col(pws, '曜日')).value = '金月';
        p.getCell(col(pws, '間隔')).value = '隔週';
        p.getCell(col(pws, '時間の決め方')).value = 'ちょうど';
        p.getCell(col(pws, '開始（早）')).value = '10:00';
        p.getCell(col(pws, '所要（分）')).value = 90;
        p.getCell(col(pws, '開始日')).value = '2026/11/2';
      }),
    );
    const nt = r.visitTypes.at(-1);
    expect(nt).toMatchObject({ name: '家事', color: 1, durationMinutes: 90, requirements: [], note: '' });
    expect(nt?.id).toMatch(/^t-/);
    const np = r.patterns.at(-1);
    expect(np).toMatchObject({
      clientId: d.clients[1]!.id,
      typeId: nt?.id,
      weekdays: [1, 5],
      everyWeeks: 2,
      windowKind: 'fixed',
      earliestStart: '10:00',
      latestStart: '10:00',
      durationMinutes: 90,
      from: '2026-11-02',
      to: null,
      usualStaffId: null,
      note: '',
    });
    expect(np?.id).toMatch(/^pt-/);
  });

  it('パターンを指す訪問の ID が「元の日_パターンID」でなければ（空の ID も）シート名・行番号付きで止める', async () => {
    const d = varied();
    const msg = fail(
      await editAndImport(d, (wb) => {
        const vws = sheet(wb, '訪問');
        // 2行目はパターンの訪問（seed）、3行目は pt-extra を指す訪問
        expect(vws.getRow(2).getCell(col(vws, '定期パターン')).value).toBeTruthy();
        vws.getRow(2).getCell(col(vws, 'ID')).value = 'v-wrong';
        vws.getRow(3).getCell(col(vws, 'ID')).value = null;
      }),
    );
    const v0 = d.visits[0]!;
    expect(msg).toContain(
      `シート『訪問』の 2行目・『ID』：定期パターンの訪問の ID は「${v0.pattern!.date}_${v0.pattern!.id}」（元の日_パターンID）にしてください`,
    );
    expect(msg).toContain(
      'シート『訪問』の 3行目・『ID』：定期パターンの訪問の ID は「2026-10-13_pt-extra」（元の日_パターンID）にしてください',
    );
  });

  it('同じ名前の種類、いない種類・利用者さん・スタッフ・パターンの参照はシート名と行番号付きで止める', async () => {
    const d = varied();
    const msg = fail(
      await editAndImport(d, (wb) => {
        const tws = sheet(wb, '種類');
        tws.getRow(3).getCell(col(tws, '名前')).value = tws.getRow(2).getCell(col(tws, '名前')).value;
        const pws = sheet(wb, '定期パターン');
        pws.getRow(2).getCell(col(pws, '種類')).value = 'ない種類';
        pws.getRow(3).getCell(col(pws, d.org.terms.client)).value = 'いない人';
        pws.getRow(4).getCell(col(pws, '担当')).value = 'いない担当';
        const vws = sheet(wb, '訪問');
        vws.getRow(2).getCell(col(vws, '定期パターン')).value = 'no-such';
      }),
    );
    expect(msg).toContain('シート『種類』の 3行目・『名前』：「');
    expect(msg).toContain('2行目と重なっています');
    expect(msg).toContain(
      'シート『定期パターン』の 2行目・『種類』：「ない種類」という種類は、シート『種類』にありません',
    );
    expect(msg).toContain(`シート『定期パターン』の 3行目・『${d.org.terms.client}』：「いない人」という`);
    expect(msg).toContain('シート『定期パターン』の 4行目・『担当』：「いない担当」という');
    // パターンのシートで止まるので、訪問のシートは次の読み込みで出る
    const msg2 = fail(
      await editAndImport(d, (wb) => {
        const vws = sheet(wb, '訪問');
        vws.getRow(2).getCell(col(vws, '定期パターン')).value = 'no-such';
        vws.getRow(3).getCell(col(vws, '種類')).value = 'ない種類';
        vws.getRow(4).getCell(col(vws, '定期パターン')).value = null;
      }),
    );
    expect(msg2).toContain(
      'シート『訪問』の 2行目・『定期パターン』：ID「no-such」の定期パターンは、シート『定期パターン』にありません',
    );
    expect(msg2).toContain('シート『訪問』の 3行目・『種類』：「ない種類」という種類は、シート『種類』にありません');
    expect(msg2).toContain('シート『訪問』の 4行目・『定期パターン』：単発の訪問');
  });

  it('読めない曜日・間隔、終了日が開始日より前、開始（早）が開始（遅）より後はシート名と行番号付きで止める', async () => {
    const d = varied();
    const msg = fail(
      await editAndImport(d, (wb) => {
        const pws = sheet(wb, '定期パターン');
        pws.getRow(2).getCell(col(pws, '曜日')).value = '月曜と木';
        pws.getRow(3).getCell(col(pws, '曜日')).value = null;
        pws.getRow(4).getCell(col(pws, '間隔')).value = '毎年';
        pws.getRow(5).getCell(col(pws, '開始日')).value = '2026-11-01';
        pws.getRow(5).getCell(col(pws, '終了日')).value = '2026-10-31';
        pws.getRow(6).getCell(col(pws, '時間の決め方')).value = '幅';
        pws.getRow(6).getCell(col(pws, '開始（早）')).value = '11:00';
        pws.getRow(6).getCell(col(pws, '開始（遅）')).value = '10:00';
      }),
    );
    expect(msg).toContain('シート『定期パターン』の 2行目・『曜日』：曜日は「月木」のように1つ以上書いてください');
    expect(msg).toContain('シート『定期パターン』の 3行目・『曜日』：');
    expect(msg).toContain(
      'シート『定期パターン』の 4行目・『間隔』：「毎週」「隔週」「3週ごと」「4週ごと」「毎月」のどれかで書いてください',
    );
    expect(msg).toContain('シート『定期パターン』の 5行目・『終了日』：終了日は開始日以降にしてください');
    expect(msg).toContain('シート『定期パターン』の 6行目・『開始（遅）』：開始（遅）は開始（早）以降にしてください');
  });

  it('シートがあるのに必須の列が無ければ止める（訪問の種類・パターンの列も）', async () => {
    const d = varied();
    const msg = fail(
      await editAndImport(d, (wb) => {
        const pws = sheet(wb, '定期パターン');
        pws.spliceColumns(col(pws, '間隔'), 1);
        const vws = sheet(wb, '訪問');
        vws.spliceColumns(col(vws, '元の日'), 1);
      }),
    );
    expect(msg).toContain('シート『定期パターン』：『間隔』の列がありません');
    expect(msg).toContain('シート『訪問』：『元の日』の列がありません');
  });
});

describe('〈利用者さん〉の仮押さえの列（ADR-0012 追記。段階3）', () => {
  const withTentative = (d: DemoData): DemoData => ({
    ...d,
    // 仮押さえは利用中の前の段階だけ（ADR-0015）
    clients: d.clients.map((c, i) => (i % 3 === 0 ? { ...c, tentative: true, stage: 'inquiry' as const } : c)),
  });
  it('仮押さえが 書き出し → 読み込み で同じに戻る（列は「利用中」の次）', async () => {
    const d = withTentative(base());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toBuffer(d));
    const ws = sheet(wb, personSheetNames(d.org.terms).client);
    expect(col(ws, '仮押さえ')).toBe(col(ws, '利用中') + 1);
    const r = ok(await importWorkbook(await toBuffer(d), d));
    expect(r.clients.map((c) => c.tentative)).toEqual(d.clients.map((c) => c.tentative));
    expect(r.clients.some((c) => c.tentative)).toBe(true);
    expect(r).toEqual(withoutPlans(d));
  });
  it('「仮押さえ」の列が無いブックは false', async () => {
    const d = withTentative(base());
    const r = ok(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, personSheetNames(d.org.terms).client);
        ws.spliceColumns(col(ws, '仮押さえ'), 1);
      }),
    );
    expect(r.clients).toHaveLength(d.clients.length);
    expect(r.clients.every((c) => c.tentative === false)).toBe(true);
  });
});

describe('〈利用者さん〉のよみの列（PRD D61）', () => {
  const withKana = (d: DemoData): DemoData => ({
    ...d,
    clients: d.clients.map((c, i) => (i % 2 === 0 ? { ...c, kana: `ﾖﾐ よみ${i}` } : { ...c, kana: '' })),
  });
  it('よみが 書き出し → 読み込み で同じに戻る（列は「表示名」の次）', async () => {
    const d = withKana(base());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toBuffer(d));
    const ws = sheet(wb, personSheetNames(d.org.terms).client);
    expect(col(ws, 'よみ')).toBe(col(ws, '表示名') + 1);
    const r = ok(await importWorkbook(await toBuffer(d), d));
    expect(r.clients.map((c) => c.kana)).toEqual(d.clients.map((c) => c.kana));
    expect(r).toEqual(withoutPlans(d));
  });
  it('「よみ」の列が無いブックは空', async () => {
    const d = withKana(base());
    const r = ok(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, personSheetNames(d.org.terms).client);
        ws.spliceColumns(col(ws, 'よみ'), 1);
      }),
    );
    expect(r.clients).toHaveLength(d.clients.length);
    expect(r.clients.every((c) => c.kana === '')).toBe(true);
  });
});

describe('〈利用者さん〉の郵便番号の列（PRD D86。ADR-0016）', () => {
  const withPostal = (d: DemoData): DemoData => ({
    ...d,
    clients: d.clients.map((c, i) => ({
      ...c,
      place: { ...c.place, postalCode: i % 2 === 0 ? `098000${i % 10}` : '' },
    })),
  });
  it('郵便番号が 書き出し → 読み込み で同じに戻る（列は「住所」の前。先頭の0を保つ）', async () => {
    const d = withPostal(base());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toBuffer(d));
    const ws = sheet(wb, personSheetNames(d.org.terms).client);
    expect(col(ws, '郵便番号')).toBe(col(ws, '住所') - 1);
    const r = ok(await importWorkbook(await toBuffer(d), d));
    expect(r.clients.map((c) => c.place.postalCode)).toEqual(d.clients.map((c) => c.place.postalCode));
    expect(r.clients[0]!.place.postalCode).toBe('0980000');
    expect(r).toEqual(withoutPlans(d));
  });
  it('「郵便番号」の列が無いブックは空。ハイフン・全角は7桁に直し、直せない値は行付きで止める', async () => {
    const d = withPostal(base());
    const r = ok(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, personSheetNames(d.org.terms).client);
        ws.spliceColumns(col(ws, '郵便番号'), 1);
      }),
    );
    expect(r.clients.every((c) => c.place.postalCode === '')).toBe(true);
    const fixed = ok(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, personSheetNames(d.org.terms).client);
        ws.getCell(2, col(ws, '郵便番号')).value = '〒９８０－０８１１';
      }),
    );
    expect(fixed.clients[0]!.place.postalCode).toBe('9800811');
    // 数値のセル（先頭の0が落ちた 380000（＝038-0000）・38000 と、7桁の 9800811）は7桁に埋める
    const nums = ok(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, personSheetNames(d.org.terms).client);
        ws.getCell(2, col(ws, '郵便番号')).value = 38000;
        ws.getCell(3, col(ws, '郵便番号')).value = 9800811;
        ws.getCell(4, col(ws, '郵便番号')).value = 380000;
      }),
    );
    expect(nums.clients[0]!.place.postalCode).toBe('0038000');
    expect(nums.clients[1]!.place.postalCode).toBe('9800811');
    expect(nums.clients[2]!.place.postalCode).toBe('0380000');
    const msg = fail(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, personSheetNames(d.org.terms).client);
        ws.getCell(3, col(ws, '郵便番号')).value = '980-081';
      }),
    );
    expect(msg).toContain('3行目・『郵便番号』');
  });
});

describe('第N曜日・曜日ごとの時刻・決まりごと・〈利用者さん〉の休み（ADR-0013）', () => {
  const rich = (): DemoData => {
    const d = base();
    const c0 = d.clients[0]!;
    return {
      ...d,
      patterns: [
        {
          ...d.patterns[0]!,
          weekdays: [1, 4],
          repeat: 'monthly',
          monthWeeks: [3, 4],
          windowKind: 'window',
          earliestStart: '15:00',
          latestStart: '15:30',
          dayTimes: [{ weekday: 1, earliestStart: '09:30', latestStart: '10:00' }],
        },
        {
          ...d.patterns[1]!,
          dayTimes: [{ weekday: d.patterns[1]!.weekdays[0]!, earliestStart: '08:30', latestStart: '08:30' }],
        },
        ...d.patterns.slice(2),
      ],
      clients: d.clients.map((c, i) => (i === 0 ? { ...c, entryNote: '裏口から、ノック2回', cautionNote: '段差' } : c)),
      clientLeaves: [
        { id: 'l1', clientId: c0.id, from: '2026-10-20', to: '2026-10-22', note: '入院' },
        { id: 'l2', clientId: d.clients[1]!.id, from: '2026-10-25', to: '2026-10-25', note: '' },
      ],
    };
  };

  it('書き出し → 読み込みで同じに戻る（毎月の第N週・曜日ごとの時刻・決まりごと・休み）', async () => {
    const d = rich();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toBuffer(d));
    const pws = sheet(wb, '定期パターン');
    expect(pws.getRow(2).getCell(col(pws, '間隔')).value).toBe('毎月');
    expect(pws.getRow(2).getCell(col(pws, '第N週')).value).toBe('3、4');
    expect(pws.getRow(2).getCell(col(pws, '曜日ごとの時刻')).value).toBe('月 9:30〜10:00');
    expect(sheet(wb, '訪問先の休み').getRow(2).values).toContain('入院');
    expect(ok(await importWorkbook(await toBuffer(d), d))).toEqual(withoutPlans(d));
  });

  it('列・シートが無い古いブックは毎週系・上書きなし・決まりごとは空・休みなし', async () => {
    const d = base();
    const r = ok(
      await editAndImport(d, (wb) => {
        wb.removeWorksheet(sheet(wb, '訪問先の休み').id);
        const pws = sheet(wb, '定期パターン');
        for (const h of ['曜日ごとの時刻', '第N週']) pws.spliceColumns(col(pws, h), 1);
        const cws = sheet(wb, d.org.terms.client);
        for (const h of ['注意', '駐車場', '鍵', '入り方']) cws.spliceColumns(col(cws, h), 1);
      }),
    );
    expect(r.clientLeaves).toEqual([]);
    expect(r.patterns).toEqual(d.patterns);
    expect(
      r.clients.every((c) => c.entryNote === '' && c.keyNote === '' && c.parkingNote === '' && c.cautionNote === ''),
    ).toBe(true);
  });

  it('「毎月」で第N週が空・読めない第N週・読めない曜日ごとの時刻・曜日に無い曜日の時刻・休みの終了日が開始日より前・いない〈利用者さん〉の休みは止める', async () => {
    const d = rich();
    const msg = fail(
      await editAndImport(d, (wb) => {
        const pws = sheet(wb, '定期パターン');
        pws.getRow(2).getCell(col(pws, '第N週')).value = null;
        pws.getRow(3).getCell(col(pws, '間隔')).value = '毎月';
        pws.getRow(3).getCell(col(pws, '第N週')).value = '第6';
        pws.getRow(4).getCell(col(pws, '曜日ごとの時刻')).value = '月曜の朝';
        pws.getRow(5).getCell(col(pws, '曜日')).value = '月';
        pws.getRow(5).getCell(col(pws, '曜日ごとの時刻')).value = '木 9:00';
      }),
    );
    expect(msg).toContain('シート『定期パターン』の 2行目・『第N週』：間隔が「毎月」のときは');
    expect(msg).toContain('シート『定期パターン』の 3行目・『第N週』：');
    expect(msg).toContain('シート『定期パターン』の 4行目・『曜日ごとの時刻』：「月曜の朝」は');
    expect(msg).toContain('シート『定期パターン』の 5行目・『曜日ごとの時刻』：「曜日」の列に無い曜日の時刻があります');
    const msg2 = fail(
      await editAndImport(d, (wb) => {
        const lws = sheet(wb, '訪問先の休み');
        lws.getRow(2).getCell(col(lws, '終了日')).value = '2026-10-01';
        lws.getRow(3).getCell(col(lws, d.org.terms.client)).value = 'いない人';
      }),
    );
    expect(msg2).toContain('シート『訪問先の休み』の 2行目・『終了日』：終了日は開始日以降にしてください');
    expect(msg2).toContain('シート『訪問先の休み』の 3行目・');
  });
});

describe('〈利用者さん〉の担当できる人の列（ADR-0014）', () => {
  const withLimit = (d: DemoData): DemoData => ({
    ...d,
    clients: d.clients.map((c, i) =>
      i === 0
        ? { ...c, allowedStaffIds: [d.staff[1]!.id, d.staff[0]!.id] }
        : i === 3
          ? { ...c, allowedStaffIds: [d.staff[2]!.id] }
          : c,
    ),
  });
  it('担当できる人が 書き出し → 読み込み で同じに戻る（列は「経度」の次、名前を「、」で区切る）', async () => {
    const d = withLimit(base());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toBuffer(d));
    const ws = sheet(wb, personSheetNames(d.org.terms).client);
    expect(col(ws, '担当できる人')).toBe(col(ws, '経度') + 1);
    expect(ws.getRow(2).getCell(col(ws, '担当できる人')).value).toBe(`${d.staff[1]!.name}、${d.staff[0]!.name}`);
    const r = ok(await importWorkbook(await toBuffer(d), d));
    expect(r.clients.map((c) => c.allowedStaffIds)).toEqual(d.clients.map((c) => c.allowedStaffIds));
    expect(r).toEqual(withoutPlans(d));
  });
  it('「担当できる人」の列が無い古いブックは限らない', async () => {
    const d = withLimit(base());
    const r = ok(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, personSheetNames(d.org.terms).client);
        ws.spliceColumns(col(ws, '担当できる人'), 1);
      }),
    );
    expect(r.clients.every((c) => c.allowedStaffIds.length === 0)).toBe(true);
  });
  it('いない〈スタッフ〉の名前はシート名と行番号付きで止める。同じ名前の重なりは1人', async () => {
    const d = base();
    const names = personSheetNames(d.org.terms);
    const msg = fail(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, names.client);
        ws.getRow(2).getCell(col(ws, '担当できる人')).value = `${d.staff[0]!.name}、だれか`;
      }),
    );
    expect(msg).toContain(`シート『${names.client}』の 2行目・『担当できる人』：「だれか」という`);
    const r = ok(
      await editAndImport(d, (wb) => {
        const ws = sheet(wb, names.client);
        ws.getRow(2).getCell(col(ws, '担当できる人')).value = `${d.staff[0]!.name}\n${d.staff[0]!.name}`;
      }),
    );
    expect(r.clients[0]!.allowedStaffIds).toEqual([d.staff[0]!.id]);
  });
});

describe('最終勤務日・段階・紹介元・当日キャンセル・拘束の上限・稼働の見込み（ADR-0015）', () => {
  const withNew = (d: DemoData): DemoData => ({
    ...d,
    org: { ...d.org, spanLimitHours: 8.5 },
    staff: d.staff.map((s, i) => (i === 0 ? { ...s, lastDay: '2026-10-31' } : s)),
    clients: d.clients.map((c, i) =>
      i === 0
        ? { ...c, stage: 'meeting' as const, active: true, tentative: true }
        : i === 1
          ? {
              ...c,
              stage: 'ended' as const,
              active: false,
              referrer: { name: '相談室（架空）', contact: '000', note: '返事待ち', email: '' },
            }
          : c,
    ),
    visits: d.visits.map((v, i) =>
      i === 0 ? { ...v, cancelled: true, cancelKind: 'sameDay' as const } : i === 1 ? { ...v, cancelled: true } : v,
    ),
  });

  it('書き出し → 読み込み で同じに戻る', async () => {
    const d = withNew(base());
    const r = ok(await importWorkbook(await toBuffer(d), d));
    expect(r).toEqual(withoutPlans(d));
    expect(r.visits[0]!.cancelKind).toBe('sameDay');
    expect(r.visits[1]!.cancelKind).toBeNull();
  });

  it('列・行の無い古いブックは、最終勤務日なし・利用中と仮押さえから段階・ふつうの取り消し・上限10時間', async () => {
    const d = withNew(base());
    const r = ok(
      await editAndImport(d, (wb) => {
        const names = personSheetNames(d.org.terms);
        const sws = sheet(wb, names.staff);
        sws.spliceColumns(col(sws, '最終勤務日'), 1);
        const cws = sheet(wb, names.client);
        for (const h of ['段階', '紹介元', '紹介元の連絡先', '紹介元のメモ']) cws.spliceColumns(col(cws, h), 1);
        const vws = sheet(wb, '訪問');
        vws.spliceColumns(col(vws, '当日キャンセル'), 1);
        const ows = sheet(wb, '事業所');
        for (let n = ows.rowCount; n >= 2; n--)
          if (ows.getRow(n).getCell(1).value === '拘束の上限（時間）') ows.spliceRows(n, 1);
      }),
    );
    expect(r.staff.every((s) => s.lastDay === null)).toBe(true);
    // 仮押さえ（利用中の前）は相談受付、利用中でない人は終了
    expect([r.clients[0]!.stage, r.clients[0]!.tentative, r.clients[0]!.active]).toEqual(['inquiry', true, true]);
    expect(r.clients[1]!.stage).toBe('ended');
    expect(r.clients[1]!.referrer.name).toBe('');
    expect(r.visits[0]!.cancelKind).toBeNull();
    expect(r.org.spanLimitHours).toBe(10);
  });

  it('知らない段階・取り消していない訪問の当日キャンセルは場所付きで止める', async () => {
    const d = base();
    const stage = fail(
      await editAndImport(d, (wb) => {
        const cws = sheet(wb, personSheetNames(d.org.terms).client);
        cws.getRow(2).getCell(col(cws, '段階')).value = '休止';
      }),
    );
    expect(stage).toContain('2行目・『段階』');
    const sameDay = fail(
      await editAndImport(d, (wb) => {
        const vws = sheet(wb, '訪問');
        vws.getRow(2).getCell(col(vws, '当日キャンセル')).value = '○';
      }),
    );
    expect(sameDay).toContain('2行目・『当日キャンセル』');
  });

  it('「稼働の見込み」のシートは担当を組んだ日の〈スタッフ〉ごとの行（読み込みでは見ない）', async () => {
    const d = base();
    const day = d.baseDate;
    const on = visitsOn(d, day).filter((v) => !v.cancelled);
    const withPlan: DemoData = {
      ...d,
      visits: on.map((v, i) => (i < 3 ? { ...v, staffId: 's1' } : { ...v, staffId: null, start: null, pinned: false })),
      snapshots: { [day]: { date: day, at: 1, visits: [] } },
    };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toBuffer(withPlan));
    const ws = sheet(wb, '稼働の見込み');
    expect(ws.getRow(1).getCell(1).value).toBe('日付');
    expect(ws.getRow(2).getCell(1).value).toBe(day);
    expect(ws.getRow(2).getCell(3).value).toBe('○');
    expect(ws.getRow(2).getCell(4).value).toBe(3);
    expect(ws.getRow(3).getCell(1).value).toBeNull();
    const r = ok(await importWorkbook(await toBuffer(withPlan), d));
    expect(r).toEqual({ ...withPlan, snapshots: d.snapshots });
  });
});

describe('〈スタッフ〉のアイコンの列（PRD D299。ADR-0050）', () => {
  it('〈スタッフ〉のシートは最終勤務日・アイコンの列が文字列の書式で、メールアドレスの列は前のまま付けない', async () => {
    const d = base();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toBuffer(d));
    const ws = sheet(wb, personSheetNames(d.org.terms).staff);
    const fmt = (h: string) => ws.getRow(2).getCell(col(ws, h)).numFmt;
    expect(fmt('アイコン')).toBe('@');
    expect(fmt('最終勤務日')).toBe('@');
    expect(fmt('ID')).toBe('@');
    expect(fmt('メールアドレス')).not.toBe('@');
  });

  it('書き出し → 読み込み で同じに戻り、列の無い古いブックは未設定。2文字を超えれば行付きで止める', async () => {
    const d = base();
    d.staff[0] = { ...d.staff[0]!, icon: '訪' };
    d.staff[1] = { ...d.staff[1]!, icon: '🌸' };
    const r = ok(await importWorkbook(await toBuffer(d), d));
    expect(r.staff.map((s) => s.icon)).toEqual(d.staff.map((s) => s.icon));
    const names = personSheetNames(d.org.terms);
    const old = ok(
      await editAndImport(d, (wb) => {
        const sws = sheet(wb, names.staff);
        sws.spliceColumns(col(sws, 'アイコン'), 1);
      }),
    );
    expect(old.staff.every((s) => s.icon === '')).toBe(true);
    const msg = fail(
      await editAndImport(d, (wb) => {
        const sws = sheet(wb, names.staff);
        sws.getCell(3, col(sws, 'アイコン')).value = '訪問者';
      }),
    );
    expect(msg).toContain('3行目・『アイコン』');
    // 32コード単位を超える値も行付きで止める（引用はサロゲートの途中で切らない）
    const long = fail(
      await editAndImport(d, (wb) => {
        const sws = sheet(wb, names.staff);
        sws.getCell(2, col(sws, 'アイコン')).value = '𠮷'.repeat(30);
      }),
    );
    expect(long).toContain('2行目・『アイコン』');
    expect(long).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('メールアドレスの列（PRD D91。ADR-0017）', () => {
  it('〈スタッフ〉と紹介元のメールアドレスが 書き出し → 読み込み で同じに戻る', async () => {
    const d = base();
    expect(d.staff.some((s) => s.email !== '')).toBe(true);
    expect(d.clients.some((c) => c.referrer.email !== '')).toBe(true);
    const r = ok(await importWorkbook(await toBuffer(d), d));
    expect(r.staff.map((s) => s.email)).toEqual(d.staff.map((s) => s.email));
    expect(r.clients.map((c) => c.referrer.email)).toEqual(d.clients.map((c) => c.referrer.email));
  });

  it('列の無い古いブックは空。全角・前後の空白は直し、形の合わない値は行付きで止める', async () => {
    const d = base();
    const names = personSheetNames(d.org.terms);
    const old = ok(
      await editAndImport(d, (wb) => {
        const sws = sheet(wb, names.staff);
        sws.spliceColumns(col(sws, 'メールアドレス'), 1);
        const cws = sheet(wb, names.client);
        cws.spliceColumns(col(cws, '紹介元のメールアドレス'), 1);
      }),
    );
    expect(old.staff.every((s) => s.email === '')).toBe(true);
    expect(old.clients.every((c) => c.referrer.email === '')).toBe(true);
    const fixed = ok(
      await editAndImport(d, (wb) => {
        const sws = sheet(wb, names.staff);
        sws.getCell(2, col(sws, 'メールアドレス')).value = ' ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏｍ ';
        // Excel が自動で付けるリンク（mailto:）も読む
        sws.getCell(3, col(sws, 'メールアドレス')).value = {
          text: 'hana@example.com',
          hyperlink: 'mailto:hana@example.com',
        };
      }),
    );
    expect(fixed.staff[0]!.email).toBe('taro@example.com');
    expect(fixed.staff[1]!.email).toBe('hana@example.com');
    const msg = fail(
      await editAndImport(d, (wb) => {
        const cws = sheet(wb, names.client);
        cws.getCell(3, col(cws, '紹介元のメールアドレス')).value = 'あおば相談室';
      }),
    );
    expect(msg).toContain('3行目・『紹介元のメールアドレス』');
  });
});

describe('リンクのセルの読み方（prim。ADR-0017）', () => {
  it('表示が文字ならそれ、リッチテキストなら連結、無ければ mailto: 以降', () => {
    expect(prim({ text: 'a@example.com', hyperlink: 'mailto:a@example.com' })).toBe('a@example.com');
    expect(
      prim({
        text: { richText: [{ text: 'hana' }, { text: '@example.com' }] },
        hyperlink: 'mailto:hana@example.com',
      } as unknown as ExcelJS.CellValue),
    ).toBe('hana@example.com');
    expect(prim({ text: '', hyperlink: 'mailto:taro%2Bx@example.com?subject=x' })).toBe('taro+x@example.com');
    expect(prim({ text: '', hyperlink: 'https://example.com/' })).toBeNull();
  });

  it('表示がリッチテキストのリンクのセルも、ブックから読める', async () => {
    const d = base();
    const names = personSheetNames(d.org.terms);
    const r = ok(
      await editAndImport(d, (wb) => {
        const sws = sheet(wb, names.staff);
        sws.getCell(2, col(sws, 'メールアドレス')).value = {
          text: { richText: [{ text: 'rich' }, { text: '@example.com' }] },
          hyperlink: 'mailto:rich@example.com',
        } as unknown as ExcelJS.CellValue;
      }),
    );
    expect(r.staff[0]!.email).toBe('rich@example.com');
  });
});

describe('名簿のブック（PRD D103〜D107。ADR-0020）', () => {
  /** 名簿のブックを書き出し、ExcelJS で直してから名簿として読み込む */
  async function editRoster(
    d: DemoData,
    kind: RosterKind,
    fn: (ws: ExcelJS.Worksheet) => void,
    mode: RosterMode = 'merge',
  ): Promise<RosterImportResult | ImportError> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await (await exportRosterWorkbook(d, kind)).arrayBuffer());
    fn(sheet(wb, personSheetNames(d.org.terms)[kind]));
    return importRoster((await wb.xlsx.writeBuffer()) as ArrayBuffer, d, kind, mode);
  }
  const rok = (r: RosterImportResult | ImportError): RosterImportResult => {
    if ('code' in r) throw new Error(`読み込めなかった：${r.message}`);
    return r;
  };
  const rfail = (r: RosterImportResult | ImportError): string => {
    if (!('code' in r)) throw new Error('エラーになるはずが読み込めた');
    return r.message;
  };
  /** 表示名の行の番号 */
  const rowOf = (ws: ExcelJS.Worksheet, header: string, name: string): number => {
    const c = col(ws, header);
    for (let n = 2; n <= ws.rowCount; n++) if (ws.getRow(n).getCell(c).value === name) return n;
    throw new Error(`${name} の行がない`);
  };
  /** 案・記録・確定した割当の入ったデータ */
  const withPlans = (): DemoData => {
    const d = base();
    const v = d.visits.find((x) => x.date === d.baseDate && !x.cancelled);
    if (!v) throw new Error('訪問がない');
    const routes = { s1: [v.id] };
    return ok(
      migrate({
        ...d,
        manualPlans: { [d.baseDate]: routes },
        aiPlans: {
          [d.baseDate]: {
            date: d.baseDate,
            createdAt: 0,
            seed: 1,
            iterations: 10,
            routes,
            unassigned: [],
            score: 0,
            stopped: false,
            rules: d.rules,
            generated: { routes, unassigned: [], score: 0 },
            pins: {},
          },
        },
      }),
    );
  };

  it('名簿のブックはその人のシート1枚だけで、全体のブックの同じシートと同じ列', async () => {
    const d = base();
    const names = personSheetNames(d.org.terms);
    for (const kind of ['client', 'staff'] as const) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await (await exportRosterWorkbook(d, kind)).arrayBuffer());
      expect(wb.worksheets.map((w) => w.name)).toEqual([names[kind]]);
      const full = new ExcelJS.Workbook();
      await full.xlsx.load(await toBuffer(d));
      expect(sheet(wb, names[kind]).getRow(1).values).toEqual(sheet(full, names[kind]).getRow(1).values);
    }
  });

  it('書き出し → 読み込みで変わらない（すべて変更なし。データも同じ）', async () => {
    const d = withPlans();
    for (const kind of ['client', 'staff'] as const) {
      const r = rok(await importRoster(await (await exportRosterWorkbook(d, kind)).arrayBuffer(), d, kind, 'merge'));
      expect(r.added).toEqual([]);
      expect(r.updated).toEqual([]);
      expect(r.retired).toEqual([]);
      expect(r.unchanged).toBe(kind === 'client' ? d.clients.length : d.staff.length);
      expect(r.data).toEqual(d);
      expect(rosterSummary(r, kind, d.org.terms)).toContain('変更なし');
    }
  });

  it('全体のブックの〈利用者さん〉シートも名簿として読める', async () => {
    const d = base();
    const r = rok(await importRoster(await toBuffer(d), d, 'client', 'merge'));
    expect(r.unchanged).toBe(d.clients.length);
    expect(r.data).toEqual(d);
  });

  it('ID が空で知らない名前の行は新しい人として足す（列の無い値は既定値）', async () => {
    const d = base();
    const r = rok(
      await editRoster(d, 'client', (ws) => {
        const row = ws.getRow(d.clients.length + 2);
        row.getCell(col(ws, '表示名')).value = '新しい 花子';
        row.getCell(col(ws, '色（1〜8）')).value = 3;
        row.getCell(col(ws, '段階')).value = '利用中';
      }),
    );
    expect(r.added).toEqual(['新しい 花子']);
    expect(r.updated).toEqual([]);
    const c = r.data.clients.at(-1);
    expect(c?.displayName).toBe('新しい 花子');
    expect(c?.color).toBe(2);
    expect(c?.stage).toBe('active');
    expect(c?.active).toBe(true);
    expect(d.clients.some((x) => x.id === c?.id)).toBe(false);
    expect(r.data.clients.slice(0, -1)).toEqual(d.clients);
  });

  it('ID が入っていれば ID で突き合わせて更新する（名前も変えられる。無い ID はその ID で足す）', async () => {
    const d = base();
    const target = d.clients[0];
    if (!target) throw new Error('利用者さんがいない');
    const r = rok(
      await editRoster(d, 'client', (ws) => {
        const n = rowOf(ws, '表示名', target.displayName);
        ws.getRow(n).getCell(col(ws, '表示名')).value = '改名 ふみ';
        ws.getRow(n).getCell(col(ws, 'メモ')).value = '名前を変えた';
        const row = ws.getRow(d.clients.length + 2);
        row.getCell(col(ws, 'ID')).value = 'c-new';
        row.getCell(col(ws, '表示名')).value = 'ID つき 新人';
        row.getCell(col(ws, '色（1〜8）')).value = 1;
        row.getCell(col(ws, '段階')).value = '相談受付';
      }),
    );
    expect(r.updated).toEqual(['改名 ふみ']);
    // 利用中でない人は段階を添える
    expect(r.added).toEqual(['ID つき 新人（相談受付）']);
    const c = r.data.clients.find((x) => x.id === target.id);
    expect(c?.displayName).toBe('改名 ふみ');
    expect(c?.note).toBe('名前を変えた');
    expect(r.data.clients.find((x) => x.id === 'c-new')?.stage).toBe('inquiry');
    // 予約語・ほかのデータの ID は止める
    const msg = rfail(
      await editRoster(d, 'client', (ws) => {
        ws.getRow(2).getCell(col(ws, 'ID')).value = '__proto__';
        ws.getRow(3).getCell(col(ws, 'ID')).value = d.staff[0]?.id ?? '';
      }),
    );
    expect(msg).toContain('「__proto__」は ID に使えません');
    expect(msg).toContain('ほかのデータで使われています');
  });

  it('ID が空なら名前（全角半角・空白の違いは同じ）で突き合わせて更新する', async () => {
    const d = base();
    const s = d.staff[1];
    if (!s) throw new Error('スタッフがいない');
    const r = rok(
      await editRoster(d, 'staff', (ws) => {
        const n = rowOf(ws, '名前', s.name);
        ws.getRow(n).getCell(col(ws, 'ID')).value = null;
        ws.getRow(n).getCell(col(ws, '名前')).value = `　${s.name.replace(' ', '　')}`;
        ws.getRow(n).getCell(col(ws, '勤務開始')).value = '10:00';
      }),
    );
    expect(r.updated).toHaveLength(1);
    expect(r.added).toEqual([]);
    const got = r.data.staff.find((x) => x.id === s.id);
    expect(got?.shiftStart).toBe('10:00');
    expect(r.data.staff).toHaveLength(d.staff.length);
  });

  it('ブックに無い列は今の値のまま', async () => {
    const d = base();
    const c0 = d.clients[0];
    if (!c0) throw new Error('利用者さんがいない');
    const trait = d.items.find((i) => i.target === 'client');
    const data: DemoData = {
      ...d,
      clients: d.clients.map((c, i) => (i === 0 ? { ...c, keyNote: '鍵は玄関の箱' } : c)),
    };
    const r = rok(
      await editRoster(data, 'client', (ws) => {
        ws.spliceColumns(col(ws, '鍵'), 1);
        ws.spliceColumns(col(ws, `特性：${trait?.name}`), 1);
        ws.getRow(rowOf(ws, '表示名', c0.displayName)).getCell(col(ws, 'メモ')).value = '直した';
      }),
    );
    const c = r.data.clients[0];
    expect(c?.keyNote).toBe('鍵は玄関の箱');
    expect(c?.traits).toEqual(c0.traits);
    expect(c?.note).toBe('直した');
    expect(r.updated).toEqual([c0.displayName]);
  });

  it('いない〈スタッフ〉の名前・知らない特性の列は、シート・行・列付きのエラー', async () => {
    const d = base();
    const msg = rfail(
      await editRoster(d, 'client', (ws) => {
        ws.getRow(3).getCell(col(ws, '担当できる人')).value = `${d.staff[0]?.name}、だれか`;
      }),
    );
    expect(msg).toContain('シート『利用者さん』の 3行目・『担当できる人』：「だれか」');
    const msg2 = rfail(
      await editRoster(d, 'staff', (ws) => {
        ws.getRow(1).getCell(ws.columnCount + 1).value = '特性：知らない項目';
      }),
    );
    expect(msg2).toContain('見出し『特性：知らない項目』の項目が');
  });

  it('ブックの中の同じ名前・同じ ID、当てたあとに他の人と重なる名前は止める', async () => {
    const d = base();
    const [a, b] = d.staff;
    if (!a || !b) throw new Error('スタッフがいない');
    const dupName = rfail(
      await editRoster(d, 'staff', (ws) => {
        ws.getRow(rowOf(ws, '名前', b.name)).getCell(col(ws, '名前')).value = a.name;
      }),
    );
    expect(dupName).toContain('重なっています');
    const dupId = rfail(
      await editRoster(d, 'staff', (ws) => {
        ws.getRow(rowOf(ws, '名前', b.name)).getCell(col(ws, 'ID')).value = a.id;
      }),
    );
    expect(dupId).toContain(`ID「${a.id}」が`);
    // ブックに無い人の名前に変えると重なる
    const clash = rfail(
      await editRoster(d, 'staff', (ws) => {
        ws.spliceRows(rowOf(ws, '名前', a.name), 1);
        ws.getRow(rowOf(ws, '名前', b.name)).getCell(col(ws, '名前')).value = a.name;
      }),
    );
    expect(clash).toContain(`いまのスタッフの「${a.name}」と名前が重なります`);
    // 人の行が無いブックは止める（総入れ替えで全員を休止にしない）
    const empty = rfail(
      await editRoster(
        d,
        'staff',
        (ws) => {
          for (let n = 2; n <= ws.rowCount; n++) ws.getRow(n).values = [];
        },
        'replace',
      ),
    );
    expect(empty).toContain('スタッフの行がありません');
  });

  it('総入れ替え：ブックに無い〈利用者さん〉は終了、〈スタッフ〉は休止（消さない。既に終了・休止の人はそのまま）', async () => {
    const d0 = withPlans();
    const [c1, c2, c3] = d0.clients;
    const [s1, s2, s3] = d0.staff;
    if (!c1 || !c2 || !c3 || !s1 || !s2 || !s3) throw new Error('人がいない');
    const d = ok(
      migrate({
        ...d0,
        clients: d0.clients.map((c) => (c.id === c3.id ? { ...c, stage: 'ended' } : c)),
        staff: d0.staff.map((s) => (s.id === s3.id ? { ...s, active: false } : s)),
        compat: { ...d0.compat, [c1.id]: { [s2.id]: 2 } },
      }),
    );
    const rc = rok(
      await editRoster(
        d,
        'client',
        (ws) => {
          for (const c of [c1, c2, c3]) ws.spliceRows(rowOf(ws, '表示名', c.displayName), 1);
        },
        'replace',
      ),
    );
    expect(rc.retired).toEqual([c1.displayName, c2.displayName]);
    expect(rc.data.clients).toHaveLength(d.clients.length);
    expect(rc.data.clients.find((c) => c.id === c1.id)).toMatchObject({ stage: 'ended', active: false });
    expect(rc.data.clients.find((c) => c.id === c3.id)).toEqual(d.clients.find((c) => c.id === c3.id));
    expect(rosterSummary(rc, 'client', d.org.terms)).toContain(
      `終了にする 2人（${c1.displayName}・${c2.displayName}）`,
    );
    // 伝えた内容・訪問・パターン・相性は残る（その人を指すものも）
    expect(rc.data.snapshots).toEqual(d.snapshots);
    expect(rc.data.visits).toEqual(d.visits);
    expect(rc.data.patterns).toEqual(d.patterns);
    expect(rc.data.compat).toEqual(d.compat);

    const rs = rok(
      await editRoster(
        d,
        'staff',
        (ws) => {
          for (const s of [s1, s2, s3]) ws.spliceRows(rowOf(ws, '名前', s.name), 1);
        },
        'replace',
      ),
    );
    expect(rs.retired).toEqual([s1.name, s2.name]);
    expect(rs.data.staff.find((s) => s.id === s1.id)?.active).toBe(false);
    expect(rs.data.staff).toHaveLength(d.staff.length);
    expect(rs.data.snapshots).toEqual(d.snapshots);
    expect(rs.data.visits).toEqual(d.visits);
    expect(rosterSummary(rs, 'staff', d.org.terms)).toContain('休止にする 2人');

    // 追加・更新（既定）では、ブックに無い人はそのまま
    const rm = rok(
      await editRoster(d, 'staff', (ws) => {
        ws.spliceRows(rowOf(ws, '名前', s1.name), 1);
      }),
    );
    expect(rm.retired).toEqual([]);
    expect(rm.data).toEqual(d);
  });

  it('休止にする〈スタッフ〉は担当できる人から外れ、全員いなくなれば限らないに戻る。確認の文に名前を出す', async () => {
    const d0 = base();
    const [s1, s2] = d0.staff;
    const [c1, c2] = d0.clients;
    if (!s1 || !s2 || !c1 || !c2) throw new Error('人がいない');
    const d = ok(
      migrate({
        ...d0,
        clients: d0.clients.map((c) =>
          c.id === c1.id
            ? { ...c, allowedStaffIds: [s1.id, s2.id] }
            : c.id === c2.id
              ? { ...c, allowedStaffIds: [s1.id] }
              : c,
        ),
      }),
    );
    const check = (r: RosterImportResult) => {
      expect(r.allowedRemoved).toEqual([c1.displayName, c2.displayName]);
      expect(r.allowedEmptied).toEqual([c2.displayName]);
      expect(r.data.clients.find((c) => c.id === c1.id)?.allowedStaffIds).toEqual([s2.id]);
      expect(r.data.clients.find((c) => c.id === c2.id)?.allowedStaffIds).toEqual([]);
      const text = rosterSummary(r, 'staff', d.org.terms);
      expect(text).toContain(`${c1.displayName}・${c2.displayName}の「担当できる人」から外します`);
      expect(text).toContain(`${c2.displayName}は担当できる人がいなくなり、だれでも担当できるようになります`);
      expect(text).toContain('あとで利用中に戻しても、担当できる人には戻りません');
    };
    // 総入れ替えでブックに無い人を休止にしたとき
    check(
      rok(
        await editRoster(
          d,
          'staff',
          (ws) => {
            ws.spliceRows(rowOf(ws, '名前', s1.name), 1);
          },
          'replace',
        ),
      ),
    );
    // 追加・更新で「利用中」を空にしたとき
    check(
      rok(
        await editRoster(d, 'staff', (ws) => {
          ws.getRow(rowOf(ws, '名前', s1.name)).getCell(col(ws, '利用中')).value = null;
        }),
      ),
    );
  });

  it('担当できる人に休止中の〈スタッフ〉を書いても、データが変わらなければ「変更なし」', async () => {
    const d0 = base();
    const s3 = d0.staff[2];
    const c1 = d0.clients[0];
    if (!s3 || !c1) throw new Error('人がいない');
    const d = ok(migrate({ ...d0, staff: d0.staff.map((s) => (s.id === s3.id ? { ...s, active: false } : s)) }));
    const r = rok(
      await editRoster(d, 'client', (ws) => {
        ws.getRow(rowOf(ws, '表示名', c1.displayName)).getCell(col(ws, '担当できる人')).value = s3.name;
      }),
    );
    expect(r.updated).toEqual([]);
    expect(r.unchanged).toBe(d.clients.length);
    expect(r.data).toEqual(d);
  });

  it('新しい人で段階・利用中・仮押さえが空なら利用中（〈スタッフ〉は利用中が空なら利用中）。利用中でない人は段階を添える', async () => {
    const d = base();
    const rc = rok(
      await editRoster(d, 'client', (ws) => {
        const a = ws.getRow(d.clients.length + 2);
        a.getCell(col(ws, '表示名')).value = '空欄 一郎';
        a.getCell(col(ws, '色（1〜8）')).value = 1;
        const b = ws.getRow(d.clients.length + 3);
        b.getCell(col(ws, '表示名')).value = '終了 二郎';
        b.getCell(col(ws, '色（1〜8）')).value = 2;
        b.getCell(col(ws, '段階')).value = '終了';
      }),
    );
    expect(rc.added).toEqual(['空欄 一郎', '終了 二郎（終了）']);
    expect(rc.data.clients.find((c) => c.displayName === '空欄 一郎')).toMatchObject({ stage: 'active', active: true });
    const rs = rok(
      await editRoster(d, 'staff', (ws) => {
        const row = ws.getRow(d.staff.length + 2);
        row.getCell(col(ws, '名前')).value = '新人 三郎';
        row.getCell(col(ws, '移動手段')).value = ws.getRow(2).getCell(col(ws, '移動手段')).value;
        row.getCell(col(ws, '勤務する曜日')).value = '月水金';
        row.getCell(col(ws, '勤務開始')).value = '9:00';
        row.getCell(col(ws, '勤務終了')).value = '17:00';
      }),
    );
    expect(rs.added).toEqual(['新人 三郎']);
    expect(rs.data.staff.at(-1)?.active).toBe(true);
  });

  it('総入れ替えで今の人の半分を超える人を外すときは、強い注意を出す', async () => {
    const d = base();
    const keep = d.staff.slice(0, 2).map((s) => s.name);
    const many = rok(
      await editRoster(
        d,
        'staff',
        (ws) => {
          for (const s of d.staff.slice(2)) ws.spliceRows(rowOf(ws, '名前', s.name), 1);
        },
        'replace',
      ),
    );
    expect(many.retired).toHaveLength(d.staff.length - keep.length);
    expect(rosterWarning(many, 'staff', d.org.terms)).toBe(
      `注意：スタッフの半分を超える ${d.staff.length - 2}人を休止にします。ファイルを取り違えていないか確かめてください。`,
    );
    const few = rok(
      await editRoster(
        d,
        'staff',
        (ws) => {
          ws.spliceRows(2, 1);
        },
        'replace',
      ),
    );
    expect(few.retired).toHaveLength(1);
    expect(rosterWarning(few, 'staff', d.org.terms)).toBeNull();
  });

  it('最終勤務日の入った〈スタッフ〉を結果に出す', async () => {
    const d = base();
    const s1 = d.staff[0];
    if (!s1) throw new Error('スタッフがいない');
    const r = rok(
      await editRoster(d, 'staff', (ws) => {
        ws.getRow(rowOf(ws, '名前', s1.name)).getCell(col(ws, '最終勤務日')).value = '2026-10-31';
      }),
    );
    expect(r.lastDaySet).toEqual([s1.name]);
    expect(r.updated).toEqual([s1.name]);
  });

  it('シートが無いブックは、呼び方のシート名を示して止める', async () => {
    const d = base();
    const buf = await (await exportRosterWorkbook(d, 'staff')).arrayBuffer();
    expect(rfail(await importRoster(buf, d, 'client', 'merge'))).toContain('シート『利用者さん』がありません');
  });
});
