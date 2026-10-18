// 〈スタッフ〉・〈利用者さん〉の詳細の吹き出しの「開いている状態」（PRD D122〜D126。ADR-0022 追記）。
// 画面全体で1つだけ持つ小さな入れ物（React の state にしない）。名前のボタンは自分が開いているかだけを購読し、
// 開け閉めで描き直すのは押したボタン・前に開いていたボタン・吹き出しだけにする（週の時間軸・日の画面の表全体を描き直さない）

export type PersonKind = 'staff' | 'client';

/** 開いている吹き出し：だれの詳細か（kind・id）と、押したボタンの id（同じ人の名前が画面に何か所あっても区別する） */
export type OpenedPerson = { kind: PersonKind; id: string; anchorId: string };

export type PersonPopoverStore = {
  get: () => OpenedPerson | null;
  subscribe: (fn: () => void) => () => void;
  /** 押したとき：同じボタンなら閉じ、違えば開き直す（同時に1つ） */
  toggle: (p: OpenedPerson) => void;
  close: () => void;
  /** そのボタンで開いていれば閉じる（ボタンが消えたとき＝見出しが消えたら閉じる） */
  closeIf: (anchorId: string) => void;
};

export function createPersonPopoverStore(): PersonPopoverStore {
  let cur: OpenedPerson | null = null;
  const subs = new Set<() => void>();
  const set = (next: OpenedPerson | null) => {
    if (next === cur) return;
    cur = next;
    for (const fn of [...subs]) fn();
  };
  return {
    get: () => cur,
    subscribe: (fn) => {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    toggle: (p) => set(cur && cur.anchorId === p.anchorId ? null : p),
    close: () => set(null),
    closeIf: (anchorId) => {
      if (cur?.anchorId === anchorId) set(null);
    },
  };
}
