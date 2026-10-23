// 初回の案内ツアー（PRD D192・D193・D226・D276・D277。ADR-0025 追記・ADR-0031・ADR-0045）の純粋な部分：案内の中身（3枚。最後の枚は
// 「今日の予定を開く」）、1枚目で聞く「どこまで使うか」の選択肢、「次へ」「戻る」「とばす」の行き先、自動で開くか。
// 画面は components/Tour.tsx、見たかの保存は store/tour.ts
import type { Terms } from '../contracts/documents';
import type { FeatureId, Features } from '../contracts/features';
import { isOn, type TemplateId } from './features';

/** 案内の1枚 */
export type TourStep = {
  key: 'home' | 'plan' | 'absence';
  title: string;
  body: string;
  /** 本文の下に番号付きで並べる段（3段の説明） */
  points?: string[];
  /** どこにあるか（メニュー・下のタブ・上の帯の名前） */
  where: string;
  /** その枚が案内する機能（切っていたら枚を出さない。土台の枚は無し） */
  feature?: FeatureId;
};

/**
 * 案内の3枚（PRD D277。呼び方は terms）：ホーム／予定で担当を組んで確定（3段「提案（AI）→ ピン → 確定（伝えた）」）／欠勤・キャンセル。
 * 最後の枚は、画面で主ボタン「今日の予定を開く」を添える（PRD D226）。条件の重み・探す（Ctrl+K）の枚は入れない
 * （探すは上の帯の「探す」が見えている。条件は設定のタブにある）。
 * features で切った機能の枚（欠勤・キャンセル）は出さない（PRD D213。枚数はそのぶん減る）
 */
export function tourSteps(terms: Pick<Terms, 'client' | 'staff'>, features: Features = {}): TourStep[] {
  const all: TourStep[] = [
    {
      key: 'home',
      title: 'ホームに「今日やること」が出ます',
      body: '開くと、まずホームが出ます。次にやることがカードで並びます。いちばん上の「まずこれ」から順に押せば進めます。',
      where: 'メニューの「ホーム」（スマホは下のタブ）',
    },
    {
      key: 'plan',
      title: '予定で担当を組んで確定します',
      body: '予定は、画面の上の［月｜週｜日］で表示を切り替えます。月・週・日のどれも、同じ操作の行（欠勤・キャンセル／AI で組む／元に戻す）が並びます。繰り返しの訪問は、繰り返しの担当で最初から入っています。次の3段で決めます。',
      points: [
        '提案（AI）：「AI で組む」で、この日・この週・この月のどれかを選ぶと、AI が担当と回る順番の提案を出します。よければ「反映する」。間違えたら「元に戻す」（Ctrl+Z）。',
        `ピン：替えたい訪問は、別の${terms.staff}へドラッグします。動かした訪問にはピンが付き、AI で組んでも担当が残ります。`,
        `確定（伝えた）：${terms.staff}に伝えたら「確定（伝えた）」を押します。あとの変更は「未連絡の変更」として連絡の一覧に出ます。`,
      ],
      where: 'メニューの「予定」（スマホは下のタブの「予定」）',
    },
    {
      key: 'absence',
      title: '欠勤・キャンセルはここから',
      body: `${terms.staff}の急な欠勤や${terms.client}の当日キャンセルを登録すると、その日の担当を振り直す手順に進みます。日の予定の「欠勤・キャンセルを登録」からも登録できます。`,
      where: 'メニューの「欠勤・キャンセル」（スマホは下のタブの「欠勤」）',
      feature: 'sudden',
    },
  ];
  return all.filter((s) => !s.feature || isOn(features, s.feature));
}

/** 1枚目で聞く「どこまで使うか」の選択肢（PRD D276。ひな形の ID と、画面に出す名前・1行の説明） */
export type TourStartChoice = { id: Extract<TemplateId, 'basic' | 'all'>; label: string; description: string };
export const TOUR_START_CHOICES: readonly TourStartChoice[] = [
  {
    id: 'basic',
    label: '基本',
    description: '予定・欠勤・キャンセル・空き状況・相性など、まず使う機能だけ（おすすめ）',
  },
  {
    id: 'all',
    label: 'すべて',
    description: '条件の重み・提案を比べる・勤務の見込み・Excel なども含めた、すべての機能',
  },
];
/** 選択肢の見出し */
export const TOUR_START_QUESTION = 'どこまで使いますか';
/** 選択肢の下の注記 */
export const TOUR_START_NOTE =
  '「次へ」で決まります。あとから「設定」の「管理者設定」で、機能を1つずつ入り切りできます。';

/** 押したボタン（Esc は skip と同じ） */
export type TourMove = 'next' | 'back' | 'skip';

/**
 * 次に出す枚の番号。閉じるときは null（とばす・最後の枚の「次へ」＝「閉じる」）。
 * 最初の枚の「戻る」は動かない。count が 0 なら閉じる
 */
export function tourMove(index: number, count: number, move: TourMove): number | null {
  if (count <= 0 || move === 'skip') return null;
  const i = Math.min(Math.max(0, index), count - 1);
  if (move === 'back') return Math.max(0, i - 1);
  return i + 1 >= count ? null : i + 1;
}

/** 「次へ」のボタンの文（最後の枚は「閉じる」。最後の枚の主ボタンは TOUR_TODAY_LABEL） */
export const tourNextLabel = (index: number, count: number): string => (index >= count - 1 ? '閉じる' : '次へ');

/** 最後の枚の主ボタン：閉じて今日の日の画面を開く（PRD D226） */
export const TOUR_TODAY_LABEL = '今日の予定を開く';

/** 何枚目か（「2 / 3」） */
export const tourCountText = (index: number, count: number): string => `${index + 1} / ${count}`;

/**
 * 起動したときに自動で開くか：まだ見ていない（とばしていない）ときだけ。
 * URL に `?id=`（人の画面へ移る）か `?do=`（操作の欄）があるリンク、人の画面のリンクで開いたときは開かない（裏で右の欄が開きフォーカスが移るため。
 * 見たことにはしないので、次にふつうに開いたときに出る）。search は HashRouter の location.search
 */
export function shouldAutoOpenTour(seen: boolean, search: string, pathname = '/'): boolean {
  if (seen) return false;
  // 〈利用者さん〉・〈スタッフ〉の画面（`/clients/:id`。PRD D308）へのリンクで開いたときも出さない（`?id=` と同じ）
  if (/^\/(clients|staff)\/[^/]+$/.test(pathname)) return false;
  const q = new URLSearchParams(search);
  return !q.has('id') && !q.has('do');
}
