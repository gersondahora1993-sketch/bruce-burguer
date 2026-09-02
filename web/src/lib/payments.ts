import type { PaymentMethod } from "../types";

export const SURCHARGE_CENTS: Partial<Record<PaymentMethod, number>> = {
  cartao_credito: 1000,
  fiado: 1500,
};

export interface PaymentTotals {
  subtotalCents: number;
  surchargeCents: number;
  roundingCents: number;
  finalCents: number;
}

export function paymentTotals(payment: PaymentMethod, subtotalCents: number): PaymentTotals {
  const extra = SURCHARGE_CENTS[payment] ?? 0;
  if (!extra) {
    return { subtotalCents, surchargeCents: 0, roundingCents: 0, finalCents: subtotalCents };
  }
  if (payment === "fiado") {
    const finalCents = Math.ceil((subtotalCents + extra) / 100) * 100;
    return { subtotalCents, surchargeCents: extra, roundingCents: finalCents - subtotalCents - extra, finalCents };
  }
  return { subtotalCents, surchargeCents: extra, roundingCents: 0, finalCents: subtotalCents + extra };
}

export function paymentHint(payment: PaymentMethod, subtotalCents: number): string {
  const totals = paymentTotals(payment, subtotalCents);
  if (totals.surchargeCents <= 0) return "à vista";
  return `+ acréscimo de ${money(totals.surchargeCents)}`;
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
