import { describe, expect, it } from 'vitest';
import type { Absence } from '../contracts/documents';
import {
  absenceOfDraft,
  absenceSummary,
  cancelImpact,
  confirmNote,
  draftError,
  draftOf,
  impactText,
  reassignBlocked,
  staffChoices,
  suddenSteps,
  visitChoices,
} from './sudden';

const absence = (x: Partial<Absence> = {}): Absence => ({
  id: 'a1',
  staffId: 's1',
  date: '2026-10-21',
  from: null,
  to: null,
  note: '',
  ...x,
});

describe('suddenSteps（段階の名前）', () => {
  it('〈スタッフ〉の流れ（選ぶ前も同じ）と〈利用者さん〉の流れ', () => {
    expect(suddenSteps(null)).toEqual(['何が起きたか', '休む人と時間帯', '影響と振り直し', '選んで確定']);
    expect(suddenSteps('staff')).toEqual(suddenSteps(null));
    expect(suddenSteps('client')).toEqual(['何が起きたか', 'キャンセルの訪問', '影響の確認', '確定']);
  });
});

describe('draftOf・absenceOfDraft・draftError（欠勤の入力）', () => {
  it('登録が無ければ終日・空', () => {
    expect(draftOf(null)).toEqual({ allDay: true, from: '', to: '', note: '' });
  });
  it('登録済みの時間帯の欠勤はその値', () => {
    expect(draftOf(absence({ from: '12:00', note: '通院' }))).toEqual({
      allDay: false,
      from: '12:00',
      to: '',
      note: '通院',
    });
  });
  it('終日なら開始・終了は null、時間帯の空は null（始業から・終業まで）', () => {
    expect(absenceOfDraft({ allDay: true, from: '9:00', to: '', note: '' }, 's1', '2026-10-21', null)).toMatchObject({
      id: 's1-2026-10-21',
      from: null,
      to: null,
    });
    expect(absenceOfDraft({ allDay: false, from: '', to: '11:00', note: 'x' }, 's1', 'd', absence())).toMatchObject({
      id: 'a1',
      from: null,
      to: '11:00',
      note: 'x',
    });
  });
  it('誤り：時間帯で開始も終了も空・終了が開始より前・30分単位でない', () => {
    expect(draftError({ allDay: true, from: '', to: '', note: '' })).toBeNull();
    expect(draftError({ allDay: false, from: '', to: '', note: '' })).toBe('開始か終了を選んでください');
    expect(draftError({ allDay: false, from: '13:00', to: '12:00', note: '' })).not.toBeNull();
    expect(draftError({ allDay: false, from: '12:10', to: '', note: '' })).not.toBeNull();
    expect(draftError({ allDay: false, from: '12:00', to: '', note: '' })).toBeNull();
  });
});

describe('staffChoices（休む人の選択肢）', () => {
  const slots = new Map([
    ['s1', { baseSlots: [{ start: '09:00', end: '17:00' }], absence: null }],
    ['s2', { baseSlots: [], absence: null }],
    ['s3', { baseSlots: [{ start: '09:00', end: '12:00' }], absence: absence({ staffId: 's3' }) }],
  ]);
  it('その日にもともと働く人だけ・欠勤の印', () => {
    const list = staffChoices(
      [
        { id: 's1', name: '青木' },
        { id: 's2', name: '石田' },
        { id: 's3', name: '上野' },
      ],
      slots,
      (id) => (id === 's1' ? 3 : 0),
    );
    expect(list.map((x) => x.id)).toEqual(['s1', 's3']);
    expect(list[0]).toEqual({ id: 's1', label: '青木（9:00〜17:00・訪問 3件）', absent: false });
    expect(list[1]?.label).toBe('上野（9:00〜12:00・訪問 0件・欠勤（終日））');
    expect(list[1]?.absent).toBe(true);
  });
});

describe('visitChoices（キャンセルの訪問の選択肢）', () => {
  it('時刻の早い順・同じなら名前・担当なし', () => {
    const names: Record<string, string> = { c1: 'いぬい', c2: 'あおば' };
    const list = visitChoices(
      [
        { id: 'v1', earliestStart: '10:00', clientId: 'c1' },
        { id: 'v2', earliestStart: '09:00', clientId: 'c1' },
        { id: 'v3', earliestStart: '10:00', clientId: 'c2' },
      ],
      (id) => names[id] ?? '',
      (id) => `[${id}]`,
      (id) => (id === 'v2' ? '青木' : null),
    );
    expect(list.map((x) => x.id)).toEqual(['v2', 'v3', 'v1']);
    expect(list[0]?.label).toBe('[v2] いぬい（担当：青木さん）');
    expect(list[1]?.label).toBe('[v3] あおば（担当なし）');
  });
});

describe('impactText（影響の見出し）', () => {
  it('0件', () => {
    expect(impactText([]).title).toBe('入らなくなる訪問はありません');
  });
  it('理由ごとの内訳（必須の条件は1件以上のときだけ）', () => {
    expect(impactText([{ reason: 'absence' }, { reason: 'absence' }, { reason: 'unreachable' }])).toEqual({
      title: '入らなくなる訪問 3件',
      detail: '欠勤と重なる 2件・間に合わない 1件',
    });
    expect(impactText([{ reason: 'notAllowed' }]).detail).toBe(
      '欠勤と重なる 0件・間に合わない 0件・ほかの必須の条件 1件',
    );
  });
});

describe('reassignBlocked（登録して振り直すを押せない理由）', () => {
  const ok = { error: null, running: false, hasPreview: true, hasBase: true };
  it('押せる', () => {
    expect(reassignBlocked(ok)).toBeNull();
  });
  it('入力の誤り → 計算中 → 見込みなし → 案なし の順', () => {
    expect(reassignBlocked({ ...ok, error: 'e', running: true })).toBe('e');
    expect(reassignBlocked({ ...ok, running: true, hasBase: false })).toContain('計算中');
    expect(reassignBlocked({ ...ok, hasPreview: false })).toBe('見込みを出せませんでした');
    expect(reassignBlocked({ ...ok, hasBase: false })).toContain('欠勤だけ登録できます');
  });
});

describe('cancelImpact（当日キャンセルの影響）', () => {
  it('担当あり・当日キャンセル', () => {
    const t = cancelImpact({ owner: '青木', sameDay: true, clientWord: '利用者さん', hasPlan: true });
    expect(t[0]).toContain('担当の青木さんの予定から');
    expect(t.at(-1)).toContain('利用者さんごとの月の集計に回数');
    expect(t).toHaveLength(2);
  });
  it('担当なし・案なし・ふつうの取り消し', () => {
    const t = cancelImpact({ owner: null, sameDay: false, clientWord: '利用者さん', hasPlan: false });
    expect(t[0]).toContain('まだ担当が決まっていません');
    expect(t[1]).toContain('まだ案がありません');
    expect(t[2]).toBe('ふつうの取り消しは回数に数えません');
  });
});

describe('confirmNote・absenceSummary', () => {
  it('確定の状態ごとの文', () => {
    expect(confirmNote(null)).toContain('まだ案がありません');
    expect(confirmNote('same')).toContain('確定済み');
    expect(confirmNote('diff')).toContain('確定し直して');
    expect(confirmNote('none')).toContain('まだ確定していません');
  });
  it('欠勤の短い文', () => {
    expect(absenceSummary('青木', { from: null, to: null }, [])).toBe('青木さん 欠勤（終日）');
  });
});
