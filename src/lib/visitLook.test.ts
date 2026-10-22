import { describe, expect, it } from 'vitest';
import type { Problem } from '../contracts/problem';
import type { ContactList, ContactVisit } from '../contracts/reassign';
import { ALLOWED_STAFF_RULE_ID, VISIT_TYPE_RULE_ID } from '../matching';
import { dayLooks, type LookFacts, PIN_TITLE, toldTexts, visitLook } from './visitLook';

/** 何も印のない訪問の元（テストごとに足す） */
const base = (over: Partial<LookFacts> = {}): LookFacts => ({
  visit: { staffId: 's1', pinned: false, cancelled: false, pattern: null },
  leave: false,
  issues: [],
  told: null,
  unfit: [],
  tentative: false,
  ...over,
});
const SHIKAKU = { short: '資格✗', why: '担当が種類の必要条件を満たさない' };
const GEN = { short: '限✗', why: '担当が担当できる人に入っていない' };

describe('訪問の見た目 visitLook（PRD D339。ADR-0056）', () => {
  it('印が無ければ空・tone は null', () => {
    expect(visitLook(base())).toEqual({ marks: [], tone: null, text: '', kinds: '' });
  });
  it('印の並びは 要対応・資格✗／限✗・未連絡・ピン・この回だけ変更・仮押さえ の順', () => {
    const l = visitLook(
      base({
        visit: {
          staffId: 's1',
          pinned: true,
          cancelled: false,
          pattern: { id: 'p', date: '2026-10-21', edited: true },
        },
        issues: ['時間が合わない'],
        told: '担当 A→B',
        tentative: true,
      }),
    );
    expect(l.kinds).toBe('issue told pin edited tentative');
    expect(l.marks.map((m) => m.short)).toEqual(['!', '未', 'ピ', '変', '仮']);
    expect(l.marks.map((m) => m.tone)).toEqual(['red', 'warn', 'pin', 'plain', 'plain']);
  });
  it('要対応の印は検査の言葉を「・」でつなぐ', () => {
    const l = visitLook(base({ issues: ['担当なし', '時間が合わない'] }));
    expect(l.marks[0]).toMatchObject({ kind: 'issue', title: '要対応：担当なし・時間が合わない' });
  });
  it('資格✗・限✗があれば、要対応の印は重ねない（資格✗・限✗が先に並ぶ）', () => {
    const l = visitLook(base({ issues: ['必須の条件に合いません'], unfit: [SHIKAKU, GEN], told: '時刻 9:00→9:30' }));
    expect(l.kinds).toBe('unfit unfit told');
    expect(l.marks.map((m) => m.short)).toEqual(['資格✗', '限✗', '未']);
    expect(l.marks[0]!.title).toBe('資格✗：担当が種類の必要条件を満たさない');
    expect(l.marks[1]!.title).toBe('限✗：担当が担当できる人に入っていない');
  });
  it('未連絡・仮押さえ・ピン・この回だけ変更の title', () => {
    const l = visitLook(
      base({
        visit: {
          staffId: 's1',
          pinned: true,
          cancelled: false,
          pattern: { id: 'p', date: '2026-10-21', edited: true },
        },
        told: '担当 A→B',
        tentative: true,
      }),
    );
    expect(l.marks.map((m) => m.title)).toEqual([
      '未連絡の変更：担当 A→B',
      PIN_TITLE,
      'この回だけ変更',
      '仮押さえ（本登録の前）',
    ]);
    expect(l.text).toBe(l.marks.map((m) => m.title).join('・'));
  });
  it('ピンは担当がいるときだけ。edited が false の繰り返しの回は変の印を出さない', () => {
    expect(visitLook(base({ visit: { staffId: null, pinned: true, cancelled: false, pattern: null } })).kinds).toBe('');
    const rep = {
      staffId: 's1',
      pinned: false,
      cancelled: false,
      pattern: { id: 'p', date: '2026-10-21', edited: false },
    };
    expect(visitLook(base({ visit: rep })).kinds).toBe('');
  });
  it('取り消し：未連絡の変更だけ残し、ほかの印は出さない・tone は off', () => {
    const l = visitLook(
      base({
        visit: { staffId: 's1', pinned: true, cancelled: true, pattern: { id: 'p', date: '2026-10-21', edited: true } },
        issues: ['x'],
        unfit: [SHIKAKU],
        told: '担当 A→なし',
        tentative: true,
      }),
    );
    expect(l.kinds).toBe('told');
    expect(l.tone).toBe('off');
    expect(l.text).toBe('未連絡の変更：担当 A→なし');
  });
  it('休み：取り消しと同じく未連絡の変更だけ。未連絡も無ければ印なしで tone は off', () => {
    expect(visitLook(base({ leave: true, issues: ['x'], unfit: [GEN], told: '時刻 9:00→9:30' })).kinds).toBe('told');
    expect(visitLook(base({ leave: true, issues: ['x'], tentative: true }))).toEqual({
      marks: [],
      tone: 'off',
      text: '',
      kinds: '',
    });
  });
  it('tone：要対応があり担当がいれば issue・担当なしなら unassigned', () => {
    expect(visitLook(base({ issues: ['x'] })).tone).toBe('issue');
    expect(
      visitLook(
        base({ visit: { staffId: null, pinned: false, cancelled: false, pattern: null }, issues: ['担当なし'] }),
      ).tone,
    ).toBe('unassigned');
  });
  it('tone：資格✗・限✗だけ（要対応の言葉なし）でも issue。未連絡・ピンだけなら null', () => {
    expect(visitLook(base({ unfit: [SHIKAKU] })).tone).toBe('issue');
    expect(visitLook(base({ unfit: [GEN] })).tone).toBe('issue');
    expect(visitLook(base({ told: '担当 A→B' })).tone).toBeNull();
    expect(
      visitLook(base({ visit: { staffId: 's1', pinned: true, cancelled: false, pattern: null } })).tone,
    ).toBeNull();
  });
});

