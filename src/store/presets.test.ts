// プリセット（DemoData.presets。ADR-0008）の移行と repair
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { MAX_PRESETS } from '../contracts/rules';
import { createDemoData, INITIAL_PRESETS } from '../seed';
import { importJson, isImportError, migrate } from './index';
import { repair } from './repair';

const base = () => createDemoData('2026-10-12');

describe('プリセットの移行（版は1のまま）', () => {
  it('presets が無い古い保存データは、初期の3つで補って読める', () => {
    const { presets: _, ...old } = base();
    const r = importJson(JSON.stringify(old));
    if (isImportError(r)) throw new Error(r.message);
    expect(r.version).toBe(1);
    expect(r.presets).toEqual(INITIAL_PRESETS);
  });

  it('weights に無い型は 重み0・必須でない で補う', () => {
    const d = base();
    const { wait: _, ...weights } = d.presets[0]!.weights;
    const r = migrate({ ...d, presets: [{ ...d.presets[0]!, weights }] });
    if (isImportError(r)) throw new Error(r.message);
    expect(r.presets[0]!.weights.wait).toEqual({ weight: 0, hard: false });
  });

  it('名前が空のプリセットは日本語のエラー（元のデータは残す）', () => {
    const d = base();
    const r = migrate({ ...d, presets: [{ ...d.presets[0]!, name: '' }] });
    expect(isImportError(r)).toBe(true);
  });

  it('書き出し → 読み込みで同じプリセット', () => {
    const d = base();
    const r = importJson(JSON.stringify(d));
    if (isImportError(r)) throw new Error(r.message);
    expect(r.presets).toEqual(d.presets);
  });
});

describe('プリセットの repair', () => {
  it('重みは 0〜5・0.5刻みに、必須にできない型の必須は外す', () => {
    const d = base();
    const p = d.presets[0]!;
    const broken: DemoData = {
      ...d,
      presets: [
        {
          ...p,
          weights: {
            ...p.weights,
            compatibility: { weight: 7, hard: false },
            continuity: { weight: -1, hard: false },
            balance: { weight: 1.26, hard: false },
            clientPreference: { weight: Number.NaN, hard: false },
            wait: { weight: 2, hard: true },
          },
        },
      ],
    };
    const w = repair(broken).presets[0]!.weights;
    expect(w.compatibility.weight).toBe(5);
    expect(w.continuity.weight).toBe(0);
    expect(w.balance.weight).toBe(1.5);
    expect(w.clientPreference.weight).toBe(0);
    expect(w.wait).toEqual({ weight: 2, hard: false });
  });

  it(`ID の重複は最初の1件、${MAX_PRESETS}つを超える分は後ろを捨て、0件なら初期の3つ`, () => {
    const d = base();
    const p = d.presets[0]!;
    const many = Array.from({ length: 9 }, (_, i) => ({ ...p, id: `p${i}`, name: `p${i}` }));
    const r = repair({ ...d, presets: [{ ...p, id: 'p0', name: '先' }, ...many] });
    expect(r.presets).toHaveLength(MAX_PRESETS);
    expect(r.presets[0]!.name).toBe('先');
    expect(new Set(r.presets.map((x) => x.id)).size).toBe(MAX_PRESETS);
    expect(repair({ ...d, presets: [] }).presets).toEqual(INITIAL_PRESETS);
  });

  it('食い違いのないプリセットは同じもの（参照も変えない）', () => {
    const d = base();
    expect(repair(d).presets[0]).toBe(d.presets[0]);
  });
});

describe('presets が null の保存データ', () => {
  it('初期の3つで補う', () => {
    const d = base();
    const r = importJson(JSON.stringify({ ...d, presets: null }));
    if (isImportError(r)) throw new Error(r.message);
    expect(r.presets).toEqual(INITIAL_PRESETS);
  });
});

describe('点数の基準のプリセット（scorePresetId。ADR-0010）', () => {
  it('初期データは「標準」', () => {
    expect(base().scorePresetId).toBe('standard');
  });

  it('無い古いデータ・存在しない id は先頭のプリセットにする（版は1のまま）', () => {
    const { scorePresetId: _, ...old } = base();
    const r = migrate(old);
    if (isImportError(r)) throw new Error(r.message);
    expect(r.scorePresetId).toBe(r.presets[0]!.id);
    const d = base();
    const moved = repair({ ...d, presets: [d.presets[1]!, d.presets[0]!], scorePresetId: 'nothing' });
    expect(moved.scorePresetId).toBe('travel');
  });

  it('あるプリセットを指していればそのまま（書き出し → 読み込みで戻る）', () => {
    const d = { ...base(), scorePresetId: 'people' };
    expect(repair(d).scorePresetId).toBe('people');
    const r = importJson(JSON.stringify(d));
    if (isImportError(r)) throw new Error(r.message);
    expect(r.scorePresetId).toBe('people');
  });
});
