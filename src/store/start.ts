// 初めて開いたとき（保存データが無い）の機能の入り切り（PRD D276。ADR-0045）。
// 既定は「基本」のひな形。DemoData とは別のキーに「すべて」と書いてあれば、すべて入（{}）で始める
// （e2e の共通の部品 scripts/lib/startFeatures.cjs と、全機能を見せたいデモの前準備のため。値は印だけで個人の情報は持たない）。
// localStorage を触るのは store の中だけ（AGENTS.md）。読めなければ既定（基本）
import type { Features } from '../contracts/features';
import { applyTemplate } from '../lib/features';

/** localStorage のキー（DemoData の STORAGE_KEY とは別。データの版・書き出し・初期状態に戻すに入れない） */
export const FEATURES_START_KEY = 'vrdemo:features:start';
/** 「すべて入で始める」の印 */
export const FEATURES_START_ALL = 'all';

type KeyStore = Pick<Storage, 'getItem'>;

/**
 * 初めて開いたときの入り切り：キーが「all」ならすべて入（{}。今までの初期データと同じ）、ほかは基本のひな形
 * （20の ID を明示して書く。あとから入れた機能は管理者設定で入れる）
 */
export function startFeatures(getStorage: () => KeyStore | null = () => globalThis.localStorage ?? null): Features {
  try {
    if (getStorage()?.getItem(FEATURES_START_KEY) === FEATURES_START_ALL) return {};
  } catch {
    // 読めなければ既定
  }
  return applyTemplate('basic');
}
