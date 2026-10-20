// 重い画面を別のチャンクに分ける（PRD D248。ADR-0039）。ホームの初回表示で読む JS を減らす。
// 分けるのは日の予定・空き状況・案を比べる・相性・月の予定（地図 Leaflet は components/RouteMap で別に分ける）
import { Hourglass } from 'lucide-react';
import { useEffect } from 'react';
import { RouteMap } from '../components/RouteMap';
import { hashPathname } from '../lib/commandPalette';
import { type LazyComponent, lazyComponent } from '../lib/lazyComponent';

export const PlanPage = lazyComponent(() => import('../pages/PlanPage'));
export const VacancyPage = lazyComponent(() => import('../pages/VacancyPage'));
export const ComparePage = lazyComponent(() => import('../pages/ComparePage'));
export const CompatPage = lazyComponent(() => import('../pages/CompatPage'));
export const MonthPage = lazyComponent(() => import('../pages/MonthPage'));

/** URL（hash）の画面のパス → 分けた画面 */
const BY_PATH: Record<string, LazyComponent<object>> = {
  '/plan': PlanPage,
  '/vacancy': VacancyPage,
  '/compare': ComparePage,
  '/compat': CompatPage,
  '/month': MonthPage,
};

// 分けた画面を直接開いたとき（ブックマーク・再読み込み）は、起動の処理（データの読み込み・初期の案）と並べて
// その画面のチャンクをすぐ読み始める（描くときに読み始めると、本体 → 画面の順に待つ）
if (typeof window !== 'undefined') {
  BY_PATH[hashPathname(window.location.hash)]?.preload().catch(() => {});
}

let preloaded = false;
/** 手が空くのを待つ最長の時間（空かなくてもこの時間で始める） */
const PRELOAD_IDLE_MS = 2000;

/** 分けた画面と地図を読む（1回だけ）。読めなくても何もしない（その画面を開いたときに読み直す） */
function preloadPages(): void {
  if (preloaded) return;
  preloaded = true;
  for (const c of [...Object.values(BY_PATH), RouteMap]) c.preload().catch(() => {});
}

/**
 * 画面が出て手が空いたら、分けた画面と地図を先に読んでおく（画面を移るときに待たせない。PRD D248）。
 * Suspense の中に置く：開いた画面のチャンクが読み終わって画面が出るまでは始めない（その画面の読み込みと取り合わない）
 */
export function PreloadWhenShown() {
  useEffect(() => {
    if (preloaded) return;
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preloadPages, { timeout: PRELOAD_IDLE_MS });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(preloadPages, PRELOAD_IDLE_MS);
    return () => clearTimeout(t);
  }, []);
  return null;
}

/** 分けた画面を読んでいる間の表示（空のときの見た目に合わせる。高さを取っておき、下のタブなどを跳ねさせない） */
export function PageLoading() {
  return (
    <output className="empty page-loading" aria-busy="true" data-testid="page-loading">
      <Hourglass size={28} strokeWidth={1.8} aria-hidden="true" />
      <div>画面を読み込んでいます…</div>
    </output>
  );
}
