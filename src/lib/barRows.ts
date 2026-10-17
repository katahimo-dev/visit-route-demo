// 3段のバーの区切り（PRD D60・D75・D82・D83。design.md §4 pages「第5弾」）。区切りはここ1か所で決め、
// 混み具合バー・〈スタッフ〉の3段バー・〈利用者さん〉の帯・凡例の見本・目盛りの文が全部ここを見る。
// 段は 8〜12時・12〜16時・16〜20時（各4時間＝30分×8マス。同じ時刻が縦にそろう）。
// 8時より前・20時以降は段に出さず、端の印（◀・▶）で「ある」ことと時刻を知らせる。純粋関数（データは書き換えない）
import { DAY_LOAD_MINUTES, type DayLoadSlot } from '../contracts/vacancy';
import { timeText } from '../domain/availability';
import { minutesToHhmm } from '../domain/time';

/** 段（時）：午前 8〜12・昼 12〜16・夕方 16〜20 */
export const BAR_ROWS: readonly (readonly [number, number])[] = [
  [8, 12],
  [12, 16],
  [16, 20],
];
/** 3段の始まりと終わり（0時からの分） */
export const BAR_START = BAR_ROWS[0]![0] * 60;
export const BAR_END = BAR_ROWS.at(-1)![1] * 60;
/** マスの刻み（分） */
export const BAR_STEP = 30;
/** 1日（分）。混み具合（vacancy の dayLoad）・〈スタッフ〉の状態は 0:00〜24:00 を数える（同じ値を契約から） */
export const DAY_MINUTES = DAY_LOAD_MINUTES;

/** 3段の範囲の文「8:00〜20:00」 */
export function barRangeText(): string {
  return `${timeText(minutesToHhmm(BAR_START))}〜${timeText(minutesToHhmm(BAR_END))}`;
}

/** 端の印の説明「（8時より前・20時以降は端に ◀・▶）」 */
export function barEdgeNote(): string {
  return `（${edgeLabel('early')}・${edgeLabel('late')}は端に ◀・▶）`;
}

/** 3段の中（8〜20時）のマスだけ（まとめの読み上げに渡す。外は端の文で読むので二重にしない） */
export function inBar<T extends { start: number }>(slots: readonly T[]): T[] {
  return slots.filter((x) => x.start >= BAR_START && x.start < BAR_END);
}

/** 読み上げのまとめに端の印の文を足す（「…。8時より前：…」） */
export function withEdges(label: string, edges: BarEdgeTexts | undefined): string {
  const extra = [edges?.early, edges?.late].filter((x): x is string => !!x);
  return extra.length > 0 ? `${label}。${extra.join('。')}` : label;
}

/** 目盛りの文「上から 8〜12時・12〜16時・16〜20時」 */
export function barRowsText(): string {
  return `上から ${BAR_ROWS.map(([a, b]) => `${a}〜${b}時`).join('・')}`;
}

/** 30分のマスを段に分ける（開始が段の中のマスだけ。段の外のマスは捨てる。端の印は barEdges） */
export function barRowsOf<T extends { start: number }>(
  slots: readonly T[],
): { from: number; to: number; slots: T[] }[] {
  return BAR_ROWS.map(([a, b]) => ({
    from: a,
    to: b,
    slots: slots.filter((x) => x.start >= a * 60 && x.start < b * 60),
  }));
}

/** 端の印の向き：early＝8時より前、late＝20時以降 */
export type BarSide = 'early' | 'late';

/** 「8時より前」「20時以降」 */
export function edgeLabel(side: BarSide): string {
  return side === 'early' ? `${BAR_START / 60}時より前` : `${BAR_END / 60}時以降`;
}

/** 8時より前・20時以降のマスのうち active なもの（端の印を出すか・title の中身） */
export function barEdges<T extends { start: number }>(
  slots: readonly T[],
  active: (x: T) => boolean,
): { early: T[]; late: T[] } {
  return {
    early: slots.filter((x) => x.start < BAR_START && active(x)),
    late: slots.filter((x) => x.start >= BAR_END && active(x)),
  };
}

/** 端の印の title・読み上げ（無ければ null） */
export type BarEdgeTexts = { early: string | null; late: string | null };

const hm = (t: number) => timeText(minutesToHhmm(t));

