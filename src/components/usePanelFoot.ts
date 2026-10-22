import { type RefObject, useEffect } from 'react';
import { panelFit, toastPlace } from '../lib/panelFit';

/**
 * 右の欄の確定のボタンの帯（PRD D194〜D197。ADR-0025 追記）。帯は巻く領域（`.drawer-body`）の中で内容のすぐ後ろに置き、
 * `position: sticky; bottom: 0` で欄の下に貼り付ける（CSS）。ここでは2つだけ JS で見る：
 * - 貼り付いているか：帯のすぐ後ろの番兵（高さ0）が巻く領域に見えていなければ、内容が帯の下に隠れている。
 *   帯の `data-stuck` に "true"／"false" を書き、区切り（背景・上の線・影）はそのときだけ CSS で出す
 * - 帯の高さ：巻く領域の `--drawer-foot-h` に入れ、`scroll-padding-bottom` に使う（Tab で入った入力欄が帯の裏に隠れない）
 * 帯が無い欄では何もしない。data-stuck は React が持たない属性なので、描き直しでも消えない
 */
export function usePanelFoot(
  body: RefObject<HTMLElement | null>,
  foot: RefObject<HTMLElement | null>,
  end: RefObject<HTMLElement | null>,
  hasFoot: boolean,
  /** 巻く領域の要素が入れ替わったら変える値（入力の欄の form ⇄ div。PRD D251） */
  bodyKind?: string,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: bodyKind は要素の入れ替わりを知るためだけに見る
  useEffect(() => {
    const b = body.current;
    const f = foot.current;
    const e = end.current;
    if (!hasFoot || !b || !f || !e) return;
    const offs: (() => void)[] = [];
    if (typeof IntersectionObserver !== 'undefined') {
      // 巻き終えた所の小数の誤差で区切りがちらつかないよう、下を 1px 広げて見る
      const io = new IntersectionObserver(
        (list) => {
          const last = list.at(-1);
          if (last) f.dataset.stuck = last.isIntersecting ? 'false' : 'true';
        },
        { root: b, rootMargin: '0px 0px 1px 0px' },
      );
      io.observe(e);
      offs.push(() => io.disconnect());
    }
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => b.style.setProperty('--drawer-foot-h', `${f.offsetHeight}px`));
      ro.observe(f);
      offs.push(() => {
        ro.disconnect();
        b.style.removeProperty('--drawer-foot-h');
      });
    }
    return () => {
      for (const off of offs) off();
      delete f.dataset.stuck;
    };
  }, [body, foot, end, hasFoot, bodyKind]);
}

/**
 * スマホでキーボードが出て見えている所（visualViewport）が縮んだら、欄の入れ物をそこへ合わせる（PRD D197）。
 * 合わせ方は `lib/panelFit.ts`（純粋関数）。visualViewport が無いブラウザでは何もしない（CSS の inset: 0 のまま）
 */
export function useVisualViewportFit(wrap: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const w = wrap.current;
    const vv = typeof window === 'undefined' ? null : window.visualViewport;
    if (!w || !vv) return;
    const apply = () => {
      const r = panelFit({
        innerHeight: window.innerHeight,
        height: vv.height,
        offsetTop: vv.offsetTop,
        scale: vv.scale,
      });
      // 知らせ（トースト）も見えている所の上端に合わせる（--drawer-top。styles.css）
      if (r) document.documentElement.style.setProperty('--drawer-top', `${r.top}px`);
      else document.documentElement.style.removeProperty('--drawer-top');
      if (r) {
        w.style.top = `${r.top}px`;
        w.style.height = `${r.height}px`;
        w.style.bottom = 'auto';
      } else {
        w.style.removeProperty('top');
        w.style.removeProperty('height');
        w.style.removeProperty('bottom');
      }
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      document.documentElement.style.removeProperty('--drawer-top');
    };
  }, [wrap]);
}

/**
 * 欄が開いている間の知らせ（トースト）の置き場所（PRD D197。PR #46 のレビュー）。欄の見出しの実際の高さ（2段になることがある）と
 * 欄の幅を html の CSS 変数（--drawer-head-h・--drawer-w）に入れ、置き場所（`toastPlace`）を html の data-drawer-toast に書く。
 * styles.css は 'top' なら見出しのすぐ下、'side' なら欄の外（幕の側）の真ん中に出す
 */
export function usePanelToastPlace(drawer: RefObject<HTMLElement | null>, head: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const d = drawer.current;
    const h = head.current;
    if (!d || !h) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty('--drawer-head-h', `${h.offsetHeight}px`);
      root.style.setProperty('--drawer-w', `${d.offsetWidth}px`);
      root.dataset.drawerToast = toastPlace(window.innerWidth, d.offsetWidth);
    };
    apply();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    ro?.observe(h);
    ro?.observe(d);
    window.addEventListener('resize', apply);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', apply);
      root.style.removeProperty('--drawer-head-h');
      root.style.removeProperty('--drawer-w');
      delete root.dataset.drawerToast;
    };
  }, [drawer, head]);
}
