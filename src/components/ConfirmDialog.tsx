import { CircleQuestionMark, TriangleAlert } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type ConfirmOptions, type ConfirmRequest, enqueue, settle, toRequest, trapTarget } from '../lib/confirmDialog';
import { FOCUSABLE } from './ui';
import { useBodyScrollLock } from './useBodyScrollLock';
import './confirmDialog.css';

/**
 * 独自の確認ダイアログ（PRD D146〜D150。ADR-0026）。ブラウザの confirm の代わりに、画面の中央にアプリの見た目で出す。
 * body の直下に出し、開いているあいだ body のほかの子（#root・右の欄・メニューの引き出し）を inert にする。
 * 最初のフォーカスは取り消し（安全な側）。Tab は中で回す。Esc・背景を押すは取り消し。閉じたら開く前の要素へ戻す。
 * 裏の画面は巻かない（useBodyScrollLock）。Provider の外（ErrorBoundary）でもこの部品だけで出せる
 */
export function ConfirmDialog({
  request,
  onClose,
}: {
  request: Omit<ConfirmRequest, 'id'>;
  /** 答え（true＝確定。取り消し・Esc・背景は false） */
  onClose: (ok: boolean) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const bodyId = useId();
  useBodyScrollLock();
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 裏（body のほかの子）を操作できなくする。閉じたら元の値に戻す
    const saved: [HTMLElement, boolean][] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === wrapRef.current || !(el instanceof HTMLElement)) continue;
      saved.push([el, el.inert]);
      el.inert = true;
    }
    cancelRef.current?.focus();
    // 捕捉の段で受け、右の欄・引き出しの Esc（document で受けている）に渡さない
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current(false);
        return;
      }
      if (e.key !== 'Tab' || !boxRef.current) return;
      e.stopPropagation();
      const list = [...boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const at = document.activeElement;
      const to = trapTarget(list.length, at instanceof HTMLElement ? list.indexOf(at) : -1, e.shiftKey);
      if (to === null) return;
      e.preventDefault();
      list[to]?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      for (const [el, was] of saved) el.inert = was;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);
  const danger = request.tone === 'danger';
  const Icon = danger ? TriangleAlert : CircleQuestionMark;
  return createPortal(
    <div ref={wrapRef} className="confirm-wrap" data-testid="confirm-wrap">
      {/* 背景を押すと取り消し（キーボードは Esc・取り消しのボタン） */}
      <div
        className="confirm-backdrop"
        aria-hidden="true"
        onClick={() => onClose(false)}
        data-testid="confirm-backdrop"
      />
      <div
        ref={boxRef}
        className={`confirm-dialog ${danger ? 'is-danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={request.body ? bodyId : undefined}
        data-testid="confirm-dialog"
      >
        <div className="confirm-head">
          <span className="confirm-icon" aria-hidden="true">
            <Icon size={20} strokeWidth={2.2} />
          </span>
          <h2 id={titleId} data-testid="confirm-title">
            {request.title}
          </h2>
        </div>
        {request.body && (
          <p id={bodyId} className="confirm-body" data-testid="confirm-body">
            {request.body}
          </p>
        )}
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn"
            onClick={() => onClose(false)}
            data-testid="confirm-cancel"
          >
            {request.cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger-solid' : 'btn btn-primary'}
            onClick={() => onClose(true)}
            data-testid="confirm-ok"
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 確認を頼む関数（確定で true、取り消し・Esc・背景で false） */
export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

/** 画面全体で1つ。頼まれた確認を順に1つずつ出す（出ている間に頼まれたら、閉じてから次を出す） */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<readonly ConfirmRequest[]>([]);
  const resolvers = useRef(new Map<number, (ok: boolean) => void>());
  const nextId = useRef(1);
  const ask = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        const id = nextId.current++;
        resolvers.current.set(id, resolve);
        setQueue((q) => enqueue(q, toRequest(id, options)));
      }),
    [],
  );
  const answer = useCallback((id: number, ok: boolean) => {
    const resolve = resolvers.current.get(id);
    resolvers.current.delete(id);
    setQueue((q) => settle(q, id));
    resolve?.(ok);
  }, []);
  // 外れるとき（画面ごと消えるとき）は残りを取り消しとして答える
  useEffect(() => {
    const map = resolvers.current;
    return () => {
      for (const resolve of map.values()) resolve(false);
      map.clear();
    };
  }, []);
  const head = queue[0];
  return (
    <Ctx.Provider value={ask}>
      {children}
      {head && <ConfirmDialog key={head.id} request={head} onClose={(ok) => answer(head.id, ok)} />}
    </Ctx.Provider>
  );
}

/** `const ok = await confirmDialog({ title, body, confirmLabel, tone })` */
export function useConfirm(): ConfirmFn {
  const ask = useContext(Ctx);
  if (!ask) throw new Error('ConfirmProvider の外で useConfirm を使っています');
  return ask;
}