/**
 * 混み具合の端の印の文（PRD D82）：8時より前・20時以降で働く人がいる30分を、時刻と人数が続く分でまとめる
 * （例「8時より前：7:00〜8:00 空き 2人／働く 3人」）。無ければ null
 */
export function loadEdgeTexts(load: readonly DayLoadSlot[]): BarEdgeTexts {
  const { early, late } = barEdges(load, (x) => x.working > 0);
  const text = (side: BarSide, xs: readonly DayLoadSlot[]) => {
    if (xs.length === 0) return null;
    const parts: string[] = [];
    let i = 0;
    while (i < xs.length) {
      let j = i;
      while (
        j + 1 < xs.length &&
        xs[j + 1]!.start === xs[j]!.start + BAR_STEP &&
        xs[j + 1]!.working === xs[i]!.working &&
        xs[j + 1]!.free === xs[i]!.free
      )
        j++;
      const x = xs[i]!;
      parts.push(`${hm(x.start)}〜${hm(xs[j]!.start + BAR_STEP)} 空き ${x.free}人／働く ${x.working}人`);
      i = j + 1;
    }
    return `${edgeLabel(side)}：${parts.join('、')}`;
  };
  return { early: text('early', early), late: text('late', late) };
}

/** 段の上の切れ端：row は段の番号、left・width は段の幅に対する割合（0〜1）。first はその区間の最初の切れ端 */
export type RowPiece<T> = { row: number; left: number; width: number; first: boolean; item: T };

/**
 * 時刻の区間（0時からの分。[start, end)）を段ごとの切れ端に分ける。段をまたぐ区間は段ごとに切る。
 * 段に少しも掛からない区間は early（終わりが 8時以前）・late（始まりが 20時以降）へ。
 * 段に掛かるが 8時より前・20時以降にはみ出す区間は、切れ端に加えて early・late にも入れる（端の印の title に出す）。
 * 長さ0の区間は、その時刻に幅0の切れ端を置く
 */
export function placeOnRows<T extends { start: number; end: number }>(
  items: readonly T[],
): { pieces: RowPiece<T>[]; early: T[]; late: T[]; outside: T[] } {
  const pieces: RowPiece<T>[] = [];
  const early: T[] = [];
  const late: T[] = [];
  /** 段に少しも掛からない区間（端の印のボタンにする） */
  const outside: T[] = [];
  for (const it of items) {
    const end = Math.max(it.start, it.end);
    if (it.start < BAR_START) early.push(it);
    if (end > BAR_END || it.start >= BAR_END) late.push(it);
    let first = true;
    BAR_ROWS.forEach(([a, b], row) => {
      const from = a * 60;
      const to = b * 60;
      const s = Math.max(it.start, from);
      const e = Math.min(end, to);
      const touches = e > s || (it.start === end && it.start >= from && it.start < to);
      if (!touches) return;
      pieces.push({ row, left: (s - from) / (to - from), width: (e - s) / (to - from), first, item: it });
      first = false;
    });
    if (first) outside.push(it);
  }
  return { pieces, early, late, outside };
}

/** 段の上の連続した塗り：left・width は段の幅に対する割合（0〜1）。level はその区間の状態（PRD D85） */
export type RowRun<L extends string> = { left: number; width: number; level: L };

/**
 * 段の中の30分のマス（開始が段の中のもの）を、同じ状態が続く区間ごとに1本へまとめる（PRD D85。描画だけのまとめ。
 * 30分ごとの計算・title・読み上げはマスのまま）。間が空いた（30分が抜けた）ところでは切る。from・to は段の時（例 8・12）
 */
export function rowRuns<L extends string>(
  slots: readonly { start: number; level: L }[],
  from: number,
  to: number,
): RowRun<L>[] {
  const a = from * 60;
  const len = (to - from) * 60;
  const out: RowRun<L>[] = [];
  let end = Number.NaN;
  for (const x of [...slots].sort((p, q) => p.start - q.start)) {
    if (x.start < a || x.start >= a + len) continue;
    const last = out.at(-1);
    const s = Math.min(BAR_STEP, a + len - x.start);
    if (last && last.level === x.level && x.start === end) {
      last.width += s / len;
    } else {
      out.push({ left: (x.start - a) / len, width: s / len, level: x.level });
    }
    end = x.start + BAR_STEP;
  }
  return out;
}
