// 欠勤の振り直しの連絡の一覧（PRD D35。ADR-0011 追記）：reassign.contactsOf の一覧から連絡文を作る。
// 送信はしない（画面がクリップボードへコピーするだけ）。呼び方は org.terms から渡す。純粋関数
import type { ContactList, ContactVisit, StaffContact } from '../contracts/reassign';
import { minutesToHhmm, weekday } from '../domain/time';

/**
 * 連絡文に使う名前・呼び方。敬称（訪問先の「様」・スタッフの「さん」）は固定で、呼び方（「スタッフ」など）が出る箇所は
 * org.terms から渡す（呼び方を変えても文が崩れないよう、訪問先の呼び方は文に出さない）
 */
export type ContactWords = {
  /** 「本日」か「10月15日（木）」（dayWordOf） */
  day: string;
  /** スタッフの呼び方（org.terms.staff） */
  staffWord: string;
  staffName: (id: string) => string;
  clientName: (id: string) => string;
  /** 訪問先の住所（無ければ空） */
  clientAddress: (id: string) => string;
};

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** その日が今日なら「本日」、それ以外は「10月15日（木）」 */
export function dayWordOf(date: string, today: string): string {
  if (date === today) return '本日';
  const [, m, d] = date.split('-').map(Number);
  return `${m}月${d}日（${WEEK[weekday(date)]}）`;
}

/** 分 → 「9:00」 */
export function clock(minutes: number | null): string {
  return minutes === null ? '' : minutesToHhmm(minutes).replace(/^0(\d)/, '$1');
}

/** 開始が四捨五入で変わるか（reassignDiff と同じ） */
const timeMoved = (c: ContactVisit) =>
  c.fromStart !== null && c.toStart !== null && Math.round(c.toStart - c.fromStart) !== 0;

/** スタッフへの連絡文（増える訪問・外れる訪問・開始が変わる訪問を、元の時刻の順に1行ずつ） */
export function staffMessage(c: StaffContact, w: ContactWords): string {
  const lines: { at: number; text: string }[] = [];
  for (const x of c.added) {
    const addr = w.clientAddress(x.clientId);
    lines.push({
      at: x.toStart ?? 0,
      text: `・${w.day} ${clock(x.toStart)} ${w.clientName(x.clientId)}様${addr ? `（${addr}）` : ''}の訪問を追加でお願いします。`,
    });
  }
  for (const x of c.removed) {
    const name = `・${w.day} ${clock(x.fromStart)} ${w.clientName(x.clientId)}様の訪問は、`;
    lines.push({
      at: x.fromStart ?? 0,
      text:
        x.toStaffId === null
          ? `${name}担当を調整中です（伺わなくて大丈夫です）。`
          : `${name}ほかの${w.staffWord}が伺います（伺わなくて大丈夫です）。`,
    });
  }
  for (const x of c.shifted) {
    lines.push({
      at: x.fromStart ?? 0,
      text: `・${w.day} ${clock(x.fromStart)} ${w.clientName(x.clientId)}様の訪問の開始が ${clock(x.toStart)} に変わります。`,
    });
  }
  // 同じ時刻は 追加 → 外れる → 開始が変わる の順（sort は安定）
  lines.sort((a, b) => a.at - b.at);
  return [`${w.staffName(c.staffId)}さん`, `${w.day}の予定の変更です。`, ...lines.map((l) => l.text)].join('\n');
}

/** 訪問先1件への連絡の1行 */
function clientLine(x: ContactVisit, w: ContactWords): string {
  const at = `${w.day} ${clock(x.fromStart ?? x.toStart)} の訪問`;
  if (x.fromStaffId !== x.toStaffId) {
    if (x.toStaffId === null) return `・${at}は、担当の調整がつかず、あらためてご連絡します。`;
    const from = x.fromStaffId === null ? '' : `${w.staffName(x.fromStaffId)}さんから `;
    const time = timeMoved(x) ? `、開始が ${clock(x.toStart)} になります` : '';
    return `・${at}は、担当が ${from}${w.staffName(x.toStaffId)}さんに代わります${time}。`;
  }
  return `・${at}の開始が ${clock(x.toStart)} に変わります（担当は ${w.staffName(x.toStaffId ?? '')}さんのままです）。`;
}

/** 訪問先ごとの連絡文（担当が変わる訪問・開始が変わる訪問。訪問先の初めの訪問の順） */
export function clientMessages(list: ContactList, w: ContactWords): { clientId: string; text: string }[] {
  const all = [...list.staffChanged, ...list.timeChanged].sort(
    (a, b) => (a.fromStart ?? a.toStart ?? 0) - (b.fromStart ?? b.toStart ?? 0) || a.visitId.localeCompare(b.visitId),
  );
  const byClient = new Map<string, ContactVisit[]>();
  for (const x of all) byClient.set(x.clientId, [...(byClient.get(x.clientId) ?? []), x]);
  return [...byClient].map(([clientId, xs]) => ({
    clientId,
    text: [`${w.clientName(clientId)}様`, ...xs.map((x) => clientLine(x, w))].join('\n'),
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
