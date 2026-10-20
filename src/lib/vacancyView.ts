// 空き状況の画面の段階と表示の決め方（PRD D184〜D187。ADR-0025 追記。UI/UX 改善の区切り8a）。
// 計算（vacancyOf・verdictOf・inquirySummary）は src/vacancy のまま。ここは画面に出す文と印を決めるだけの純粋関数
import type { InquiryWish, VacancyCell, VacancyResult, Verdict } from '../contracts/vacancy';
import { timeText } from '../domain/availability';
import { hhmmToMinutes, minutesToHhmm } from '../domain/time';
import { verdictOf } from '../vacancy';
import { WEEKDAY_LABELS } from './common';

/** 狭い画面で表をはじめに見せる開始時刻（PRD D221。朝の早い列はたいてい × なので 9:00 の列から） */
export const NARROW_FIRST_START = '09:00';

/** マスの印（○△×？） */
export const VACANCY_MARK: Record<Verdict, string> = { ok: '○', partial: '△', ng: '×', unknown: '？' };

/** 印の短い読み方（凡例・マスの読み上げ。区切り6の言い換えにそろえる：案の無い日は「案が無く数えていない」） */
export const VACANCY_MARK_TEXT: Record<Verdict, string> = {
  ok: 'どの週も受けられる',
  partial: '受けられない週がある',
  ng: '受けられない',
  unknown: '案が無く数えていない',
};

export type CellFace = {
  verdict: Verdict;
  /** 印（○△×？） */
  mark: string;
  /** 印の下の小さい文字：○ はどの週でも受けられる人数（目安なら「約」）、△ は受けられる週の数（3/4）、×・？ は空 */
  sub: string;
  /** 読み上げ・title の文（「月 10:00から：○ どの週も受けられる・どの週でも 約3人（4/4週）」） */
  label: string;
};

/**
 * マスの見た目と読み方（PRD D187）。×（受けられない）に「約0」、△（週による）に「0」を出さない：
 * 数字は ○ のときだけ人数、△ は受けられる週の数（a/b）。目安（場所なし）の人数は「約」を付ける
 */
export function cellFace(
  cell: Pick<VacancyCell, 'min' | 'weeksOk' | 'weeksTotal'>,
  exact: boolean,
  head: string,
): CellFace {
  const verdict = verdictOf(cell as VacancyCell);
  const mark = VACANCY_MARK[verdict];
  const people = `${exact ? '' : '約'}${cell.min}人`;
  const sub =
    verdict === 'ok'
      ? `${exact ? '' : '約'}${cell.min}`
      : verdict === 'partial'
        ? `${cell.weeksOk}/${cell.weeksTotal}`
        : '';
  const detail =
    verdict === 'ok'
      ? `・どの週でも ${people}（${cell.weeksOk}/${cell.weeksTotal}週）`
      : verdict === 'partial' || verdict === 'ng'
        ? `（受けられる週 ${cell.weeksOk}/${cell.weeksTotal}週）`
        : '';
  return { verdict, mark, sub, label: `${head}：${mark} ${VACANCY_MARK_TEXT[verdict]}${detail}` };
}

/** 表の凡例の印の読み方（PRD D187。見本の印と下の文字・読み方） */
export function markLegend(exact: boolean): { verdict: Verdict; mark: string; sample: string; text: string }[] {
  const n = exact ? '3' : '約3';
  return [
    {
      verdict: 'ok',
      mark: '○',
      sample: n,
      text: `どの週も受けられる（数字＝どの週でも受けられる人数。${n}＝3人${exact ? '' : 'ほど'}）`,
    },
    { verdict: 'partial', mark: '△', sample: '2/4', text: '受けられない週がある（2/4＝4週のうち2週は受けられる）' },
    { verdict: 'ng', mark: '×', sample: '', text: '受けられない' },
    { verdict: 'unknown', mark: '？', sample: '', text: '案が無く数えていない' },
  ];
}

