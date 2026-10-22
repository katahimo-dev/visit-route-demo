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
  it('担当なしのある要対応は日の画面の「担当なしの訪問」', () => {
    expect(attentionTarget(at('care', { count: 2, names: ['担当なし 2'] }), {})).toEqual({
      to: '/plan?date=2026-10-21&do=unassigned',
      date: D,
      note: '（日の予定の「担当なしの訪問」で開く）',
    });
  });
  it('担当なしの無い要対応（担当が休みなど）は日の画面', () => {
    expect(attentionTarget(at('care', { names: ['担当が休み 1'] }), {}).to).toBe('/plan');
  });
  it('拘束が上限を超えるは、稼働の見込みをその月・先頭の人で', () => {
    const t = attentionTarget(
      at('overSpan', { count: 2, names: ['青葉 一郎', '泉 二郎'], staffIds: ['s1', 's2'] }),
      {},
    );
    expect(t.to).toBe('/workload?ym=2026-10&staff=s1');
    expect(t.note).toBe('（勤務の見込みで開く）');
    // 人が分からなければ月だけ
    expect(attentionTarget(at('overSpan'), {}).to).toBe('/workload?ym=2026-10');
  });
  it('月末の日でもその日の月', () => {
    expect(attentionTarget({ ...at('overSpan', { staffIds: ['s1'] }), date: '2026-10-31' }, {}).to).toBe(
      '/workload?ym=2026-10&staff=s1',
    );
  });
  it('未連絡の変更は日の画面', () => {
    expect(attentionTarget(at('changed'), {})).toEqual({ to: '/plan', date: D, note: '（日の予定で開く）' });
  });
});
