import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

interface Toast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

interface ToastContextValue {
  toast: (type: Toast["type"], message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (type: Toast["type"], message: string) => {
      const id = ++counter.current;
      setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
      window.setTimeout(() => remove(id), 4000);
    },
    [remove]
  );

  const success = useCallback((message: string) => toast("success", message), [toast]);
  const error = useCallback((message: string) => toast("error", message), [toast]);

  const icons = {
    success: <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />,
    error: <AlertCircle size={18} className="text-rose-500 shrink-0" />,
    info: <Info size={18} className="text-rose-600 shrink-0" />,
  };

  return (
    <ToastContext.Provider value={{ toast, success, error }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3.5 shadow-lg shadow-zinc-900/10 animate-[slideIn_.2s_ease-out]"
          >
            {icons[t.type]}
            <p className="flex-1 text-sm text-zinc-700">{t.message}</p>
            <button onClick={() => remove(t.id)} className="text-zinc-400 hover:text-zinc-600" aria-label="Fechar">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
      <style>{`@keyframes slideIn { from { opacity: 0; transform: translateY(-8px);} to { opacity: 1; transform: translateY(0);} }`}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast deve ser usado dentro de ToastProvider");
  return ctx;
}