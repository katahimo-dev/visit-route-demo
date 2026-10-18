// 相性の画面の純粋関数（PRD D113〜D117。ADR-0022）
import { describe, expect, it } from 'vitest';
import { popoverPlace } from '../components/DetailPopover';
import type { Item } from '../contracts/rules';
import { client, staff } from '../matching/fixtures';
import {
  type ClientFilterState,
  decodeFilter,
  EMPTY_FILTER,
  encodeFilter,
  extraCounts,
  type FilterFacts,
  filterClients,
  sameFilter,
  toggleExtra,
} from './clientFilter';
import {
  COMPAT_CHIPS,
  compatChipTests,
  decodeStaffFilter,
  EMPTY_STAFF_FILTER,
  encodeStaffFilter,
  filterStaff,
  nameLines,
  sameStaffFilter,
  staffChipCounts,
  staffChipDefs,
  staffChipKey,
  staffCompatCounts,
  toggleStaffChip,
  traitText,
  weeklyHours,
} from './compatView';

describe('列の見出しの名前（nameLines）', () => {
  it('空白で名字と名の2行に分ける（全角の空白も）', () => {
    expect(nameLines('市役所 まち子')).toEqual(['市役所', 'まち子']);
    expect(nameLines('地底の森　もりお')).toEqual(['地底の森', 'もりお']);
  });
  it('名にさらに空白があれば名の行に残し、前後の空白は落とす', () => {
    expect(nameLines('  山田 花子  よし ')).toEqual(['山田', '花子 よし']);
  });
  it('空白が無ければ4文字ごとに折り返す（文字は切らない）', () => {
    expect(nameLines('若林図書館わかば')).toEqual(['若林図書', '館わかば']);
    expect(nameLines('やまだ')).toEqual(['やまだ']);
    expect(nameLines('あいうえおかきくけ')).toEqual(['あいうえ', 'おかきく', 'け']);
    expect(nameLines('')).toEqual([]);
  });
  it('サロゲートペアの字も1文字に数える', () => {
    expect(nameLines('𠮷野家𠮷田')).toEqual(['𠮷野家𠮷', '田']);
  });
});

const items: Item[] = [
  { id: 'gender', name: '性別', target: 'staff', kind: 'choice', options: ['女性', '男性'] },
  { id: 'qual', name: '資格', target: 'staff', kind: 'multi', options: ['看護師', '介護福祉士'] },
  { id: 'exp', name: '経験年数', target: 'staff', kind: 'number', options: [] },
  { id: 'smoker', name: '喫煙者', target: 'staff', kind: 'flag', options: [] },
  { id: 'pet', name: 'ペットあり', target: 'client', kind: 'flag', options: [] },
];
const people = [
  staff('s1', 0, 0, { name: '市役所 まち子', traits: { gender: '女性', qual: ['看護師'], smoker: false } }),
  staff('s2', 0, 0, { name: '長町 小太郎', traits: { gender: '男性', qual: ['看護師', '介護福祉士'], smoker: true } }),
  staff('s3', 0, 0, { name: '榴岡 さくら', traits: { gender: '女性', qual: [], smoker: null } }),
];
const defs = staffChipDefs(items);
const key = staffChipKey;

