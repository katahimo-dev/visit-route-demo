import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMS } from '../domain/terms';
import {
  filterPalette,
  isMacPlatform,
  isPaletteShortcut,
  moveActive,
  PALETTE_PEOPLE_LIMIT,
  paletteActions,
  paletteItem,
  palettePeople,
  paletteScreens,
  paletteTerms,
  TERM_READINGS,
  termReading,
} from './commandPalette';
import { menuSections } from './nav';

const terms = { client: '利用者さん', staff: 'スタッフ' };
const TODAY = '2026-10-21';
const clients = [
  { id: 'c1', displayName: '図書館 ふみ', kana: 'としょかん ふみ', stage: 'active' as const },
  { id: 'c2', displayName: '動物公園 やぎお', kana: 'どうぶつこうえん やぎお', stage: 'active' as const },
  { id: 'c3', displayName: '長町 みどり', kana: 'ながまち みどり', stage: 'ended' as const },
];
const staff = [
  { id: 's1', name: '長町 小太郎', active: true },
  { id: 's2', name: '市役所 まち子', active: false },
];
const items = [
  ...paletteActions(TODAY),
  ...paletteScreens(menuSections(terms, TODAY), terms),
  ...palettePeople(clients, staff, terms),
];
const labels = (q: string) => filterPalette(items, q).flat.map((i) => i.label);

describe('候補', () => {
  it('操作は今ある入口（?do=）へ。欠勤と今日の予定は今日を選ぶ', () => {
    const a = paletteActions(TODAY);
    const by = (id: string) => a.find((x) => x.id === id)!;
    expect(by('action:absence').to).toBe('/plan?date=2026-10-21&do=absence');
    expect(by('action:absence').date).toBe(TODAY);
    expect(by('action:today')).toMatchObject({ to: '/plan', date: TODAY });
    expect(by('action:batch')).toMatchObject({ label: '10月の案をまとめて作る', to: '/month?ym=2026-10&do=batch' });
    expect(by('action:batch-next')).toMatchObject({
      label: '11月の案をまとめて作る',
      to: '/month?ym=2026-11&do=batch',
    });
    expect(by('action:attention').to).toBe('/month?ym=2026-10&do=attention');
    expect(by('action:unconfirmed').to).toBe('/month?ym=2026-10&do=unconfirmed');
    expect(by('action:stale').to).toBe('/month?ym=2026-10&do=stale');
    expect(by('action:vacancy').to).toBe('/vacancy');
  });
  it('いまの条件がどのプリセットとも違うときだけ「今日の案をいまの条件で作り直す」（?do=recreate）', () => {
    expect(paletteActions(TODAY).some((x) => x.id === 'action:recreate')).toBe(false);
    const r = paletteActions(TODAY, { customRules: true }).find((x) => x.id === 'action:recreate')!;
    expect(r).toMatchObject({
      label: '今日の案をいまの条件で作り直す',
      to: '/plan?date=2026-10-21&do=recreate',
      date: TODAY,
    });
  });
  it('画面の候補は呼び方のよみでも引ける（既定の呼び方）', () => {
    const scr = paletteScreens(menuSections(terms, TODAY), terms);
    const hit = (q: string) => filterPalette(scr, q).flat.map((i) => i.to);
    expect(hit('りようしゃ')).toEqual(['/clients']);
    expect(hit('すたっふ')).toEqual(['/staff']);
    const sitter = { client: 'お客様', staff: 'シッター' };
    const scr2 = paletteScreens(menuSections(sitter, TODAY), sitter);
    expect(filterPalette(scr2, 'おきゃく').flat.map((i) => i.to)).toEqual(['/clients']);
    expect(filterPalette(scr2, 'しったー').flat.map((i) => i.to)).toEqual(['/staff']);
  });
  it('既定の呼び方の漢字はみなよみを持ち、変えた呼び方（表に無い）はよみを足さない', () => {
    for (const t of Object.values(DEFAULT_TERMS)) {
      for (const term of [t.client, t.staff]) {
        if (/[\u4e00-\u9fff]/.test(term)) expect(TERM_READINGS[term]).toBeTruthy();
      }
    }
    expect(termReading('ご利用者')).toEqual([]);
  });
  it('12月の来月は翌年の1月', () => {
    const next = paletteActions('2026-12-30').find((x) => x.id === 'action:batch-next')!;
    expect(next).toMatchObject({ label: '1月の案をまとめて作る', to: '/month?ym=2027-01&do=batch' });
  });
  it('画面はメニューと同じ名前・同じ順で、操作の項目（欠勤・キャンセル）は入れない', () => {
    const s = paletteScreens(menuSections(terms, TODAY), terms);
    expect(s.map((x) => x.label)).toEqual([
      'ホーム',
      '月',
      '週',
      '日',
      '案を比べる',
      '空き状況',
      '利用者さん一覧',
      '相性',
      'スタッフ一覧',
      '稼働時間',
      '稼働の見込み',
      '条件の重み',
      '訪問の種類',
      '特性の項目',
      'データ',
    ]);
    expect(s.find((x) => x.to === '/clients')!.hint).toBe('人の情報');
  });
  it('人は ?id= で閲覧の欄へ。利用中でなければ段階、休止中の〈スタッフ〉はそう添える', () => {
    const p = palettePeople(clients, staff, terms);
    expect(p.find((x) => x.id === 'client:c1')).toMatchObject({ to: '/clients?id=c1', hint: 'としょかん ふみ' });
    expect(p.find((x) => x.id === 'client:c3')!.hint).toBe('ながまち みどり・終了');
    expect(p.find((x) => x.id === 'staff:s1')).toMatchObject({ to: '/staff?id=s1', hint: 'スタッフ' });
    expect(p.find((x) => x.id === 'staff:s2')!.hint).toBe('スタッフ・休止中');
  });
  it('語は比べる形にそろえて持つ（重ねない・空を入れない）', () => {
    const it = paletteItem({
      id: 'x',
      kind: 'screen',
      label: 'データ',
      hint: '',
      to: '/data',
      words: ['でーた', '', 'データ'],
    });
    expect(it.keys).toEqual(['でーた']);
  });
});

