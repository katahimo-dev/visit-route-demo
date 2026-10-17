// 〈利用者さん〉の段階・紹介元・当日キャンセル・拘束の上限の読み込み（PRD D71〜D74。ADR-0015）
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { clientSchema, stageOfLegacy } from '../contracts/documents';
import { client } from '../matching/fixtures';
import { createDemoData } from '../seed';
import { importJson, isImportError, migrate } from '../store';
import { repair } from '../store/repair';
import { isBeforeActive, stageCounts, stageFlags, withStage } from './clientStage';

const base = () => createDemoData('2026-10-12');

describe('段階と予定の対象（stageFlags・withStage）', () => {
  it('利用中は対象・終了は対象でない・利用中の前は仮押さえのときだけ対象', () => {
    expect(stageFlags('active', true)).toEqual({ active: true, tentative: false });
    expect(stageFlags('ended', true)).toEqual({ active: false, tentative: false });
    expect(stageFlags('inquiry', true)).toEqual({ active: true, tentative: true });
    expect(stageFlags('meeting', false)).toEqual({ active: false, tentative: false });
    expect(isBeforeActive('contract')).toBe(true);
    expect(isBeforeActive('active')).toBe(false);
  });

  it('withStage は active・tentative を合わせ、変わらなければ同じものを返す', () => {
    const c = client('c1', 0, 0);
    expect(withStage(c, 'active')).toBe(c);
    const held = withStage(c, 'inquiry', true);
    expect([held.stage, held.active, held.tentative]).toEqual(['inquiry', true, true]);
    const done = withStage(held, 'active');
    expect([done.stage, done.active, done.tentative]).toEqual(['active', true, false]);
    expect(stageCounts([held, done, c])).toEqual({ inquiry: 1, meeting: 0, contract: 0, active: 2, ended: 0 });
  });
});

describe('古いデータの読み替え（版は1のまま）', () => {
  it('段階の無い〈利用者さん〉：休止（active=false）は終了、仮押さえは相談受付（予定には入ったまま）、ほかは利用中', () => {
    expect(stageOfLegacy({ active: false, tentative: true })).toBe('ended');
    expect(stageOfLegacy({ active: true, tentative: true })).toBe('inquiry');
    expect(stageOfLegacy({ active: true })).toBe('active');
    const { stage: _s, referrer: _r, ...old } = client('c1', 0, 0, { active: true, tentative: true });
    const c = clientSchema.parse(old);
    expect([c.stage, c.active, c.tentative]).toEqual(['inquiry', true, true]);
    expect(c.referrer).toEqual({ name: '', contact: '', note: '', email: '' });
  });

  it('最終勤務日・段階・紹介元・取り消しの種類・拘束の上限の無い古いデータを既定値で読む', () => {
    const d = base();
    const old = JSON.parse(JSON.stringify(d));
    old.staff = old.staff.map(({ lastDay: _l, ...s }: Record<string, unknown>) => s);
    old.clients = old.clients.map(({ stage: _s, referrer: _r, ...c }: Record<string, unknown>, i: number) =>
      i === 0 ? { ...c, active: false } : c,
    );
    old.visits = old.visits.map(({ cancelKind: _c, ...v }: Record<string, unknown>) => v);
    delete old.org.spanLimitHours;
    const r = migrate(old);
    expect(isImportError(r)).toBe(false);
    const x = r as DemoData;
    expect(x.version).toBe(1);
    expect(x.staff.every((s) => s.lastDay === null)).toBe(true);
    expect(x.clients[0]!.stage).toBe('ended');
    expect(x.clients.slice(1).every((c) => c.stage === 'active')).toBe(true);
    expect(x.visits.every((v) => v.cancelKind === null)).toBe(true);
    expect(x.org.spanLimitHours).toBe(10);
  });

  it('repair：active・tentative は段階に合わせ、取り消していない訪問の取り消しの種類は外す。往復で同じに戻る', () => {
    const d = base();
    const bad: DemoData = {
      ...d,
      clients: d.clients.map((c, i) =>
        i === 0 ? { ...c, stage: 'ended' as const, active: true, tentative: true } : c,
      ),
      visits: d.visits.map((v, i) => (i === 0 ? { ...v, cancelKind: 'sameDay' as const } : v)),
    };
    const r = repair(bad);
    expect([r.clients[0]!.active, r.clients[0]!.tentative]).toEqual([false, false]);
    expect(r.visits[0]!.cancelKind).toBeNull();
    const good: DemoData = {
      ...d,
      staff: d.staff.map((s, i) => (i === 0 ? { ...s, lastDay: '2026-10-31' } : s)),
      clients: d.clients.map((c, i) =>
        i === 0
          ? withStage({ ...c, referrer: { name: '相談室', contact: '000', note: 'メモ', email: '' } }, 'meeting', true)
          : c,
      ),
      visits: d.visits.map((v, i) => (i === 0 ? { ...v, cancelled: true, cancelKind: 'sameDay' as const } : v)),
      org: { ...d.org, spanLimitHours: 8.5 },
    };
    expect(repair(good)).toEqual(good);
    expect(importJson(JSON.stringify(good))).toEqual(good);
  });
});
