import { describe, expect, it } from 'vitest';
import { demoDataSchema } from '../contracts/data';
import { addDays, weekday } from '../domain/time';
import { compile } from '../matching';
import { visitsIn } from '../patterns';
import { visitsOf } from './generate';
import {
  applyPreset,
  createDemoData,
  INITIAL_PRESETS as PRESETS,
  presetOf,
  REHAB_SEEDS,
  rehabPatternId,
} from './index';

const TODAY = '2026-10-12';
/** 14日分の訪問（版2：繰り返しの回は計算する） */
const twoWeeks = (d: ReturnType<typeof createDemoData>, from = TODAY) => visitsIn(d, { from, to: addDays(from, 13) });

describe('createDemoData', () => {
  it('同じ日付なら同じデータ', () => {
    expect(createDemoData(TODAY)).toEqual(createDemoData(TODAY));
  });

  it('契約（demoDataSchema）を通る', () => {
    expect(() => demoDataSchema.parse(createDemoData(TODAY))).not.toThrow();
    expect(() => demoDataSchema.parse(createDemoData('2027-03-01'))).not.toThrow();
  });

  it('20人全員によみ（ひらがな）が入っている（PRD D61）', () => {
    const d = createDemoData(TODAY);
    expect(d.clients).toHaveLength(20);
    for (const c of d.clients) expect(c.kana).toMatch(/^[\u3041-\u309f ー]+$/);
  });

  it('c6 に性別の必要条件、c2 と s2 は相性×', () => {
    const d = createDemoData(TODAY);
    const c6 = d.clients.find((c) => c.id === 'c6');
    expect(c6?.requirements).toContainEqual({ itemId: 'gender', op: 'is', value: '女性' });
    expect(d.compat.c2?.s2).toBe(-2);
    expect(d.compat.c12?.s7).toBe(-2);
  });

  it('14日分の訪問がある（繰り返しの回は保存しない。版2）', () => {
    const d = createDemoData(TODAY);
    expect(d.visits).toEqual([]);
    const dates = new Set(twoWeeks(d).map((v) => v.date));
    for (let i = 0; i < 14; i++) expect(dates.has(addDays(TODAY, i))).toBe(true);
    expect(dates.size).toBe(14);
  });

  it('伝えた内容・欠勤は入れない（ADR-0005・ADR-0011）', () => {
    const d = createDemoData(TODAY);
    expect(d.snapshots).toEqual({});
    expect(d.absences).toEqual([]);
  });

  it('繰り返しの担当は入る（内部の手作業らしい割当で最も多い人）。計算した回はその人が担当', () => {
    const d = createDemoData(TODAY);
    expect(d.patterns.some((p) => p.usualStaffId !== null)).toBe(true);
    const v = twoWeeks(d).find((x) => x.pattern !== null)!;
    expect(v.staffId).toBe(d.patterns.find((p) => p.id === v.pattern!.id)!.usualStaffId);
  });
});