describe('〈スタッフ〉の特性のチップ（staffChipDefs・filterStaff・staffChipCounts）', () => {
  it('選択肢・あり／なしごとに作り、数値の項目と〈利用者さん〉の項目は作らない', () => {
    expect(defs.map((d) => d.label)).toEqual([
      '性別：女性',
      '性別：男性',
      '資格：看護師',
      '資格：介護福祉士',
      '喫煙者：あり',
      '喫煙者：なし',
    ]);
  });
  it('AND で絞る（未入力は「あり」「なし」のどちらにも当てはまらない）', () => {
    const ids = (chips: string[]) => filterStaff(people, { query: '', chips }, defs).map((s) => s.id);
    expect(ids([key('gender', '女性')])).toEqual(['s1', 's3']);
    expect(ids([key('gender', '女性'), key('qual', '看護師')])).toEqual(['s1']);
    expect(ids([key('smoker', false)])).toEqual(['s1']);
    expect(ids([key('smoker', true), key('gender', '女性')])).toEqual([]);
  });
  it('名前で探す（ひらがな・カタカナ・空白の違いを問わない）', () => {
    expect(filterStaff(people, { query: 'サクラ', chips: [] }, defs).map((s) => s.id)).toEqual(['s3']);
    expect(filterStaff(people, { query: '長町小', chips: [] }, defs).map((s) => s.id)).toEqual(['s2']);
  });
  it('人数は「押したら何人になるか」。押しているチップは今の人数、0人のチップも数える', () => {
    const c = staffChipCounts(people, { query: '', chips: [key('gender', '女性')] }, defs);
    expect(c.get(key('gender', '女性'))).toBe(2);
    expect(c.get(key('gender', '男性'))).toBe(0);
    expect(c.get(key('qual', '看護師'))).toBe(1);
    expect(c.get(key('smoker', true))).toBe(0);
    expect(c.get(key('smoker', false))).toBe(1);
  });
  it('付け外しは defs の順にそろえ、知らないキーは外す', () => {
    const s = toggleStaffChip({ query: '', chips: ['zzz', key('smoker', true)] }, key('gender', '男性'), defs);
    expect(s.chips).toEqual([key('gender', '男性'), key('smoker', true)]);
    expect(toggleStaffChip(s, key('gender', '男性'), defs).chips).toEqual([key('smoker', true)]);
  });
});