describe('filterPalette（PRD D182）', () => {
  it('打っていないときは操作と画面だけ（人は出さない）', () => {
    const r = filterPalette(items, '');
    expect(r.groups.map((g) => g.kind)).toEqual(['action', 'screen']);
    expect(r.flat[0]!.label).toBe('欠勤・キャンセルを登録');
  });
  it('よみで〈利用者さん〉を引ける。ひらがな・カタカナ・半角カナ・空白の違いを問わない', () => {
    expect(labels('としょ')).toContain('図書館 ふみ');
    expect(labels('トショカン')).toContain('図書館 ふみ');
    expect(labels('ﾄｼｮｶﾝ')).toContain('図書館 ふみ');
    expect(labels('としょかんふみ')).toContain('図書館 ふみ');
    expect(labels('図書館　ふみ')).toContain('図書館 ふみ');
  });
  it('全角英数と半角を問わない', () => {
    expect(labels('ＥＸＣＥＬ')).toContain('データ');
    expect(labels('excel')).toContain('データ');
  });
  it('空白で区切った語はすべて含むものだけ', () => {
    expect(labels('ながまち みどり')).toEqual(['長町 みどり']);
    expect(labels('ながまち こうえん')).toEqual([]);
  });
  it('〈スタッフ〉は名前で引ける（よみは持たない）', () => {
    expect(labels('小太郎')).toEqual(['長町 小太郎']);
  });
  it('種類の順は 操作 → 画面 → 〈利用者さん〉 → 〈スタッフ〉', () => {
    const r = filterPalette(items, '長町');
    expect(r.groups.map((g) => g.kind)).toEqual(['client', 'staff']);
    const r2 = filterPalette(items, 'けっきん');
    expect(r2.groups[0]!.kind).toBe('action');
  });
  it('種類の中は先頭が一致するものを前に（同じ組は渡した順）', () => {
    // 別名（読み・言い換え）でも引ける
    const r = filterPalette(items, 'ひかく');
    expect(r.flat.map((i) => i.label)).toEqual(['案を比べる']);
    const s = filterPalette(
      [
        paletteItem({ id: 'a', kind: 'client', label: '北 ながい', hint: '', to: '/a', words: ['きた ながい'] }),
        paletteItem({ id: 'b', kind: 'client', label: '長井 はな', hint: '', to: '/b', words: ['ながい はな'] }),
      ],
      'ながい',
    );
    expect(s.flat.map((i) => i.id)).toEqual(['b', 'a']);
  });
  it('人は種類ごとに上限まで。残りは数だけ', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `p${i}`,
      displayName: `山田 ${i}`,
      kana: `やまだ ${i}`,
      stage: 'active' as const,
    }));
    const r = filterPalette(palettePeople(many, [], terms), 'やまだ');
    expect(r.groups[0]).toMatchObject({ kind: 'client', rest: 30 - PALETTE_PEOPLE_LIMIT });
    expect(r.groups[0]!.items).toHaveLength(PALETTE_PEOPLE_LIMIT);
  });
  it('見つからなければ空', () => {
    expect(filterPalette(items, 'zzzz')).toEqual({ groups: [], flat: [] });
  });
  it('300人×60人でも打つたびに速い', () => {
    const cs = Array.from({ length: 300 }, (_, i) => ({
      id: `c${i}`,
      displayName: `利用者 ${i}`,
      kana: `りようしゃ ${i}`,
      stage: 'active' as const,
    }));
    const ss = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, name: `スタッフ ${i}`, active: true }));
    const all = [...paletteActions(TODAY), ...palettePeople(cs, ss, terms)];
    const t0 = performance.now();
    for (const q of ['り', 'りよ', 'りよう', 'りようしゃ', 'りようしゃ 1', 'す', 'すた']) filterPalette(all, q);
    expect((performance.now() - t0) / 7).toBeLessThan(20);
  });
});

