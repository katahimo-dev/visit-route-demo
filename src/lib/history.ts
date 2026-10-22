// 全体の「元に戻す・やり直す」の履歴（PRD D329。ADR-0054）。データ（DemoData）の変更を1手ずつ積み、最大50手まで戻せる。
// 画面の状態だけで保存しない（読み直すと消える）。DemoData は不変なので、前後のデータの参照を持つだけで写しは作らない。
// store（DemoDataProvider）が変更のたびに record し、読み込み・初期化・別のタブの変更（丸ごと差し替え）では clear する
import type { DemoData } from '../contracts/data';
import { createValueStore, type ReadableStore } from './valueStore';

/** 戻せる手の数の上限 */
export const HISTORY_MAX = 50;

/** 名前の無い変更の呼び名 */
export const DEFAULT_LABEL = '変更';

/** 1手（変える前と後のデータ・操作の名前） */
export type HistoryEntry = { before: DemoData; after: DemoData; label: string; token?: object };

/** 画面が読む今の状態（戻せる手・やり直せる手の名前。無ければ null） */
export type HistoryState = { undo: string | null; redo: string | null; undoCount: number; redoCount: number };

export type History = {
  state: ReadableStore<HistoryState>;
  /**
   * 変更を1手積む（同じなら積まない）。やり直しの手は捨てる。token は update の1回ごとの印で、同じ印の2回目
   * （StrictMode・描き直しで更新の関数がもう一度呼ばれたとき）は前の手を置き換える
   */
  record(before: DemoData, after: DemoData, label?: string | null, token?: object): void;
  /** 1手戻す：戻した先のデータと手の名前（戻せなければ null）。current は今のデータ（やり直しの先になる） */
  undo(current: DemoData): { data: DemoData; label: string } | null;
  /** 1手やり直す */
  redo(current: DemoData): { data: DemoData; label: string } | null;
  /** 全部捨てる（データを丸ごと差し替えたとき） */
  clear(): void;
};

const EMPTY: HistoryState = { undo: null, redo: null, undoCount: 0, redoCount: 0 };

export function createHistory(max = HISTORY_MAX): History {
  let past: HistoryEntry[] = [];
  let future: HistoryEntry[] = [];
  const state = createValueStore<HistoryState>(EMPTY);
  const now = () =>
    state.set({
      undo: past.at(-1)?.label ?? null,
      redo: future.at(-1)?.label ?? null,
      undoCount: past.length,
      redoCount: future.length,
    });
  // 積むのは store の更新の関数の中（描画の途中のことがある）なので、画面への知らせは後へ回す（描画の途中にほかの部品を描き直させない）
  let queued = false;
  const emit = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      now();
    });
  };
  return {
    state,
    record(before, after, label, token) {
      const last = past.at(-1);
      if (token && last?.token === token && last.before === before) {
        // 同じ update の関数がもう一度呼ばれた：前の手を置き換える（変わらなければ消す）
        past.pop();
      }
      if (before === after) {
        emit();
        return;
      }
      past.push({ before, after, label: label || DEFAULT_LABEL, token });
      if (past.length > max) past = past.slice(past.length - max);
      future = [];
      emit();
    },
    undo(current) {
      const e = past.pop();
      if (!e) return null;
      future.push({ before: e.before, after: current, label: e.label });
      emit();
      return { data: e.before, label: e.label };
    },
    redo(current) {
      const e = future.pop();
      if (!e) return null;
      past.push({ before: current, after: e.after, label: e.label });
      emit();
      return { data: e.after, label: e.label };
    },
    clear() {
      past = [];
      future = [];
      emit();
    },
  };
}

/** アプリで1つの履歴（store が書き、画面は state を読む） */
export const appHistory: History = createHistory();

/**
 * Ctrl+Z（mac は ⌘Z）・Ctrl+Shift+Z・Ctrl+Y のどれか（null は当たらない）。
 * 入力欄・テキストエリア・選ぶ欄・書ける要素の中では奪わない（その欄の文字の取り消しに使う）
 */
export function historyKey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  isMac: boolean,
): 'undo' | 'redo' | null {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !isMac && !e.shiftKey) return 'redo';
  return null;
}

/** キーを奪わない所（入力欄・テキストエリア・選ぶ欄・書ける要素） */
export function isTextTarget(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).closest !== 'function') return false;
  const el = t as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
  // 押すだけの入力（チェック・ラジオ・ボタン）は文字を持たないので奪ってよい
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
}
