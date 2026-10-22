// 古い訪問の片づけ（PRD D227。ADR-0032・ADR-0053）：選んだ月より前の日の、保存した訪問（担当を組んだ・変えた回と単発の訪問）・
// 伝えた内容（snapshots）・振り直しの情報（reassigns）を消す純粋関数。繰り返しの回は繰り返しのとおりに戻り、人・条件は消さない。
// 容量の見積もりは JSON の文字数から。データの書き換えは画面が store の update で行う
import type { DemoData } from '../contracts/data';

/** 選べる月の数（今月から前へ） */
export const TIDY_MONTHS_BACK = 12;
/** 既定は何か月前の月より前か */
export const TIDY_DEFAULT_BACK = 3;

/** 年月（YYYY-MM）を n か月ずらす */
export function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

/** 「2026年7月より前」 */
export const tidyMonthLabel = (ym: string): string => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月より前`;

/** 選べる月（新しい順。今月〜TIDY_MONTHS_BACK か月前）と既定（TIDY_DEFAULT_BACK か月前） */
export function tidyMonthOptions(today: string): { options: string[]; initial: string } {
  const ym = today.slice(0, 7);
  const options = Array.from({ length: TIDY_MONTHS_BACK + 1 }, (_, i) => addMonths(ym, -i));
  return { options, initial: addMonths(ym, -TIDY_DEFAULT_BACK) };
}

export type TidyPreview = {
  /** 消す保存した訪問（変えた回・単発の訪問）の件数 */
  visits: number;
  /** 消す伝えた内容（確定）の日数 */
  snapshots: number;
  /** 訪問か伝えた内容のある日の数 */
  days: number;
  /** 空く見込み（JSON の文字数） */
  chars: number;
};

type TidyData = Pick<DemoData, 'visits' | 'snapshots' | 'reassigns'>;

const before = (date: string, ym: string) => date < `${ym}-01`;

/**
 * beforeYm の月より前の日の、保存した訪問（変えた回・単発の訪問）・伝えた内容・振り直しの情報の件数と空く見込み（版2）。
 * 繰り返しの回は見るときに計算するので、消すと元の繰り返しのとおりに戻る（担当・取り消し・この回だけの変更は消える）
 */
export function tidyPreview(data: TidyData, beforeYm: string): TidyPreview {
  const out: TidyPreview = { visits: 0, snapshots: 0, days: 0, chars: 0 };
  const days = new Set<string>();
  for (const v of data.visits) {
    if (!before(v.date, beforeYm)) continue;
    out.visits++;
    out.chars += JSON.stringify(v).length + 1;
    days.add(v.date);
  }
  for (const [date, s] of Object.entries(data.snapshots)) {
    if (!before(date, beforeYm)) continue;
    out.snapshots++;
    out.chars += JSON.stringify(s).length + date.length + 4;
    days.add(date);
  }
  for (const [date, r] of Object.entries(data.reassigns)) {
    if (!before(date, beforeYm)) continue;
    out.chars += JSON.stringify(r).length + date.length + 4;
  }
  out.days = days.size;
  return out;
}

/** 文字数を「約 N KB」に（1KB 未満は「1KB 未満」） */
export function sizeText(chars: number): string {
  return chars < 1024 ? '1KB 未満' : `約 ${Math.round(chars / 1024)}KB`;
}

/** beforeYm の月より前の日の保存した訪問・伝えた内容・振り直しの情報を消したデータ（消すものが無ければ同じもの） */
export function tidyOld<T extends TidyData>(data: T, beforeYm: string): T {
  const visits = data.visits.filter((v) => !before(v.date, beforeYm));
  const snapshots = Object.entries(data.snapshots).filter(([date]) => !before(date, beforeYm));
  const reassigns = Object.entries(data.reassigns).filter(([date]) => !before(date, beforeYm));
  if (
    visits.length === data.visits.length &&
    snapshots.length === Object.keys(data.snapshots).length &&
    reassigns.length === Object.keys(data.reassigns).length
  )
    return data;
  return { ...data, visits, snapshots: Object.fromEntries(snapshots), reassigns: Object.fromEntries(reassigns) };
}
