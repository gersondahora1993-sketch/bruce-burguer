export interface User {
  id: number;
  name: string;
  email: string;
  role: "admin" | "vendedora" | "funcionaria";
  active?: number;
  created_at?: string;
}

export interface Category {
  id: number;
  name: string;
  active: number;
  created_at: string;
}

export interface Color {
  id: number;
  name: string;
  hex: string;
  active: number;
  created_at: string;
}

export interface Size {
  id: number;
  name: string;
  sort_order: number;
  active: number;
  created_at: string;
}

export interface Variation {
  id: number;
  product_id: number;
  color_id: number;
  size_id: number;
  stock: number;
  min_stock: number;
  barcode: string;
  color_name: string;
  size_name: string;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  description: string;
  category_id: number | null;
  category_name: string;
  cost_price_cents: number;
  sale_price_cents: number;
  image_url: string;
  active: boolean;
  created_at: string;
  total_stock: number;
  stock_value_cents: number;
  variations: Variation[];
}

export interface ProductInput {
  name: string;
  sku: string;
  description: string;
  category_id: number | null;
  cost_price_cents: number;
  sale_price_cents: number;
  image_url: string;
  active: boolean;
  variations: { color_id: number; size_id: number; stock: number; min_stock: number }[];
}

export interface StockItem {
  id: number;
  product_id: number;
  color_id: number;
  size_id: number;
  stock: number;
  min_stock: number;
  barcode: string;
  product_name: string;
  sku: string;
  sale_price_cents: number;
  image_url: string;
  category_id: number | null;
  category_name: string;
  color_name: string;
  color_hex: string;
  size_name: string;
  status: "out" | "low" | "ok";
  stock_value_cents: number;
}

export interface StockMovement {
  id: number;
  variation_id: number;
  product_id: number;
  type: "entrada" | "saida" | "ajuste" | "venda_online";
  quantity: number;
  stock_before: number;
  stock_after: number;
  reason: string;
  user_id: number | null;
  user_name: string | null;
  sale_id: number | null;
  order_id: number | null;
  created_at: string;
  product_name: string;
  color_name: string;
  size_name: string;
}

export interface Sale {
  id: number;
  customer_id: number | null;
  customer_name: string;
  total_cents: number;
  payment_method: PaymentMethod;
  status?: "ativa" | "cancelada";
  user_id?: number | null;
  cancelled_at?: string | null;
  cancelled_by?: number | null;
  cancelled_by_name?: string | null;
  user_name: string | null;
  created_at: string;
  item_count: number;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  variation_id: number;
  product_name: string;
  color_name: string;
  size_name: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  image_url?: string;
}

export interface SaleDetail extends Sale {
  items: SaleItem[];
  fiscal_document?: FiscalDocument | null;
}

export type FiscalDocType = "nfce" | "nfe";

export type FiscalDocStatus = "nao_configurado" | "pendente_provedor" | "autorizado" | "rejeitado" | "cancelado";

export const FISCAL_DOC_STATUS_LABELS: Record<FiscalDocStatus, string> = {
  nao_configurado: "Emissão não configurada",
  pendente_provedor: "Aguardando provedor",
  autorizado: "Autorizado",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
};

export interface FiscalDocument {
  id: number;
  sale_id: number;
  type: FiscalDocType;
  status: FiscalDocStatus;
  number: string;
  series: string;
  access_key: string;
  protocol: string;
  xml: string;
  issued_at: string | null;
  cancellation_reason: string;
  provider: string;
  created_at: string;
  updated_at: string;
  sale_total_cents?: number;
  sale_payment_method?: string;
  sale_customer_name?: string;
  sale_status?: string;
  sale_created_at?: string;
}

export type PaymentMethod = "dinheiro" | "pix" | "cartao_debito" | "cartao_credito" | "fiado";

export const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "Pix" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "fiado", label: "Fiado" },
];

export interface Receivable {
  id: number;
  sale_id: number;
  customer_id: number | null;
  customer_name: string;
  total_cents: number;
  received_cents?: number;
  remaining_cents?: number;
  due_date: string;
  status: "pendente" | "pago";
  paid_at: string | null;
  created_at: string;
  sale_date: string;
  vencido: boolean;
  days_overdue: number;
}

