// メール連携（PRD D91〜D95。ADR-0017）：OS の標準のメールアプリを、宛先・件名・本文の入った状態で開く mailto: の URL を組み立てる。
// 送信は人がメールアプリで押す（アプリからは何も送らない）。画面は <a href> で開くだけ。純粋関数
import { EMAIL_PATTERN } from '../contracts/documents';

/**
 * mailto の URL の長さ（エンコード後の文字数）の目安。これを超えると、本文を途中で切るメールアプリ・OS がある
 * （古い Outlook・Windows の関連付けはおよそ 2000 字）。日本語は1字が9字（%E3%81%82）になるので、本文はおよそ 180 字
 */
export const MAILTO_LIMIT = 1800;

/**
 * メールアドレスの入力を直す（全角→半角・前後の空白・「mailto:」を落とす）。空は ''、緩い形（EMAIL_PATTERN）に合わなければ null。
 * 細かい形（ドメインの綴りなど）は見ない（メールアプリが確かめる）
 */
export function normalizeEmail(raw: string): string | null {
  const s = raw
    .normalize('NFKC')
    .trim()
    .replace(/^mailto:/i, '');
  if (s === '') return '';
  if (s.length > 254 || !EMAIL_PATTERN.test(s)) return null;
  return s;
}

/** 宛先1つをエンコードする（@ は RFC 6068 で使ってよい文字なので読めるまま残す） */
const encodeAddress = (a: string) => encodeURIComponent(a).replace(/%40/g, '@');

/** 本文の改行を CRLF にそろえてエンコードする（改行は %0D%0A） */
export const encodeBody = (body: string) => encodeURIComponent(body.replace(/\r\n|\r|\n/g, '\r\n'));

export type MailParts = {
  /** To（ふつうは1人） */
  to: readonly string[];
  /** BCC（一斉に送るとき。宛先どうしに互いのアドレスを見せない） */
  bcc?: readonly string[];
  subject: string;
  /** 本文（文字だけ）。空なら body を付けない */
  body: string;
};

/** mailto: の URL（宛先・件名・BCC・本文を encodeURIComponent。改行は %0D%0A） */
export function mailtoHref(m: MailParts): string {
  const params: string[] = [];
  if (m.bcc && m.bcc.length > 0) params.push(`bcc=${m.bcc.map(encodeAddress).join(',')}`);
  if (m.subject) params.push(`subject=${encodeURIComponent(m.subject)}`);
  if (m.body) params.push(`body=${encodeBody(m.body)}`);
  return `mailto:${m.to.map(encodeAddress).join(',')}${params.length > 0 ? `?${params.join('&')}` : ''}`;
}

/**
 * 組み立てたメール。mode：'full'＝本文をすべて入れた、'short'＝長いので要点に絞った本文を入れた、
 * 'none'＝要点でも長いので本文を入れていない（画面は「本文をコピー」を並べて知らせる）
 */
export type BuiltMail = {
  href: string;
  mode: 'full' | 'short' | 'none';
  /** URL に入れた本文（'none' は ''） */
  body: string;
  /** すべての本文（コピーに使う） */
  fullBody: string;
  /** URL の長さ（エンコード後） */
  length: number;
};

/**
 * 本文を入れた URL が limit を超えるなら要点（short）に、それでも超えるなら本文なしにする。
 * 宛先・件名だけで超えるときも本文なし（URL はそのまま返す。画面がコピーを並べる）
 */
export function buildMail(
  m: Omit<MailParts, 'body'> & { full: string; short?: string },
  limit: number = MAILTO_LIMIT,
): BuiltMail {
  const make = (body: string) => mailtoHref({ to: m.to, bcc: m.bcc, subject: m.subject, body });
  const full = make(m.full);
  if (full.length <= limit) return { href: full, mode: 'full', body: m.full, fullBody: m.full, length: full.length };
  if (m.short !== undefined) {
    const short = make(m.short);
    if (short.length <= limit)
      return { href: short, mode: 'short', body: m.short, fullBody: m.full, length: short.length };
  }
  const none = make('');
  return { href: none, mode: 'none', body: '', fullBody: m.full, length: none.length };
}

/** メールの宛先の候補（名前とアドレス） */
export type Recipient = { email: string; names: string[] };

/**
 * 宛先を重複なく集める（大文字・小文字は同じとみなし、最初に出た書き方を使う）。空・形の合わないアドレスは除く。
 * 同じアドレスの名前はまとめる（重ならないよう）
 */
export function uniqueRecipients(list: readonly { email: string; name: string }[]): Recipient[] {
  const out = new Map<string, Recipient>();
  for (const x of list) {
    const e = normalizeEmail(x.email);
    if (!e) continue;
    const key = e.toLowerCase();
    const r = out.get(key);
    if (!r) out.set(key, { email: e, names: x.name ? [x.name] : [] });
    else if (x.name && !r.names.includes(x.name)) r.names.push(x.name);
  }
  return [...out.values()];
}
