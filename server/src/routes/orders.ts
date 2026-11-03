import { Router } from "express";
import { db, now } from "../db.js";
import { requireAuth, requireTenant } from "../auth.js";
import { env } from "../config.js";
import {
  consumeStockForOrder,
  estornarOrderStock,
} from "../lib/stock.js";
import type { Request, Response } from "express";

const router = Router();

export const ORDER_STATUSES = ["novo", "confirmado", "em_preparacao", "pronto", "entregue", "cancelado"];

const STATUS_FLOW = ["novo", "confirmado", "em_preparacao", "pronto", "entregue", "cancelado"];

export const PAYMENT_METHODS = ["dinheiro", "pix", "cartao_debito", "cartao_credito", "fiado"];

const PAYMENT_ALIASES: Record<string, string> = {
  pix: "pix",
  dinheiro: "dinheiro",
  cartao_debito: "cartao_debito",
  debito: "cartao_debito",
  "cartão de débito": "cartao_debito",
  cartao_credito: "cartao_credito",
  credito: "cartao_credito",
  crédito: "cartao_credito",
  "cartão de crédito": "cartao_credito",
  fiado: "fiado",
  crediário: "fiado",
};

const DELIVERY_TYPES = ["entrega", "retirada"] as const;
type DeliveryType = (typeof DELIVERY_TYPES)[number];

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePaymentMethod(raw: unknown): string {
  const value = asString(raw) || "pix";
  const lowered = value.toLowerCase();
  if (!lowered) return value;
  return PAYMENT_ALIASES[lowered] ?? value;
}

function isPaymentMethod(value: string): boolean {
  return PAYMENT_METHODS.includes(value);
}

function normalizeDeliveryType(raw: unknown, fallback: DeliveryType): DeliveryType {
  const value = asString(raw);
  return DELIVERY_TYPES.includes(value as DeliveryType) ? (value as DeliveryType) : fallback;
}

function parseDiscountCents(raw: unknown): { value: number } | { error: string } {
  if (raw === undefined || raw === null || raw === "") return { value: 0 };
  const text = typeof raw === "number" ? String(raw) : asString(raw);
  if (!/^\d+$/.test(text)) return { error: "Desconto inválido." };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0) return { error: "Desconto inválido." };
  return { value };
}

interface AddonSpec {
  addon_id: number;
  quantity: number;
}

interface ItemSpec {
  kind: "product" | "combo";
  id: number;
  quantity: number;
  addons: AddonSpec[];
}

function parseItemSpecs(rawItems: unknown): { specs?: ItemSpec[]; error?: string } {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: "O carrinho está vazio." };
  }
  const specs: ItemSpec[] = [];
  for (const raw of rawItems) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const quantity = Number(it.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return { error: "Item do pedido inválido." };
    }
    const hasProduct = it.product_id !== undefined && it.product_id !== null && it.product_id !== "";
    const hasCombo = it.combo_id !== undefined && it.combo_id !== null && it.combo_id !== "";
    if (hasProduct === hasCombo) {
      return { error: "Cada item do pedido deve conter product_id ou combo_id." };
    }
    if (hasProduct) {
      const productId = Number(it.product_id);
      if (!Number.isInteger(productId) || productId <= 0) {
        return { error: "Produto inválido." };
      }
      const addons: AddonSpec[] = [];
      const rawAddons = Array.isArray(it.addons) ? it.addons : [];
      for (const a of rawAddons) {
        const addonId = Number((a as any)?.addon_id);
        const addonQty = Number((a as any)?.quantity);
        if (!Number.isInteger(addonId) || addonId <= 0 || !Number.isInteger(addonQty) || addonQty <= 0) {
          return { error: "Adicional do item inválido." };
        }
        addons.push({ addon_id: addonId, quantity: addonQty });
      }
      specs.push({ kind: "product", id: productId, quantity, addons });
    } else {
      const comboId = Number(it.combo_id);
      if (!Number.isInteger(comboId) || comboId <= 0) {
        return { error: "Combo inválido." };
      }
      if (Array.isArray(it.addons) && it.addons.length > 0) {
        return { error: "Combos não aceitam adicionais individuais." };
      }
      specs.push({ kind: "combo", id: comboId, quantity, addons: [] });
    }
  }
  return { specs };
}

