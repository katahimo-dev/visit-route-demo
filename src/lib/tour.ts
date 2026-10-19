// 初回の案内ツアー（PRD D192・D193。ADR-0025 追記。区切り8b）の純粋な部分：案内の中身（5枚）、
// 「次へ」「戻る」「とばす」の行き先、自動で開くか。画面は components/Tour.tsx、見たかの保存は store/tour.ts
import type { Terms } from '../contracts/documents';
import type { FeatureId, Features } from '../contracts/features';
import { isOn } from './features';

/** 案内の1枚 */
export type TourStep = {
  key: 'home' | 'plan' | 'absence' | 'rules' | 'search';
  title: string;
  body: string;
  /** どこにあるか（メニュー・下のタブ・上の帯の名前） */
  where: string;
  /** その枚が案内する機能（切っていたら枚を出さない。土台の枚は無し） */
  feature?: FeatureId;
};

/**
 * 案内の5枚（呼び方は terms。キーの印は mac なら ⌘K）。
 * features で切った機能の枚（欠勤・キャンセル・条件の重み）は出さない（PRD D213。枚数はそのぶん減る）
 */
export function tourSteps(terms: Pick<Terms, 'client' | 'staff'>, isMac: boolean, features: Features = {}): TourStep[] {
  const key = isMac ? '⌘K' : 'Ctrl+K';
  // 予定を組むのメニューの項目（案を比べるを切っていれば出さない）
  const planItems = isOn(features, 'compare') ? '月・週・日・案を比べる' : '月・週・日';
  const all: TourStep[] = [
    {
      key: 'home',
      title: 'ここが「今日やること」です',
      body: '開くとまずホームが出ます。今月の案づくり・確定していない日・要対応など、次にやることをカードで出します。カードを押すと、その操作の画面へ移ります。',
      where: 'メニューの「ホーム」（スマホは下のタブ）',
    },
    {
      key: 'plan',
      title: '予定は月・週・日で組みます',
      body: 'AI が割当の案を作ります。日の画面で案を確かめ、必要なら手直しして「この割当で確定」を押します。月の画面では一月分の案をまとめて作れます。',
      where: `メニューの「予定を組む」（${planItems}）`,
    },
    {
      key: 'absence',
      title: '欠勤・キャンセルはここから',
      body: `${terms.staff}の急な欠勤や${terms.client}の当日キャンセルは、登録すると、その日の案を振り直す手順に進みます。日の画面の「欠勤・キャンセル」からも同じです。`,
      where: 'メニューの「当日の対応」の「欠勤・キャンセル」',
      feature: 'sudden',
    },
    {
      key: 'rules',
      title: '条件（AI の考え方）はここで変えます',
      body: '条件の重み・訪問の種類・特性の項目を変えると、AI の案の作り方が変わります。変えたあとは、影響する日と「作り直す」が画面の上に出ます。',
      where: 'メニューの「AI の考え方」',
      feature: 'rules',
    },
    {
      key: 'search',
      title: `${key} で探せます`,
      body: `上の「探す」か ${key} で、画面・操作・${terms.client}・${terms.staff}の名前を打って探し、そこへ移れます。この案内は「データ」の画面からもう一度見られます。`,
      where: '上の帯の「探す」',
    },
  ];
  return all.filter((s) => !s.feature || isOn(features, s.feature));
}

/** 押したボタン（Esc は skip と同じ） */
export type TourMove = 'next' | 'back' | 'skip';

/**
 * 次に出す枚の番号。閉じるときは null（とばす・最後の枚の「次へ」＝「はじめる」）。
 * 最初の枚の「戻る」は動かない。count が 0 なら閉じる
 */
export function tourMove(index: number, count: number, move: TourMove): number | null {
  if (count <= 0 || move === 'skip') return null;
  const i = Math.min(Math.max(0, index), count - 1);
  if (move === 'back') return Math.max(0, i - 1);
  return i + 1 >= count ? null : i + 1;
}

/** 「次へ」のボタンの文（最後の枚は「はじめる」） */
export const tourNextLabel = (index: number, count: number): string => (index >= count - 1 ? 'はじめる' : '次へ');

/** 何枚目か（「2 / 5」） */
export const tourCountText = (index: number, count: number): string => `${index + 1} / ${count}`;

/**
 * 起動したときに自動で開くか：まだ見ていない（とばしていない）ときだけ。
 * URL に `?id=`（閲覧の欄）か `?do=`（操作の欄）があるリンクで開いたときは開かない（裏で右の欄が開きフォーカスが移るため。
 * 見たことにはしないので、次にふつうに開いたときに出る）。search は HashRouter の location.search
 */
export function shouldAutoOpenTour(seen: boolean, search: string): boolean {
  if (seen) return false;
  const q = new URLSearchParams(search);
  return !q.has('id') && !q.has('do');
}
