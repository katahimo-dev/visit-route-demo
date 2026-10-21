import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** 知らせに添えるボタン（日の画面の手直しの「元に戻す」。PRD D218） */
export type ToastAction = { label: string; onClick: () => void; testId?: string };
export type ToastOptions = { action?: ToastAction };

/** 文だけの知らせを出しておく時間 */
const TOAST_MS = 2500;
/** ボタン付きの知らせを出しておく時間（押す間を残す。フォーカスがボタンにある間・マウスを重ねている間は消さない） */
const ACTION_TOAST_MS = 6000;
/** ボタン付きの知らせの最長（長い文は1字 120ms で読む間を足し、ここで止める。PRD D268） */
const ACTION_TOAST_MAX_MS = 10000;

/** 知らせを出しておく時間（PRD D268）：文だけは短く、ボタン付きは読み上げと押す間を残す（長い文ほど長く、上限あり） */
export function toastMs(msg: string, withAction: boolean): number {
  if (!withAction) return TOAST_MS;
  return Math.min(ACTION_TOAST_MAX_MS, Math.max(ACTION_TOAST_MS, [...msg].length * 120));
}

/** 画面下に短く出す知らせ */
const Ctx = createContext<(msg: string, opts?: ToastOptions) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; action?: ToastAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const hideAfter = useCallback(
    (ms: number) => {
      stop();
      timer.current = setTimeout(() => setToast(null), ms);
    },
    [stop],
  );
  const show = useCallback(
    (msg: string, opts?: ToastOptions) => {
      setToast({ msg, action: opts?.action });
      hideAfter(toastMs(msg, !!opts?.action));
    },
    [hideAfter],
  );
  useEffect(() => {
    return stop;
  }, [stop]);
  const action = toast?.action;
  return (
    <Ctx.Provider value={show}>
      {children}
      {/* body の直下に出す。右の欄が裏（#root）を inert にしても読み上げ・「元に戻す」を押せるよう、欄の inert から外す
          （data-inert-keep。PRD D252） */}
      {createPortal(
        <div className="toast-layer" data-inert-keep>
          {toast &&
            (action ? (
              // 読み上げは文だけ（ボタンの名前を知らせに混ぜない）。ボタンだけ押せる（ほかは下の画面を押せるまま）
              // マウスを重ねている間は消さない（離したら文だけの時間で消す。フォーカスと同じ。PRD D268）
              // biome-ignore lint/a11y/noStaticElementInteractions: 重ねている間だけ時間を止める（操作ではない）
              <div className="toast has-action" onMouseEnter={stop} onMouseLeave={() => hideAfter(TOAST_MS)}>
                <output className="toast-text">{toast.msg}</output>
                <button
                  type="button"
                  className="toast-action"
                  data-testid={action.testId}
                  onFocus={stop}
                  onBlur={() => hideAfter(TOAST_MS)}
                  onClick={() => {
                    stop();
                    setToast(null);
                    action.onClick();
                  }}
                >
                  {action.label}
                </button>
              </div>
            ) : (
              <output className="toast">{toast.msg}</output>
            ))}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