export interface CustomerReceivable {
  id: number;
  sale_id: number;
  total_cents: number;
  received_cents?: number;
  remaining_cents?: number;
  due_date: string;
  status: "pendente" | "pago";
  paid_at: string | null;
}

export interface ReceivablesResponse {
  rows: Receivable[];
  summary: {
    total_aberto: number;
    total_vencido: number;
    total_recebido: number;
  };
}

export type OrderStatus = "novo" | "confirmado" | "em_preparacao" | "pronto" | "entregue" | "cancelado";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  novo: "Novo",
  confirmado: "Confirmado",
  em_preparacao: "Em preparação",
  pronto: "Pronto",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export interface Order {
  id: number;
  customer_name: string;
  customer_phone: string;
  address: string;
  notes: string;
  payment_method: string;
  total_cents: number;
  status: OrderStatus;
  created_at: string;
  item_count: number;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  variation_id: number;
  product_name: string;
  color_name: string;
  size_name: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  image_url?: string;
}

export interface OrderDetail extends Order {
  items: OrderItem[];
}

export type CashEntryType = "abertura" | "venda" | "cancelamento" | "recebimento" | "sangria" | "reforco" | "despesa" | "entrada" | "saida";

export const CASH_ENTRY_TYPE_LABELS: Record<CashEntryType, string> = {
  abertura: "Abertura",
  venda: "Venda",
  cancelamento: "Cancelamento",
  recebimento: "Recebimento",
  sangria: "Sangria",
  reforco: "Reforço",
  despesa: "Despesa",
  entrada: "Entrada manual",
  saida: "Saída manual",
};

export const CASH_MOVEMENT_TYPES: { value: CashEntryType; label: string; sign: 1 | -1 }[] = [
  { value: "entrada", label: "Entrada manual", sign: 1 },
  { value: "reforco", label: "Reforço (suprimento)", sign: 1 },
  { value: "saida", label: "Saída manual", sign: -1 },
  { value: "sangria", label: "Sangria", sign: -1 },
  { value: "despesa", label: "Despesa", sign: -1 },
];

export interface CashEntry {
  id: number;
  cash_session_id: number | null;
  type: CashEntryType;
  sale_id: number | null;
  receivable_id: number | null;
  customer_name: string;
  reference: string;
  description: string;
  amount_cents: number;
  payment_method: string | null;
  user_id: number | null;
  user_name: string | null;
  created_at: string;
}

export interface CashSession {
  id: number;
  user_id: number | null;
  user_name: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cents: number;
  total_sales_cents: number;
  total_saidas_cents: number;
  expected_cents: number;
  dinheiro_cents: number;
  pix_cents: number;
  debito_cents: number;
  credito_cents: number;
  fiado_cents: number;
  closing_cents: number;
  diff_cents: number;
  status: "aberto" | "fechado";
  sales: {
    dinheiro: number;
    pix: number;
    cartao_debito: number;
    cartao_credito: number;
    fiado: number;
    total: number;
  };
  entries: CashEntry[];
}

export interface CashResponse {
  sessions: CashSession[];
  current: CashSession | null;
}

export interface StoreVariation {
  id: number;
  color_id: number;
  color_name: string;
  color_hex: string;
  size_id: number;
  size_name: string;
  stock: number;
  min_stock: number;
  available: boolean;
}

export interface StoreProduct {
  id: number;
  name: string;
  sku: string;
  description: string;
  category_id: number | null;
  category_name: string;
  sale_price_cents: number;
  image_url: string;
  total_stock: number;
  variations: StoreVariation[];
}

export interface StoreInfo {
  store_name: string;
  store_logo_url: string;
  store_cnpj: string;
  store_phone: string;
  store_instagram: string;
  store_address: string;
  store_city: string;
  store_state: string;
  store_zip: string;
  opening_hours: string;
  whatsapp_digits_only: string;
  slogan: string;
}

