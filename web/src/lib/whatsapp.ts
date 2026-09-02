import { money } from "./format";

export interface WhatsappOrderItem {
  name: string;
  color: string;
  size: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
}

export interface WhatsappOrder {
  customerName: string;
  paymentLabel: string;
  totalCents: number;
  items: WhatsappOrderItem[];
}

/**
 * Monta a mensagem do pedido para o WhatsApp.
 * A integração oficial (API do WhatsApp Business / provedores como Z-API, Twilio etc.)
 * deve substituir o link wa.me futuramente. O ponto de integração está na função
 * `sendOrderWhatsApp` e nas configurações (Configurações > WhatsApp).
 */
export function buildOrderMessage(order: WhatsappOrder): string {
  const lines: string[] = [
    `*Pedido - ${order.customerName || "Cliente"}*`,
    ``,
    "*Itens do pedido:*",
  ];
  for (const it of order.items) {
    lines.push(`• ${it.name} (${it.color}/${it.size}) x${it.quantity} — ${money(it.line_cents)}`);
  }
  lines.push(``, `*Total: ${money(order.totalCents)}*`, `*Pagamento: ${order.paymentLabel}*`);
  return lines.join("\n");
}

export interface StoreOrderData {
  orderId?: number;
  customerName: string;
  customerPhone: string;
  address: string;
  notes: string;
  paymentLabel: string;
  totalCents: number;
  items: WhatsappOrderItem[];
}

export function buildStoreOrderMessage(order: StoreOrderData): string {
  const lines: string[] = ["Olá! Gostaria de fazer um pedido.", ``];
  if (order.orderId) lines.push(`*Pedido: #${String(order.orderId).padStart(4, "0")}*`);
  lines.push(``, "*Itens:*");
  for (const it of order.items) {
    lines.push(`• ${it.name} (${it.color}/${it.size}) x${it.quantity} — ${money(it.line_cents)}`);
  }
  lines.push(``, `*Total: ${money(order.totalCents)}*`, `*Pagamento: ${order.paymentLabel}*`, ``);
  lines.push(`*Cliente:* ${order.customerName}`, `*Telefone:* ${order.customerPhone}`);
  if (order.address) lines.push(`*Endereço:* ${order.address}`);
  if (order.notes) lines.push(`*Observação:* ${order.notes}`);
  return lines.join("\n");
}

export function sendOrderWhatsApp(phoneDigits: string, message: string): void {
  const base = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
  window.open(base, "_blank", "noopener");
}