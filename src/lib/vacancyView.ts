// 空き状況の画面の段階と表示の決め方（PRD D184〜D187。ADR-0025 追記。UI/UX 改善の区切り8a）。
// 計算（vacancyOf・verdictOf・inquirySummary）は src/vacancy のまま。ここは画面に出す文と印を決めるだけの純粋関数
import type { VacancyCell, Verdict } from '../contracts/vacancy';
import { verdictOf } from '../vacancy';

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

/** 案内文の段階の要約の行（PRD D185）：「来週・種類なし（60分）」 */
export function noticeLine(periodLabel: string, typeName: string | null, durationMinutes: number | null): string {
  const d = durationMinutes === null ? '所要を入れてください' : `${durationMinutes}分`;
  return `${periodLabel}・${typeName ?? '種類なし'}（${d}）`;
}

/** いつ・何をの段階の要約（結果の見出しの下に出す1行。PRD D184）：「種類なし・60分・月水・9:00〜17:00に始める・週1回・10/20から4週」 */
export function whenWhatLine(q: {
  typeName: string | null;
  duration: string;
  weekdayLabels: string[];
  from: string;
  to: string;
  perWeek: number;
  startMd: string;
  weeks: number;
}): string {
  const days = q.weekdayLabels.length === 0 ? 'どの曜日でも' : q.weekdayLabels.join('');
  return `${q.typeName ?? '種類なし'}・${q.duration}分・${days}・${q.from}〜${q.to}に始める・週${q.perWeek}回・${q.startMd}から${q.weeks}週`;
}
