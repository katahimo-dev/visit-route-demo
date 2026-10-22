import { describe, expect, it } from 'vitest';
import { addDays } from '../domain/time';
import { visitsOn } from '../patterns';
import { createDemoData } from '../seed';
import { type DropVerdict, dropShadowText, dropTone, dropVerdict, staffWhyOf } from './visitDrop';

const TODAY = '2026-10-21';
const data = createDemoData(TODAY);
/** 今日の繰り返しの回（08:30・30分。取り消していない） */
const rep = visitsOn(data, TODAY).find((v) => !v.cancelled && !!v.pattern && v.staffId !== null)!;
/** 繰り返しではない回（保存した1件） */
const one = { ...rep, id: 'one', pattern: null };
const cancelled = { ...rep, id: 'cx', pattern: null, cancelled: true };
const withVisits = { ...data, visits: [...data.visits, one, cancelled] };
const START = 8 * 60 + 30;

const ok = (v: DropVerdict) => {
  if (!v.ok) throw new Error(`置けるはずが置けない：${v.why}`);
  return v;
};

describe('落とし先の判定 dropVerdict（PRD D341。ADR-0056）', () => {
  it('見つからない訪問', () => {
    expect(dropVerdict(data, 'nope', { date: TODAY }, TODAY)).toEqual({ ok: false, why: 'この訪問は見つかりません' });
  });
  it('取り消した訪問は動かせない', () => {
    expect(dropVerdict(withVisits, 'cx', { date: TODAY }, TODAY)).toEqual({
      ok: false,
      why: '取り消した訪問は動かせません',
    });
  });
  it('休みのため無しの訪問は動かせない', () => {
    const leave = { id: 'lv', clientId: rep.clientId, from: TODAY, to: TODAY, note: '' };
    const d = { ...withVisits, clientLeaves: [leave] };
    expect(dropVerdict(d, 'one', { date: addDays(TODAY, 1) }, TODAY)).toEqual({
      ok: false,
      why: '休みのため無しの訪問は動かせません',
    });
  });
  it('今日より前の訪問は動かせない', () => {
    const past = visitsOn(data, addDays(TODAY, -3)).find((v) => !v.cancelled)!;
    expect(dropVerdict(data, past.id, { date: TODAY }, TODAY)).toEqual({
      ok: false,
      why: '今日より前の訪問は動かせません',
    });
  });
  it('今日より前の日へは動かせない', () => {
    expect(dropVerdict(data, rep.id, { date: addDays(TODAY, -1) }, TODAY)).toEqual({
      ok: false,
      why: '今日より前の日へは動かせません',
    });
  });
  it('別の〈利用者さん〉の行へは動かせない（同じ人の行なら可）', () => {
    expect(dropVerdict(data, rep.id, { date: TODAY, clientId: 'other' }, TODAY)).toEqual({
      ok: false,
      why: 'ほかの人の行へは動かせません（同じ行の別の日へ）',
    });
    expect(dropVerdict(data, rep.id, { date: addDays(TODAY, 1), clientId: rep.clientId }, TODAY).ok).toBe(true);
  });
  it('DAY_START〜DAY_END（07:00〜20:00）の外には置けない。ぴったりは置ける', () => {
    const why = '07:00〜20:00 の中に置いてください';
    expect(dropVerdict(data, rep.id, { date: TODAY, start: 6 * 60 + 45 }, TODAY)).toEqual({ ok: false, why });
    // 30分の訪問が 20:00 を超える
    expect(dropVerdict(data, rep.id, { date: TODAY, start: 19 * 60 + 45 }, TODAY)).toEqual({ ok: false, why });
    expect(dropVerdict(data, rep.id, { date: TODAY, start: 7 * 60 }, TODAY).ok).toBe(true);
    expect(dropVerdict(data, rep.id, { date: TODAY, start: 19 * 60 + 30 }, TODAY).ok).toBe(true);
  });
  it('same：今と同じ日時・担当なら何も変えない（start 省略・担当を同じ人にしても同じ）', () => {
    const a = ok(dropVerdict(data, rep.id, { date: TODAY }, TODAY));
    expect(a).toMatchObject({ same: true, date: TODAY, start: START, warn: null, told: [], staffId: undefined });
    const b = ok(dropVerdict(data, rep.id, { date: TODAY, start: START, staffId: rep.staffId }, TODAY));
    expect(b.same).toBe(true);
    expect(b.staffId).toBeUndefined();
  });
  it('same のときは warn・told を出さない（fit=0・staffWhy・確定した日でも）', () => {
    const d = { ...data, snapshots: { [TODAY]: { at: 0, visits: [] } as never } };
    const v = ok(dropVerdict(d, rep.id, { date: TODAY }, TODAY, { fit: 0, staffWhy: 'だめ' }));
    expect(v).toMatchObject({ same: true, warn: null, told: [] });
  });
  it('時刻・日付を変えると same ではない。担当は変えない（staffId は undefined）', () => {
    const t = ok(dropVerdict(data, rep.id, { date: TODAY, start: START + 15 }, TODAY));
    expect(t).toMatchObject({ same: false, start: START + 15, staffId: undefined });
    const day = ok(dropVerdict(data, rep.id, { date: addDays(TODAY, 1) }, TODAY));
    expect(day).toMatchObject({ same: false, date: addDays(TODAY, 1), start: START });
  });
  it('担当を替える：staffId に出る。null（担当なし）にもできる', () => {
    const o = data.staff.find((s) => s.id !== rep.staffId)!;
    expect(ok(dropVerdict(data, rep.id, { date: TODAY, staffId: o.id }, TODAY))).toMatchObject({
      same: false,
      staffId: o.id,
    });
    expect(ok(dropVerdict(data, rep.id, { date: TODAY, staffId: null }, TODAY))).toMatchObject({
      same: false,
      staffId: null,
    });
  });
  it('warn：担当を替えるときの staffWhy を出す（staffWhy は fit=0 より優先）', () => {
    const o = data.staff.find((s) => s.id !== rep.staffId)!;
    const v = ok(dropVerdict(data, rep.id, { date: TODAY, staffId: o.id }, TODAY, { staffWhy: '理由', fit: 0 }));
    expect(v.warn).toBe('理由');
  });
  it('warn：担当なしへ落とすときや、担当を替えないときの staffWhy は使わない', () => {
    const none = ok(dropVerdict(data, rep.id, { date: TODAY, staffId: null }, TODAY, { staffWhy: '理由' }));
    expect(none.warn).toBeNull();
    const time = ok(dropVerdict(data, rep.id, { date: TODAY, start: START + 15 }, TODAY, { staffWhy: '理由' }));
    expect(time.warn).toBeNull();
  });
  it('warn：同じ担当の行の別の日・時刻へ落とすときも、その人が担当できない理由を出す', () => {
    const same = ok(
      dropVerdict(data, rep.id, { date: TODAY, start: START + 15, staffId: rep.staffId }, TODAY, { staffWhy: '理由' }),
    );
    expect(same.staffId).toBeUndefined();
    expect(same.warn).toBe('理由');
  });
  it('warn：fit=0 なら「入れる人がいません」。fit が 1 以上・null・省略なら null', () => {
    const t = { date: TODAY, start: START + 15 };
    expect(ok(dropVerdict(data, rep.id, t, TODAY, { fit: 0 })).warn).toBe(
      '入れる人がいません（落とすと要対応に出ます）',
    );
    expect(ok(dropVerdict(data, rep.id, t, TODAY, { fit: 3 })).warn).toBeNull();
    expect(ok(dropVerdict(data, rep.id, t, TODAY, { fit: null })).warn).toBeNull();
    expect(ok(dropVerdict(data, rep.id, t, TODAY)).warn).toBeNull();
  });
  it('told：変わる日のうち確定した日（snapshots にある日）だけ。日付順で重ねない', () => {
    const next = addDays(TODAY, 1);
    const snap = { at: 0, visits: [] } as never;
    const both = { ...data, snapshots: { [next]: snap, [TODAY]: snap } };
    expect(ok(dropVerdict(both, rep.id, { date: next }, TODAY)).told).toEqual([TODAY, next]);
    const onlyTo = { ...data, snapshots: { [next]: snap } };
    expect(ok(dropVerdict(onlyTo, rep.id, { date: next }, TODAY)).told).toEqual([next]);
    // 同じ日の中で動かすなら1日だけ
    expect(ok(dropVerdict(both, rep.id, { date: TODAY, start: START + 15 }, TODAY)).told).toEqual([TODAY]);
    // 確定していなければ空
    expect(ok(dropVerdict(data, rep.id, { date: next }, TODAY)).told).toEqual([]);
  });
  it('repeating：繰り返しの回だけ true', () => {
    expect(ok(dropVerdict(data, rep.id, { date: TODAY }, TODAY)).repeating).toBe(true);
    expect(ok(dropVerdict(withVisits, 'one', { date: TODAY }, TODAY)).repeating).toBe(false);
  });
});

