// 機能の入り切り（org.features。PRD D216。ADR-0028）の読み書き：無い古いデータ・初期データ・初期状態に戻す・往復・知らない ID
import { beforeEach, describe, expect, it } from 'vitest';
import { type DemoData, STORAGE_KEY } from '../contracts/data';
import { featuresSchema } from '../contracts/features';
import { applyTemplate } from '../lib/features';
import { createDemoData } from '../seed';
import { exportJson, importJson, isImportError, load, reset } from './index';

/** 環境は node なので localStorage の簡単なモック */
function mockStorage() {
  const m = new Map<string, string>();
  const ls = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
  return m;
}

let mem: Map<string, string>;
beforeEach(() => {
  mem = mockStorage();
});

const ok = (x: ReturnType<typeof importJson>): DemoData => {
  if (isImportError(x)) throw new Error(x.message);
  return x;
};

describe('org.features（PRD D216）', () => {
  it('初期データはすべて入（{}）', () => {
    expect(createDemoData('2026-10-12').org.features).toEqual({});
  });

  it('org.features の無い古いデータは {} で読める（版は1のまま）', () => {
    const d = createDemoData('2026-10-12');
    const { features: _drop, ...oldOrg } = d.org;
    const r = ok(importJson(JSON.stringify({ ...d, org: oldOrg })));
    expect(r.org.features).toEqual({});
    expect(r.version).toBe(1);
  });

  it('知らない ID・真偽でない値は捨て、検査で落とさない', () => {
    const d = createDemoData('2026-10-12');
    const raw = { ...d, org: { ...d.org, features: { compat: false, vacancy: true, oldThing: false, mail: 'no' } } };
    const r = ok(importJson(JSON.stringify(raw)));
    expect(r.org.features).toEqual({ compat: false, vacancy: true });
    expect(featuresSchema.parse({ nope: true })).toEqual({});
  });

  it('features が null・配列・オブジェクトでない値でも、読み込み全体を落とさず {}（すべて入）', () => {
    const d = createDemoData('2026-10-12');
    for (const bad of [null, [], ['compat'], 'all', 0, true]) {
      const r = ok(importJson(JSON.stringify({ ...d, org: { ...d.org, features: bad } })));
      expect(r.org.features, JSON.stringify(bad)).toEqual({});
      expect(r.clients).toEqual(d.clients);
      expect(featuresSchema.parse(bad)).toEqual({});
    }
  });

  it('書き出して読み込むと同じ入り切り', async () => {
    const d = createDemoData('2026-10-12');
    const withF: DemoData = { ...d, org: { ...d.org, features: applyTemplate('laborContract') } };
    const r = ok(importJson(await exportJson(withF).text()));
    expect(r.org.features).toEqual(applyTemplate('laborContract'));
    expect(r).toEqual(withF);
  });

  it('保存して読み直しても同じ。初期状態に戻すと {}', () => {
    const d = createDemoData('2026-10-12');
    mem.set(STORAGE_KEY, JSON.stringify({ ...d, org: { ...d.org, features: { sudden: false } } }));
    expect(load().org.features).toEqual({ sudden: false });
    expect(reset().org.features).toEqual({});
    expect((JSON.parse(mem.get(STORAGE_KEY) ?? '{}') as DemoData).org.features).toEqual({});
  });
});
