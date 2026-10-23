// メール連携（PRD D91〜D95。ADR-0017）の件名・本文。本文は文字だけ。担当は訪問の今の担当（版2。ADR-0053）
// （lib/monthPrint の printDay と同じ決め方。どちらかを本文に書く）。鍵の情報は includeKeys のときだけ入れる。
// 呼び方は org.terms、事業所名は org.name から。データは書き換えない純粋関数
import type { DemoData } from '../contracts/data';
import type { Client, Org, Staff, Visit } from '../contracts/documents';
import { weekday } from '../domain/time';
import { visitsOn } from '../patterns';
import { type BuiltMail, buildMail, MAILTO_LIMIT, uniqueRecipients } from './mailto';
import { BICYCLE_NOTE, dayStops, HOME_LABEL, legLinks, type RouteStop, tripLinks } from './mapsLink';
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
  return source === 'confirmed' ? '確定した担当' : source === 'plan' ? '今の担当（まだ確定していません）' : '';
}

/** 1人あての1日の訪問（開始の順） */
export type MailVisit = { start: number; end: number; client: Client | undefined; visit: Visit | undefined };

/** その日の担当ごとの訪問（訪問の担当。printDay と同じ） */
export function dayByStaff(data: MailInput, date: string): { day: PrintDay; byStaff: Map<string, MailVisit[]> } {
  const day = printDay(data, date, null);
  const visitById = new Map(visitsOn(data, date).map((v) => [v.id, v]));
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

/** 経路のリンクを作れない場所（〈利用者さん〉が見つからない） */
const NO_PLACE = { address: '', lat: null, lng: null };

/**
 * 1日の経路のリンク（PRD D97・D99・D101。ADR-0018）：全行程（分けたときは「全行程 1/2」。経由地はスマホのブラウザに合わせて3件まで）と、
 * 区間ごと（前の場所→この訪問、最後は自宅まで）。notes は全行程の下に書く一言（場所が未登録で入っていない〈利用者さん〉・自宅、公共交通、自転車）。
 * 公共交通は全行程を作らず区間ごとだけ
 */
export function dayRouteLinks(
  staff: Pick<Staff, 'home' | 'travelMode'>,
  visits: readonly MailVisit[],
  terms: Org['terms'],
): {
  trip: string[];
  notes: string[];
  legs: (string | null)[];
  back: string | null;
  shortLegs: (string | null)[];
  shortBack: string | null;
} {
  const stops: RouteStop[] = dayStops(
    staff.home,
    visits.map((v) => ({ label: nameOf(v.client), place: v.client?.place ?? NO_PLACE })),
  );
  const t = tripLinks(stops, staff.travelMode);
  const trip = t.links.map((x) => `${x.label}（${x.from}→${x.to}）：${x.href}`);
  const ls = legLinks(stops, staff.travelMode);
  const legs = ls.map((l) =>
    l.href ? `${l.to === HOME_LABEL ? '帰りの道順' : '道順'}（${l.from}から）：${l.href}` : null,
  );
  /** 区間ごとの短い行（前の場所の名前を省く。長さの上限があるときに区間ごとの道順を残すため） */
  const shortLegs = ls.map((l) => (l.href ? `${l.to === HOME_LABEL ? '帰りの道順' : '道順'}：${l.href}` : null));
  const anyLink = trip.length > 0 || legs.some((l) => l !== null);
  const notes = [
    ...(trip.length > 0 && t.skipped.length > 0
      ? [`（場所が未登録の${terms.client}（${t.skipped.join('・')}）は全行程に入っていません）`]
      : []),
    ...(trip.length > 0 && t.homeSkipped ? ['（自宅の場所が未登録のため、全行程は自宅を通りません）'] : []),
    ...(staff.travelMode === 'TRANSIT' && anyLink ? ['（公共交通のため、道順は区間ごと（各訪問の下）です）'] : []),
    ...(staff.travelMode === 'BICYCLE' && anyLink ? [`（${BICYCLE_NOTE}）`] : []),
  ];
  return {
    trip,
    notes,
    legs: legs.slice(0, visits.length),
    back: legs[visits.length] ?? null,
    shortLegs: shortLegs.slice(0, visits.length),
    shortBack: shortLegs[visits.length] ?? null,
  };
}

/**
 * 日の予定（担当ごと。PRD D92）の件名・本文。full は 順番・時刻・〈利用者さん〉・住所・入り方・駐車場・注意（鍵は includeKeys のときだけ）と、
 * 〈スタッフ〉の自宅・移動手段があれば Google マップの経路のリンク（全行程と区間ごと。PRD D97。ADR-0018）。
 * short は長い順に試す段階。区間ごとの道順（訪問から次の訪問へ）を最後まで残す（PRD D346）：
 * 区間ごとがあるとき［要点1＋全行程＋区間（短い行）、要点1＋区間、要点2＋区間、要点2＋区間（リンクだけ・帰りなし）］のあとに、区間を外した
 * ［全行程だけの全文、要点1＋全行程、要点2＋全行程、要点2（リンクなし）］（全行程が無ければ全行程の段を除く）。
 * 要点1＝順番・時刻・〈利用者さん〉・住所（鍵は includeKeys のときだけ残す）、要点2＝順番・時刻・〈利用者さん〉だけ。
 * 「鍵の情報は…入れていません」は鍵のメモがある訪問があって鍵を入れないときだけ書く。「本文をコピー」は full（区間ごとのリンクも入る）
 */
export function dayMailText(
  org: Org,
  staff: Pick<Staff, 'name'> & Partial<Pick<Staff, 'home' | 'travelMode'>>,
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
  const route =
    staff.home && staff.travelMode
      ? dayRouteLinks({ home: staff.home, travelMode: staff.travelMode }, visits, org.terms)
      : { trip: [], notes: [], legs: [], back: null, shortLegs: [], shortBack: null };
  const hasTrip = route.trip.length > 0;
  /** 区間ごとのリンクがあるか */
  const hasLegs = route.legs.some((l) => l !== null) || route.back !== null;
  /** 道順の見出しと全行程・一言（本文の上。移動の分数・キロ数はアプリの目安で、Google マップで確かめる）。公共交通は一言だけ */
  const routeBlock = (withTrip: boolean) =>
    (withTrip && hasTrip) || hasLegs
      ? ['■Google マップの道順', ...(withTrip ? route.trip : []), ...route.notes, '']
      : [];
  /** 訪問の行の中身：all＝決まりごとまで、address＝住所まで（鍵は includeKeys のときだけ）、none＝順番・時刻・名前だけ */
  type Detail = 'all' | 'address' | 'none';
  const visitLines = (v: MailVisit, i: number, detail: Detail) =>
    detail === 'all'
      ? [line(v, i), ...ruleLines(v.client, includeKeys)]
      : detail === 'address'
        ? [
            `${line(v, i)}${v.client?.place.address ? `（${v.client.place.address}）` : ''}`,
            // 鍵は「鍵の情報も入れる」を選んだときだけ、要点にも残す（選んだ人が要ると決めたもの）
            ...(includeKeys && v.client?.keyNote.trim()
              ? [`   鍵：${v.client.keyNote.replace(/\s*\n\s*/g, ' ')}`]
              : []),
          ]
        : [line(v, i)];
  /** 本文：detail＝訪問の行、trip＝全行程を入れる、legs＝区間ごと（full＝前の場所の名前つき・short＝短い行・none＝入れない） */
  /** 区間を残す段の短い冒頭（日付・件数・未確定か） */
  const shortLead = `${mdw(date)} ${visits.length}件${source === 'confirmed' ? '' : '（未確定）'}`;
  const bodyOf = (detail: Detail, withTrip: boolean, legs: 'full' | 'short' | 'bare' | 'none') => {
    // 区間の短い行の段は、冒頭・省いた知らせを短くして区間ごとの道順を残す（長さの上限 2000字の端末向け）。
    // bare は「道順：」も省いてリンクだけ（訪問の行のすぐ下なので、その訪問への道順と分かる）。帰りの道順も省く
    const compact = legs === 'short' || legs === 'bare';
    const bare = (x: string | null | undefined) => (x ? x.slice(x.indexOf('：') + 1) : null);
    const legOf = (i: number) =>
      legs === 'full'
        ? route.legs[i]
        : legs === 'short'
          ? route.shortLegs[i]
          : legs === 'bare'
            ? bare(route.shortLegs[i])
            : null;
    const back = legs === 'full' ? route.back : legs === 'short' ? route.shortBack : null;
    const dropped = [
      ...(detail === 'none' ? ['住所'] : []),
      ...(detail !== 'all' ? ['入り方・駐車場・注意'] : []),
      ...(hasTrip && !withTrip ? ['1日の全行程の道順'] : []),
      ...(hasLegs && legs === 'none' ? ['区間ごとの道順'] : []),
    ];
    const block =
      legs === 'none'
        ? withTrip && hasTrip
          ? routeBlock(true)
          : []
        : compact && !withTrip && route.notes.length === 0
          ? []
          : routeBlock(withTrip);
    return [
      ...head,
      compact ? shortLead : lead,
      '',
      ...block,
      ...visits.flatMap((v, i) => {
        const leg = legOf(i);
        return [...visitLines(v, i, detail), ...(leg ? [`   ${leg}`] : [])];
      }),
      ...(back ? ['', back] : []),
      ...(dropped.length > 0
        ? [
            '',
            compact
              ? `※${detail === 'none' ? '住所' : '入り方'}${legs === 'bare' && route.shortBack ? '・帰りの道順' : ''}などは省略`
              : `※長いため、${dropped.join('・')}は省きました。`,
          ]
        : []),
      ...(compact
        ? hasKeys && !(includeKeys && detail === 'address')
          ? ['※鍵は省略']
          : []
        : keyNote(detail === 'none' ? false : includeKeys)),
      ...foot,
    ].join('\n');
  };
  const full = bodyOf('all', true, 'full');
  const withLegs = hasLegs
    ? [
        ...(hasTrip ? [bodyOf('address', true, 'short')] : []),
        bodyOf('address', false, 'short'),
        bodyOf('none', false, 'short'),
        bodyOf('none', false, 'bare'),
      ]
    : [];
  const withoutLegs = hasTrip
    ? [
        ...(hasLegs ? [bodyOf('all', true, 'none')] : []),
        bodyOf('address', true, 'none'),
        bodyOf('none', true, 'none'),
        bodyOf('none', false, 'none'),
      ]
    : [bodyOf('address', false, 'none'), bodyOf('none', false, 'none')];
  return { subject, full, short: [...withLegs, ...withoutLegs] };
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

/** 週の予定（担当ごと。PRD D93・D346）の件名・本文。full は曜日ごとの訪問（時刻・〈利用者さん〉）、short は曜日ごとの時刻と件数。確定していない日があれば冒頭に1回だけ書く */
export function weekMailText(
  org: Org,
  staff: Pick<Staff, 'name'>,
  days: readonly WeekMailDay[],
): { subject: string; full: string; short: string } {
  const first = days[0]?.date ?? '';
  const last = days[days.length - 1]?.date ?? '';
  const subject = `${md(first)}〜${md(last)} の予定`;
  /** 日の見出し（確定していない日の印は日ごとに付けず、冒頭に1回だけ書く。PRD D346） */
  const dayHead = (d: WeekMailDay) => `■${mdw(d.date)}`;
  /** 確定していない日があるとき冒頭に書く一言（週のメールは見通し。確定は前日の日のメールで知らせる） */
  const tentative = days.some((d) => d.source === 'plan' && d.visits.length > 0)
    ? ['※変わることがあります。確定した予定は前日のメールでお知らせします。', '']
    : [];
  const emptyWord = (d: WeekMailDay) =>
    d.off && d.visits.length === 0 ? OFF_WORD[d.off] : d.pending > 0 ? '予定はまだ決まっていません' : '訪問なし';
  const head = [`${staff.name}さん`, '', `${mdw(first)}〜${mdw(last)}の予定です。`, '', ...tentative];
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
        : `${mdw(d.date)} ${d.visits.map((v) => clockText(v.start)).join('・')}（${d.visits.length}件）`,
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
