import { Router } from "express";
import { db, now } from "../db.js";
import { requireAuth, requireTenant } from "../auth.js";
import { env } from "../config.js";
import type { Request, Response } from "express";

const router = Router();

export const ORDER_STATUSES = ["novo", "confirmado", "em_preparacao", "pronto", "entregue", "cancelado"];

const STATUS_FLOW = ["novo", "confirmado", "em_preparacao", "pronto", "entregue", "cancelado"];

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

/* ------------------------- Criação de pedido (loja pública) ------------------------- */

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
  const paymentMethod = asString(body.payment_method) || "pix";

  if (!customerName) {
    res.status(400).json({ error: "Informe o seu nome." });
    return;
  }
  if (!customerPhone) {
    res.status(400).json({ error: "Informe o seu telefone." });
    return;
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    res.status(400).json({ error: "O carrinho está vazio." });
    return;
  }

  const specs: ItemSpec[] = [];
  for (const raw of body.items) {
    const it = raw ?? {};
    const quantity = Number(it.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      res.status(400).json({ error: "Item do pedido inválido." });
      return;
    }
    const hasProduct = it.product_id !== undefined && it.product_id !== null && it.product_id !== "";
    const hasCombo = it.combo_id !== undefined && it.combo_id !== null && it.combo_id !== "";
    if (hasProduct === hasCombo) {
      res.status(400).json({ error: "Cada item do pedido deve conter product_id ou combo_id." });
      return;
    }
    if (hasProduct) {
      const productId = Number(it.product_id);
      if (!Number.isInteger(productId) || productId <= 0) {
        res.status(400).json({ error: "Produto inválido." });
        return;
      }
      const addons: AddonSpec[] = [];
      const rawAddons = Array.isArray(it.addons) ? it.addons : [];
      for (const a of rawAddons) {
        const addonId = Number(a?.addon_id);
        const addonQty = Number(a?.quantity);
        if (!Number.isInteger(addonId) || addonId <= 0 || !Number.isInteger(addonQty) || addonQty <= 0) {
          res.status(400).json({ error: "Adicional do item inválido." });
          return;
        }
        addons.push({ addon_id: addonId, quantity: addonQty });
      }
      specs.push({ kind: "product", id: productId, quantity, addons });
    } else {
      const comboId = Number(it.combo_id);
      if (!Number.isInteger(comboId) || comboId <= 0) {
        res.status(400).json({ error: "Combo inválido." });
        return;
      }
      if (Array.isArray(it.addons) && it.addons.length > 0) {
        res.status(400).json({ error: "Combos não aceitam adicionais individuais." });
        return;
      }
      specs.push({ kind: "combo", id: comboId, quantity, addons: [] });
    }
  }

  const tx = db.transaction(() => {
    const lines = specs.map((spec) => {
      if (spec.kind === "product") {
        const row = db
          .prepare(
            `SELECT p.id, p.name, p.sale_price_cents, p.active, p.image_url
             FROM products p
             WHERE p.id = ? AND p.company_id = ?`
          )
          .get(spec.id, companyId) as {
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
            .get(a.addon_id, companyId) as {
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
            .get(spec.id, a.addon_id, companyId);
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
        .get(spec.id, companyId) as { id: number; name: string; sale_price_cents: number; active: number } | undefined;
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
    const deliveryFeeCents = 0;
    const total = subtotal;

    const ts = now();
    const info = db
      .prepare(
        `INSERT INTO orders (
           customer_name, customer_phone, street, neighborhood, complement, reference, notes,
           subtotal_cents, delivery_fee_cents, total_cents, payment_method, status, company_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'novo', ?, ?)`
      )
      .run(
        customerName,
        customerPhone,
        street,
        neighborhood,
        complement,
        reference,
        notes,
        subtotal,
        deliveryFeeCents,
        total,
        paymentMethod,
        companyId,
        ts
      );
    const orderId = Number(info.lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, quantity, price_cents, observation, company_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insertAddon = db.prepare(
      `INSERT INTO order_item_addons (order_item_id, addon_id, quantity, price_cents, company_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const persisted = [];
    for (const l of lines) {
      const observation = l.kind === "combo" ? l.product_name : "";
      const itemInfo = insertItem.run(orderId, l.product_id, l.quantity, l.unit_cents, observation, companyId, ts);
      const orderItemId = Number(itemInfo.lastInsertRowid);
      for (const a of l.addons) {
        insertAddon.run(orderItemId, a.addon_id, a.quantity, a.price_cents, companyId, ts);
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

    return {
      order_id: orderId,
      total_cents: total,
      status: "novo",
      created_at: ts,
      item_count: persisted.length,
      items: persisted,
    };
  });

  try {
    const result = tx();
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Não foi possível registrar o pedido." });
  }
});

/* ------------------------- Listagem (painel) ------------------------- */

router.get("/", requireAuth, requireTenant, (req: Request, res: Response) => {
  const { status, search } = req.query;
  const where: string[] = [];
  const params: (string | number)[] = [];

  const companyId = (req.user as any).company_id;
  where.push("o.company_id = ?");
  params.push(companyId);

  if (status && status !== "all" && ORDER_STATUSES.includes(String(status))) {
    where.push("o.status = ?");
    params.push(String(status));
  }
  if (search && String(search).trim()) {
    where.push(
      `(o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.notes LIKE ? OR EXISTS (
         SELECT 1 FROM order_items oi
         LEFT JOIN products pp ON pp.id = oi.product_id
         WHERE oi.order_id = o.id AND (pp.name LIKE ? OR oi.observation LIKE ?)
       ))`
    );
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term, term, term);
  }

  const rows = db
    .prepare(
      `SELECT o.*,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.company_id = o.company_id) AS item_count
       FROM orders o
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
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND company_id = ?").get(Number(req.params.id), companyId) as any;

  if (!order) {
    res.status(404).json({ error: "Pedido não encontrado." });
    return;
  }

  const rows = db
    .prepare(
      `SELECT oi.*, p.image_url, p.name AS product_name
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id AND p.company_id = ?
       WHERE oi.order_id = ? AND oi.company_id = ?
       ORDER BY oi.id ASC`
    )
    .all(companyId, order.id, companyId) as any[];

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
      quantity: row.quantity,
      unit_price_cents: row.price_cents,
      total_cents,
      product_name: row.product_name ?? row.observation ?? "Item",
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
      db.prepare("UPDATE orders SET status = 'cancelado' WHERE id = ? AND company_id = ?").run(order.id, companyId);
      return { status: 200, body: buildOrderResult(order.id, companyId) };
    }

    if (tgtIdx !== curIdx + 1) {
      return { status: 400, body: { error: "Transição de status inválida para este pedido." } };
    }

    db.prepare("UPDATE orders SET status = ? WHERE id = ? AND company_id = ?").run(target, order.id, companyId);
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