/** 場所の段階の要約の行（PRD D185）。畳んでいるときに見出しの横に出す */
export function placeLine(
  p: { address: string; pinnedAddress: string; hasPin: boolean },
  marginMinutes: number,
): { text: string; set: boolean } {
  if (p.hasPin) {
    return { text: `${p.pinnedAddress.trim() || '選んだ場所'}（移動を含めて数えています）`, set: true };
  }
  if (p.address.trim() !== '') {
    return {
      text: `${p.address.trim()}（位置がまだありません。地図に置くと移動を含めて数えます）`,
      set: false,
    };
  }
  return {
    text: `場所を入れると移動も含めて絞り込めます（いまは移動を前後${marginMinutes}分で見込んだ目安）`,
    set: false,
  };
}

/** 種類を選ばないときの呼び方（PRD D258。「種類なし」は種類の無い訪問と紛れるので「指定なし」） */
export const NO_TYPE_TEXT = '指定なし';
/** 要約の行の種類（選ばないときは「種類の指定なし」） */
const typeText = (typeName: string | null) => typeName ?? `種類の${NO_TYPE_TEXT}`;

/** 案内文の段階の要約の行（PRD D185）：「来週・種類の指定なし（60分）」 */
export function noticeLine(periodLabel: string, typeName: string | null, durationMinutes: number | null): string {
  const d = durationMinutes === null ? '所要を入れてください' : `${durationMinutes}分`;
  return `${periodLabel}・${typeText(typeName)}（${d}）`;
}

/**
 * いつ・何をの段階の要約（結果の見出しの下に出す1行。PRD D184）：「種類の指定なし・60分・月水・9:00〜17:00に始める・週1回・10/20から4週」。
 * 所要が正しくないときは所要を、希望の開始の「から」が「まで」より後のときは時間帯を「—」にする（PR #44 のレビュー）
 */
export function whenWhatLine(q: {
  typeName: string | null;
  duration: string;
  durationOk: boolean;
  weekdayLabels: string[];
  from: string;
  to: string;
  wishOk: boolean;
  perWeek: number;
  startMd: string;
  weeks: number;
}): string {
  const days = q.weekdayLabels.length === 0 ? 'どの曜日でも' : q.weekdayLabels.join('');
  const dur = q.durationOk ? `${q.duration}分` : '—';
  const time = q.wishOk ? `${q.from}〜${q.to}に始める` : '—';
  return `${typeText(q.typeName)}・${dur}・${days}・${time}・週${q.perWeek}回・${q.startMd}から${q.weeks}週`;
}

/** 答えのカード（PRD D258）：ok＝受けられる・partial＝一部だけ・ng＝受けられない・unknown＝案が無く数えられない */
export type AnswerCard = {
  tone: 'ok' | 'partial' | 'ng' | 'unknown';
  /** 答え（「受けられます」） */
  head: string;
  /** 曜日・開始の時間と人数（「火・木 10:00〜12:00 に 3人」）。無ければ null */
  body: string | null;
  /** 補い（読み方・足りない分） */
  note: string;
};

const hm = (t: number) => timeText(minutesToHhmm(t));

/**
 * 結果の1枚目の答え（PRD D258）。希望の曜日（無ければ全曜日）・開始の時間帯の中で、どの週も受けられる（○）開始時刻を
 * 曜日ごとに続いた範囲にまとめ（要約 inquirySummary と同じ決め方）、そこで受けられる人数（どの週でも受けられる人数の幅）を添える。
 * ○ の曜日が週の回数以上なら「受けられます」
 */
