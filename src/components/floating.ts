import { useLayoutEffect, useState } from 'react';

/** 浮かせた部品の位置が変わったときに出す（ほかの浮かせた部品が自分の位置を出し直す。detail は部品の名前） */
export const FLOATING_EVENT = 'floating-change';

/**
 * 浮かせた部品（右下の地図・左下の欠勤の振り直しの帯）の位置を、ほかの部品が避けられるよう CSS の変数に出す。
 * `--{name}-top`：画面の下端から部品の上端までの高さ、`--{name}-left`：画面の右端から部品の左端までの幅（px）。
 * 部品が消えたら変数も消す。返す関数を ref に渡す
 */
export function useFloatingEdge(name: string): (el: HTMLElement | null) => void {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const root = document.documentElement.style;
    let last = '';
    const put = () => {
      const r = el.getBoundingClientRect();
      const top = `${Math.round(window.innerHeight - r.top)}px`;
      const left = `${Math.round(window.innerWidth - r.left)}px`;
      if (`${top} ${left}` === last) return;
      last = `${top} ${left}`;
      root.setProperty(`--${name}-top`, top);
      root.setProperty(`--${name}-left`, left);
      window.dispatchEvent(new CustomEvent(FLOATING_EVENT, { detail: name }));
    };
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    window.addEventListener('resize', put);
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== name) put();
    };
    window.addEventListener(FLOATING_EVENT, onOther);
    // 出てくるときの動き（toast-in）が終わってから位置を出し直す
    el.addEventListener('animationend', put);
    return () => {
      el.removeEventListener('animationend', put);
      ro.disconnect();
      window.removeEventListener('resize', put);
      window.removeEventListener(FLOATING_EVENT, onOther);
      root.removeProperty(`--${name}-top`);
      root.removeProperty(`--${name}-left`);
      window.dispatchEvent(new CustomEvent(FLOATING_EVENT, { detail: name }));
    };
  }, [el, name]);
  return setEl;
}
