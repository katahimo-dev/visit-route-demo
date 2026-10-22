// Excel の「プリセット」シート（ADR-0008）
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { DemoData, ImportError } from '../contracts/data';
import { setBasisWeight } from '../lib/presets';
import { createDemoData, presetOf, scorePresetOf } from '../seed';
import { isImportError } from '../store';
import { exportWorkbook, importWorkbook } from './index';

const base = () => createDemoData('2026-10-13');

async function toBuffer(d: DemoData): Promise<ArrayBuffer> {
  return (await exportWorkbook(d)).arrayBuffer();
}
async function editAndImport(d: DemoData, fn: (wb: ExcelJS.Workbook) => void): Promise<DemoData | ImportError> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await toBuffer(d));
  fn(wb);
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return importWorkbook(buf, d);
}
const col = (ws: ExcelJS.Worksheet, header: string) => {
  for (let c = 1; c <= ws.columnCount; c++) if (ws.getRow(1).getCell(c).value === header) return c;
  throw new Error(`列がない：${header}`);
};

describe('Excel のプリセットのシート', () => {
  it('書き出し → 読み込みでプリセット（名前・一言・重み・必須・ID・並び）が戻る', async () => {
    const d0 = base();
    const d: DemoData = {
      ...d0,
      presets: [
        ...d0.presets,
        {
          id: 'p-mine',
          name: '私の重み',
          note: '',
          weights: {
            ...d0.presets[0]!.weights,
            balance: { weight: 2.5, hard: true },
            wait: { weight: 0, hard: false },
          },
        },
      ],
    };
    const r = await importWorkbook(await toBuffer(d), d);
    if (isImportError(r)) throw new Error(r.message);
    expect(r.presets).toEqual(d.presets);
  });

  it('Excel で直した重み・名前・必須が入り、ID が空の行は新しいプリセット', async () => {
    const d = base();
    const r = await editAndImport(d, (wb) => {
      const ws = wb.getWorksheet('プリセット')!;
      ws.getRow(2).getCell(col(ws, '名前')).value = 'ふだん';
      ws.getRow(2).getCell(col(ws, '重み：待ち時間')).value = 4.5;
      const row = ws.getRow(5);
      row.getCell(col(ws, '名前')).value = '新しい';
      row.getCell(col(ws, '重み：相性')).value = 5;
      row.getCell(col(ws, '必須')).value = '相性、いつもの担当';
      row.commit();
    });
    if (isImportError(r)) throw new Error(r.message);
    expect(r.presets).toHaveLength(4);
    expect(r.presets[0]!.name).toBe('ふだん');
    expect(r.presets[0]!.weights.wait.weight).toBe(4.5);
    const added = r.presets[3]!;
    expect(added.id).not.toBe('');
    expect(added.weights.compatibility).toEqual({ weight: 5, hard: true });
    expect(added.weights.continuity).toEqual({ weight: 0, hard: true });
    expect(added.weights.clientPreference).toEqual({ weight: 0, hard: false });
  });

  it('6つを超える行・0.5刻みでない重み・必須にできない型は場所付きで止める', async () => {
    const d = base();
    const tooMany = await editAndImport(d, (wb) => {
      const ws = wb.getWorksheet('プリセット')!;
      for (let n = 5; n <= 8; n++) ws.getRow(n).getCell(col(ws, '名前')).value = `追加${n}`;
    });
    expect(isImportError(tooMany) && tooMany.message).toContain('6つまで');
    const badWeight = await editAndImport(d, (wb) => {
      const ws = wb.getWorksheet('プリセット')!;
      ws.getRow(3).getCell(col(ws, '重み：相性')).value = 1.3;
    });
    expect(isImportError(badWeight) && badWeight.message).toContain('3行目');
    const badHard = await editAndImport(d, (wb) => {
      const ws = wb.getWorksheet('プリセット')!;
      ws.getRow(2).getCell(col(ws, '必須')).value = '待ち時間';
    });
    expect(isImportError(badHard) && badHard.message).toContain('必須にできません');
  });

  it('シートが無い古いブックは、いまのプリセットのまま', async () => {
    const d0 = base();
    const d = { ...d0, presets: [d0.presets[1]!] };
    const r = await editAndImport(d, (wb) => {
      wb.removeWorksheet(wb.getWorksheet('プリセット')!.id);
    });
    if (isImportError(r)) throw new Error(r.message);
    expect(r.presets).toEqual(d.presets);
  });

  it('点数の基準（ADR-0010）：○ の行が往復し、列が無い・無印なら先頭、○ が2つなら止める', async () => {
    const d = { ...base(), scorePresetId: 'people' };
    const round = await importWorkbook(await toBuffer(d), d);
    if (isImportError(round)) throw new Error(round.message);
    expect(round.scorePresetId).toBe('people');
    const noCol = await editAndImport(d, (wb) => {
      const ws = wb.getWorksheet('プリセット')!;
      ws.spliceColumns(col(ws, '点数の基準'), 1);
    });
    if (isImportError(noCol)) throw new Error(noCol.message);
    expect(noCol.scorePresetId).toBe('standard');
    const blank = await editAndImport(d, (wb) => {
      const ws = wb.getWorksheet('プリセット')!;
      for (let n = 2; n <= 4; n++) ws.getRow(n).getCell(col(ws, '点数の基準')).value = null;
    });
    if (isImportError(blank)) throw new Error(blank.message);
    expect(blank.scorePresetId).toBe('standard');
    const two = await editAndImport(d, (wb) => {
      const ws = wb.getWorksheet('プリセット')!;
      ws.getRow(2).getCell(col(ws, '点数の基準')).value = '○';
    });
    expect(isImportError(two) && two.message).toContain('1行だけ');
  });

  it('シートが無い古いブックは、いまの点数の基準のまま', async () => {
    const d = { ...base(), scorePresetId: 'travel' };
    const r = await editAndImport(d, (wb) => {
      wb.removeWorksheet(wb.getWorksheet('プリセット')!.id);
    });
    if (isImportError(r)) throw new Error(r.message);
    expect(r.scorePresetId).toBe('travel');
  });
});

describe('Excel の条件のシート＝この日だけ試す重み（ADR-0035）', () => {
  it('基準の重みを直したデータは、書き出し → 読み込みで試す重みが基準のまま（「どのプリセットとも違う」案内が出ない）', async () => {
    const d = setBasisWeight(base(), 'wait', { weight: 1 });
    const r = await importWorkbook(await toBuffer(d), base());
    if (isImportError(r)) throw new Error(r.message);
    expect(r.rules).toEqual(d.rules);
    expect(presetOf(r.rules, r.presets)?.id).toBe(scorePresetOf(r.presets, r.scorePresetId)?.id);
  });
  it('条件のシートの重みが基準と違っても、読み込むと基準の重みにそろう（版2は試す重みを持たない。ADR-0053）', async () => {
    const d0 = base();
    const d = { ...d0, rules: d0.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 4.5 } : r)) };
    const r = await importWorkbook(await toBuffer(d), d0);
    if (isImportError(r)) throw new Error(r.message);
    expect(r.rules.find((x) => x.type === 'wait')!.weight).toBe(3);
    expect(scorePresetOf(r.presets, r.scorePresetId)!.weights.wait.weight).toBe(3);
  });
});
