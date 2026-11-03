import { db, now } from "../db.js";

// FASE 4B — Núcleo de estoque por produto.
// Toda alteração de estoque passa por adjustStock() (update atômico + movimentação),
// nunca por UPDATE direto de products.stock fora deste módulo.

export const STOCK_MOVEMENT_TYPES = ["entrada", "saida", "ajuste", "venda", "estorno"] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

// Tipos aceitos pela API manual de movimentações. venda/estorno são apenas gerados pelo motor.
export const MANUAL_MOVEMENT_TYPES = ["entrada", "saida", "ajuste"] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export interface StockAdjustOptions {
  companyId: number;
  productId: number;
  type: StockMovementType;
  /** Sempre positivo. Delta para entrada/saida/venda/estorno; |delta| para ajuste. */
  quantity: number;
  reason?: string;
  /** "order" quando a movimentação origina de um pedido; null para movimentações manuais. */
  referenceType?: string | null;
  referenceId?: number | null;
  userId?: number | null;
  /** Estoque absoluto desejado (apenas para type === "ajuste"). */
  targetStock?: number;
}

function insertMovement(opts: {
  companyId: number;
  productId: number;
  type: StockMovementType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reason: string;
  referenceType?: string | null;
  referenceId?: number | null;
  userId?: number | null;
}): void {
  db.prepare(
    `INSERT INTO stock_movements (
       company_id, product_id, type, quantity, stock_before, stock_after, reason,
       reference_type, reference_id, user_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    opts.companyId,
    opts.productId,
    opts.type,
    opts.quantity,
    opts.stockBefore,
    opts.stockAfter,
    opts.reason,
    opts.referenceType ?? null,
    opts.referenceId ?? null,
    opts.userId ?? null,
    now()
  );
}

export function getProductStock(companyId: number, productId: number): number | null {
  const row = db
    .prepare("SELECT stock FROM products WHERE id = ? AND company_id = ?")
    .get(productId, companyId) as { stock: number } | undefined;
  return row ? row.stock : null;
}

/**
 * Aplica uma movimentação de estoque de forma atômica (deve ser chamada dentro de
 * um hook de transação do chamador quando fizer parte de um fluxo maior).
 * Nunca deixa o estoque ficar negativo.
 */
export function adjustStock(opts: StockAdjustOptions): void {
  const { companyId, productId, type } = opts;
  if (!STOCK_MOVEMENT_TYPES.includes(type)) {
    throw new Error("Tipo de movimentação de estoque inválido.");
  }
  if (type !== "ajuste" && (!Number.isInteger(opts.quantity) || opts.quantity <= 0)) {
    throw new Error("A quantidade da movimentação deve ser um inteiro positivo.");
  }

  const current = getProductStock(companyId, productId);
  if (current === null) {
    throw new Error("Produto não encontrado para a movimentação de estoque.");
  }

  let delta: number;
  let recordedQty: number;

  switch (type) {
    case "entrada":
    case "estorno":
      delta = opts.quantity;
      recordedQty = opts.quantity;
      break;
    case "saida":
    case "venda":
      if (opts.quantity > current) {
        throw new Error(
          `Estoque insuficiente para "${productLabel(productId)}" (disponível: ${current}).`
        );
      }
      delta = -opts.quantity;
      recordedQty = opts.quantity;
      break;
    case "ajuste": {
      const target = opts.targetStock;
      if (typeof target !== "number" || !Number.isInteger(target) || target < 0) {
        throw new Error("Para o ajuste informe o estoque-alvo (target_stock) não negativo.");
      }
      if (target === current) {
        return; // sem mudança real: não gera ruído no histórico
      }
      delta = target - current;
      recordedQty = Math.abs(delta);
      break;
    }
    default:
      throw new Error("Tipo de movimentação de estoque inválido.");
  }

  const stockAfter = current + delta;

  // Update condicional: para saídas, garante que o estoque nunca fique negativo
  // mesmo sob concorrência (changes !== 1 ⇒ conflito/insuficiência).
  const result =
    delta < 0
      ? db
          .prepare(
            "UPDATE products SET stock = stock + ? WHERE id = ? AND company_id = ? AND stock >= ?"
          )
          .run(delta, productId, companyId, recordedQty)
      : db
          .prepare("UPDATE products SET stock = stock + ? WHERE id = ? AND company_id = ?")
          .run(delta, productId, companyId);

  if (result.changes !== 1) {
    throw new Error("Não foi possível atualizar o estoque (insuficiente ou concorrência).");
  }

  insertMovement({
    companyId,
    productId,
    type,
    quantity: recordedQty,
    stockBefore: current,
    stockAfter,
    reason: opts.reason ?? "",
    referenceType: opts.referenceType ?? null,
    referenceId: opts.referenceId ?? null,
    userId: opts.userId ?? null,
  });
}

function productLabel(productId: number): string {
  const row = db.prepare("SELECT name FROM products WHERE id = ?").get(productId) as
    | { name: string }
    | undefined;
  return row?.name ?? `produto #${productId}`;
}

export interface OrderConsumptionLine {
  product_id: number | null;
  combo_id: number | null;
  quantity: number;
}

export function hasOrderVendaMovements(companyId: number, orderId: number): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM stock_movements
       WHERE company_id = ? AND reference_type = 'order' AND reference_id = ? AND type = 'venda'
       LIMIT 1`
    )
    .get(companyId, orderId);
}

export function hasOrderEstornoMovements(companyId: number, orderId: number): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM stock_movements
       WHERE company_id = ? AND reference_type = 'order' AND reference_id = ? AND type = 'estorno'
       LIMIT 1`
    )
    .get(companyId, orderId);
}

