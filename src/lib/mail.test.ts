// メール連携の件名・本文（PRD D91〜D95。ADR-0017）
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { clientSchema, staffSchema } from '../contracts/documents';
import { addDays } from '../domain/time';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import {
  contactMailText,
  dayByStaff,
  dayMailText,
  mailTo,
  mdw,
  referrerRecipients,
  vacancySubject,
  weekByStaff,
  weekMailText,
} from './mail';
import { mailtoHref } from './mailto';
import { REQUESTED_OFF_NOTE } from './requestedOff';

/** 担当の並び（版2：担当は訪問に持つ。data の aiPlans・manualPlans で訪問に書く） */
const plan = (_date: string, routes: Record<string, string[]>) => routes;
type Routes = Record<string, string[]>;

/**
 * テストのデータ。aiPlans は日ごとの担当の並び（訪問に担当を書く）、manualPlans はそれに加えて伝えた（確定）日にする
 */
function data(
  over: Partial<DemoData> & { aiPlans?: Record<string, Routes>; manualPlans?: Record<string, Routes> } = {},
): DemoData {
  const { aiPlans = {}, manualPlans = {}, ...rest } = over;
  const owner = new Map<string, string>();
  for (const routes of [...Object.values(aiPlans), ...Object.values(manualPlans)])
    for (const [sid, ids] of Object.entries(routes)) for (const id of ids) owner.set(id, sid);
  const d = base(rest);
  const visits = d.visits.map((v) => (owner.has(v.id) ? { ...v, staffId: owner.get(v.id)! } : v));
  const snapshots = Object.fromEntries(Object.keys(manualPlans).map((date) => [date, { date, at: 1, visits: [] }]));
  return { ...d, visits, snapshots: { ...d.snapshots, ...snapshots } };
}

function base(over: Partial<DemoData> = {}): DemoData {
  return makeData({
    staff: [
      staff('s1', 38.26, 140.87, { name: '山田 花', email: 'hana@example.com' }),
      staff('s2', 38.27, 140.88, { name: '佐藤 一' }),
    ],
    clients: [
      client('c1', 38.265, 140.875, {
        displayName: '青葉',
        place: { address: '仙台市青葉区1-1', lat: 38.265, lng: 140.875, postalCode: '' },
        entryNote: 'インターホンは2回',
        keyNote: 'キーボックス 1234',
        parkingNote: '前の道に停めない',
        cautionNote: '犬がいます',
      }),
      client('c2', 38.266, 140.876, { displayName: '泉' }),
      client('c3', 38.267, 140.877, { displayName: '宮城野' }),
    ],
    visits: [
      visit('v1', 'c1', '13:00', '13:00', { windowKind: 'fixed' }),
      visit('v2', 'c2', '09:00', '09:00', { windowKind: 'fixed' }),
      visit('v3', 'c3', '11:00', '11:00', { windowKind: 'fixed' }),
    ],
    ...over,
  });
}

describe('mdw', () => {
  it('「10/12（月）」', () => {
    expect(mdw(DATE)).toBe('10/12（月）');
  });
});