const cv = (o: Partial<ContactVisit> & { visitId: string }): ContactVisit => ({
  clientId: 'c1',
  fromStaffId: null,
  toStaffId: null,
  fromStart: null,
  toStart: null,
  ...o,
});
const list = (o: Partial<ContactList>): ContactList => ({ staffChanged: [], timeChanged: [], staff: [], ...o });
const nm = (id: string) => `名${id}`;

describe('未連絡の変更の文 toldTexts', () => {
  it('伝えていない日（null）は空', () => {
    expect(toldTexts(null, nm).size).toBe(0);
  });
  it('担当の変更：「担当 A→B」。元・先が無ければ「なし」', () => {
    const m = toldTexts(
      list({
        staffChanged: [
          cv({ visitId: 'v1', fromStaffId: 'a', toStaffId: 'b' }),
          cv({ visitId: 'v2', fromStaffId: null, toStaffId: 'b' }),
          cv({ visitId: 'v3', fromStaffId: 'a', toStaffId: null }),
        ],
      }),
      nm,
    );
    expect(m.get('v1')).toBe('担当 名a→名b');
    expect(m.get('v2')).toBe('担当 なし→名b');
    expect(m.get('v3')).toBe('担当 名a→なし');
  });
  it('時刻の変更：「時刻 9:00→9:30」（先頭の 0 は付けない）。無い側は —', () => {
    const m = toldTexts(
      list({
        timeChanged: [
          cv({ visitId: 'v1', fromStart: 540, toStart: 570 }),
          cv({ visitId: 'v2', fromStart: null, toStart: 13 * 60 }),
          cv({ visitId: 'v3', fromStart: 600.4, toStart: null }),
        ],
      }),
      nm,
    );
    expect(m.get('v1')).toBe('時刻 9:00→9:30');
    expect(m.get('v2')).toBe('時刻 —→13:00');
    expect(m.get('v3')).toBe('時刻 10:00→—');
  });
  it('担当と時刻の両方が変わった訪問は、両方の文をつなぐ（担当の文を消さない）', () => {
    const m = toldTexts(
      list({
        staffChanged: [cv({ visitId: 'v1', fromStaffId: 'a', toStaffId: 'b' })],
        timeChanged: [cv({ visitId: 'v1', fromStart: 540, toStart: 570 })],
      }),
      nm,
    );
    expect(m.get('v1')).toBe('担当 名a→名b・時刻 9:00→9:30');
  });
});

