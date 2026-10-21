import { describe, expect, it } from 'vitest';
import type { Absence } from '../contracts/documents';
import type { ReassignDiff } from '../contracts/reassign';
import {
  absenceOfDraft,
  absenceSummary,
  cancelImpact,
  confirmNote,
  draftError,
  draftOf,
  impactText,
  noPlanText,
  reassignBlocked,
  reassignMoveRows,
  recommendAnneal,
  staffChoices,
  suddenHeading,
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

describe('suddenSteps・suddenHeading（段階の名前と見出し）', () => {
  it('〈スタッフ〉の流れ（選ぶ前も同じ）と〈利用者さん〉の流れ（短い名前）', () => {
    expect(suddenSteps(null)).toEqual(['起きたこと', '休む人', '影響', '確定', '連絡']);
    expect(suddenSteps('staff')).toEqual(suddenSteps(null));
    expect(suddenSteps('client')).toEqual(['起きたこと', '訪問', '影響', '確定', '連絡']);
  });
  it('見出しは段階の名前と重ねない', () => {
    expect(suddenHeading(null, 1, 'スタッフ')).toBe('何が起きましたか？');
    expect(suddenHeading('staff', 2, 'スタッフ')).toBe('休むスタッフと時間帯を選ぶ');
    expect(suddenHeading('staff', 3, 'スタッフ')).toBe('影響を確かめて振り直す');
    expect(suddenHeading('staff', 4, 'スタッフ')).toBe('案を選んで確定する');
    expect(suddenHeading('client', 2, 'スタッフ')).toBe('キャンセルの訪問を選ぶ');
    expect(suddenHeading('client', 4, 'スタッフ')).toBe('確定する');
    expect(suddenHeading('staff', 5, 'スタッフ')).toBe('変更を伝える');
    expect(suddenHeading('client', 5, 'スタッフ')).toBe('変更を伝える');
    for (const k of ['staff', 'client'] as const)
      for (const st of [1, 2, 3, 4, 5] as const) expect(suddenSteps(k)).not.toContain(suddenHeading(k, st, 'スタッフ'));
  });
});

describe('noPlanText・recommendAnneal', () => {
  it('案の無い日：計算中は「案を作っています」', () => {
    expect(noPlanText(true)).toBe('案を作っています。終わると振り直せます');
    expect(noPlanText(false)).toContain('欠勤だけ登録できます');
  });
  it('案A で入らない見込みがある案のある日だけ案B を勧める', () => {
    expect(recommendAnneal({ hasBase: true, unplacedA: 1 })).toBe(true);
    expect(recommendAnneal({ hasBase: true, unplacedA: 0 })).toBe(false);
    expect(recommendAnneal({ hasBase: false, unplacedA: 2 })).toBe(false);
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

describe('reassignMoveRows（PRD D265）', () => {
  const label: Record<string, string> = {
    v1: '10:00 天文台',
    v2: '09:30 交通局',
    v3: '13:30 文学館',
    v4: '11:00 図書館',
  };
  const visitLabel = (id: string) => label[id] ?? id;
  const diff = (x: Partial<ReassignDiff>): ReassignDiff => ({
    moved: [],
    shifted: [],
    unplaced: [],
    changedStaff: [],
    travelDelta: 0,
    ...x,
  });
  it('担当が変わる訪問と入らない訪問を、訪問の文（受けられる時間帯の初め）の順に並べる', () => {
    const rows = reassignMoveRows(
      diff({
        moved: [
          { visitId: 'v3', from: 's1', to: 's2' },
          { visitId: 'v1', from: 's1', to: 's3' },
        ],
        unplaced: ['v2'],
      }),
      visitLabel,
    );
    expect(rows.map((r) => r.visitId)).toEqual(['v2', 'v1', 'v3']);
    expect(rows[0]).toEqual({ visitId: 'v2', from: null, to: null });
  });
  it('moved と unplaced の両方にある訪問は1行（moved の元の担当を使う）', () => {
    const rows = reassignMoveRows(
      diff({ moved: [{ visitId: 'v1', from: 's1', to: null }], unplaced: ['v1'] }),
      visitLabel,
    );
    expect(rows).toEqual([{ visitId: 'v1', from: 's1', to: null }]);
  });
  it('入らなかった訪問から入れた（from が null）', () => {
    const rows = reassignMoveRows(diff({ moved: [{ visitId: 'v4', from: null, to: 's2' }] }), visitLabel);
    expect(rows).toEqual([{ visitId: 'v4', from: null, to: 's2' }]);
  });
  it('無ければ空', () => {
    expect(reassignMoveRows(diff({}), visitLabel)).toEqual([]);
  });
});
