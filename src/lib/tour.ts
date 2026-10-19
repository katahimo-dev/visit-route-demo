// 初回の案内ツアー（PRD D192・D193・D226。ADR-0025 追記・ADR-0031）の純粋な部分：案内の中身（6枚。最後は3段の説明と
// 「今日の予定を開く」）、「次へ」「戻る」「とばす」の行き先、自動で開くか。画面は components/Tour.tsx、見たかの保存は store/tour.ts
import type { Terms } from '../contracts/documents';
import type { FeatureId, Features } from '../contracts/features';
import { isOn } from './features';

/** 案内の1枚 */
export type TourStep = {
  key: 'home' | 'plan' | 'absence' | 'rules' | 'search' | 'flow';
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
 * 案内の6枚（呼び方は terms。キーの印は mac なら ⌘K）。最後の枚は予定の組み方の3段（AI案 → 手直し（固定）→ 確定）で、
 * 画面は「今日の予定を開く」を添える（PRD D226）。
 * features で切った機能の枚（欠勤・キャンセル・条件の重み）は出さない（PRD D213。枚数はそのぶん減る）
 */
export function tourSteps(terms: Pick<Terms, 'client' | 'staff'>, isMac: boolean, features: Features = {}): TourStep[] {
  const key = isMac ? '⌘K' : 'Ctrl+K';
  // 予定のメニューの項目（案を比べるを切っていれば出さない）
  const planItems = isOn(features, 'compare')
    ? '月の予定・週の予定・日の予定・案を比べる'
    : '月の予定・週の予定・日の予定';
  // AI の条件のメニューの項目（相性を切っていれば出さない）
  const ruleItems = isOn(features, 'compat') ? '条件の重み・相性' : '条件の重み';
  const all: TourStep[] = [
    {
      key: 'home',
      title: 'ホームに「今日やること」が出ます',
      body: '開くとまずホームが出ます。今月の案づくり・確定していない日・要対応など、次にやることをカードで出します。カードを押すと、その操作の画面へ移ります。',
      where: 'メニューの「ホーム」（スマホは下のタブ）',
    },
    {
      key: 'plan',
      title: '予定は月・週・日で組みます',
      body: '月で一月分を見渡し、案をまとめて作って、問題の無い日をまとめて確定できます。週は人ごとの1週間、日はその日の割当を手直しして確定する画面です。',
      where: `メニューの「予定」（${planItems}）`,
    },
    {
      key: 'absence',
      title: '欠勤・キャンセルはここから',
      body: `${terms.staff}の急な欠勤や${terms.client}の当日キャンセルは、登録すると、その日の案を振り直す手順に進みます。日の予定の「欠勤・キャンセルを登録」からも同じです。`,
      where: 'メニューの「当日・問い合わせ」の「欠勤・キャンセルを登録」',
      feature: 'sudden',
    },
    {
      key: 'rules',
      title: 'AI の条件はここで変えます',
      body: '条件の重み・相性を変えると、AI の案の作り方が変わります（訪問の種類・特性の項目は「設定」）。変えたあとは、影響する日と「作り直す」が画面の上に出ます。',
      where: `メニューの「AI の条件」（${ruleItems}）`,
      feature: 'rules',
    },
    {
      key: 'search',
      title: `${key} で探せます`,
      body: `上の「探す」か ${key} で、画面・操作・${terms.client}・${terms.staff}の名前を打って探し、そこへ移れます。この案内は「データ」の画面からもう一度見られます。`,
      where: '上の帯の「探す」',
    },
    {
      key: 'flow',
      title: '予定は「AI案 → 手直し → 確定」の3段です',
      body: '日ごとに、この3段で割当を決めます。まず今日の予定を開いてみましょう。',
      points: [
        'AI案：AI が、条件に合う担当と回る順番の案を作ります（日を開くと自動で作ります）。',
        `手直し（固定）：替えたい訪問は別の${terms.staff}へドラッグします。動かした訪問は「固定」になり、残りを AI に組み直させても担当が残ります。`,
        `確定：「この割当で確定」を押すと各訪問の担当が決まり、${terms.staff}の画面にも出ます。`,
      ],
      where: 'メニューの「予定」の「日の予定」（スマホは下のタブの「今日」）',
    },
  ];
  return all.filter((s) => !s.feature || isOn(features, s.feature));
}

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

/** 何枚目か（「2 / 6」） */
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
