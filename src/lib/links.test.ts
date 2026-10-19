import { describe, expect, it } from 'vitest';
import { attentionTarget, dayHref, suddenHref, UNASSIGNED_DO, unassignedHref, workloadHref } from './links';
import type { Attention } from './month';

const D = '2026-10-21';
const at = (kind: Attention['kind'], extra: Partial<Attention> = {}): Attention => ({
  date: D,
  kind,
  count: 1,
  names: [],
  ...extra,
});

describe('行き先の URL（PRD D201〜D204）', () => {
  it('欠勤・キャンセルの欄：日付と ?do=absence。人を渡すと &staff=', () => {
    expect(suddenHref(D)).toBe('/plan?date=2026-10-21&do=absence');
    expect(suddenHref(D, 's1')).toBe('/plan?date=2026-10-21&do=absence&staff=s1');
  });
  it('日の画面：?date= だけ', () => {
    expect(dayHref(D)).toBe('/plan?date=2026-10-21');
  });
  it('入らなかった訪問：日付と ?do=unassigned', () => {
    expect(UNASSIGNED_DO).toBe('unassigned');
    expect(unassignedHref(D)).toBe('/plan?date=2026-10-21&do=unassigned');
  });
  it('稼働の見込み：月と人（人が無ければ月だけ）', () => {
    expect(workloadHref('2026-10', 's2')).toBe('/workload?ym=2026-10&staff=s2');
    expect(workloadHref('2026-10')).toBe('/workload?ym=2026-10');
  });
});

describe('月の要対応の行き先（attentionTarget。PRD D201）', () => {
  it('入らない訪問は日の画面の「入らなかった訪問」', () => {
    expect(attentionTarget(at('unassigned', { count: 2 }))).toEqual({
      to: '/plan?date=2026-10-21&do=unassigned',
      date: D,
      note: '（日の画面の「入らなかった訪問」で開く）',
    });
  });
  it('休みの人に訪問が残るは、その日の「欠勤・キャンセル」の欄（1段目）', () => {
    const t = attentionTarget(at('absentLeft'));
    expect(t.to).toBe('/plan?date=2026-10-21&do=absence');
    expect(t.date).toBe(D);
    expect(t.note).toBe('（日の画面の「欠勤・キャンセル」で開く）');
  });
  it('拘束が上限を超えるは、稼働の見込みをその月・先頭の人で', () => {
    const t = attentionTarget(at('overSpan', { count: 2, names: ['青葉 一郎', '泉 二郎'], staffIds: ['s1', 's2'] }));
    expect(t.to).toBe('/workload?ym=2026-10&staff=s1');
    expect(t.note).toBe('（稼働の見込みで開く）');
    // 人が分からなければ月だけ
    expect(attentionTarget(at('overSpan')).to).toBe('/workload?ym=2026-10');
  });
  it('月末の日でもその日の月', () => {
    expect(attentionTarget({ ...at('overSpan', { staffIds: ['s1'] }), date: '2026-10-31' }).to).toBe(
      '/workload?ym=2026-10&staff=s1',
    );
  });
  it('そのほか（条件が変わった・欠勤がある）は今のまま日の画面', () => {
    for (const k of ['stale', 'absence'] as const) {
      expect(attentionTarget(at(k))).toEqual({ to: '/plan', date: D, note: '（日の画面で開く）' });
    }
  });
});
