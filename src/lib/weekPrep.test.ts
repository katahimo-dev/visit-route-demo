import { describe, expect, it } from 'vitest';
import type { BulkConfirm } from './confirmDay';
import { weekConfirmLabel, weekDayCountText, weekNext } from './weekPrep';

const bulk = (x: Partial<BulkConfirm> = {}): BulkConfirm => ({ targets: [], problem: [], changed: [], ...x });
const base = { futureDays: 5, bulk: bulk(), running: null };

describe('weekNext（週の主ボタン。PRD D280・D328。組むのは「AI で組む ▾」）', () => {
  it('確定 → 済み の順で1つ', () => {
    expect(weekNext({ ...base, bulk: bulk({ targets: ['2026-10-22', '2026-10-23'] }) })).toMatchObject({
      kind: 'confirm',
      label: 'この週の問題の無い日をまとめて確定（2日）',
    });
    expect(weekNext(base)).toMatchObject({ kind: 'done', label: 'この週は確定済みです' });
  });
  it('この週を組んでいる間は「組んでいます」、ほかを組んでいる間は確定を押せず理由', () => {
    expect(weekNext({ ...base, running: 'this' })).toMatchObject({ kind: 'making', why: null });
    expect(weekNext({ ...base, bulk: bulk({ targets: ['2026-10-22'] }), running: 'other' }).why).toMatch(
      /確定できません/,
    );
  });
  it('要対応・未連絡の変更の日だけ残る：ボタンなしで日の予定で確定する理由', () => {
    const r = weekNext({ ...base, bulk: bulk({ problem: ['2026-10-22'], changed: ['2026-10-23'] }) });
    expect(r).toMatchObject({ kind: 'rest', label: '確定していない 2日は日の予定で' });
    expect(r.why).toMatch(/要対応/);
    expect(weekNext({ ...base, bulk: bulk({ changed: ['2026-10-23'] }) }).why).toMatch(/連絡の一覧/);
  });
  it('今日以降に訪問の無い週はボタンなし', () => {
    expect(weekNext({ ...base, futureDays: 0 }).kind).toBe('none');
  });
  it('文', () => {
    expect(weekConfirmLabel(4)).toBe('この週の問題の無い日をまとめて確定（4日）');
  });
});

describe('weekDayCountText（日の見出しの件数。PRD D282）', () => {
  it('件数と担当なし', () => {
    expect(weekDayCountText({ count: 0, unassigned: 0 })).toBe('0件');
    expect(weekDayCountText({ count: 17, unassigned: 0 })).toBe('17件');
    expect(weekDayCountText({ count: 17, unassigned: 2 })).toBe('17件・担当なし2');
  });
});
