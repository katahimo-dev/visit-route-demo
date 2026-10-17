import { describe, expect, it } from 'vitest';
import { demoDataSchema } from '../contracts/data';
import { addDays, weekday } from '../domain/time';
import { compile } from '../matching';
import { visitsOf } from './generate';
import {
  applyPreset,
  createDemoData,
  daysFrom,
  INITIAL_PRESETS as PRESETS,
  presetOf,
  REHAB_SEEDS,
  rehabPatternId,
} from './index';

const TODAY = '2026-10-12';

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

  it('14日分の訪問がある', () => {
    const d = createDemoData(TODAY);
    const dates = new Set(d.visits.map((v) => v.date));
    for (let i = 0; i < 14; i++) expect(dates.has(addDays(TODAY, i))).toBe(true);
    expect(dates.size).toBe(14);
  });

  it('手作業の割当は入れない（ADR-0005）', () => {
    const d = createDemoData(TODAY);
    expect(d.manualPlans).toEqual({});
    // 初期データに欠勤は入らない（ADR-0011）
    expect(d.absences).toEqual([]);
    expect(d.visits.every((v) => v.staffId === null)).toBe(true);
    expect(d.aiRuns).toEqual({});
  });

  it('いつもの担当は入る（内部の手作業らしい割当で最も多い人）', () => {
    const d = createDemoData(TODAY);
    expect(d.clients.some((c) => c.usualStaffId !== null)).toBe(true);
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

  it('利用者さんごとのパターン（ID＝利用者さんID）から、いまの seed と同じ訪問（ID・日付・時刻・所要・順）になる', () => {
    for (const today of [TODAY, '2027-03-01', '2026-12-27']) {
      const d = createDemoData(today);
      const clientIds = new Set(d.clients.map((c) => c.id));
      const expected = Array.from({ length: 14 }, (_, i) => visitsOf(addDays(today, i), clientIds)).flat();
      const fromClients = d.visits.filter((v) => v.pattern?.id === v.clientId);
      expect(fromClients.map(pick)).toEqual(expected.map(pick));
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
      const rehab = d.visits.filter((v) => v.pattern?.id === rehabPatternId(r.clientId));
      expect(rehab).toHaveLength(2);
      for (const v of rehab) {
        expect(v.typeId).toBe('rehab');
        expect(v.durationMinutes).toBe(40);
        expect(weekday(v.date)).toBe(r.weekday);
        const toMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
        const usual = d.visits.find((u) => u.date === v.date && u.id === `${v.date}_${r.clientId}`);
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
        const isRehab = d.visits.find((x) => x.id === v.id)?.typeId === 'rehab';
        p.staff.forEach((s, k) => {
          const pt = (d.staff.find((x) => x.id === s.id)?.traits.qualification as string[]).includes('理学療法士');
          const want = withoutTypes.allowed[j]![k]! && (!isRehab || pt);
          expect(p.allowed[j]![k]).toBe(want);
        });
      });
    }
  });
});

describe('daysFrom', () => {
  it('既存の日は変えず、足りない日だけ足す', () => {
    const d = createDemoData(TODAY);
    const e = daysFrom(d, addDays(TODAY, 7), 14);
    expect(e.visits.filter((v) => v.date < addDays(TODAY, 14))).toEqual(d.visits);
    expect(new Set(e.visits.map((v) => v.date)).size).toBe(21);
    expect(e.visits.every((v) => v.staffId === null)).toBe(true);
    expect(() => demoDataSchema.parse(e)).not.toThrow();
  });
  it('パターンの無い古いデータでは、今までどおりの訪問（種類・パターンなし、リハビリなし）', () => {
    const d = { ...createDemoData(TODAY), visits: [], availability: [], visitTypes: [], patterns: [] };
    const e = daysFrom(d, TODAY, 14);
    const clientIds = new Set(d.clients.map((c) => c.id));
    const expected = Array.from({ length: 14 }, (_, i) => visitsOf(addDays(TODAY, i), clientIds)).flat();
    expect(e.visits).toEqual(expected);
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
