import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** 知らせに添えるボタン（日の画面の手直しの「元に戻す」。PRD D218） */
export type ToastAction = { label: string; onClick: () => void; testId?: string };
export type ToastOptions = { action?: ToastAction };

/** 文だけの知らせを出しておく時間 */
const TOAST_MS = 2500;
/** ボタン付きの知らせを出しておく時間（押す間を残す。フォーカスがボタンにある間は消さない） */
const ACTION_TOAST_MS = 6000;

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
      hideAfter(opts?.action ? ACTION_TOAST_MS : TOAST_MS);
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
              <div className="toast has-action">
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