/** その日の問題の代わり：訪問 v1・担当 s1 の組に資格✗か限✗の理由だけ持つ */
const problemWith = (ruleId: string): Problem =>
  ({
    visits: [{ id: 'v1' }],
    staff: [{ id: 's1' }],
    reasons: [[[{ ruleId, points: Number.POSITIVE_INFINITY }]]],
  }) as unknown as Problem;

const visit = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  clientId: `c-${id}`,
  staffId: 's1',
  pinned: false,
  cancelled: false,
  pattern: null,
  ...over,
});
const opts = (o: Partial<Parameters<typeof dayLooks>[2]> = {}) => ({
  staffName: nm,
  leaveOf: () => false,
  tentativeOf: () => false,
  ...o,
});

describe('その日の訪問の見た目 dayLooks', () => {
  const src = {
    issues: new Map([['v1', [{ label: '時間が合わない' }]]]),
    told: list({ staffChanged: [cv({ visitId: 'v1', fromStaffId: 'a', toStaffId: 's1' })] }),
    problem: problemWith(VISIT_TYPE_RULE_ID),
  };
  it('訪問ごとに、要対応・資格✗・未連絡を引く（資格✗があれば要対応は重ねない）', () => {
    const m = dayLooks(src, [visit('v1'), visit('v2')], opts());
    expect(m.get('v1')!.kinds).toBe('unfit told');
    expect(m.get('v1')!.marks[1]!.title).toBe('未連絡の変更：担当 名a→名s1');
    expect(m.get('v2')).toEqual({ marks: [], tone: null, text: '', kinds: '' });
  });
  it('限✗も引く', () => {
    const m = dayLooks({ ...src, problem: problemWith(ALLOWED_STAFF_RULE_ID) }, [visit('v1')], opts());
    expect(m.get('v1')!.marks[0]!.short).toBe('限✗');
  });
  it('問題が無ければ資格✗は出ず、要対応だけ出る', () => {
    const m = dayLooks({ ...src, problem: null }, [visit('v1')], opts());
    expect(m.get('v1')!.kinds).toBe('issue told');
  });
  it('past：要対応・資格✗・限✗を出さない。未連絡・仮押さえは出す', () => {
    const m = dayLooks(src, [visit('v1')], opts({ past: true, tentativeOf: () => true }));
    expect(m.get('v1')!.kinds).toBe('told tentative');
    expect(m.get('v1')!.tone).toBeNull();
  });
  it('past でなければ（false・省略）出す', () => {
    expect(dayLooks(src, [visit('v1')], opts({ past: false })).get('v1')!.kinds).toBe('unfit told');
  });
  it('leaveOf：休みの訪問は未連絡の変更だけで tone は off', () => {
    const calls: string[] = [];
    const m = dayLooks(
      src,
      [visit('v1')],
      opts({
        leaveOf: (v) => {
          calls.push(`${v.id}/${v.clientId}`);
          return true;
        },
      }),
    );
    expect(m.get('v1')!.kinds).toBe('told');
    expect(m.get('v1')!.tone).toBe('off');
    expect(calls).toContain('v1/c-v1');
  });
  it('取り消しの訪問は、休みの期間でも休み扱いにしない（取り消しとして tone は off）', () => {
    const m = dayLooks(src, [visit('v1', { cancelled: true, pinned: true })], opts({ leaveOf: () => true }));
    expect(m.get('v1')).toMatchObject({ tone: 'off', kinds: 'told' });
  });
  it('tentativeOf は〈利用者さん〉の ID で引く。休み・取り消しの訪問には仮の印を出さない', () => {
    const m = dayLooks(
      { issues: new Map(), told: null, problem: null },
      [visit('v1'), visit('v2'), visit('v3', { cancelled: true })],
      opts({ tentativeOf: (c) => c !== 'c-v9', leaveOf: (v) => v.id === 'v2' }),
    );
    expect(m.get('v1')!.kinds).toBe('tentative');
    expect(m.get('v2')!.kinds).toBe('');
    expect(m.get('v3')!.kinds).toBe('');
  });
  it('伝えていない日（told が null）は未連絡を出さない', () => {
    const m = dayLooks({ ...src, told: null }, [visit('v1')], opts());
    expect(m.get('v1')!.kinds).toBe('unfit');
  });
});