/**
 * Baixa o estoque de um pedido (venda presencial na criação ou confirmação online).
 * Combos consomem seus componentes via combo_items (sem estoque próprio). Adicionais
 * não consomem estoque. Idempotente: se já houver movimentação de venda para o pedido, não faz nada.
 */
export function consumeStockForOrder(opts: {
  companyId: number;
  orderId: number;
  lines: OrderConsumptionLine[];
  userId: number | null;
  reason: string;
}): void {
  if (hasOrderVendaMovements(opts.companyId, opts.orderId)) return;

  const consumption = new Map<number, { qty: number; labels: Set<string> }>();
  for (const line of opts.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;
    if (line.product_id) {
      const entry = consumption.get(line.product_id) ?? { qty: 0, labels: new Set<string>() };
      entry.qty += line.quantity;
      consumption.set(line.product_id, entry);
    } else if (line.combo_id) {
      const combo = db
        .prepare("SELECT name FROM combos WHERE id = ? AND company_id = ?")
        .get(line.combo_id, opts.companyId) as { name: string } | undefined;
      const comboName = combo?.name ?? `combo #${line.combo_id}`;
      const items = db
        .prepare("SELECT product_id, quantity FROM combo_items WHERE combo_id = ? AND company_id = ?")
        .all(line.combo_id, opts.companyId) as { product_id: number; quantity: number }[];
      for (const it of items) {
        if (!it.product_id) continue;
        const entry = consumption.get(it.product_id) ?? { qty: 0, labels: new Set<string>() };
        entry.qty += it.quantity * line.quantity;
        entry.labels.add(comboName);
        consumption.set(it.product_id, entry);
      }
    }
  }

  for (const [productId, entry] of consumption) {
    const comboPart = entry.labels.size ? ` [${[...entry.labels].join(",")}]` : "";
    adjustStock({
      companyId: opts.companyId,
      productId,
      type: "venda",
      quantity: entry.qty,
      reason: `${opts.reason}${comboPart}`,
      referenceType: "order",
      referenceId: opts.orderId,
      userId: opts.userId ?? null,
    });
  }
}

/**
 * Estorna o estoque de um pedido cancelado usando as movimentações ORIGINAIS de venda do pedido
 * (não recalcula a composição atual de combos). Idempotente: se já houver estorno registrado, não faz nada.
 */
export function estornarOrderStock(opts: { companyId: number; orderId: number; userId: number | null }): void {
  if (hasOrderEstornoMovements(opts.companyId, opts.orderId)) return;

  const movementRows = db
    .prepare(
      `SELECT product_id, quantity, reason FROM stock_movements
       WHERE company_id = ? AND reference_type = 'order' AND reference_id = ? AND type = 'venda'
       ORDER BY id ASC`
    )
    .all(opts.companyId, opts.orderId) as { product_id: number; quantity: number; reason: string }[];

  for (const m of movementRows) {
    adjustStock({
      companyId: opts.companyId,
      productId: m.product_id,
      type: "estorno",
      quantity: m.quantity,
      reason: m.reason ? `Estorno de ${m.reason}` : "Estorno de venda",
      referenceType: "order",
      referenceId: opts.orderId,
      userId: opts.userId ?? null,
    });
  }
}