describe('日の予定（PRD D92）', () => {
  it('訪問の担当で、担当ごとに開始の順。確定（伝えた）日は confirmed', () => {
    const d = data({ aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v1'], s2: ['v3'] }) } });
    const p = dayByStaff(d, DATE);
    expect(p.day.source).toBe('plan');
    expect(p.byStaff.get('s1')?.map((v) => v.client?.displayName)).toEqual(['泉', '青葉']);
    const c = dayByStaff(data({ manualPlans: { [DATE]: { s2: ['v1', 'v2', 'v3'] } } }), DATE);
    expect(c.day.source).toBe('confirmed');
    expect(c.byStaff.get('s1')).toBeUndefined();
    expect(c.byStaff.get('s2')?.length).toBe(3);
  });

  it('件名と本文：順番・時刻・〈利用者さん〉・住所・入り方・駐車場・注意。鍵は選んだときだけ', () => {
    const d = data({ aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v1'] }) } });
    const { day, byStaff } = dayByStaff(d, DATE);
    const t = dayMailText(d.org, d.staff[0]!, DATE, day.source, byStaff.get('s1')!, false);
    expect(t.subject).toBe('10/12（月）の訪問予定');
    expect(t.full).toContain('山田 花さん');
    expect(t.full).toContain('今の担当（まだ確定していません）');
    expect(t.full).toContain('1. 9:00〜10:00 泉様');
    expect(t.full).toContain('2. 13:00〜14:00 青葉様');
    expect(t.full).toContain('住所：仙台市青葉区1-1');
    expect(t.full).toContain('入り方：インターホンは2回');
    expect(t.full).toContain('駐車場：前の道に停めない');
    expect(t.full).toContain('注意：犬がいます');
    expect(t.full).not.toContain('1234');
    expect(t.full).toContain('鍵の情報はメールに入れていません');
    expect(t.full.endsWith(d.org.name)).toBe(true);
    const k = dayMailText(d.org, d.staff[0]!, DATE, day.source, byStaff.get('s1')!, true);
    expect(k.full).toContain('鍵：キーボックス 1234');
    // 要点（区間を外した段 5・6）は入り方・駐車場・注意を省く。鍵は選んだときだけ残す
    expect(k.short[5]).toContain('   鍵：キーボックス 1234');
    expect(t.short[5]).not.toContain('1234');
    expect(k.short[5]).not.toContain('入り方：');
    expect(k.short[5]).toContain('2. 13:00〜14:00 青葉様（仙台市青葉区1-1）');
    // 要点2は 順番・時刻・〈利用者さん〉だけ
    expect(k.short[6]).toContain('2. 13:00〜14:00 青葉様\n');
    expect(k.short[6]).not.toContain('仙台市');
    expect(k.short[6]).toContain('※長いため、鍵の情報は省きました。');
    expect(t.short[5]).toContain('※鍵の情報はメールに入れていません。');
    expect(t.short[6]).toContain('※鍵の情報はメールに入れていません。');
    // 区間を残す短い段も、鍵は選んだときだけ（要点1）。要点2 は「鍵は省略」
    expect(k.short[1]).toContain('   鍵：キーボックス 1234');
    expect(k.short[2]).toContain('※鍵は省略');
    expect(t.short[1]).toContain('※鍵は省略');
  });

  it('訪問の無い人は「訪問はありません」', () => {
    const t = dayMailText(data().org, { name: '佐藤 一' }, DATE, 'confirmed', [], false);
    expect(t.full).toContain('10/12（月）の訪問はありません。');
  });

  it('メールアドレスの無い人は null。長い本文は段階を追って短く（URL は目安以内）', () => {
    const d = data({ aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v1'] }) } });
    const { day, byStaff } = dayByStaff(d, DATE);
    const t = dayMailText(d.org, d.staff[0]!, DATE, day.source, byStaff.get('s1')!, false);
    expect(mailTo('', t)).toBeNull();
    const m = mailTo('hana@example.com', t, 8000)!;
    expect(m.href.startsWith('mailto:hana@example.com?subject=')).toBe(true);
    expect(m.mode).toBe('full');
    // 目安に収まる最初の段階を使う。どの段階より短いと本文なし
    const lens = t.short.map((b) => mailtoHref({ to: ['hana@example.com'], subject: t.subject, body: b }).length);
    expect(Math.max(...lens)).toBeLessThan(m.length);
    t.short.forEach((_, i) => {
      const x = mailTo('hana@example.com', t, lens[i]!)!;
      const first = lens.findIndex((n) => n <= lens[i]!);
      expect(x.mode).toBe('short');
      expect(x.body).toBe(t.short[first]);
    });
    expect(mailTo('hana@example.com', t, Math.min(...lens) - 1)!.mode).toBe('none');
  });

  it('鍵のメモのある訪問が無ければ「鍵の情報は…」を書かない', () => {
    const d = data({ aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v3'] }) } });
    const { day, byStaff } = dayByStaff(d, DATE);
    const t = dayMailText(d.org, d.staff[0]!, DATE, day.source, byStaff.get('s1')!, false);
    expect(t.full).not.toContain('鍵');
    expect(t.short.join('')).not.toContain('鍵');
  });

  it.each([4, 5, 6])('訪問 %i件の日も、目安 2000字の中に本文（要点1か要点2）が入る', (n) => {
    const names = ['青葉', '泉', '宮城野', '若林', '太白', '秋保'];
    const clients = names.slice(0, n).map((name, i) =>
      client(`k${i}`, 38.26 + i / 1000, 140.87, {
        displayName: `${name} 花子`,
        place: {
          address: `仙台市${name}区中央${i + 1}丁目1-1 架空マンション101`,
          lat: 38.26,
          lng: 140.87,
          postalCode: '',
        },
        entryNote: 'インターホンを押してから玄関で一声かけてください',
        parkingNote: '建物の裏の来客用の2番に停めてください',
        cautionNote: '段差が多いので足元に気を付けてください',
      }),
    );
    const visits = clients.map((c, i) =>
      visit(`x${i}`, c.id, `${String(8 + i * 2).padStart(2, '0')}:00`, `${String(8 + i * 2).padStart(2, '0')}:00`, {
        windowKind: 'fixed',
      }),
    );
    const d = data({ clients, visits, aiPlans: { [DATE]: plan(DATE, { s1: visits.map((v) => v.id) }) } });
    const { day, byStaff } = dayByStaff(d, DATE);
    expect(byStaff.get('s1')?.length).toBe(n);
    const t = dayMailText(d.org, d.staff[0]!, DATE, day.source, byStaff.get('s1')!, false);
    const m = mailTo('hana@example.com', t, 2000)!;
    expect(m.mode).toBe('short');
    expect(m.length).toBeLessThanOrEqual(2000);
    expect(m.body).toContain(`${n}. `);
  });
});

describe('日の予定の経路のリンク（PRD D97。ADR-0018）', () => {
  const urls = (text: string) => [...text.matchAll(/https:\S+/g)].map((m) => new URL(m[0]));
  it('全行程（自宅→訪問…→自宅、経由地付き）と区間ごと。移動手段は travelmode に。鍵・名前は URL に入れない', () => {
    const d = data({ aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v1'] }) } });
    const s1 = { ...d.staff[0]!, travelMode: 'BICYCLE' as const };
    const { day, byStaff } = dayByStaff(d, DATE);
    const t = dayMailText(d.org, s1, DATE, day.source, byStaff.get('s1')!, true);
    expect(t.full).toContain(
      '■Google マップの道順\n全行程（自宅→自宅）：https://www.google.com/maps/dir/?api=1&origin=',
    );
    const [trip, ...legs] = urls(t.full);
    expect(trip!.searchParams.get('origin')).toBe('38.26,140.87');
    expect(trip!.searchParams.get('destination')).toBe('38.26,140.87');
    expect(trip!.searchParams.get('waypoints')).toBe('38.266,140.876|38.265,140.875');
    expect(trip!.searchParams.get('travelmode')).toBe('bicycling');
    expect(t.full).toContain('   道順（自宅から）：');
    expect(t.full).toContain('   道順（泉様から）：');
    expect(t.full).toContain('帰りの道順（青葉様から）：');
    expect(legs.map((u) => u.searchParams.get('destination'))).toEqual([
      '38.266,140.876',
      '38.265,140.875',
      '38.26,140.87',
    ]);
    for (const u of urls(t.full)) {
      expect(u.href).not.toContain('1234');
      expect(decodeURIComponent(u.href)).not.toContain('青葉');
    }
  });
  it('長いときは区間ごとの道順を残し、決まりごと・全行程・住所を先に外す（PRD D346）。本文をコピー（fullBody）にはすべて入る', () => {
    const d = data({ aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v1'] }) } });
    const { day, byStaff } = dayByStaff(d, DATE);
    const t = dayMailText(d.org, d.staff[0]!, DATE, day.source, byStaff.get('s1')!, false);
    // 区間を残す段：要点1＋全行程＋区間 → 要点1＋区間 → 要点2＋区間 → 要点2＋区間（リンクだけ・帰りなし）
    expect(t.short[0]).toContain('全行程（自宅→自宅）');
    expect(t.short[0]).toContain('   道順：https://www.google.com/maps/dir/');
    expect(t.short[0]).toContain('帰りの道順：https:');
    expect(t.short[0]).not.toContain('入り方：');
    expect(t.short[1]).not.toContain('全行程');
    expect(t.short[1]).toContain('   道順：https:');
    expect(t.short[1]).toContain('※入り方などは省略');
    expect(t.short[2]).not.toContain('仙台市');
    expect(t.short[2]).toContain('※住所などは省略');
    expect(t.short[3]).not.toContain('道順：');
    expect(t.short[3]).not.toContain('帰りの道順：');
    expect(t.short[3]).toMatch(/\n {3}https:\/\/www\.google\.com\/maps\/dir\//);
    expect(t.short[3]).toContain('※住所・帰りの道順などは省略');
    // 区間を外す段（いままでの段）：全行程だけの全文 → 要点1＋全行程 → 要点2＋全行程 → 要点2（リンクなし）
    expect(t.short[4]).toContain('全行程（自宅→自宅）');
    expect(t.short[4]).not.toContain('道順（自宅から）');
    expect(t.short[4]).toContain('※長いため、区間ごとの道順は省きました。');
    expect(t.short[7]).not.toContain('https:');
    expect(t.short[7]).toContain(
      '※長いため、住所・入り方・駐車場・注意・1日の全行程の道順・区間ごとの道順は省きました。',
    );
    const m = mailTo('hana@example.com', t, 2000)!;
    expect(m.mode).toBe('short');
    expect(m.body).toContain('道順：https:');
    expect(m.fullBody).toContain('道順（自宅から）');
  });
  it('自宅の場所が無ければ訪問だけをつなぎ、1件目の区間のリンクは出さない。住所だけの訪問先は住所の文字で', () => {
    const d = data({
      staff: [staff('s1', 0, 0, { name: '山田 花', home: { address: '', lat: null, lng: null } })],
      clients: [
        client('c1', 0, 0, {
          displayName: '青葉',
          place: { address: '仙台市青葉区1-1', lat: null, lng: null, postalCode: '' },
        }),
        client('c2', 38.266, 140.876, { displayName: '泉' }),
      ],
      aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v1'] }) },
      visits: [
        visit('v1', 'c1', '13:00', '13:00', { windowKind: 'fixed' }),
        visit('v2', 'c2', '09:00', '09:00', { windowKind: 'fixed' }),
      ],
    });
    const { day, byStaff } = dayByStaff(d, DATE);
    const t = dayMailText(d.org, d.staff[0]!, DATE, day.source, byStaff.get('s1')!, false);
    expect(t.full).toContain('全行程（泉様→青葉様）');
    expect(t.full).not.toContain('道順（自宅から）');
    expect(t.full).not.toContain('帰りの道順');
    const [trip, leg] = urls(t.full);
    expect(trip!.searchParams.get('destination')).toBe('仙台市青葉区1-1');
    expect(leg!.searchParams.get('origin')).toBe('38.266,140.876');
  });
  it('訪問4件は全行程を2本に分ける（経由地はスマホのブラウザに合わせて3件まで）', () => {
    const d = data({
      clients: [...data().clients, client('c4', 38.268, 140.878, { displayName: '若林' })],
      visits: [...data().visits, visit('v4', 'c4', '15:00', '15:00', { windowKind: 'fixed' })],
      aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v3', 'v1', 'v4'] }) },
    });
    const { day, byStaff } = dayByStaff(d, DATE);
    const t = dayMailText(d.org, d.staff[0]!, DATE, day.source, byStaff.get('s1')!, false);
    expect(t.full).toContain('全行程 1/2（自宅→若林様）：');
    expect(t.full).toContain('全行程 2/2（若林様→自宅）：');
    const trips = urls(t.full).slice(0, 2);
    expect(trips.map((u) => u.searchParams.get('waypoints')?.split('|').length)).toEqual([3, undefined]);
  });
  it('場所が未登録の〈利用者さん〉は全行程に入っていないと書く（呼び方は org.terms）', () => {
    const d = data({ aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v3', 'v1'] }) } });
    const clients = d.clients.map((c) =>
      c.id === 'c3' ? { ...c, place: { address: '', lat: null, lng: null, postalCode: '' } } : c,
    );
    const dd = { ...d, clients };
    const { day, byStaff } = dayByStaff(dd, DATE);
    const t = dayMailText(dd.org, dd.staff[0]!, DATE, day.source, byStaff.get('s1')!, false);
    expect(t.full).toContain(`（場所が未登録の${dd.org.terms.client}（宮城野様）は全行程に入っていません）`);
    expect(t.short[0]).toContain('は全行程に入っていません');
    expect(t.full).not.toContain('道順（泉様から）');
  });
  it('公共交通は全行程を出さず区間ごとだけ。段階は 区間を残す3段 → 要点1 → 要点2', () => {
    const d = data({ aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v1'] }) } });
    const s1 = { ...d.staff[0]!, travelMode: 'TRANSIT' as const };
    const { day, byStaff } = dayByStaff(d, DATE);
    const t = dayMailText(d.org, s1, DATE, day.source, byStaff.get('s1')!, false);
    expect(t.full).not.toContain('全行程');
    expect(t.full).toContain('（公共交通のため、道順は区間ごと（各訪問の下）です）');
    expect(t.full).toContain('   道順（自宅から）：');
    expect(urls(t.full).every((u) => u.searchParams.get('travelmode') === 'transit')).toBe(true);
    // 区間を残す段（要点1＋区間 → 要点2＋区間 → リンクだけ）のあとに、区間を外した 要点1 → 要点2
    expect(t.short.length).toBe(5);
    expect(t.short[0]).toContain('（公共交通のため、道順は区間ごと（各訪問の下）です）');
    expect(t.short[0]).toContain('   道順：https:');
    expect(t.short[3]).not.toContain('https:');
    expect(t.short[3]).toContain('※長いため、入り方・駐車場・注意・区間ごとの道順は省きました。');
    expect(t.short[4]).toContain('※長いため、住所・入り方・駐車場・注意・区間ごとの道順は省きました。');
  });
  it('自転車は「経路が出ないときは徒歩に」と添える', () => {
    const d = data({ aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v1'] }) } });
    const s1 = { ...d.staff[0]!, travelMode: 'BICYCLE' as const };
    const { day, byStaff } = dayByStaff(d, DATE);
    const t = dayMailText(d.org, s1, DATE, day.source, byStaff.get('s1')!, false);
    expect(t.full).toContain('（自転車の経路が出ないときは、Google マップで徒歩に切り替えてください。）');
    expect(t.short[1]).toContain('徒歩に切り替えて');
  });
  it('自宅・移動手段を渡さなければリンクなし（要点は2段のまま）', () => {
    const d = data({ aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v1'] }) } });
    const { day, byStaff } = dayByStaff(d, DATE);
    const t = dayMailText(d.org, { name: '山田 花' }, DATE, day.source, byStaff.get('s1')!, false);
    expect(t.full).not.toContain('https:');
    expect(t.short.length).toBe(2);
  });
});

describe('週の予定（PRD D93）', () => {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(DATE, i));
  it('件名「10/12〜10/18 の予定」、曜日ごとの訪問。確定していない日は冒頭に1回書き、休み・担当なし・訪問なしを分ける', () => {
    const next = addDays(DATE, 1);
    const d = data({
      visits: [
        ...data().visits,
        visit('w1', 'c1', '10:00', '10:00', { date: next, windowKind: 'fixed' }),
        visit('w2', 'c2', '10:00', '10:00', { date: addDays(DATE, 2), windowKind: 'fixed' }),
      ],
      manualPlans: { [DATE]: { s1: ['v2', 'v1'], s2: ['v3'] } },
      aiPlans: { [next]: plan(next, { s1: ['w1'] }) },
      absences: [{ id: 'a', staffId: 's1', date: addDays(DATE, 3), from: null, to: null, note: REQUESTED_OFF_NOTE }],
    });
    const days = weekByStaff(d, dates).get('s1')!;
    const t = weekMailText(d.org, d.staff[0]!, days);
    expect(t.subject).toBe('10/12〜10/18 の予定');
    expect(t.full).toContain('■10/12（月）\n  9:00〜10:00 泉様\n  13:00〜14:00 青葉様');
    expect(t.full).toContain('■10/13（火）\n  10:00〜11:00 青葉様');
    expect(t.full).not.toContain('まだ確定していません');
    // 確定していない日があれば冒頭に1回だけ（PRD D346）
    expect(t.full.split('確定した予定は前日のメールでお知らせします').length).toBe(2);
    expect(t.short).toContain('※変わることがあります。確定した予定は前日のメールでお知らせします。');
    expect(t.full).toContain('■10/14（水） 予定はまだ決まっていません');
    expect(t.full).toContain('■10/15（木） 希望休');
    expect(t.full).toContain('■10/18（日） 休み');
    expect(t.short).toContain('10/12（月） 9:00・13:00（2件）');
    expect(t.short).toContain('10/13（火） 10:00（1件）');
  });
});

describe('欠勤の連絡・空き枠の案内（PRD D94・D95）', () => {
  it('連絡のメールは件名「10/12（月）の予定の変更」、本文は連絡文＋事業所名', () => {
    const t = contactMailText(data().org, DATE, '山田 花さん\n本日の予定の変更です。');
    expect(t.subject).toBe('10/12（月）の予定の変更');
    expect(t.full).toBe(`山田 花さん\n本日の予定の変更です。\n\n${data().org.name}`);
  });
  it('紹介元の宛先は重複なく、件名は事業所名入り', () => {
    const d = data();
    const clients = d.clients.map((c, i) => ({
      ...c,
      referrer: {
        name: i === 2 ? 'ひかり' : 'あおば',
        contact: '',
        note: '',
        email: i === 2 ? 'hikari@example.com' : 'aoba@example.com',
      },
    }));
    expect(referrerRecipients(clients).map((r) => r.email)).toEqual(['aoba@example.com', 'hikari@example.com']);
    expect(vacancySubject(d.org)).toBe(`空き枠のご案内（${d.org.name}）`);
  });
});

describe('データの形（PRD D91。DATA_VERSION は1のまま）', () => {
  it('メールアドレスの無い古いデータは空。形の合わない値は止める', () => {
    const { email: _s, ...oldStaff } = staff('s1', 38, 140);
    expect(staffSchema.parse(oldStaff).email).toBe('');
    const c = client('c1', 38, 140);
    const { email: _r, ...oldReferrer } = c.referrer;
    expect(clientSchema.parse({ ...c, referrer: oldReferrer }).referrer.email).toBe('');
    expect(staffSchema.safeParse({ ...oldStaff, email: 'あおば' }).success).toBe(false);
    expect(staffSchema.safeParse({ ...oldStaff, email: 'a@example.com' }).success).toBe(true);
  });
});