interface CreateOrderInput {
  companyId: number;
  userId: number | null;
  source: "online" | "presencial";
  deliveryType: DeliveryType;
  paymentMethod: string;
  discountCents: number;
  paidAt: string | null;
  customerName: string;
  customerPhone: string;
  street: string;
  neighborhood: string;
  complement: string;
  reference: string;
  notes: string;
  specs: ItemSpec[];
  /** Presencial baixa o estoque na criação; online não (baixa apenas na confirmação). */
  applyStock: boolean;
}

function persistOrder(input: CreateOrderInput) {
  const tx = db.transaction(() => {
    const lines = input.specs.map((spec) => {
      if (spec.kind === "product") {
        const row = db
          .prepare(
            `SELECT p.id, p.name, p.sale_price_cents, p.active, p.image_url
             FROM products p
             WHERE p.id = ? AND p.company_id = ?`
          )
          .get(spec.id, input.companyId) as {
          id: number;
          name: string;
          sale_price_cents: number;
          active: number;
          image_url: string;
        } | undefined;
        if (!row || row.active !== 1) {
          throw new Error("Algum produto não está mais disponível. Atualize o carrinho.");
        }

        const addonLines = spec.addons.map((a) => {
          const addonRow = db
            .prepare("SELECT id, name, price_cents, active FROM addons WHERE id = ? AND company_id = ?")
            .get(a.addon_id, input.companyId) as {
            id: number;
            name: string;
            price_cents: number;
            active: number;
          } | undefined;
          if (!addonRow || addonRow.active !== 1) {
            throw new Error(`Adicional indisponível para "${row.name}". Atualize o carrinho.`);
          }
          const link = db
            .prepare("SELECT 1 FROM product_addons WHERE product_id = ? AND addon_id = ? AND company_id = ?")
            .get(spec.id, a.addon_id, input.companyId);
          if (!link) {
            throw new Error(`O adicional "${addonRow.name}" não está disponível para "${row.name}".`);
          }
          return { addon_id: a.addon_id, name: addonRow.name, price_cents: addonRow.price_cents, quantity: a.quantity };
        });

        const unit = row.sale_price_cents;
        const addonPerUnit = addonLines.reduce((sum, a) => sum + a.price_cents * a.quantity, 0);
        const line = (unit + addonPerUnit) * spec.quantity;
        return {
          kind: "product" as const,
          product_id: row.id,
          combo_id: null as number | null,
          product_name: row.name,
          image_url: row.image_url,
          quantity: spec.quantity,
          unit_cents: unit,
          addons: addonLines,
          line_cents: line,
        };
      }

      const combo = db
        .prepare("SELECT id, name, sale_price_cents, active FROM combos WHERE id = ? AND company_id = ?")
        .get(spec.id, input.companyId) as { id: number; name: string; sale_price_cents: number; active: number } | undefined;
      if (!combo || combo.active !== 1) {
        throw new Error("Algum combo não está mais disponível. Atualize o carrinho.");
      }
      const line = combo.sale_price_cents * spec.quantity;
      return {
        kind: "combo" as const,
        product_id: null as number | null,
        combo_id: combo.id,
        product_name: combo.name,
        image_url: null,
        quantity: spec.quantity,
        unit_cents: combo.sale_price_cents,
        addons: [] as { addon_id: number; name: string; price_cents: number; quantity: number }[],
        line_cents: line,
      };
    });

    const subtotal = lines.reduce((sum, l) => sum + l.line_cents, 0);
    if (input.discountCents > subtotal) {
      throw new Error("O desconto não pode ser maior que o subtotal do pedido.");
    }
    const deliveryFeeCents = 0;
    const total = subtotal + deliveryFeeCents - input.discountCents;

    const ts = now();
    const info = db
      .prepare(
        `INSERT INTO orders (
           customer_name, customer_phone, street, neighborhood, complement, reference, notes,
           subtotal_cents, delivery_fee_cents, discount_cents, total_cents, payment_method,
           source, delivery_type, user_id, customer_id, paid_at, completed_at, status, company_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'novo', ?, ?)`
      )
      .run(
        input.customerName,
        input.customerPhone,
        input.street,
        input.neighborhood,
        input.complement,
        input.reference,
        input.notes,
        subtotal,
        deliveryFeeCents,
        input.discountCents,
        total,
        input.paymentMethod,
        input.source,
        input.deliveryType,
        input.userId,
        null,
        input.paidAt,
        null,
        input.companyId,
        ts
      );
    const orderId = Number(info.lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, combo_id, quantity, price_cents, observation, company_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertAddon = db.prepare(
      `INSERT INTO order_item_addons (order_item_id, addon_id, quantity, price_cents, company_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const persisted = [];
    for (const l of lines) {
      const observation = l.kind === "combo" ? l.product_name : "";
      const itemInfo = insertItem.run(orderId, l.product_id, l.combo_id, l.quantity, l.unit_cents, observation, input.companyId, ts);
      const orderItemId = Number(itemInfo.lastInsertRowid);
      for (const a of l.addons) {
        insertAddon.run(orderItemId, a.addon_id, a.quantity, a.price_cents, input.companyId, ts);
      }
      persisted.push({
        product_id: l.product_id,
        combo_id: l.combo_id,
        product_name: l.product_name,
        quantity: l.quantity,
        unit_cents: l.unit_cents,
        addons: l.addons.map((a) => ({
          ...a,
          total_cents: a.price_cents * a.quantity * l.quantity,
        })),
        line_cents: l.line_cents,
      });
    }

    // Baixa de estoque na criação (apenas venda presencial). Combos consomem componentes,
    // adicionais não consomem. Falhas de estoque revertem o pedido inteiro (rollback).
    if (input.applyStock) {
      consumeStockForOrder({
        companyId: input.companyId,
        orderId,
        lines: input.specs.map((s) => ({
          product_id: s.kind === "product" ? s.id : null,
          combo_id: s.kind === "combo" ? s.id : null,
          quantity: s.quantity,
        })),
        userId: input.userId,
        reason: "Venda presencial",
      });
    }

    return {
      order_id: orderId,
      source: input.source,
      subtotal_cents: subtotal,
      discount_cents: input.discountCents,
      total_cents: total,
      payment_method: input.paymentMethod,
      delivery_type: input.deliveryType,
      paid_at: input.paidAt,
      status: "novo",
      created_at: ts,
      item_count: persisted.length,
      items: persisted,
    };
  });
  return tx;
}

/* ------------------------- Criação de pedido (loja online/pública) ------------------------- */

router.post("/", (req: Request, res: Response) => {
  const body = req.body ?? {};
  const companyId = env.publicCompanyId;
  const userId = null;
  if (!companyId) {
    res.status(503).json({ error: "Pedidos públicos não estão configurados para uma empresa." });
    return;
  }

  const customerName = asString(body.customer_name);
  const customerPhone = asString(body.customer_phone);
  const street = asString(body.street);
  const neighborhood = asString(body.neighborhood);
  const complement = asString(body.complement);
  const reference = asString(body.reference);
  const notes = asString(body.notes);
  const paymentMethod = normalizePaymentMethod(body.payment_method);
  const deliveryType = normalizeDeliveryType(body.delivery_type, "entrega");

  if (!customerName) {
    res.status(400).json({ error: "Informe o seu nome." });
    return;
  }
  if (!customerPhone) {
    res.status(400).json({ error: "Informe o seu telefone." });
    return;
  }

  const items = parseItemSpecs(body.items);
  if (items.error) {
    res.status(400).json({ error: items.error });
    return;
  }

  const orderTx = persistOrder({
    companyId,
    userId,
    source: "online",
    deliveryType,
    paymentMethod,
    discountCents: 0,
    paidAt: null,
    customerName,
    customerPhone,
    street,
    neighborhood,
    complement,
    reference,
    notes,
    specs: items.specs!,
    applyStock: false,
  });

  try {
    const result = orderTx();
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Não foi possível registrar o pedido." });
  }
});

/* ------------------------- Criação de venda presencial (painel autenticado) ------------------------- */

router.post("/presencial", requireAuth, requireTenant, (req: Request, res: Response) => {
  const body = req.body ?? {};
  const companyId = (req.user as any).company_id;
  const userId = (req.user as any).id;

  const customerName = asString(body.customer_name);
  const customerPhone = asString(body.customer_phone);
  const street = asString(body.street);
  const neighborhood = asString(body.neighborhood);
  const complement = asString(body.complement);
  const reference = asString(body.reference);
  const notes = asString(body.notes);

  const paymentMethod = normalizePaymentMethod(body.payment_method);
  if (!isPaymentMethod(paymentMethod)) {
    res.status(400).json({ error: "Forma de pagamento inválida." });
    return;
  }
  const deliveryType = normalizeDeliveryType(body.delivery_type, "retirada");

  if (!customerName) {
    res.status(400).json({ error: "Informe o nome do cliente." });
    return;
  }
  if (!customerPhone) {
    res.status(400).json({ error: "Informe o telefone do cliente." });
    return;
  }

  const items = parseItemSpecs(body.items);
  if (items.error) {
    res.status(400).json({ error: items.error });
    return;
  }

  const discount = parseDiscountCents(body.discount_cents);
  if ("error" in discount) {
    res.status(400).json({ error: discount.error });
    return;
  }

  const paidAt = paymentMethod === "fiado" ? null : now();

  const orderTx = persistOrder({
    companyId,
    userId,
    source: "presencial",
    deliveryType,
    paymentMethod,
    discountCents: discount.value,
    paidAt,
    customerName,
    customerPhone,
    street,
    neighborhood,
    complement,
    reference,
    notes,
    specs: items.specs!,
    applyStock: true,
  });

  try {
    const result = orderTx();
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Não foi possível registrar a venda." });
  }
});

/* ------------------------- Listagem (painel) ------------------------- */

router.get("/", requireAuth, requireTenant, (req: Request, res: Response) => {
  const { status, search, source } = req.query;
  const where: string[] = [];
  const params: (string | number)[] = [];

  const companyId = (req.user as any).company_id;
  where.push("o.company_id = ?");
  params.push(companyId);

  if (status && status !== "all" && ORDER_STATUSES.includes(String(status))) {
    where.push("o.status = ?");
    params.push(String(status));
  }
  if (source === "online" || source === "presencial") {
    where.push("o.source = ?");
    params.push(String(source));
  }
  if (search && String(search).trim()) {
    where.push(
      `(o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.notes LIKE ? OR EXISTS (
         SELECT 1 FROM order_items oi
         LEFT JOIN products pp ON pp.id = oi.product_id
         LEFT JOIN combos cc ON cc.id = oi.combo_id
         WHERE oi.order_id = o.id AND (pp.name LIKE ? OR cc.name LIKE ? OR oi.observation LIKE ?)
       ))`
    );
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term, term, term, term);
  }

  const rows = db
    .prepare(
      `SELECT o.*,
              u.name AS user_name,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.company_id = o.company_id) AS item_count
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE ${where.join(" AND ")}
       ORDER BY CASE WHEN o.status IN ('novo','confirmado','em_preparacao','pronto') THEN 0 ELSE 1 END, o.id DESC
       LIMIT 300`
    )
    .all(...params) as any[];

  res.json(rows);
});

/* ------------------------- Detalhe (painel) ------------------------- */

router.get("/:id", requireAuth, requireTenant, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const order = db
    .prepare("SELECT o.*, u.name AS user_name FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ? AND o.company_id = ?")
    .get(Number(req.params.id), companyId) as any;

  if (!order) {
    res.status(404).json({ error: "Pedido não encontrado." });
    return;
  }

  const rows = db
    .prepare(
      `SELECT oi.*,
              p.image_url, p.name AS product_name,
              c.name AS combo_name
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id AND p.company_id = ?
       LEFT JOIN combos c ON c.id = oi.combo_id AND c.company_id = ?
       WHERE oi.order_id = ? AND oi.company_id = ?
       ORDER BY oi.id ASC`
    )
    .all(companyId, companyId, order.id, companyId) as any[];

  const items = rows.map((row) => {
    const addonRows = db
      .prepare(
        `SELECT oia.addon_id, oia.quantity, oia.price_cents, a.name AS name
         FROM order_item_addons oia
         LEFT JOIN addons a ON a.id = oia.addon_id
         WHERE oia.order_item_id = ? AND oia.company_id = ?
         ORDER BY oia.id ASC`
      )
      .all(row.id, companyId) as any[];
    const addons = addonRows.map((a) => ({
      addon_id: a.addon_id,
      name: a.name ?? `Adicional #${a.addon_id}`,
      quantity: a.quantity,
      price_cents: a.price_cents,
      total_cents: a.price_cents * a.quantity,
    }));
    const addonTotal = addons.reduce((sum, a) => sum + a.total_cents, 0);
    const total_cents = row.quantity * row.price_cents + addonTotal * row.quantity;
    return {
      id: row.id,
      order_id: row.order_id,
      product_id: row.product_id,
      combo_id: row.combo_id,
      quantity: row.quantity,
      unit_price_cents: row.price_cents,
      total_cents,
      product_name: row.combo_name ?? row.product_name ?? row.observation ?? "Item",
      image_url: row.image_url,
      observation: row.observation,
      addons,
    };
  });

  res.json({ ...order, items });
});