describe('種類と定期パターン（ADR-0012）', () => {
  const pick = (v: {
    id: string;
    date: string;
    windowKind: string;
    earliestStart: string;
    latestStart: string;
    durationMinutes: number;
    clientId: string;
  }) => ({
    id: v.id,
    date: v.date,
    clientId: v.clientId,
    windowKind: v.windowKind,
    earliestStart: v.earliestStart,
    latestStart: v.latestStart,
    durationMinutes: v.durationMinutes,
  });

  it('初期の種類は介護・リハビリ。資格に理学療法士などがあり、スタッフ2人が理学療法士', () => {
    const d = createDemoData(TODAY);
    expect(d.visitTypes.map((t) => t.name)).toEqual(['介護', 'リハビリ']);
    const qual = d.items.find((i) => i.id === 'qualification');
    expect(qual?.options).toEqual(expect.arrayContaining(['理学療法士', '作業療法士', '言語聴覚士']));
    const pts = d.staff.filter((s) => (s.traits.qualification as string[]).includes('理学療法士'));
    expect(pts).toHaveLength(2);
  });

  it('利用者さんごとのパターン（ID＝利用者さんID）から、いまの seed と同じ訪問（ID・日付・時刻・所要）になる', () => {
    for (const today of [TODAY, '2027-03-01', '2026-12-27']) {
      const d = createDemoData(today);
      const clientIds = new Set(d.clients.map((c) => c.id));
      const expected = Array.from({ length: 14 }, (_, i) => visitsOf(addDays(today, i), clientIds)).flat();
      const fromClients = twoWeeks(d, today).filter((v) => v.pattern?.id === v.clientId);
      // 日の中の並びは開始の順（版2の visitsOn）なので、ID の順で比べる
      const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      expect(fromClients.map(pick).sort(byId)).toEqual(expected.map(pick).sort(byId));
      for (const v of fromClients) {
        expect(v.pattern).toEqual({ id: v.clientId, date: v.date, edited: false });
        const target = d.clients.find((c) => c.id === v.clientId)?.traits.target;
        expect(v.typeId).toBe(target === '子ども' ? null : 'care');
      }
      for (const c of d.clients) expect(d.patterns.some((p) => p.id === c.id && p.clientId === c.id)).toBe(true);
    }
  });

  it('高齢の利用者さん2人に週1回・40分のリハビリ（いつもの訪問と時間が重ならない）', () => {
    const d = createDemoData(TODAY);
    expect(REHAB_SEEDS).toHaveLength(2);
    for (const r of REHAB_SEEDS) {
      expect(d.clients.find((c) => c.id === r.clientId)?.traits.target).toBe('高齢');
      const all = twoWeeks(d);
      const rehab = all.filter((v) => v.pattern?.id === rehabPatternId(r.clientId));
      expect(rehab).toHaveLength(2);
      for (const v of rehab) {
        expect(v.typeId).toBe('rehab');
        expect(v.durationMinutes).toBe(40);
        expect(weekday(v.date)).toBe(r.weekday);
        const toMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
        const usual = all.find((u) => u.date === v.date && u.id === `${v.date}_${r.clientId}`);
        if (usual) {
          const a = toMin(usual.earliestStart);
          const b = toMin(v.earliestStart);
          expect(b >= a + usual.durationMinutes || b + v.durationMinutes <= a).toBe(true);
        }
      }
    }
  });

  it('リハビリの訪問は理学療法士だけが可。ほかの訪問は種類で外れる人がいない', () => {
    const d = createDemoData(TODAY);
    for (let i = 0; i < 14; i++) {
      const date = addDays(TODAY, i);
      const p = compile(d, date);
      const withoutTypes = compile({ ...d, visitTypes: [] }, date);
      p.visits.forEach((v, j) => {
        const isRehab = twoWeeks(d).find((x) => x.id === v.id)?.typeId === 'rehab';
        p.staff.forEach((s, k) => {
          const pt = (d.staff.find((x) => x.id === s.id)?.traits.qualification as string[]).includes('理学療法士');
          const want = withoutTypes.allowed[j]![k]! && (!isRehab || pt);
          expect(p.allowed[j]![k]).toBe(want);
        });
      });
    }
  });
});

describe('プリセット', () => {
  it('3種あり、標準は初期の条件と同じ', () => {
    const d = createDemoData(TODAY);
    expect(PRESETS).toHaveLength(3);
    expect(d.presets.map((p) => p.id)).toEqual(['standard', 'travel', 'people']);
    expect(d.presets).toEqual(PRESETS);
    expect(d.presets[0]).not.toBe(PRESETS[0]);
    expect(applyPreset(d.rules, PRESETS[0]!)).toEqual(d.rules);
    expect(presetOf(d.rules, d.presets)?.id).toBe('standard');
  });
  it('当てた条件はそのプリセットと分かる。重みを変えると null', () => {
    const d = createDemoData(TODAY);
    for (const p of PRESETS) expect(presetOf(applyPreset(d.rules, p), d.presets)?.id).toBe(p.id);
    const changed = d.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 0.5 } : r));
    expect(presetOf(changed, d.presets)).toBeNull();
  });
});

describe('ADR-0013 の初期データ', () => {
  it('数人（c2・c4・c9・c13）に訪問先の決まりごとの例が入り、ほかは空。休みは無く、パターンは毎週', () => {
    const d = createDemoData('2026-10-12');
    const withRules = d.clients
      .filter((c) => c.entryNote || c.keyNote || c.parkingNote || c.cautionNote)
      .map((c) => c.id)
      .sort();
    expect(withRules).toEqual(['c13', 'c2', 'c4', 'c9']);
    expect(d.clientLeaves).toEqual([]);
    expect(d.patterns.every((p) => p.repeat === 'weekly' && p.monthWeeks.length === 0 && p.dayTimes.length === 0)).toBe(
      true,
    );
  });
});
