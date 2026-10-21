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
 * 案内の3枚（PRD D277。呼び方は terms）：ホーム／予定で案を作って確定（3段「AI案 → 手直し（固定）→ 確定」）／欠勤・キャンセル。
 * 最後の枚は、画面で主ボタン「今日の予定を開く」を添える（PRD D226）。条件の重み・探す（Ctrl+K）の枚は入れない
 * （探すは上の帯の「探す」が見えている。条件は設定のタブにある）。
 * features で切った機能の枚（欠勤・キャンセル）は出さない（PRD D213。枚数はそのぶん減る）
 */
export function tourSteps(terms: Pick<Terms, 'client' | 'staff'>, features: Features = {}): TourStep[] {
  const all: TourStep[] = [
    {
      key: 'home',
      title: 'ホームに「今日やること」が出ます',
      body: '開くとまずホームが出ます。今月の案づくり・確定していない日・要対応など、次にやることをカードで出します。いちばん上の「まずこれ」から押していけば、作業の順に進めます。',
      where: 'メニューの「ホーム」（スマホは下のタブ）',
    },
    {
      key: 'plan',
      title: '予定で案を作って確定します',
      body: '予定は月・週・日の3つの表示を、画面の上の［月｜週｜日］で切り替えます。月で一月分の案をまとめて作り、問題の無い日をまとめて確定できます。日ごとには、この3段で割当を決めます。',
      points: [
        'AI案：AI が、条件に合う担当と回る順番の案を作ります（日を開くと自動で作ります）。',
        `手直し（固定）：替えたい訪問は別の${terms.staff}へドラッグします。動かした訪問は「固定」になり、残りを AI に組み直させても担当が残ります。`,
        `確定：「この割当で確定」を押すと各訪問の担当が決まり、${terms.staff}の画面にも出ます。`,
      ],
      where: 'メニューの「予定」（スマホは下のタブの「予定」）',
    },
    {
      key: 'absence',
      title: '欠勤・キャンセルはここから',
      body: `${terms.staff}の急な欠勤や${terms.client}の当日キャンセルは、登録すると、その日の案を振り直す手順に進みます。日の予定の「欠勤・キャンセルを登録」からも同じです。`,
      where: 'メニューの「欠勤・キャンセルを登録」（スマホは下のタブの「欠勤」）',
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
    description: '条件の重み・案を比べる・勤務の見込み・Excel なども含めた、すべての機能',
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
 * URL に `?id=`（閲覧の欄）か `?do=`（操作の欄）があるリンクで開いたときは開かない（裏で右の欄が開きフォーカスが移るため。
 * 見たことにはしないので、次にふつうに開いたときに出る）。search は HashRouter の location.search
 */
export function shouldAutoOpenTour(seen: boolean, search: string): boolean {
  if (seen) return false;
  const q = new URLSearchParams(search);
  return !q.has('id') && !q.has('do');
}
