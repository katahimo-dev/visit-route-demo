// メール連携（PRD D91〜D95。ADR-0017）の件名・本文。本文は文字だけ。担当は確定した割当があればそれ、無ければ今の案
// （lib/monthPrint の printDay と同じ決め方。どちらかを本文に書く）。鍵の情報は includeKeys のときだけ入れる。
// 呼び方は org.terms、事業所名は org.name から。データは書き換えない純粋関数
import type { DemoData } from '../contracts/data';
import type { Client, Org, Staff, Visit } from '../contracts/documents';
import { weekday } from '../domain/time';
import { type BuiltMail, buildMail, MAILTO_LIMIT, uniqueRecipients } from './mailto';
import { type PrintDay, printDay } from './monthPrint';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 「10/18（日）」 */
export function mdw(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}（${WEEK[weekday(date)]}）`;
}
/** 「10/18」 */
const md = (date: string) => {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
};
/** 分 → 「9:00」 */
export const clockText = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;

/** メールアドレスの無い人のボタンの理由（PRD D91） */
export const NO_EMAIL = 'メールアドレスが未登録です';

type MailInput = Parameters<typeof printDay>[0] & Pick<DemoData, 'org'>;

/** 担当の元の言葉（本文に書く） */
export function sourceWord(source: PrintDay['source']): string {
  return source === 'confirmed' ? '確定した割当' : source === 'plan' ? '今の案（まだ確定していません）' : '';
}

/** 1人あての1日の訪問（開始の順） */
export type MailVisit = { start: number; end: number; client: Client | undefined; visit: Visit | undefined };

/** その日の担当ごとの訪問（確定した割当があればそれ、無ければ今の案。printDay と同じ） */
export function dayByStaff(data: MailInput, date: string): { day: PrintDay; byStaff: Map<string, MailVisit[]> } {
  const day = printDay(data, date, null);
  const visitById = new Map(data.visits.map((v) => [v.id, v]));
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const byStaff = new Map<string, MailVisit[]>();
  for (const e of day.entries) {
    if (e.staffId === null) continue;
    const visit = visitById.get(e.visitId);
    const client = visit ? clientById.get(visit.clientId) : undefined;
    const item = { start: e.start, end: e.start + (visit?.durationMinutes ?? 0), client, visit };
    byStaff.set(e.staffId, [...(byStaff.get(e.staffId) ?? []), item]);
  }
  return { day, byStaff };
}

/** 決まりごとの行（空の項目は出さない。鍵は includeKeys のときだけ） */
function ruleLines(c: Client | undefined, includeKeys: boolean): string[] {
  if (!c) return [];
  const rows: [string, string][] = [
    ['住所', c.place.address],
    ['入り方', c.entryNote],
    ['駐車場', c.parkingNote],
    ['注意', c.cautionNote],
    ...(includeKeys ? ([['鍵', c.keyNote]] as [string, string][]) : []),
  ];
  return rows.filter(([, t]) => t.trim() !== '').map(([k, t]) => `   ${k}：${t.replace(/\s*\n\s*/g, ' ')}`);
}

const nameOf = (c: Client | undefined) => (c ? `${c.displayName}様` : '（不明）');

/**
 * 日の予定（担当ごと。PRD D92）の件名・本文。full は 順番・時刻・〈利用者さん〉・住所・入り方・駐車場・注意（鍵は includeKeys のときだけ）。
 * 要点は2段（長い順に試す）：short＝順番・時刻・〈利用者さん〉・住所（鍵は includeKeys のときだけ残す）、
 * shorter＝順番・時刻・〈利用者さん〉だけ。「鍵の情報は…入れていません」は鍵のメモがある訪問があって鍵を入れないときだけ書く
 */
export function dayMailText(
  org: Org,
  staff: Pick<Staff, 'name'>,
  date: string,
  source: PrintDay['source'],
  visits: readonly MailVisit[],
  includeKeys: boolean,
): { subject: string; full: string; short: string[] } {
  const subject = `${mdw(date)}の訪問予定`;
  const head = [`${staff.name}さん`, ''];
  const foot = ['', org.name];
  if (visits.length === 0) {
    const body = [...head, `${mdw(date)}の訪問はありません。`, ...foot].join('\n');
    return { subject, full: body, short: [] };
  }
  const lead = `${mdw(date)}の訪問予定です（${sourceWord(source)}。${visits.length}件）。`;
  const line = (v: MailVisit, i: number) => `${i + 1}. ${clockText(v.start)}〜${clockText(v.end)} ${nameOf(v.client)}`;
  const hasKeys = visits.some((v) => (v.client?.keyNote ?? '').trim() !== '');
  /** 鍵を入れないときの一言（鍵のメモがある訪問があるときだけ） */
  const keyNote = (keysIn: boolean) =>
    hasKeys && !keysIn
      ? [includeKeys ? '※長いため、鍵の情報は省きました。' : '※鍵の情報はメールに入れていません。']
      : [];
  const full = [
    ...head,
    lead,
    '',
    ...visits.flatMap((v, i) => [line(v, i), ...ruleLines(v.client, includeKeys)]),
    ...(keyNote(includeKeys).length > 0 ? ['', ...keyNote(includeKeys)] : []),
    ...foot,
  ].join('\n');
  const short = [
    ...head,
    lead,
    '',
    // 鍵は「鍵の情報も入れる」を選んだときだけ、要点にも残す（選んだ人が要ると決めたもの）
    ...visits.flatMap((v, i) => [
      `${line(v, i)}${v.client?.place.address ? `（${v.client.place.address}）` : ''}`,
      ...(includeKeys && v.client?.keyNote.trim() ? [`   鍵：${v.client.keyNote.replace(/\s*\n\s*/g, ' ')}`] : []),
    ]),
    '',
    '※入り方・駐車場・注意は省きました。',
    ...keyNote(includeKeys),
    ...foot,
  ].join('\n');
  const shorter = [
    ...head,
    lead,
    '',
    ...visits.map(line),
    '',
    '※住所・入り方・駐車場・注意は省きました。',
    ...keyNote(false),
    ...foot,
  ].join('\n');
  return { subject, full, short: [short, shorter] };
}

/** 週の1日（1人あて） */
export type WeekMailDay = {
  date: string;
  source: PrintDay['source'];
  visits: MailVisit[];
  /** その人の休み（希望休・欠勤・勤務なし）。無ければ null */
  off: 'requested' | 'absent' | 'noShift' | null;
  /** その日の担当の決まっていない訪問の数（案なし・未定） */
  pending: number;
};

/** 週の日ごと・担当ごとの訪問（月〜日。PRD D93） */
export function weekByStaff(data: MailInput, dates: readonly string[]): Map<string, WeekMailDay[]> {
  const out = new Map<string, WeekMailDay[]>();
  const days = dates.map((date) => ({ date, ...dayByStaff(data, date) }));
  for (const s of data.staff) {
    out.set(
      s.id,
      days.map(({ date, day, byStaff }) => ({
        date,
        source: day.source,
        visits: byStaff.get(s.id) ?? [],
        off: day.off.find((o) => o.staffId === s.id)?.kind ?? null,
        pending: day.pending,
      })),
    );
  }
  return out;
}

const OFF_WORD = { requested: '希望休', absent: '欠勤', noShift: '休み' } as const;

/** 週の予定（担当ごと。PRD D93）の件名・本文。full は曜日ごとの訪問（時刻・〈利用者さん〉）、short は曜日ごとの時刻と件数 */
export function weekMailText(
  org: Org,
  staff: Pick<Staff, 'name'>,
  days: readonly WeekMailDay[],
): { subject: string; full: string; short: string } {
  const first = days[0]?.date ?? '';
  const last = days[days.length - 1]?.date ?? '';
  const subject = `${md(first)}〜${md(last)} の予定`;
  const dayHead = (d: WeekMailDay) => {
    const tag = d.source === 'plan' && d.visits.length > 0 ? '（案。まだ確定していません）' : '';
    return `■${mdw(d.date)}${tag}`;
  };
  const emptyWord = (d: WeekMailDay) =>
    d.off && d.visits.length === 0
      ? OFF_WORD[d.off]
      : d.source === null && d.pending > 0
        ? '予定はまだ決まっていません'
        : '訪問なし';
  const head = [`${staff.name}さん`, '', `${mdw(first)}〜${mdw(last)}の予定です。`, ''];
  const foot = ['', org.name];
  const full = [
    ...head,
    ...days.flatMap((d) =>
      d.visits.length === 0
        ? [`${dayHead(d)} ${emptyWord(d)}`]
        : [dayHead(d), ...d.visits.map((v) => `  ${clockText(v.start)}〜${clockText(v.end)} ${nameOf(v.client)}`)],
    ),
    ...foot,
  ].join('\n');
  const short = [
    ...head,
    ...days.map((d) =>
      d.visits.length === 0
        ? `${mdw(d.date)} ${emptyWord(d)}`
        : `${mdw(d.date)}${d.source === 'plan' ? '（案）' : ''} ${d.visits.map((v) => clockText(v.start)).join('・')}（${d.visits.length}件）`,
    ),
    '',
    `※${org.terms.client}の名前は省きました。`,
    ...foot,
  ].join('\n');
  return { subject, full, short };
}

/** 欠勤の振り直しの連絡（PRD D94）の件名・本文（本文は lib/contacts の staffMessage に事業所名を足したもの） */
export function contactMailText(org: Org, date: string, message: string): { subject: string; full: string } {
  return { subject: `${mdw(date)}の予定の変更`, full: [message, '', org.name].join('\n') };
}

/** 空き枠の案内文（PRD D95）の件名 */
export const vacancySubject = (org: Org) => `空き枠のご案内（${org.name}）`;

/** 紹介元のメールの宛先（重複なく。名前は紹介元の名前。PRD D95） */
export const referrerRecipients = (clients: readonly Client[]) =>
  uniqueRecipients(clients.map((c) => ({ email: c.referrer.email, name: c.referrer.name })));

/** 1人あてのメール（宛先が無ければ null）。長さの判定は buildMail */
export function mailTo(
  email: string,
  text: { subject: string; full: string; short?: string | readonly string[] },
  limit: number = MAILTO_LIMIT,
): BuiltMail | null {
  if (!email) return null;
  return buildMail({ to: [email], subject: text.subject, full: text.full, short: text.short }, limit);
}
