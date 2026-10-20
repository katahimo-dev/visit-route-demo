// 欠勤・キャンセルの連絡（PRD D35・D244〜D246。ADR-0011 追記・ADR-0038）：差（reassign.contactsOf の一覧）と取り消した訪問から、
// 誰に何を伝えるかの一覧と連絡文を作る。送信はしない（画面がコピー・メールアプリを開くだけ）。呼び方は org.terms から渡す。純粋関数
import type { ContactList, ContactVisit, StaffContact } from '../contracts/reassign';
import { minutesToHhmm, weekday } from '../domain/time';

/**
 * 連絡文に使う名前・呼び方。敬称（訪問先の「様」・スタッフの「さん」）は固定で、呼び方（「スタッフ」など）が出る箇所は
 * org.terms から渡す（呼び方を変えても文が崩れないよう、訪問先の呼び方は文に出さない）
 */
export type ContactWords = {
  /** 日付の書き方（dateWordOf「10月15日（木）」。連絡文は後から読まれるので「本日」にしない。D245） */
  day: string;
  /** スタッフの呼び方（org.terms.staff） */
  staffWord: string;
  staffName: (id: string) => string;
  clientName: (id: string) => string;
  /** 訪問先の住所（無ければ空）。スタッフあての「お願いします」の行だけに載せる（D246） */
  clientAddress: (id: string) => string;
  /** 訪問の所要（分。分からなければ null）。スタッフあての「お願いします」の行だけ */
  visitMinutes?: (visitId: string) => number | null;
  /** 事業所名（〈利用者さん〉あての名乗り。空なら名乗りを省く） */
  orgName?: string;
};

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 日付 →「10月15日（木）」（連絡文の日付の書き方。D245） */
export function dateWordOf(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}月${d}日（${WEEK[weekday(date)]}）`;
}

/** その日が今日なら「本日」、それ以外は「10月15日（木）」（画面の見出し用） */
export function dayWordOf(date: string, today: string): string {
  return date === today ? '本日' : dateWordOf(date);
}

/** 分 → 「9:00」（24時間・時の0は付けない。D245） */
export function clock(minutes: number | null): string {
  return minutes === null ? '' : minutesToHhmm(minutes).replace(/^0(\d)/, '$1');
}

/** 名前の姓（空白の前。〈利用者さん〉あてには担当の姓だけを載せる。D246） */
export function familyName(name: string): string {
  return name.trim().split(/[\s　]+/)[0] || name;
}

/** 開始が四捨五入で変わるか（reassignDiff と同じ） */
const timeMoved = (c: ContactVisit) =>
  c.fromStart !== null && c.toStart !== null && Math.round(c.toStart - c.fromStart) !== 0;

/** 取り消した訪問（キャンセル。担当あての「中止」の連絡。D244） */
export type CancelledContact = {
  visitId: string;
  clientId: string;
  /** 取り消す前の担当（確定した割当、無ければ今の案。null＝担当なし＝連絡しない） */
  staffId: string | null;
  /** 取り消す前の開始（0時からの分） */
  start: number | null;
};

/**
 * スタッフへの連絡文（丁寧語の短文。D245）。行は元の時刻の順（同じ時刻は 新しく入る → 外れる → 時刻 → 中止）。
 * 〈利用者さん〉の住所・所要は「お願いします」の行だけ（D246）
 */
export function staffMessage(c: StaffContact, w: ContactWords, cancelled: readonly CancelledContact[] = []): string {
  const lines: { at: number; text: string }[] = [];
  for (const x of c.added) {
    const addr = w.clientAddress(x.clientId);
    const min = w.visitMinutes?.(x.visitId) ?? null;
    const extra = [addr, min ? `${min}分` : ''].filter(Boolean).join('・');
    lines.push({
      at: x.toStart ?? 0,
      text: `・${clock(x.toStart)} ${w.clientName(x.clientId)}様の訪問をお願いします${extra ? `（${extra}）` : ''}。`,
    });
  }
  for (const x of c.removed) {
    const head = `・${clock(x.fromStart)} ${w.clientName(x.clientId)}様の訪問は`;
    lines.push({
      at: x.fromStart ?? 0,
      text:
        x.toStaffId === null
          ? `${head}、代わりの${w.staffWord}を調整中です。伺わなくて大丈夫です。`
          : `${head}${w.staffName(x.toStaffId)}さんに代わりました。伺わなくて大丈夫です。`,
    });
  }
  for (const x of c.shifted) {
    lines.push({
      at: x.fromStart ?? 0,
      text: `・${clock(x.fromStart)} ${w.clientName(x.clientId)}様の訪問は、開始が ${clock(x.toStart)} に変わりました。`,
    });
  }
  for (const x of cancelled) {
    if (x.staffId !== c.staffId) continue;
    lines.push({
      at: x.start ?? 0,
      text: `・${clock(x.start)} ${w.clientName(x.clientId)}様の訪問は中止です（キャンセル）。伺わなくて大丈夫です。`,
    });
  }
  // 同じ時刻は 新しく入る → 外れる → 時刻 → 中止 の順（sort は安定）
  lines.sort((a, b) => a.at - b.at);
  return [`${w.staffName(c.staffId)}さん`, `${w.day}の予定の変更です。`, ...lines.map((l) => l.text)].join('\n');
}

/** 訪問先1件への連絡の1行（敬語。担当は姓だけ・前の担当と代わる理由は書かない。D245・D246） */
function clientLine(x: ContactVisit, w: ContactWords): string {
  const at = `・${clock(x.fromStart ?? x.toStart)}からの訪問は`;
  if (x.fromStaffId !== x.toStaffId) {
    if (x.toStaffId === null) return `${at}、担当の調整がついておりません。あらためてご連絡いたします。`;
    const who = familyName(w.staffName(x.toStaffId));
    return timeMoved(x)
      ? `${at}、担当が${who}に代わり、開始が ${clock(x.toStart)} になります。`
      : `${at}、担当が${who}に代わります。`;
  }
  return `${at}、開始が ${clock(x.toStart)} に変わります（担当は変わりません）。`;
}

/** 訪問先ごとの連絡文（担当が変わる訪問・開始が変わる訪問。訪問先の初めの訪問の順。敬語。D245） */
export function clientMessages(list: ContactList, w: ContactWords): { clientId: string; text: string }[] {
  const all = [...list.staffChanged, ...list.timeChanged].sort(
    (a, b) => (a.fromStart ?? a.toStart ?? 0) - (b.fromStart ?? b.toStart ?? 0) || a.visitId.localeCompare(b.visitId),
  );
  const byClient = new Map<string, ContactVisit[]>();
  for (const x of all) byClient.set(x.clientId, [...(byClient.get(x.clientId) ?? []), x]);
  const hello = `いつもお世話になっております。${w.orgName ? `${w.orgName}です。` : ''}`;
  return [...byClient].map(([clientId, xs]) => ({
    clientId,
    text: [
      `${w.clientName(clientId)}様`,
      hello,
      `${w.day}の訪問について、変更をお知らせいたします。`,
      ...xs.map((x) => clientLine(x, w)),
      'ご迷惑をおかけして申し訳ございません。どうぞよろしくお願いいたします。',
    ].join('\n'),
  }));
}

/** 連絡が要る訪問の数（担当が変わる訪問＋時刻だけ変わる訪問。同じ訪問は1件）。一覧が無ければ 0 */
export function contactCount(list: ContactList | null): number {
  if (!list) return 0;
  return new Set([...list.staffChanged, ...list.timeChanged].map((x) => x.visitId)).size;
}

/** 一覧すべての連絡文（スタッフ → 訪問先。間に空行） */
export function allContactsText(list: ContactList, w: ContactWords): string {
  return [...list.staff.map((c) => staffMessage(c, w)), ...clientMessages(list, w).map((c) => c.text)].join('\n\n');
}

// ---- 欠勤・キャンセルの欄の5段目「連絡」（PRD D244。ADR-0038） ----

/** 連絡の種類：担当が外れる・新しく入る・時刻が変わる・中止（キャンセル）・〈利用者さん〉あて */
export type ContactKind = 'removed' | 'added' | 'shifted' | 'cancelled' | 'client';

/** 種類の短い名前（行の印） */
export const CONTACT_KIND_LABEL: Record<ContactKind, string> = {
  removed: '担当が外れる',
  added: '新しく入る',
  shifted: '時刻が変わる',
  cancelled: '中止',
  client: '担当・時刻のお知らせ',
};

/** 連絡の一覧の1行（1人に1行。連絡文は1つにまとめる） */
export type ContactRow = {
  /** `staff:〈ID〉` か `client:〈ID〉`（［連絡した］の印の鍵） */
  key: string;
  to: 'staff' | 'client';
  /** スタッフの ID か〈利用者さん〉の ID */
  id: string;
  /** 宛名（「山田 花さん」「青葉様」） */
  name: string;
  /** 種類（並びは 外れる → 入る → 時刻 → 中止） */
  kinds: ContactKind[];
  text: string;
};

/**
 * 差（前の確定した割当 → 新しい割当。contactsOf）と取り消した訪問から、連絡の一覧を作る。
 * 並びは スタッフ（差の一覧の順、続けて中止だけの人）→ 〈利用者さん〉。取り消した訪問は差から除き「中止」として担当にだけ伝える
 * （キャンセルした〈利用者さん〉には連絡しない）。担当の無い取り消しは誰にも伝えない
 */
export function contactRows(list: ContactList, cancelled: readonly CancelledContact[], w: ContactWords): ContactRow[] {
  const gone = new Set(cancelled.map((x) => x.visitId));
  const keep = (xs: ContactVisit[]) => xs.filter((x) => !gone.has(x.visitId));
  const clean: ContactList = {
    staffChanged: keep(list.staffChanged),
    timeChanged: keep(list.timeChanged),
    staff: list.staff.map((c) => ({
      staffId: c.staffId,
      added: keep(c.added),
      removed: keep(c.removed),
      shifted: keep(c.shifted),
    })),
  };
  const staff = new Map<string, StaffContact>();
  for (const c of clean.staff) staff.set(c.staffId, c);
  for (const x of cancelled) {
    if (x.staffId && !staff.has(x.staffId))
      staff.set(x.staffId, { staffId: x.staffId, added: [], removed: [], shifted: [] });
  }
  const rows: ContactRow[] = [];
  for (const c of staff.values()) {
    const kinds: ContactKind[] = [];
    if (c.removed.length > 0) kinds.push('removed');
    if (c.added.length > 0) kinds.push('added');
    if (c.shifted.length > 0) kinds.push('shifted');
    if (cancelled.some((x) => x.staffId === c.staffId)) kinds.push('cancelled');
    if (kinds.length === 0) continue;
    rows.push({
      key: `staff:${c.staffId}`,
      to: 'staff',
      id: c.staffId,
      name: `${w.staffName(c.staffId)}さん`,
      kinds,
      text: staffMessage(c, w, cancelled),
    });
  }
  for (const c of clientMessages(clean, w)) {
    rows.push({
      key: `client:${c.clientId}`,
      to: 'client',
      id: c.clientId,
      name: `${w.clientName(c.clientId)}様`,
      kinds: ['client'],
      text: c.text,
    });
  }
  return rows;
}