export interface CustomerStats {
  sale_count: number;
  total_spent_cents: number;
  total_fiado_cents: number;
  open_balance_cents: number;
  total_received_cents: number;
  cancelled_count: number;
}

export interface CustomerPayment {
  id: number;
  receivable_id: number;
  reference: string;
  amount_cents: number;
  payment_method: PaymentMethod;
  created_at: string;
  user_name?: string | null;
}

export interface CustomerDetail extends Customer {
  stats: CustomerStats;
  recent_sales: { id: number; total_cents: number; payment_method: PaymentMethod; status: "ativa" | "cancelada"; created_at: string }[];
  sales_history: { id: number; total_cents: number; payment_method: PaymentMethod; status: "ativa" | "cancelada"; created_at: string; cancelled_at: string | null }[];
  payments: CustomerPayment[];
  receivables: CustomerReceivable[];
}

export interface Customer {
  id: number;
  name: string;
  cpf: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  uf: string;
  cep: string;
  notes: string;
  status: "ativo" | "inativo";
  created_at: string;
  updated_at?: string;
  created_by?: number | null;
  updated_by?: number | null;
  inactivated_at?: string;
  inactivated_by?: number | null;
}

export interface DashboardData {
  totals: {
    products: number;
    active_products: number;
    out_of_stock_products: number;
    low_stock_products: number;
    total_pieces: number;
    stock_value_cents: number;
  };
  sales: {
    today: { count: number; total_cents: number };
    month: { count: number; total_cents: number; items: number };
  };
  chart_sales: { date: string; count: number; total_cents: number }[];
  top_products: { name: string; quantity: number; total_cents: number }[];
  stock_by_category: { name: string; pieces: number; value_cents: number }[];
}

export interface ReportData {
  summary: { count: number; total_cents: number; avg_ticket_cents: number };
  daily: { date: string; count: number; total_cents: number }[];
  items: {
    product_name: string;
    color_name: string;
    size_name: string;
    quantity: number;
    unit_price_cents: number;
    total_cents: number;
    category_name: string;
    created_at: string;
  }[];
  by_payment: { payment_method: PaymentMethod; count: number; total_cents: number }[];
  top: { name: string; quantity: number; total_cents: number }[];
  stock: {
    rows: {
      id: number;
      product_name: string;
      sku: string;
      color_name: string;
      size_name: string;
      stock: number;
      min_stock: number;
      sale_price_cents: number;
      stock_value_cents: number;
    }[];
    by_category: { name: string; pieces: number; value_cents: number }[];
    total_value_cents: number;
    total_pieces: number;
    out_of_stock: unknown[];
    low_stock: unknown[];
  };
}

export interface AppSettings {
  store_name: string;
  store_logo_url: string;
  store_cnpj: string;
  store_phone: string;
  whatsapp_number: string;
  whatsapp_digits_only: string;
  store_instagram: string;
  store_address: string;
  store_city: string;
  store_state: string;
  store_zip: string;
  opening_hours: string;
}

export interface SaleReceiptStore {
  store_name: string;
  store_logo_url: string;
  store_cnpj: string;
  store_phone: string;
  whatsapp_number: string;
  store_address: string;
  store_city: string;
  store_state: string;
  store_zip: string;
}

export interface SaleReceiptSale {
  id: number;
  customer_id: number | null;
  customer_name: string;
  total_cents: number;
  amount_received_cents: number;
  change_cents: number;
  payment_method: PaymentMethod;
  status: "ativa" | "cancelada";
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  created_at: string;
  user_id: number | null;
  user_name: string | null;
}

export interface SaleReceiptItem {
  product_name: string;
  color_name: string;
  size_name: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
}

export interface SaleReceipt {
  store: SaleReceiptStore;
  sale: SaleReceiptSale;
  items: SaleReceiptItem[];
  subtotal_cents: number;
  surcharge_cents: number;
  rounding_cents: number;
  discount_cents: number;
  payment_label: string;
  fiado: {
    receivable_id: number;
    total_cents: number;
    due_date: string;
    received_cents: number;
    remaining_cents: number;
    status: string;
    quitado: boolean;
  } | null;
  whatsapp_text: string;
}