/* ------------------------- Mudança de status (painel) ------------------------- */

interface OrderStatusResult {
  status: number;
  body: any;
}

function buildOrderResult(orderId: number, companyId: number) {
  return db.prepare("SELECT * FROM orders WHERE id = ? AND company_id = ?").get(orderId, companyId) as any;
}

router.patch("/:id/status", requireAuth, requireTenant, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const userId = (req.user as any).id ?? null;
  const orderId = Number(req.params.id);
  const target = req.body?.status;
  if (!ORDER_STATUSES.includes(target)) {
    res.status(400).json({ error: "Status inválido." });
    return;
  }

  const tx = db.transaction((): OrderStatusResult => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ? AND company_id = ?").get(orderId, companyId) as any;
    if (!order) return { status: 404, body: { error: "Pedido não encontrado." } };

    const curIdx = STATUS_FLOW.indexOf(order.status);
    const tgtIdx = STATUS_FLOW.indexOf(target);

    if (order.status === target) {
      return { status: 200, body: buildOrderResult(order.id, companyId) };
    }

    if (target === "cancelado") {
      // Estorna usando as movimentações originais de venda do pedido (idempotente).
      estornarOrderStock({ companyId, orderId: order.id, userId });
      db.prepare("UPDATE orders SET status = 'cancelado' WHERE id = ? AND company_id = ?").run(order.id, companyId);
      return { status: 200, body: buildOrderResult(order.id, companyId) };
    }

    if (tgtIdx !== curIdx + 1) {
      return { status: 400, body: { error: "Transição de status inválida para este pedido." } };
    }

    if (target === "confirmado") {
      // Baixa de estoque online apenas em novo -> confirmado (idempotente).
      const orderItemLines = db
        .prepare("SELECT product_id, combo_id, quantity FROM order_items WHERE order_id = ? AND company_id = ?")
        .all(order.id, companyId) as { product_id: number | null; combo_id: number | null; quantity: number }[];
      consumeStockForOrder({
        companyId,
        orderId: order.id,
        lines: orderItemLines,
        userId,
        reason: "Confirmação de pedido",
      });
    }

    if (target === "entregue") {
      const ts = now();
      db.prepare(
        `UPDATE orders
            SET status = 'entregue',
                completed_at = COALESCE(completed_at, ?),
                paid_at = CASE WHEN payment_method = 'fiado' THEN paid_at ELSE COALESCE(paid_at, ?) END
          WHERE id = ? AND company_id = ?`
      ).run(ts, ts, order.id, companyId);
    } else {
      db.prepare("UPDATE orders SET status = ? WHERE id = ? AND company_id = ?").run(target, order.id, companyId);
    }
    return { status: 200, body: buildOrderResult(order.id, companyId) };
  });

  try {
    const result = tx();
    res.status(result.status).json(result.body);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Não foi possível atualizar o pedido." });
  }
});

export default router;