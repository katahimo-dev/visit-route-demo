// メール連携の件名・本文（PRD D91〜D95。ADR-0017）
import { describe, expect, it } from 'vitest';
import type { AiPlan, DemoData } from '../contracts/data';
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
import { MAILTO_LIMIT, mailtoHref } from './mailto';
import { REQUESTED_OFF_NOTE } from './requestedOff';

const plan = (date: string, routes: Record<string, string[]>): AiPlan => ({
  date,
  createdAt: 1,
  seed: 1,
  iterations: 1,
  routes,
  unassigned: [],
  score: 0,
  stopped: false,
  rules: [],
  generated: { routes, unassigned: [], score: 0 },
  pins: {},
});

function data(over: Partial<DemoData> = {}): DemoData {
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
  it('確定した割当があればそれ、無ければ今の案。担当ごとに開始の順', () => {
    const d = data({ aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v1'], s2: ['v3'] }) } });
    const p = dayByStaff(d, DATE);
    expect(p.day.source).toBe('plan');
    expect(p.byStaff.get('s1')?.map((v) => v.client?.displayName)).toEqual(['泉', '青葉']);
    const c = dayByStaff({ ...d, manualPlans: { [DATE]: { s2: ['v1', 'v2', 'v3'] } } }, DATE);
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
    expect(t.full).toContain('今の案（まだ確定していません）');
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
    // 要点は入り方・駐車場・注意を省く。鍵は選んだときだけ残す
    expect(k.short[0]).toContain('   鍵：キーボックス 1234');
    expect(t.short[0]).not.toContain('1234');
    expect(k.short[0]).not.toContain('入り方：');
    expect(k.short[0]).toContain('2. 13:00〜14:00 青葉様（仙台市青葉区1-1）');
    // 要点2は 順番・時刻・〈利用者さん〉だけ
    expect(k.short[1]).toContain('2. 13:00〜14:00 青葉様\n');
    expect(k.short[1]).not.toContain('仙台市');
    expect(k.short[1]).toContain('※長いため、鍵の情報は省きました。');
    expect(t.short[0]).toContain('※鍵の情報はメールに入れていません。');
    expect(t.short[1]).toContain('※鍵の情報はメールに入れていません。');
  });

  it('訪問の無い人は「訪問はありません」', () => {
    const t = dayMailText(data().org, { name: '佐藤 一' }, DATE, 'confirmed', [], false);
    expect(t.full).toContain('10/12（月）の訪問はありません。');
  });

  it('メールアドレスの無い人は null。長い本文は要点に（URL は目安以内）', () => {
    const d = data({ aiPlans: { [DATE]: plan(DATE, { s1: ['v2', 'v1'] }) } });
    const { day, byStaff } = dayByStaff(d, DATE);
    const t = dayMailText(d.org, d.staff[0]!, DATE, day.source, byStaff.get('s1')!, false);
    expect(mailTo('', t)).toBeNull();
    const m = mailTo('hana@example.com', t)!;
    expect(m.href.startsWith('mailto:hana@example.com?subject=')).toBe(true);
    expect(m.length).toBeLessThanOrEqual(MAILTO_LIMIT);
    expect(m.mode).toBe('full');
    // 要点の URL の長さちょうどを目安にすると要点、それより短いと本文なし
    const shortLen = mailtoHref({ to: ['hana@example.com'], subject: t.subject, body: t.short[0]! }).length;
    expect(shortLen).toBeLessThan(m.length);
    const tiny = mailTo('hana@example.com', t, shortLen)!;
    expect(tiny.mode).toBe('short');
    expect(new URL(tiny.href).searchParams.get('body')).toContain('入り方・駐車場・注意は省きました');
    const shorterLen = mailtoHref({ to: ['hana@example.com'], subject: t.subject, body: t.short[1]! }).length;
    const tiny2 = mailTo('hana@example.com', t, shortLen - 1)!;
    expect(tiny2.mode).toBe('short');
    expect(tiny2.body).toBe(t.short[1]);
    expect(mailTo('hana@example.com', t, shorterLen - 1)!.mode).toBe('none');
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

describe('週の予定（PRD D93）', () => {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(DATE, i));
  it('件名「10/12〜10/18 の予定」、曜日ごとの訪問。案は「案」と書き、休み・案なし・訪問なしを分ける', () => {
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
    expect(t.full).toContain('■10/13（火）（案。まだ確定していません）\n  10:00〜11:00 青葉様');
    expect(t.full).toContain('■10/14（水） 予定はまだ決まっていません');
    expect(t.full).toContain('■10/15（木） 希望休');
    expect(t.full).toContain('■10/18（日） 休み');
    expect(t.short).toContain('10/12（月） 9:00・13:00（2件）');
    expect(t.short).toContain('10/13（火）（案） 10:00（1件）');
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
