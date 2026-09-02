import { forwardRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Loader2, AlertTriangle, Search, X, Eye, EyeOff } from "lucide-react";

const inputClasses =
  "w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 disabled:bg-zinc-100 disabled:text-zinc-400";

/* ------------------------------ Field ------------------------------ */

export function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-700">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-400">{hint}</span>}
    </label>
  );
}

/* ------------------------------ Input ------------------------------ */

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      {...props}
      className={`${inputClasses} ${invalid ? "border-rose-400 focus:border-rose-500 focus:ring-rose-500/20" : ""} ${props.className ?? ""}`}
    />
  );
});

/* --------------------------- PasswordInput -------------------------- */

export function PasswordInput({ invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={props.className} invalid={invalid} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-600"
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

/* ----------------------- SearchInput (debounce) ---------------------- */

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className ?? ""}`}>
      <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-zinc-400" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-10" />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
          aria-label="Limpar busca"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------ Select ------------------------------ */

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
  invalid?: boolean;
}

export function Select({ children, className, invalid, ...props }: SelectProps) {
  return (
    <select
      {...props}
      className={`${inputClasses} ${invalid ? "border-rose-400" : ""} ${className ?? ""}`}
    >
      {children}
    </select>
  );
}

/* ----------------------------- Textarea ----------------------------- */

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={`${inputClasses} ${invalid ? "border-rose-400" : ""} ${props.className ?? ""}`}
    />
  );
});

/* ------------------------------ Button ------------------------------ */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "whatsapp";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm shadow-rose-600/30",
  secondary: "bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-50",
  ghost: "bg-transparent text-zinc-600 hover:bg-zinc-100",
  danger: "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100",
  whatsapp: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/30",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2.5 text-sm gap-2",
  lg: "px-6 py-3 text-base gap-2",
};

export function Button({ variant = "primary", size = "md", loading, disabled, children, className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition select-none disabled:cursor-not-allowed disabled:opacity-50 active:scale-[.98] ${variantClasses[variant]} ${sizeClasses[size]} ${className ?? ""}`}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ------------------------------- Toggle ------------------------------ */

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2"
      aria-pressed={checked}
    >
      <span
        className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-rose-600" : "bg-zinc-300"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
      {label && <span className="text-sm text-zinc-700">{label}</span>}
    </button>
  );
}

/* ------------------------------- Badge ------------------------------- */

export function Badge({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "rose" | "emerald" | "amber" | "red" | "violet" }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-700",
    rose: "bg-rose-100 text-rose-700",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
    violet: "bg-violet-100 text-violet-700",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

/* ------------------------------- Card ------------------------------- */

export function Card({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-zinc-200 bg-white shadow-sm ${className ?? ""}`}>{children}</div>;
}

/* ------------------------------ Spinner ------------------------------ */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={20} className={`animate-spin text-rose-600 ${className ?? ""}`} />;
}

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

/* ----------------------------- Skeleton ----------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-zinc-200 ${className ?? "h-4 w-full"}`} />;
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="space-y-3 p-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </Card>
      ))}
    </div>
  );
}

/* ---------------------------- EmptyState ---------------------------- */

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-200/70 text-zinc-500">
        <AlertTriangle size={24} />
      </div>
      <div>
        <p className="font-medium text-zinc-800">{title}</p>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------- Modal ------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  if (!open) return null;
  const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-zinc-950/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl ${sizes[size]}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h3 className="font-display text-lg font-semibold text-zinc-900">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-100 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

/* --------------------------- ConfirmDialog --------------------------- */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Excluir",
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-zinc-600">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------------------------- PageHeader ----------------------------- */

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold text-zinc-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}