import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { DemoData, ImportError } from '../contracts/data';
import type { Condition, Item } from '../contracts/rules';
import { createDemoData } from '../seed';
import { isImportError } from '../store';
import { MAX_FILE_BYTES, MAX_ROWS } from './importBook';
import { exportWorkbook, importWorkbook } from './index';
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

/** seed のデータ（種類・定期パターン入り。ADR-0012） */
const base = (): DemoData => createDemoData('2026-10-13');
const withoutPlans = (d: DemoData): DemoData => ({ ...d, manualPlans: {}, aiPlans: {}, aiRuns: {} });

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
  it('seed のデータは、案を除いて同じデータに戻る（ID・並び順も）', async () => {
    const d = base();
    const r = ok(await importWorkbook(await toBuffer(d), d));
    expect(r).toEqual(withoutPlans(d));
    expect(r.staff.map((s) => s.id)).toEqual(d.staff.map((s) => s.id));
    expect(r.visits.map((v) => v.id)).toEqual(d.visits.map((v) => v.id));
  });

  it('案（手作業の割当・AI案・記録）は消え、版・基準日は base から引き継ぐ', async () => {
    const d = base();
    const withPlans: DemoData = { ...d, manualPlans: { [d.baseDate]: { __none: [] } } };
    const r = ok(await importWorkbook(await toBuffer(withPlans), withPlans));
    expect(r.manualPlans).toEqual({});
    expect(r.aiPlans).toEqual({});
    expect(r.aiRuns).toEqual({});
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
        // 消した人の名前を参照するところは消しておく（いつもの担当・相性の列・稼働時間・訪問の担当）
        const clws = sheet(wb, names.client);
        const usualCol = col(clws, 'いつもの担当');
        for (let n = 2; n <= clws.rowCount; n++) {
          if (clws.getRow(n).getCell(usualCol).value === removed?.name) clws.getRow(n).getCell(usualCol).value = null;
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
            ? { ...v, typeId: 't-extra', pattern: { id: 'pt-extra', date: '2026-10-13', edited: false } }
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

  it('同じ名前の種類、いない種類・利用者さん・スタッフ・パターンの参照はシート名と行番号付きで止める', async () => {
    const d = varied();
    const msg = fail(
      await editAndImport(d, (wb) => {
        const tws = sheet(wb, '種類');
        tws.getRow(3).getCell(col(tws, '名前')).value = tws.getRow(2).getCell(col(tws, '名前')).value;
        const pws = sheet(wb, '定期パターン');
        pws.getRow(2).getCell(col(pws, '種類')).value = 'ない種類';
        pws.getRow(3).getCell(col(pws, d.org.terms.client)).value = 'いない人';
        pws.getRow(4).getCell(col(pws, 'いつもの担当')).value = 'いない担当';
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
    expect(msg).toContain('シート『定期パターン』の 4行目・『いつもの担当』：「いない担当」という');
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
        pws.getRow(4).getCell(col(pws, '間隔')).value = '毎月';
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
      'シート『定期パターン』の 4行目・『間隔』：「毎週」「隔週」「3週ごと」「4週ごと」のどれかで書いてください',
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
    clients: d.clients.map((c, i) => (i % 3 === 0 ? { ...c, tentative: true } : c)),
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
