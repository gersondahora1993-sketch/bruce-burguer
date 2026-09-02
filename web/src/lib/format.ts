export function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function parseMoney(value: string): number | null {
  const raw = value.replace(/[^\d,.-]/g, "").trim();
  if (!raw) return null;
  let cleaned = raw;
  if (raw.includes(",")) {
    cleaned = raw.replace(/\./g, "").replace(",", ".");
  } else if ((raw.match(/\./g) ?? []).length === 1 && /\.\d{1,2}$/.test(raw)) {
    cleaned = raw;
  } else {
    cleaned = raw.replace(/\./g, "");
  }
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function formatDate(value: string): string {
  if (!value) return "";
  const [datePart, timePart = ""] = value.split(" ");
  const [y, m, d] = datePart.split("-");
  return timePart ? `${d}/${m}/${y} ${timePart.slice(0, 5)}` : `${d}/${m}/${y}`;
}

export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function monthStartIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
}

export function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}`;
}

export function maskCpf(value: string): string {
  const d = (value ?? "").replace(/\D/g, "");
  if (d.length === 11) {
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (d.length === 14) {
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return value || "";
}

export function maskPhone(value: string): string {
  const d = (value ?? "").replace(/\D/g, "");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 12) return d.replace(/(\d{2})(\d{2})(\d{4})(\d{4})/, "+$1 ($2) $3-$4");
  if (d.length === 13) return d.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "+$1 ($2) $3-$4");
  return value || "";
}

export function maskCep(value: string): string {
  const d = (value ?? "").replace(/\D/g, "");
  if (d.length >= 8) return `${d.slice(0, 5)}-${d.slice(5, 8)}`;
  return value || "";
}

export function digitsOnly(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

export function maskInputCpf(value: string): string {
  const d = digitsOnly(value).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function maskInputPhone(value: string): string {
  const d = digitsOnly(value).slice(0, 13);
  if (d.length >= 10) return maskPhone(d);
  return d;
}

export function maskInputCep(value: string): string {
  const d = digitsOnly(value).slice(0, 8);
  if (d.length > 5) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return d;
}