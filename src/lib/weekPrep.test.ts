import { describe, expect, it } from 'vitest';
import type { BulkConfirm } from './confirmDay';
import { weekConfirmLabel, weekDayCountText, weekDayUnmadeNote, weekMakeLabel, weekNext } from './weekPrep';

const bulk = (x: Partial<BulkConfirm> = {}): BulkConfirm => ({
  targets: [],
  problem: [],
  changed: [],
  noPlan: [],
  ...x,
});
const base = { futureDays: 5, canExpand: 0, makeDays: 0, bulk: bulk(), running: null };

describe('weekNext（週の主ボタン。PRD D280）', () => {
  it('作る → 確定 → 済み の順で1つ', () => {
    expect(weekNext({ ...base, makeDays: 3 })).toMatchObject({
      kind: 'make',
      label: 'この週の案を作る（3日）',
      why: null,
    });
    expect(weekNext({ ...base, canExpand: 20, makeDays: 0 })).toMatchObject({
      kind: 'make',
      label: 'この週の訪問を作る（20件）',
    });
    expect(weekNext({ ...base, bulk: bulk({ targets: ['2026-10-22', '2026-10-23'] }) })).toMatchObject({
      kind: 'confirm',
      label: 'この週の問題の無い日をまとめて確定（2日）',
    });
    expect(weekNext(base)).toMatchObject({ kind: 'done', label: 'この週は確定済みです' });
  });
  it('作るものがあれば、確定できる日があっても先に作る', () => {
    expect(weekNext({ ...base, makeDays: 1, bulk: bulk({ targets: ['2026-10-22'] }) }).kind).toBe('make');
  });
  it('この週を作っている間は「作っています」、ほかを作っている間は押せず理由', () => {
    expect(weekNext({ ...base, makeDays: 3, running: 'this' })).toMatchObject({ kind: 'making', why: null });
    expect(weekNext({ ...base, makeDays: 3, running: 'other' }).why).toMatch(/ほかの案を作っています/);
    expect(weekNext({ ...base, bulk: bulk({ targets: ['2026-10-22'] }), running: 'other' }).why).toMatch(
      /確定できません/,
    );
  });
  it('問題のある日だけ残る：ボタンなしで日の予定で確定する理由', () => {
    const r = weekNext({ ...base, bulk: bulk({ problem: ['2026-10-22'], changed: ['2026-10-23'] }) });
    expect(r).toMatchObject({ kind: 'rest', label: '確定していない 2日は日の予定で' });
    expect(r.why).toMatch(/要対応/);
    expect(weekNext({ ...base, bulk: bulk({ changed: ['2026-10-23'] }) }).why).toMatch(/確定し直します/);
  });
  it('作れない日（担当できる人がいない など）だけ残る：作るに進まず、確定のあと日の予定で確かめる理由', () => {
    // 作れない日は makeDays に数えない（画面が除く）ので、案の無い日として残る
    expect(weekNext({ ...base, bulk: bulk({ targets: ['2026-10-22'], noPlan: ['2026-10-23'] }) }).kind).toBe('confirm');
    const r = weekNext({ ...base, bulk: bulk({ noPlan: ['2026-10-23'] }) });
    expect(r).toMatchObject({ kind: 'rest', label: '確定していない 1日は日の予定で' });
    expect(r.why).toMatch(/案を作れない日/);
  });
  it('今日以降に訪問も未作成も無い週はボタンなし', () => {
    expect(weekNext({ ...base, futureDays: 0 }).kind).toBe('none');
    // 未作成があれば作れる
    expect(weekNext({ ...base, futureDays: 0, canExpand: 4 }).kind).toBe('make');
  });
  it('文', () => {
    expect(weekConfirmLabel(4)).toBe('この週の問題の無い日をまとめて確定（4日）');
    expect(weekMakeLabel(2, 10)).toBe('この週の案を作る（2日）');
  });
});

describe('weekDayCountText（日の見出しの件数。PRD D282）', () => {
  it('未作成と本当に0件を分ける', () => {
    expect(weekDayCountText({ count: 0, unexpanded: 17, noPlan: true })).toBe('未作成');
    expect(weekDayCountText({ count: 0, unexpanded: 0, noPlan: true })).toBe('0件');
    expect(weekDayCountText({ count: 3, unexpanded: 2, noPlan: true })).toBe('3件・ほか未作成');
    expect(weekDayCountText({ count: 17, unexpanded: 0, noPlan: true })).toBe('17件・案なし');
    expect(weekDayCountText({ count: 17, unexpanded: 0, noPlan: false })).toBe('17件');
    expect(weekDayUnmadeNote(17)).toContain('17件');
    expect(weekDayUnmadeNote(0)).toBe('');
  });
});