export function answerCard(result: VacancyResult, wish: Omit<InquiryWish, 'startDate'>): AnswerCard {
  const days = wish.weekdays.length > 0 ? [...new Set(wish.weekdays)].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
  // 月曜はじめに並べる（表と同じ）
  const order = (wd: number) => (wd + 6) % 7;
  days.sort((a, b) => order(a) - order(b));
  const lo = hhmmToMinutes(wish.from);
  const hi = hhmmToMinutes(wish.to);
  const perWeek = Math.max(1, Math.floor(wish.perWeek));
  const idx = new Map(result.times.map((t, i) => [t, i]));
  const cellsOf = (wd: number) =>
    result.cells.filter((c) => c.weekday === wd && c.start >= lo && c.start <= hi).sort((a, b) => a.start - b.start);
  const all = days.flatMap(cellsOf);
  const about = result.exact ? '' : '約';
  if (all.length === 0) {
    return {
      tone: 'ng',
      head: '受けられません',
      body: '希望の時間帯に始められる時刻がありません',
      note: '所要が長いか、希望の開始の時間帯が短すぎます。所要・時間帯を直してください。',
    };
  }
  if (all.every((c) => verdictOf(c) === 'unknown')) {
    return {
      tone: 'unknown',
      head: '案が無く数えられません',
      body: null,
      note: '希望の曜日・時間帯の日に案がありません。下の［足りない案を作る］で作ると数えます。',
    };
  }
  // 案が無く数えていない（？）曜日。混ざるときは補いに添える（数えた曜日だけの答えなので）
  const unknownDays = days.filter((wd) => {
    const cs = cellsOf(wd);
    return cs.length > 0 && cs.every((c) => verdictOf(c) === 'unknown');
  });
  const withUnknown = (note: string) =>
    unknownDays.length === 0
      ? note
      : `${note}${unknownDays.map((wd) => WEEKDAY_LABELS[wd]).join('・')}は案が無く数えていません（［足りない案を作る］）。`;
  const people: number[] = [];
  const ok = days.flatMap((wd) => {
    const ranges: string[] = [];
    let first: number | null = null;
    let last: number | null = null;
    const flush = () => {
      if (first !== null && last !== null) ranges.push(first === last ? hm(first) : `${hm(first)}〜${hm(last)}`);
    };
    for (const c of cellsOf(wd)) {
      if (verdictOf(c) !== 'ok') continue;
      people.push(c.min);
      if (last !== null && idx.get(c.start) === (idx.get(last) ?? -2) + 1) {
        last = c.start;
        continue;
      }
      flush();
      first = c.start;
      last = c.start;
    }
    flush();
    return ranges.length > 0 ? [{ wd, ranges }] : [];
  });
  if (ok.length > 0) {
    // 同じ時間の曜日はまとめる（「月・火・水 9:00〜16:30、土 9:30〜15:30」）
    const groups = new Map<string, number[]>();
    for (const x of ok) {
      const k = x.ranges.join('、');
      groups.set(k, [...(groups.get(k) ?? []), x.wd]);
    }
    const when = [...groups].map(([k, wds]) => `${wds.map((wd) => WEEKDAY_LABELS[wd]).join('・')} ${k}`).join('、');
    const a = Math.min(...people);
    const b = Math.max(...people);
    const body = `${when} に ${about}${a === b ? a : `${a}〜${b}`}人`;
    if (ok.length >= perWeek) {
      return {
        tone: 'ok',
        head: '受けられます',
        body,
        note: withUnknown(
          `時刻は開始の時刻、人数はどの週でも受けられる人数${about ? '（場所が無いので目安）' : ''}です。`,
        ),
      };
    }
    return {
      tone: 'partial',
      head: `週${perWeek}回には足りません`,
      body,
      note: withUnknown(
        `どの週も受けられるのは週${ok.length}回分です。曜日・時間帯を広げるか、下の表の △ を見てください。`,
      ),
    };
  }
  const partial = days.filter((wd) => cellsOf(wd).some((c) => verdictOf(c) === 'partial'));
  if (partial.length > 0) {
    return {
      tone: 'partial',
      head: '受けられない週があります',
      body: `${partial.map((wd) => WEEKDAY_LABELS[wd]).join('・')} は週によって受けられます`,
      note: withUnknown(
        'どの週も受けられる開始の時刻はありません。下の表の △ を押すと、受けられない日付が分かります。',
      ),
    };
  }
  return {
    tone: 'ng',
    head: '受けられません',
    body: null,
    note: withUnknown('ご希望の曜日・時間帯では、いまは空きがありません。曜日・時間帯を広げてみてください。'),
  };
}
