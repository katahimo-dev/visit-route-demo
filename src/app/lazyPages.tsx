// 重い画面を別のチャンクに分ける（PRD D248。ADR-0039）。ホームの初回表示で読む JS を減らす。
// 分けるのは日の予定・空き状況・案を比べる・相性・月の予定（地図 Leaflet は components/RouteMap で別に分ける）
import { Hourglass } from 'lucide-react';
import { useEffect } from 'react';
import { RouteMap } from '../components/RouteMap';
import { hashPathname } from '../lib/commandPalette';
import { type LazyComponent, lazyComponent } from '../lib/lazyComponent';

export const PlanPage = lazyComponent('PlanPage', () => import('../pages/PlanPage'));
export const VacancyPage = lazyComponent('VacancyPage', () => import('../pages/VacancyPage'));
export const ComparePage = lazyComponent('ComparePage', () => import('../pages/ComparePage'));
export const CompatPage = lazyComponent('CompatPage', () => import('../pages/CompatPage'));
export const MonthPage = lazyComponent('MonthPage', () => import('../pages/MonthPage'));

/** URL（hash）の画面のパス → 分けた画面 */
const BY_PATH: Record<string, LazyComponent<object>> = {
  '/plan': PlanPage,
  '/vacancy': VacancyPage,
  '/compare': ComparePage,
  '/compat': CompatPage,
  '/month': MonthPage,
};

/** 地図も出す画面（直接開いたら地図の本体も一緒に読み始める） */
const WITH_MAP = new Set(['/plan', '/compare', '/vacancy']);

// 分けた画面を直接開いたとき（ブックマーク・再読み込み）は、起動の処理（データの読み込み・初期の案）と並べて
// その画面のチャンクをすぐ読み始める（描くときに読み始めると、本体 → 画面 → 地図の順に待つ）
if (typeof window !== 'undefined') {
  const path = hashPathname(window.location.hash);
  BY_PATH[path]?.preload().catch(() => {});
  if (WITH_MAP.has(path)) RouteMap.preload().catch(() => {});
}

/** 先読みの順（よく使う順。下のタブの「今日」・月・空き状況、地図、比較・相性） */
const PRELOAD_ORDER: { preload: () => Promise<unknown> }[] = [
  PlanPage,
  MonthPage,
  VacancyPage,
  RouteMap,
  ComparePage,
  CompatPage,
];
/** 手が空くのを待つ最長の時間（空かなくてもこの時間で始める） */
const PRELOAD_IDLE_MS = 2000;

/** 手が空いたら cb（requestIdleCallback が無ければ時間で）。戻り値は取り消し */
function whenIdle(cb: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(cb, { timeout: PRELOAD_IDLE_MS });
    return () => window.cancelIdleCallback(id);
  }
  const t = setTimeout(cb, PRELOAD_IDLE_MS);
  return () => clearTimeout(t);
}

let preloaded = false;
/**
 * 分けた画面と地図を1つずつ順に読む（1回だけ）。1つ読み終わったら、手が空くのを待って次へ
 * （まとめて読むと、読んで実行する間ほかの操作・計測を待たせる）。読めなくても次へ進む（その画面を開いたときに読み直す）
 */
function preloadPages(): void {
  if (preloaded) return;
  preloaded = true;
  const next = (i: number) => {
    const c = PRELOAD_ORDER[i];
    if (!c) return;
    c.preload()
      .catch(() => {})
      .finally(() => whenIdle(() => next(i + 1)));
  };
  next(0);
}

/**
 * 画面が出て手が空いたら、分けた画面と地図を先に読んでおく（画面を移るときに待たせない。PRD D248）。
 * Suspense の中に置く：開いた画面のチャンクが読み終わって画面が出るまでは始めない（その画面の読み込みと取り合わない）
 */
export function PreloadWhenShown() {
  useEffect(() => (preloaded ? undefined : whenIdle(preloadPages)), []);
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
