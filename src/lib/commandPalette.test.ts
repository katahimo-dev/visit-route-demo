import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMS } from '../domain/terms';
import {
  filterPalette,
  hashPathname,
  isMacPlatform,
  isPaletteShortcut,
  keepPaletteOn,
  moveActive,
  PALETTE_PEOPLE_LIMIT,
  paletteActions,
  paletteDate,
  paletteItem,
  palettePeople,
  paletteScreens,
  paletteTerms,
  paletteVisits,
  TERM_READINGS,
  termReading,
  visitIndex,
} from './commandPalette';
import { screenSections } from './nav';

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
  ...paletteScreens(screenSections(terms, {}), terms),
  ...palettePeople(clients, staff, terms),
];
const labels = (q: string) => filterPalette(items, q).flat.map((i) => i.label);

describe('候補', () => {
  it('操作は今ある入口（?do=）へ。欠勤と今日の予定は今日を選ぶ', () => {
    const a = paletteActions(TODAY);
    const by = (id: string) => a.find((x) => x.id === id)!;
    expect(by('action:absence').to).toBe('/plan?date=2026-10-21&do=absence&mode=change');
    expect(by('action:absence').date).toBe(TODAY);
    expect(by('action:today')).toMatchObject({ to: '/plan', date: TODAY });
    expect(by('action:batch')).toMatchObject({ label: '10月の担当を AI で組む', to: '/month?ym=2026-10&do=batch' });
    expect(by('action:batch-next')).toMatchObject({
      label: '11月の担当を AI で組む',
      to: '/month?ym=2026-11&do=batch',
    });
    expect(by('action:attention').to).toBe('/month?ym=2026-10&do=attention');
    expect(by('action:unconfirmed').to).toBe('/month?ym=2026-10&do=unconfirmed');
    expect(a.some((x) => x.id === 'action:stale')).toBe(false);
    expect(by('action:vacancy').to).toBe('/vacancy');
  });
  it('画面の候補は呼び方のよみでも引ける（既定の呼び方）', () => {
    const scr = paletteScreens(screenSections(terms, {}), terms);
    const hit = (q: string) => filterPalette(scr, q).flat.map((i) => i.to);
    expect(hit('りようしゃ')).toEqual(['/clients']);
    expect(hit('すたっふ')).toEqual(['/staff']);
    const sitter = { client: 'お客様', staff: 'シッター' };
    const scr2 = paletteScreens(screenSections(sitter, {}), sitter);
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
    expect(next).toMatchObject({ label: '1月の担当を AI で組む', to: '/month?ym=2027-01&do=batch' });
  });
  it('画面はメニューと同じ名前・同じ順で、操作の項目（欠勤・キャンセル）は入れない', () => {
    const s = paletteScreens(screenSections(terms, {}), terms);
    expect(s.map((x) => x.label)).toEqual([
      'ホーム',
      '月の予定',
      '週の予定',
      '日の予定',
      '空き状況',
      '利用者さん一覧',
      'スタッフ一覧',
      '相性',
      '勤務時間（シフト）',
      '勤務の見込み',
      '訪問の種類',
      '特性の項目',
      '条件の重み',
      '管理者設定',
      'データ',
    ]);
    expect(s.find((x) => x.to === '/clients')!.hint).toBe('人');
    expect(s.find((x) => x.to === '/data')!.hint).toBe('設定');
    expect(s.find((x) => x.to === '/plan')!.hint).toBe('予定');
  });
  it('名前を変えた画面は前の名前でも引ける（月間・週間・日の画面・稼働時間・稼働の見込み。PRD D230）', () => {
    const scr = paletteScreens(screenSections(terms, {}), terms);
    const hit = (q: string) => filterPalette(scr, q).flat.map((i) => i.to);
    expect(hit('月間')).toEqual(['/month']);
    expect(hit('げっかん')).toEqual(['/month']);
    expect(hit('週間')).toEqual(['/week']);
    expect(hit('日の画面')).toEqual(['/plan']);
    expect(hit('稼働時間')).toEqual(['/availability']);
    expect(hit('しふと')).toEqual(['/availability']);
    expect(hit('稼働の見込み')).toEqual(['/workload']);
    expect(hit('かどう')).toEqual(['/availability', '/workload']);
    expect(hit('こうつうひ')).toEqual(['/workload']);
  });
  it('メニューから外した画面も1つずつ引ける。「よてい」で月・週・日の予定、「せってい」で設定のタブ（PRD D273・D275）', () => {
    const scr = paletteScreens(screenSections(terms, {}), terms);
    const hit = (q: string) => filterPalette(scr, q).flat.map((i) => i.to);
    expect(hit('よてい')).toEqual(expect.arrayContaining(['/month', '/week', '/plan']));
    expect(hit('せってい')).toEqual(['/types', '/items', '/rules', '/settings', '/data']);
    expect(hit('きんむのみこみ')).toEqual(['/workload']);
    // 案を比べるは日の予定の「AI で組む ▾」から開く（パレットには出さない。PRD D331）
    expect(hit('あんをくらべる')).toEqual([]);
    expect(paletteActions(TODAY).find((x) => x.id === 'action:today')!.label).toBe('日の予定（今日）を開く');
  });
  it('操作の補足は画面の名前（日の予定・月の予定）。欠勤・キャンセルを登録は「当日の対応」でも引ける', () => {
    const acts = paletteActions(TODAY);
    expect(acts.find((x) => x.id === 'action:absence')!.hint).toBe('日の予定（今日）');
    expect(acts.find((x) => x.id === 'action:today')!.hint).toBe('日の予定');
    expect(acts.find((x) => x.id === 'action:batch')!.hint).toBe('月の予定');
    expect(filterPalette(acts, '当日の対応').flat.map((i) => i.id)).toEqual(['action:absence']);
  });
  it('人はその人の画面（/clients/:id・/staff/:id）へ。利用中でなければ段階、休止中の〈スタッフ〉はそう添える', () => {
    const p = palettePeople(clients, staff, terms);
    expect(p.find((x) => x.id === 'client:c1')).toMatchObject({ to: '/clients/c1', hint: 'としょかん ふみ' });
    expect(p.find((x) => x.id === 'client:c3')!.hint).toBe('ながまち みどり・終了');
    expect(p.find((x) => x.id === 'staff:s1')).toMatchObject({ to: '/staff/s1', hint: 'スタッフ' });
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
    const r = filterPalette(items, 'げっかん');
    expect(r.flat.map((i) => i.label)).toEqual(['月の予定']);
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

describe('画面を移ったときのパレット（hashPathname・keepPaletteOn）', () => {
  it('hash から画面のパス', () => {
    expect(hashPathname('#/workload?ym=2026-10')).toBe('/workload');
    expect(hashPathname('#/plan')).toBe('/plan');
    expect(hashPathname('#/')).toBe('/');
    expect(hashPathname('')).toBe('/');
  });
  it('移る前の画面で開いていたら閉じ、移った先で開き直していれば閉じない', () => {
    expect(keepPaletteOn('/week', '/workload')).toBeNull();
    // 画面を移ってすぐ（描画の前）に Ctrl+K で開いた：あとから来た「画面を移った」で閉じない
    expect(keepPaletteOn('/workload', '/workload')).toBe('/workload');
    expect(keepPaletteOn(null, '/workload')).toBeNull();
  });
});

describe('訪問の候補（PRD D304）', () => {
  const people = palettePeople(clients, staff, terms);
  const v = (id: string, clientId: string, date: string, start: string, cancelled = false) => ({
    id,
    date,
    clientId,
    windowKind: 'fixed' as const,
    earliestStart: start,
    latestStart: start,
    durationMinutes: 60,
    staffId: null,
    start: null,
    pinned: false,
    cancelled,
    note: '',
    typeId: null,
    pattern: null,
    cancelKind: null,
  });
  const index = visitIndex([
    v('a1', 'c2', '2026-10-20', '09:00'),
    v('a2', 'c2', '2026-10-28', '10:00'),
    v('a3', 'c2', '2026-10-22', '11:00', true),
    v('a4', 'c2', '2026-10-23', '08:00'),
    v('b1', 'c1', '2026-10-28', '09:00'),
  ]);
  const describeV = () => '担当なし';
  it('日付の語', () => {
    expect(paletteDate('10/28', TODAY)).toBe('2026-10-28');
    expect(paletteDate('１０月２８日', TODAY)).toBe('2026-10-28');
    expect(paletteDate('明日', TODAY)).toBe('2026-10-22');
    expect(paletteDate('きょう', TODAY)).toBe(TODAY);
    expect(paletteDate('1/5', TODAY)).toBe('2027-01-05');
    expect(paletteDate('2/30', TODAY)).toBeNull();
    expect(paletteDate('やぎお', TODAY)).toBeNull();
  });
  it('名前と日付でその日の回、名前だけなら今日以降の近い回（取り消しを除く）', () => {
    expect(paletteVisits('やぎお 10/28', people, index, TODAY, describeV).map((x) => x.visitId)).toEqual(['a2']);
    expect(paletteVisits('やぎお', people, index, TODAY, describeV).map((x) => x.visitId)).toEqual(['a4', 'a2']);
    expect(paletteVisits('10/28', people, index, TODAY, describeV)).toEqual([]);
    const it0 = paletteVisits('ふみ 10/28', people, index, TODAY, describeV)[0]!;
    expect(it0).toMatchObject({ kind: 'visit', label: '図書館 ふみ 10/28（水） 09:00', hint: '担当なし' });
  });
  it('年の無い日付は今日に近い方の年、かなの日付の語しか無ければ名前として読む', () => {
    expect(paletteDate('12/28', '2027-01-03')).toBe('2026-12-28');
    expect(paletteDate('1/5', '2026-12-20')).toBe('2027-01-05');
    const more = palettePeople(
      [{ id: 'c9', displayName: '明日香 さち', kana: 'あすか さち', stage: 'active' }],
      [],
      terms,
    );
    const idx = visitIndex([v('z1', 'c9', '2026-10-25', '09:00')]);
    expect(paletteVisits('あす', more, idx, TODAY, describeV).map((x) => x.visitId)).toEqual(['z1']);
  });
  it('担当の名前で、その人が担当の回（PRD D337）', () => {
    const staffed = (id: string, clientId: string, date: string, start: string, staffId: string | null) => ({
      ...v(id, clientId, date, start),
      staffId,
    });
    const idx = visitIndex([
      staffed('s-a', 'c1', '2026-10-22', '09:00', 's1'),
      staffed('s-b', 'c2', '2026-10-22', '10:00', null),
      staffed('s-c', 'c2', '2026-10-23', '11:00', 's1'),
    ]);
    // 「長町」は〈利用者さん〉の長町 みどり（訪問なし）と〈スタッフ〉の長町 小太郎の両方に当たる
    expect(paletteVisits('長町 明日', people, idx, TODAY, describeV).map((x) => x.visitId)).toEqual(['s-a']);
    expect(paletteVisits('小太郎', people, idx, TODAY, describeV).map((x) => x.visitId)).toEqual(['s-a', 's-c']);
    const one = paletteVisits('長町 明日', people, idx, TODAY, describeV)[0]!;
    expect(one.label).toBe('図書館 ふみ 10/22（木） 09:00');
  });
  it('「担当なし」「要対応」の語（PRD D337）', () => {
    const staffed = (id: string, date: string, staffId: string | null, cancelled = false) => ({
      ...v(id, 'c2', date, '09:00', cancelled),
      staffId,
    });
    const idx = visitIndex([
      staffed('u1', '2026-10-22', null),
      staffed('u2', '2026-10-23', 's1'),
      staffed('u3', '2026-10-24', null, true),
      staffed('u4', '2026-10-20', null),
    ]);
    expect(paletteVisits('担当なし', people, idx, TODAY, describeV).map((x) => x.visitId)).toEqual(['u1']);
    expect(paletteVisits('たんとうなし 10/20', people, idx, TODAY, describeV).map((x) => x.visitId)).toEqual(['u4']);
    expect(paletteVisits('やぎお 担当なし', people, idx, TODAY, describeV).map((x) => x.visitId)).toEqual(['u1']);
    // 要対応：検査（attention）で当たる回。渡さなければ担当なしと同じ
    expect(paletteVisits('要対応', people, idx, TODAY, describeV).map((x) => x.visitId)).toEqual(['u1']);
    expect(
      paletteVisits('ようたいおう', people, idx, TODAY, describeV, undefined, (x) => x.id === 'u2').map(
        (x) => x.visitId,
      ),
    ).toEqual(['u2']);
    // 要対応は日付が無ければ今日から31日先まで
    const far = visitIndex([staffed('f1', '2026-12-30', null)]);
    expect(paletteVisits('要対応', people, far, TODAY, describeV)).toEqual([]);
    expect(paletteVisits('担当なし', people, far, TODAY, describeV).map((x) => x.visitId)).toEqual(['f1']);
  });
  it('訪問を追加の操作', () => {
    expect(paletteActions(TODAY).find((x) => x.id === 'action:visit-add')).toMatchObject({ op: 'visit-add' });
  });
});
