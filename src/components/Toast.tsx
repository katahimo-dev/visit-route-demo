import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

/** 画面下に短く出す知らせ */
const Ctx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2500);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Ctx.Provider value={show}>
      {children}
      {msg && <output className="toast">{msg}</output>}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
