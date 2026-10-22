/**
 * 空き状況と問い合わせの試算（vacancy）の入出力（design.md §5「空き状況と問い合わせの試算」。ADR-0012 追記。段階3）。
 * 関数（vacancyOf・verdictOf・inquirySummary・dayLoad）の実装は src/vacancy/（下の関数の型で注釈する）。
 * 時刻は0時からの分。例外を投げない：いない種類は種類なし、時刻の範囲が空なら times が空。
 * データ・今の案は書き換えない
 */
import type { DemoData } from './data';
import type { Place, Terms } from './documents';
import type { Condition } from './rules';

/** 試算の仮の〈利用者さん〉（データには入れない） */
export const INQUIRY_CLIENT_ID = '__inquiry_client';
/** 試算の仮の訪問（データには入れない） */
export const INQUIRY_VISIT_ID = '__inquiry_visit';

/** 既定値（design.md §5） */
export const VACANCY_MARGIN_DEFAULT = 15;
export const VACANCY_DAY_START_DEFAULT = '07:00';
export const VACANCY_DAY_END_DEFAULT = '20:00';
export const VACANCY_STEP_DEFAULT = 30;
/** 日の混み具合（dayLoad）で数える長さ：0:00〜24:00（分。PRD D82） */
export const DAY_LOAD_MINUTES = 24 * 60;
export const VACANCY_WEEKS_DEFAULT = 4;
export const VACANCY_WEEKS_MIN = 1;
export const VACANCY_WEEKS_MAX = 8;
export const VACANCY_DURATION_MIN = 5;
export const VACANCY_DURATION_MAX = 720;

export type VacancyQuery = {
  typeId: string | null;
  /** 5〜720 */
  durationMinutes: number;
  /** 〈スタッフ〉の特性に対する条件（例：性別） */
  requirements: Condition[];
  /** null＝目安（移動を前後 marginMinutes で見込む） */
  place: Place | null;
  /** 既定 15 */
  marginMinutes: number;
  /** 既定 '07:00' */
  dayStart: string;
  /** 既定 '20:00' */
  dayEnd: string;
  /** 既定 30 */
  stepMinutes: number;
};

/** from から weeks×7日（weeks 1〜8） */
export type VacancyRange = { from: string; weeks: number };

export type VacancyCell = {
  /** 0=日〜6=土 */
  weekday: number;
  /** 0時からの分 */
  start: number;
  /** 数えた日ごと（日付の順） */
  byDate: { date: string; staffIds: string[] }[];
  /** byDate の人数の最小（byDate が空なら 0） */
  min: number;
  /** 人数が1以上の日の数 */
  weeksOk: number;
  /** 数えた日の数 */
  weeksTotal: number;
};

export type VacancyResult = {
  /** place あり */
  exact: boolean;
  /** 対象の日 */
  dates: string[];
  /** その日の問題を作れず数えなかった日（データの食い違いなど。ふつうは空） */
  noPlanDates: string[];
  /** 開始時刻の列（分） */
  times: number[];
  /** 曜日（日〜土）× times の順 */
  cells: VacancyCell[];
};

export type Verdict = 'ok' | 'partial' | 'ng' | 'unknown';

/** from〜to は開始時刻の範囲（HH:mm） */
export type InquiryWish = { weekdays: number[]; from: string; to: string; perWeek: number; startDate: string };

/** 日の混み具合（D54）の30分1つ。working＝その30分に稼働時間帯がある人、free＝そのうち元の案の訪問と重ならない人 */
export type DayLoadSlot = { start: number; working: number; free: number };
/** 日の混み具合で数える人。typeId があれば、その種類の必要条件を満たす人だけ（いない種類は種類なし） */
export type DayLoadFilter = { typeId: string | null };

export type VacancyOf = (data: DemoData, query: VacancyQuery, range: VacancyRange) => VacancyResult;
export type VerdictOf = (cell: VacancyCell) => Verdict;
export type InquirySummary = (result: VacancyResult, wish: InquiryWish, terms: Terms) => string;
/** 0:00〜24:00 の30分ごと（開始の順。PRD D82）。その日の問題を作れなければ null（D54） */
export type DayLoadFn = (data: DemoData, date: string, filter: DayLoadFilter) => DayLoadSlot[] | null;

/** 空き枠の案内文の形（ADR-0013）：'dates'＝日付ごと（1人以上の時刻）、'weekly'＝曜日ごと（どの週も受けられる時刻） */
export type VacancyNoticeMode = 'dates' | 'weekly';

/** 空き枠の案内文の入力（PRD D67。ADR-0013） */
export type VacancyNoticeInput = {
  /** 事業所名（org.name） */
  orgName: string;
  terms: Terms;
  /** 種類の名前（null＝種類を問わない） */
  typeName: string | null;
  durationMinutes: number;
  /** 文に載せる日（両端を含む。YYYY-MM-DD） */
  period: { from: string; to: string };
  mode: VacancyNoticeMode;
  /** 移動を含む（場所あり）か目安か */
  exact: boolean;
  /**
   * この日（今日）は、この時刻（0時からの分）より前の開始を載せない（もう過ぎた時刻。'dates' のときだけ）。
   * 今の時刻は画面が渡す（vacancy の中で Date.now を使わない）。無ければ見ない
   */
  notBefore?: { date: string; minutes: number };
};

/** 空き枠の案内文（純粋関数。例外を投げない） */
export type VacancyNoticeFn = (result: VacancyResult, input: VacancyNoticeInput) => string;
