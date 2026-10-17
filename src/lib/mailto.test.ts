// mailto の組み立て（PRD D91〜D95。ADR-0017）
import { describe, expect, it } from 'vitest';
import {
  buildBccMails,
  buildMail,
  encodeBody,
  MAILTO_LIMIT,
  mailLimitFor,
  mailtoHref,
  normalizeEmail,
  uniqueRecipients,
} from './mailto';

describe('normalizeEmail', () => {
  it('空は空。全角・前後の空白・mailto: を直す', () => {
    expect(normalizeEmail('')).toBe('');
    expect(normalizeEmail('   ')).toBe('');
    expect(normalizeEmail(' ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏｍ ')).toBe('taro@example.com');
    expect(normalizeEmail('mailto:Hana@Example.com')).toBe('Hana@Example.com');
  });
  it('形が緩く合わなければ null（@ が無い・空白・2つの @・区切りの文字）', () => {
    expect(normalizeEmail('あおば相談室')).toBeNull();
    expect(normalizeEmail('a b@example.com')).toBeNull();
    expect(normalizeEmail('a@b@example.com')).toBeNull();
    expect(normalizeEmail('a@example.com,b@example.com')).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(250)}@x.jp`)).toBeNull();
  });
  it('mailto の URL を壊す「?&=%#/」を含むものは通さない', () => {
    for (const bad of [
      'a?b@example.com',
      'a&b@example.com',
      'a=b@example.com',
      'a%b@example.com',
      'a#b@example.com',
      'a/b@example.com',
      'a@example.com?cc=x',
    ])
      expect(normalizeEmail(bad)).toBeNull();
    expect(normalizeEmail('a+b.c_d-e@example.co.jp')).toBe('a+b.c_d-e@example.co.jp');
  });
  it('細かい形は見ない（ドメインに点が無くても通す）', () => {
    expect(normalizeEmail('staff@localhost')).toBe('staff@localhost');
  });
});

describe('mailtoHref', () => {
  it('宛先・件名・本文を encodeURIComponent し、改行は %0D%0A', () => {
    const href = mailtoHref({ to: ['taro@example.com'], subject: '10/18（日）の訪問予定', body: '1行目\n2行目' });
    expect(href).toBe(
      `mailto:taro@example.com?subject=${encodeURIComponent('10/18（日）の訪問予定')}&body=${encodeURIComponent('1行目')}%0D%0A${encodeURIComponent('2行目')}`,
    );
    const u = new URL(href);
    expect(decodeURIComponent(u.searchParams.get('body') ?? '')).toBe('1行目\r\n2行目');
  });
  it('CRLF・CR もそろえる。& や ? や # は本文を壊さない', () => {
    expect(encodeBody('a\r\nb\rc\nd')).toBe('a%0D%0Ab%0D%0Ac%0D%0Ad');
    const href = mailtoHref({ to: [], subject: 'A&B?', body: '#1 & 2 = 3%' });
    const u = new URL(href);
    expect(u.searchParams.get('subject')).toBe('A&B?');
    expect(u.searchParams.get('body')).toBe('#1 & 2 = 3%');
  });
  it('BCC は「,」で並べ、To が空なら mailto:? で始める。件名・本文が空なら付けない', () => {
    expect(mailtoHref({ to: [], bcc: ['a@example.com', 'b+x@example.com'], subject: '', body: '' })).toBe(
      'mailto:?bcc=a@example.com,b%2Bx@example.com',
    );
    expect(mailtoHref({ to: ['a@example.com'], subject: '', body: '' })).toBe('mailto:a@example.com');
  });
});

describe('buildMail（長さの判定）', () => {
  const to = ['taro@example.com'];
  it('目安以内なら本文をすべて入れる', () => {
    const m = buildMail({ to, subject: '件名', full: '短い本文' });
    expect(m.mode).toBe('full');
    expect(m.href.length).toBe(m.length);
    expect(m.length).toBeLessThanOrEqual(MAILTO_LIMIT);
  });
  it('長ければ要点（short）に、それでも長ければ本文なし。コピー用にすべての本文を残す', () => {
    const long = 'あ'.repeat(300);
    const short = buildMail({ to, subject: '件名', full: long, short: '要点' });
    expect(short.mode).toBe('short');
    expect(short.body).toBe('要点');
    expect(short.fullBody).toBe(long);
    const none = buildMail({ to, subject: '件名', full: long, short: 'い'.repeat(300) });
    expect(none.mode).toBe('none');
    expect(none.href).not.toContain('body=');
    expect(none.fullBody).toBe(long);
    expect(buildMail({ to, subject: '件名', full: long }).mode).toBe('none');
  });
  it('判定はエンコード後の長さ（日本語1字＝9字）', () => {
    const base = mailtoHref({ to, subject: '件名', body: '' }).length + '&body='.length;
    const n = Math.floor((MAILTO_LIMIT - base) / 9);
    expect(buildMail({ to, subject: '件名', full: 'あ'.repeat(n) }).mode).toBe('full');
    expect(buildMail({ to, subject: '件名', full: 'あ'.repeat(n + 1) }).mode).toBe('none');
  });
});

describe('uniqueRecipients', () => {
  it('大文字・小文字を同じとみなして重複なく。名前はまとめる。空・形の合わないものは除く', () => {
    expect(
      uniqueRecipients([
        { email: 'Aoba@example.com', name: 'あおば相談室' },
        { email: '', name: '名前だけ' },
        { email: 'aoba@example.com', name: 'あおば相談室' },
        { email: 'aoba@EXAMPLE.com', name: 'あおば（別名）' },
        { email: 'でたらめ', name: 'x' },
        { email: 'hikari@example.com', name: '' },
      ]),
    ).toEqual([
      { email: 'Aoba@example.com', names: ['あおば相談室', 'あおば（別名）'] },
      { email: 'hikari@example.com', names: [] },
    ]);
  });
});

describe('mailLimitFor（端末ごとの目安。ADR-0017）', () => {
  it('Windows と判定できない端末は 2000、iOS・Android・macOS は 8000', () => {
    expect(mailLimitFor('Windows', '')).toBe(2000);
    expect(mailLimitFor(undefined, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(2000);
    expect(mailLimitFor(undefined, 'Mozilla/5.0 (X11; Linux x86_64)')).toBe(2000);
    expect(mailLimitFor('', '')).toBe(2000);
    expect(mailLimitFor('macOS', '')).toBe(8000);
    expect(mailLimitFor(undefined, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(8000);
    expect(mailLimitFor(undefined, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(8000);
    expect(mailLimitFor('Android', 'Mozilla/5.0 (Linux; Android 14)')).toBe(8000);
  });
});

describe('BCC の宛先が多いとき（tooLong・分ける）', () => {
  const many = Array.from({ length: 120 }, (_, i) => `referrer${i}@example.com`);
  it('本文なしでも長すぎれば tooLong', () => {
    const m = buildMail({ to: [], bcc: many, subject: '件名', full: '本文' }, 2000);
    expect(m.mode).toBe('none');
    expect(m.tooLong).toBe(true);
    expect(buildMail({ to: [], bcc: many.slice(0, 2), subject: '件名', full: '本文' }, 2000).tooLong).toBe(false);
  });
  it('目安の長さに収まるよう宛先を前から分け、どの組も tooLong でない。宛先は漏れも重なりもない', () => {
    const groups = buildBccMails({ bcc: many, subject: '空き枠のご案内', full: 'あ'.repeat(100) }, 2000);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.every((g) => !g.mail.tooLong && g.mail.length <= 2000)).toBe(true);
    expect(groups.flatMap((g) => g.bcc)).toEqual(many);
    expect(new URL(groups[0]!.mail.href).searchParams.get('bcc')).toBe(groups[0]!.bcc.join(','));
  });
  it('宛先が少なければ1通', () => {
    const groups = buildBccMails({ bcc: many.slice(0, 3), subject: '件名', full: '本文' }, 2000);
    expect(groups.length).toBe(1);
    expect(groups[0]!.mail.mode).toBe('full');
  });
});