describe('〈スタッフ〉の絞り込みの URL（?sf=）', () => {
  it('書いて読むと元に戻る（日本語・記号も）', () => {
    const s = { query: '市役所 ;:,', chips: [key('gender', '女性'), key('qual', '看護師')] };
    const raw = encodeStaffFilter(s);
    expect(raw).not.toMatch(/[^;:,=%\w.\-~!*'()]/);
    expect(decodeStaffFilter(raw, defs)).toEqual(s);
  });
  it('空なら空の文字、URL に無ければ既定、知らないチップ・壊れた文字は捨てる', () => {
    expect(encodeStaffFilter(EMPTY_STAFF_FILTER)).toBe('');
    expect(decodeStaffFilter(null, defs)).toEqual(EMPTY_STAFF_FILTER);
    expect(decodeStaffFilter('q:%E0%A4;chip:nope,gender=%E5%A5%B3%E6%80%A7;zz:1', defs)).toEqual({
      query: '',
      chips: [key('gender', '女性')],
    });
    expect(sameStaffFilter({ query: '', chips: [] }, EMPTY_STAFF_FILTER)).toBe(true);
  });
});

describe('相性のチップ（compatChipTests・extraTests）', () => {
  const compat = { a: { s1: 2 as const, s2: -2 as const }, b: { s1: 1 as const, s2: 1 as const }, c: {} };
  const clients = [client('a', 0, 0), client('b', 0, 0), client('c', 0, 0)];
  const facts = (visible: string[]): FilterFacts => ({
    periodIds: new Set(),
    unassignedIds: new Set(),
    leaveIds: new Set(),
    patternClientIds: new Set(),
    staffClientIds: () => new Set(),
    workingStaffIds: new Set(),
    endedShownIds: new Set(),
    extraTests: compatChipTests(compat, visible, ['s1', 's2']),
  });
  const f = (over: Partial<ClientFilterState> = {}): ClientFilterState => ({ ...EMPTY_FILTER, ...over });
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it('まだ相性が入っていない組がある人は、見えている列との組で数える', () => {
    expect(ids(filterClients(clients, f({ extra: ['pending'] }), facts(['s1', 's2']), ''))).toEqual(['c']);
    expect(ids(filterClients(clients, f({ extra: ['pending'] }), facts(['s1', 's2', 's3']), ''))).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(ids(filterClients(clients, f({ extra: ['pending'] }), facts([]), ''))).toEqual([]);
  });
  it('× がある人は、休止中でない〈スタッフ〉との組で数える（列の絞り込みに関係なく）', () => {
    expect(ids(filterClients(clients, f({ extra: ['ng'] }), facts(['s1']), ''))).toEqual(['a']);
  });
  it('ほかの絞り込みと AND。人数は「押したら何人になるか」', () => {
    const fx = facts(['s1', 's2']);
    expect(ids(filterClients(clients, f({ extra: ['pending', 'ng'] }), fx, ''))).toEqual([]);
    const c = extraCounts(clients, f({ extra: ['ng'] }), fx, '', COMPAT_CHIPS);
    expect(c.get('ng')).toBe(1);
    expect(c.get('pending')).toBe(0);
    expect(extraCounts(clients, f(), fx, '', COMPAT_CHIPS).get('pending')).toBe(1);
  });
  it('判定の無いキーは絞らない（相性の画面のほか）', () => {
    expect(ids(filterClients(clients, f({ extra: ['pending'] }), { ...facts([]), extraTests: undefined }, ''))).toEqual(
      ['a', 'b', 'c'],
    );
  });
  it('付け外し・URL（?cf= の x:）：書いて読むと戻り、知らないキーは捨てる。並びが違っても同じ絞り込み', () => {
    const s = toggleExtra(toggleExtra(f(), 'ng'), 'pending');
    expect(s.extra).toEqual(['ng', 'pending']);
    expect(toggleExtra(s, 'ng').extra).toEqual(['pending']);
    const raw = encodeFilter(s);
    expect(raw).toContain('x:ng,pending');
    expect(decodeFilter(raw, EMPTY_FILTER, COMPAT_CHIPS).extra).toEqual(['pending', 'ng']);
    expect(sameFilter(decodeFilter(raw, EMPTY_FILTER, COMPAT_CHIPS), s)).toBe(true);
    // 相性の画面のほか（キーを渡さない）は捨てる
    expect(decodeFilter(raw, EMPTY_FILTER).extra).toBeUndefined();
    expect(decodeFilter('chip:;x:zzz,ng', EMPTY_FILTER, COMPAT_CHIPS).extra).toEqual(['ng']);
    // 押していなければ今までと同じ文字
    expect(encodeFilter(f({ extra: [] }))).toBe(encodeFilter(EMPTY_FILTER));
  });
});

describe('吹き出しの中身', () => {
  it('〈スタッフ〉1人の相性の件数（渡した〈利用者さん〉だけ）', () => {
    const compat = { a: { s1: 2 as const }, b: { s1: -2 as const }, c: { s1: -1 as const }, d: { s1: 2 as const } };
    expect(staffCompatCounts(compat, 's1', ['a', 'b', 'c', 'x'])).toEqual({ great: 1, good: 0, poor: 1, ng: 1 });
  });
  it('特性の値の文字（空は「—」）', () => {
    expect(traitText(true)).toBe('あり');
    expect(traitText(false)).toBe('なし');
    expect(traitText(['看護師', '介護福祉士'])).toBe('看護師・介護福祉士');
    expect(traitText([])).toBe('—');
    expect(traitText(null)).toBe('—');
    expect(traitText(undefined)).toBe('—');
    expect(traitText(3)).toBe('3');
  });
  it('曜日ごとの稼働時間（月〜日。勤務日でなければ null）', () => {
    const w = weeklyHours({ workDays: [0, 3], shiftStart: '09:00', shiftEnd: '17:30' });
    expect(w.map((x) => x.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(w[2]?.hours).toEqual({ start: '09:00', end: '17:30' });
    expect(w[6]?.hours).toEqual({ start: '09:00', end: '17:30' });
    expect(w[0]?.hours).toBeNull();
  });
  it('吹き出しの位置：右の端で切れないよう左へずらし、下に入らなければ上に出す', () => {
    const view = { width: 400, height: 600 };
    expect(popoverPlace({ top: 100, bottom: 130, left: 380 }, { width: 300, height: 200 }, view)).toEqual({
      top: 134,
      left: 92,
      maxHeight: 458,
    });
    const up = popoverPlace({ top: 500, bottom: 530, left: 0 }, { width: 300, height: 300 }, view);
    expect(up.left).toBe(8);
    expect(up.top).toBe(196);
    expect(up.maxHeight).toBe(488);
  });
});
