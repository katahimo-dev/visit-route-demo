// メール連携（PRD D91〜D95。ADR-0017）：OS の標準のメールアプリを、宛先・件名・本文の入った状態で開く mailto: の URL を組み立てる。
// 送信は人がメールアプリで押す（アプリからは何も送らない）。画面は <a href> で開くだけ。純粋関数
import { EMAIL_PATTERN } from '../contracts/documents';

/**
 * mailto の URL の長さ（エンコード後の文字数）の目安。これを超えると、本文を途中で切る・開かないメールアプリ・OS がある。
 * 日本語は1字が9字（%E3%81%82）になる。端末ごとの目安は mailLimitFor（ADR-0017）。これは端末が分からないときの既定
 */
export const MAILTO_LIMIT = 2000;
/** Windows・分からない端末の目安（Windows の関連付け・古い Outlook はおよそ 2000字で切る） */
export const MAILTO_LIMIT_SAFE = 2000;
/** iOS・Android・macOS の目安（標準のメールアプリはずっと長い URL を受ける。余裕を見て 8000字） */
export const MAILTO_LIMIT_LONG = 8000;

/**
 * 端末から目安の長さを決める（純粋関数。画面が navigator.userAgentData?.platform と navigator.userAgent を渡す）。
 * iOS（iPhone・iPad）・Android・macOS は 8000、Windows と判定できない端末は 2000
 */
export function mailLimitFor(platform: string | undefined, userAgent: string): number {
  const p = (platform ?? '').toLowerCase();
  const ua = userAgent.toLowerCase();
  if (p.includes('windows') || ua.includes('windows')) return MAILTO_LIMIT_SAFE;
  if (/android|ios|iphone|ipad|macos|mac os|macintosh/.test(`${p} ${ua}`)) return MAILTO_LIMIT_LONG;
  return MAILTO_LIMIT_SAFE;
}

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
  /** 本文を入れなくても目安を超える（宛先・件名が長すぎる）。画面はボタンを押せなくし、「宛先をコピー」を出す */
  tooLong: boolean;
};

/**
 * 本文を入れた URL が limit を超えるなら要点（short。配列なら長い順に試す）に、それでも超えるなら本文なしにする。
 * 本文なしでも超えるときは tooLong（URL はそのまま返す。画面はボタンを押せなくする）
 */
export function buildMail(
  m: Omit<MailParts, 'body'> & { full: string; short?: string | readonly string[] },
  limit: number = MAILTO_LIMIT,
): BuiltMail {
  const make = (body: string) => mailtoHref({ to: m.to, bcc: m.bcc, subject: m.subject, body });
  const built = (href: string, mode: BuiltMail['mode'], body: string): BuiltMail => ({
    href,
    mode,
    body,
    fullBody: m.full,
    length: href.length,
    tooLong: href.length > limit,
  });
  const full = make(m.full);
  if (full.length <= limit) return built(full, 'full', m.full);
  const shorts = m.short === undefined ? [] : typeof m.short === 'string' ? [m.short] : m.short;
  for (const sh of shorts) {
    const href = make(sh);
    if (href.length <= limit) return built(href, 'short', sh);
  }
  return built(make(''), 'none', '');
}

/**
 * BCC で一斉に送るメールを、宛先を分けて目安の長さに収める（PRD D95）。本文なしの URL が limit 以内に収まるよう、
 * 宛先を前から詰めて組に分け、組ごとに buildMail する。1人でも収まらない宛先は、その1人の組（tooLong）にする
 */
export function buildBccMails(
  m: { bcc: readonly string[]; subject: string; full: string; short?: string | readonly string[] },
  limit: number = MAILTO_LIMIT,
): { bcc: string[]; mail: BuiltMail }[] {
  const groups: string[][] = [];
  let cur: string[] = [];
  const fits = (bcc: string[]) => mailtoHref({ to: [], bcc, subject: m.subject, body: '' }).length <= limit;
  for (const a of m.bcc) {
    if (cur.length > 0 && !fits([...cur, a])) {
      groups.push(cur);
      cur = [];
    }
    cur.push(a);
  }
  if (cur.length > 0) groups.push(cur);
  return groups.map((bcc) => ({
    bcc,
    mail: buildMail({ to: [], bcc, subject: m.subject, full: m.full, short: m.short }, limit),
  }));
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
