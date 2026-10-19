// 古い案と記録の片づけ（PRD D227。ADR-0032）：選んだ月より前の日の AI案（aiPlans）と記録（aiRuns）を消す純粋関数。
// 確定した割当（manualPlans）・訪問・人・条件は消さない。容量の見積もりは JSON の文字数から。データの書き換えは画面が store の update で行う
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
  /** 消す記録（aiRuns）の件数 */
  runs: number;
  /** 消す今の案（aiPlans）の件数 */
  plans: number;
  /** 案か記録のある日の数 */
  days: number;
  /** 空く見込み（JSON の文字数） */
  chars: number;
};

const before = (date: string, ym: string) => date < `${ym}-01`;

/** beforeYm の月より前の日の案と記録の件数・空く見込み */
export function tidyPreview(data: Pick<DemoData, 'aiRuns' | 'aiPlans'>, beforeYm: string): TidyPreview {
  const out: TidyPreview = { runs: 0, plans: 0, days: 0, chars: 0 };
  const days = new Set<string>();
  for (const [date, runs] of Object.entries(data.aiRuns)) {
    if (!before(date, beforeYm) || runs.length === 0) continue;
    out.runs += runs.length;
    out.chars += JSON.stringify(runs).length + date.length + 4;
    days.add(date);
  }
  for (const [date, plan] of Object.entries(data.aiPlans)) {
    if (!before(date, beforeYm)) continue;
    out.plans++;
    out.chars += JSON.stringify(plan).length + date.length + 4;
    days.add(date);
  }
  out.days = days.size;
  return out;
}

/** 文字数を「約 N KB」に（1KB 未満は「1KB 未満」） */
export function sizeText(chars: number): string {
  return chars < 1024 ? '1KB 未満' : `約 ${Math.round(chars / 1024)}KB`;
}

/** beforeYm の月より前の日の AI案と記録を消したデータ（消すものが無ければ同じもの） */
export function tidyOld<T extends Pick<DemoData, 'aiRuns' | 'aiPlans'>>(data: T, beforeYm: string): T {
  const runs = Object.entries(data.aiRuns).filter(([date]) => !before(date, beforeYm));
  const plans = Object.entries(data.aiPlans).filter(([date]) => !before(date, beforeYm));
  if (runs.length === Object.keys(data.aiRuns).length && plans.length === Object.keys(data.aiPlans).length) return data;
  return { ...data, aiRuns: Object.fromEntries(runs), aiPlans: Object.fromEntries(plans) };
}