describe('影の文 dropShadowText・色 dropTone', () => {
  const v = (o: Partial<Extract<DropVerdict, { ok: true }>> = {}): DropVerdict => ({
    ok: true,
    same: false,
    date: TODAY,
    start: 9 * 60 + 15,
    staffId: undefined,
    warn: null,
    told: [],
    repeating: false,
    ...o,
  });
  it('置けないときは理由', () => {
    expect(dropShadowText({ ok: false, why: '理由' })).toBe('置けません：理由');
  });
  it('「ここへ（09:15）」と入れる人の数', () => {
    expect(dropShadowText(v(), { fit: 3 })).toBe('ここへ（09:15）・入れる人 3人');
    expect(dropShadowText(v(), { fit: null })).toBe('ここへ（09:15）・入れる人 —');
    // 数えない落とし先（〈スタッフ〉×曜日の表など）でも、入るなら「入る」と出す（影の文を空にしない）
    expect(dropShadowText(v())).toBe('ここへ（09:15）・入る');
    expect(dropShadowText(v(), { time: false })).toBe('入る');
  });
  it('time:false なら「ここへ」を出さない', () => {
    expect(dropShadowText(v(), { fit: 2, time: false })).toBe('入れる人 2人');
  });
  it('入らないときは理由を出し、入れる人の数は出さない', () => {
    expect(dropShadowText(v({ warn: '入れる人がいません' }), { fit: 0 })).toBe(
      'ここへ（09:15）・入らない：入れる人がいません',
    );
  });
  it('確定した日・繰り返しの回の知らせ（same の繰り返しは出さない）', () => {
    expect(dropShadowText(v({ told: [TODAY], repeating: true }), { fit: 1 })).toBe(
      'ここへ（09:15）・入れる人 1人・確定した日（変えると未連絡の変更）・繰り返しの回（範囲は欄で選ぶ）',
    );
    expect(dropShadowText(v({ same: true, repeating: true }))).toBe('ここへ（09:15）');
  });
  it('dropTone：置けない=ng・入らない=warn・入る=ok', () => {
    expect(dropTone({ ok: false, why: 'x' })).toBe('ng');
    expect(dropTone(v({ warn: 'x' }))).toBe('warn');
    expect(dropTone(v())).toBe('ok');
  });
});

describe('担当の行・列へ落とすときの理由 staffWhyOf（seed のデータ）', () => {
  it('その日に働かない人なら理由が返る', () => {
    expect(staffWhyOf(data, rep.id, TODAY, 's8')).toBe('その日に働かない人です');
  });
  it('今の担当（担当できる人）なら null', () => {
    expect(staffWhyOf(data, rep.id, TODAY, rep.staffId!)).toBeNull();
  });
  it('必須の条件に合わない人は理由が返る', () => {
    expect(staffWhyOf(data, rep.id, TODAY, 's1')).toContain('必須の条件に合いません');
  });
  it('訪問が見つからなければ null', () => {
    expect(staffWhyOf(data, 'nope', TODAY, 's2')).toBeNull();
  });
});
