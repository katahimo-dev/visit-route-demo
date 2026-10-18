// 独自の確認ダイアログ（PRD D146〜D150。ADR-0026）の純粋な部分：頼まれた確認の並び（同時に出すのは先頭の1つ）、
// 既定の文言、ダイアログの中で Tab を回す行き先。画面の部品は components/ConfirmDialog.tsx

/** 確定のボタンの色：danger＝消す・捨てる（赤）、primary＝それ以外（オレンジ） */
export type ConfirmTone = 'danger' | 'primary';

/** 確認の頼み方（`const ok = await confirmDialog({...})`） */
export type ConfirmOptions = {
  /** 見出し（問いを1文で。例「変更を捨てて、欄を閉じますか？」） */
  title: string;
  /** 本文（何が起きるか。改行 \n はそのまま改行で出す）。無ければ出さない */
  body?: string;
  /** 確定のボタンの文言（動詞。例「捨てて作り直す」。「OK」にしない） */
  confirmLabel: string;
  /** 取り消しのボタンの文言（既定「取り消す」） */
  cancelLabel?: string;
  /** 既定 primary */
  tone?: ConfirmTone;
};

/** 並びに入れた確認（既定を埋めたもの） */
export type ConfirmRequest = {
  id: number;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmTone;
};

/** 取り消しのボタンの既定の文言（Esc・背景を押したときも同じ答え） */
export const CANCEL_LABEL = '取り消す';

/** 頼み方から並びに入れる形へ（文言の前後の空白を落とし、空なら既定） */
export function toRequest(id: number, o: ConfirmOptions): ConfirmRequest {
  const cancel = o.cancelLabel?.trim();
  return {
    id,
    title: o.title.trim(),
    body: (o.body ?? '').trim(),
    confirmLabel: o.confirmLabel.trim(),
    cancelLabel: cancel ? cancel : CANCEL_LABEL,
    tone: o.tone ?? 'primary',
  };
}

/** 並びの後ろに足す（出ているものがあれば、閉じてから次を出す） */
export const enqueue = (q: readonly ConfirmRequest[], r: ConfirmRequest): ConfirmRequest[] => [...q, r];

/** 答えた確認を並びから外す（無い ID なら何もしない＝2回押しても1回だけ） */
export const settle = (q: readonly ConfirmRequest[], id: number): readonly ConfirmRequest[] =>
  q.some((r) => r.id === id) ? q.filter((r) => r.id !== id) : q;

/**
 * Tab で中を回す行き先。count はダイアログの中のフォーカスできるものの数、index は今のフォーカスの位置
 * （中に無ければ -1）。端から外へ出るときだけ行き先（反対の端）を返し、ほかは null（ブラウザに任せる）。
 * 何も無ければ -1（動かさない）
 */
export function trapTarget(count: number, index: number, shift: boolean): number | null {
  if (count <= 0) return -1;
  if (shift) return index <= 0 ? count - 1 : null;
  return index < 0 || index >= count - 1 ? 0 : null;
}
