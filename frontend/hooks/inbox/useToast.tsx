"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "info" | "success" | "error";

export type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
  /** Optional retry handler — when present, the toast renders a "Retry" button. */
  retry?: () => void;
};

type ToastInput = { message: string; variant?: ToastVariant; retry?: () => void };

export type UseToastValue = {
  toasts: Toast[];
  push: (t: ToastInput) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<UseToastValue | null>(null);

const DEFAULT_TTL_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    ({ message, variant = "info", retry }: ToastInput) => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((prev) => [...prev, { id, message, variant, retry }]);
      const ttl = variant === "error" ? DEFAULT_TTL_MS + 2000 : DEFAULT_TTL_MS;
      const handle = setTimeout(() => dismiss(id), ttl);
      timersRef.current.set(id, handle);
    },
    [dismiss]
  );

  const value = useMemo<UseToastValue>(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