describe('paletteTerms', () => {
  it('半角・全角の空白で区切る', () => {
    expect(paletteTerms(' なが　まち ')).toEqual(['なが', 'まち']);
    expect(paletteTerms('')).toEqual([]);
  });
});

describe('moveActive', () => {
  it('端で回る・候補が無ければ -1', () => {
    expect(moveActive(0, 3, 1)).toBe(1);
    expect(moveActive(2, 3, 1)).toBe(0);
    expect(moveActive(0, 3, -1)).toBe(2);
    expect(moveActive(-1, 3, -1)).toBe(2);
    expect(moveActive(-1, 3, 1)).toBe(0);
    expect(moveActive(0, 0, 1)).toBe(-1);
  });
});

describe('isPaletteShortcut（PRD D181）', () => {
  const key = (o: Partial<Parameters<typeof isPaletteShortcut>[0]>) => ({
    key: 'k',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...o,
  });
  it('mac 以外は Ctrl+K、mac は ⌘K', () => {
    expect(isPaletteShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isPaletteShortcut(key({ metaKey: true }), false)).toBe(false);
    expect(isPaletteShortcut(key({ metaKey: true }), true)).toBe(true);
    // mac の Ctrl+K（入力欄の行末まで消す）は横取りしない
    expect(isPaletteShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isPaletteShortcut(key({ key: 'K', ctrlKey: true }), false)).toBe(true);
  });
  it('Shift・Alt 付き・ほかのキー・変換中は違う', () => {
    expect(isPaletteShortcut(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isPaletteShortcut(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isPaletteShortcut(key({ key: 'j', ctrlKey: true }), false)).toBe(false);
    expect(isPaletteShortcut(key({ ctrlKey: true, isComposing: true }), false)).toBe(false);
    expect(isPaletteShortcut(key({}), false)).toBe(false);
  });
  it('isMacPlatform', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('iPhone')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
    expect(isMacPlatform('Linux x86_64')).toBe(false);
  });
});
