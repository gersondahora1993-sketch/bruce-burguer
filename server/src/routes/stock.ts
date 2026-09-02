import { Router } from "express";
import { db, now } from "../db.js";
import { requireAuth } from "../auth.js";
import type { Request, Response } from "express";

const router = Router();

const VARIATION_SELECT = `
  SELECT v.id, v.product_id, v.color_id, v.size_id, v.stock, v.min_stock, v.barcode,
         p.name AS product_name, p.sku, p.sale_price_cents, p.image_url,
         p.category_id, c.name AS category_name,
         col.name AS color_name, col.hex AS color_hex,
         s.name AS size_name
  FROM product_variations v
  JOIN products p ON p.id = v.product_id
   JOIN colors col ON col.id = v.color_id AND col.company_id = p.company_id
   JOIN sizes s ON s.id = v.size_id AND s.company_id = p.company_id
   LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
`;

function stockStatus(v: { stock: number; min_stock: number }): "out" | "low" | "ok" {
  if (v.stock <= 0) return "out";
  if (v.stock <= v.min_stock) return "low";
  return "ok";
}

router.get("/", requireAuth, (req: Request, res: Response) => {
  const { search, category_id, color_id, size_id, status } = req.query;
  const where: string[] = [];
  const params: (string | number)[] = [];
  const companyId = (req.user as any).company_id;
  where.push("p.company_id = ? AND v.company_id = ?");
  params.push(companyId, companyId);

  if (search && String(search).trim()) {
    where.push("(p.name LIKE ? OR p.sku LIKE ? OR v.barcode LIKE ?)");
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term);
  }
  if (category_id && Number(category_id) > 0) {
    where.push("p.category_id = ?");
    params.push(Number(category_id));
  }
  if (color_id && Number(color_id) > 0) {
    where.push("v.color_id = ?");
    params.push(Number(color_id));
  }
  if (size_id && Number(size_id) > 0) {
    where.push("v.size_id = ?");
    params.push(Number(size_id));
  }

  const rows = db
    .prepare(
      `${VARIATION_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.category_id, p.name, s.sort_order, col.name`
    )
    .all(...params) as any[];

  let result = rows.map((r) => ({
    ...r,
    status: stockStatus(r),
    stock_value_cents: r.stock * r.sale_price_cents,
  }));

  if (status === "out") result = result.filter((r) => r.status === "out");
  if (status === "low") result = result.filter((r) => r.status === "low");
  if (status === "ok") result = result.filter((r) => r.status === "ok");

  res.json(result);
});

router.get("/low", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const rows = db
    .prepare(`${VARIATION_SELECT} WHERE p.company_id = ? AND v.company_id = ? AND v.stock <= v.min_stock ORDER BY v.stock ASC`)
    .all(companyId, companyId) as any[];
  res.json(rows.map((r) => ({ ...r, status: stockStatus(r), stock_value_cents: r.stock * r.sale_price_cents })));
});

router.get("/movements", requireAuth, (req: Request, res: Response) => {
  const { limit, type } = req.query;
  const companyId = (req.user as any).company_id;
  const cap = Math.min(500, Math.max(1, Number(limit) || 200));
  const allowed = ["entrada", "saida", "ajuste", "venda_online"];
  const where = allowed.includes(String(type))
    ? "WHERE m.company_id = ? AND p.company_id = ? AND v.company_id = ? AND m.type = ?"
    : "WHERE m.company_id = ? AND p.company_id = ? AND v.company_id = ?";
  const params: (string | number)[] = [companyId, companyId, companyId];
  if (allowed.includes(String(type))) params.push(String(type));
  const rows = db
    .prepare(
      `SELECT m.id, m.variation_id, m.product_id, m.type, m.quantity, m.stock_before, m.stock_after, m.reason, m.user_id, m.sale_id, m.order_id, m.created_at,
              p.name AS product_name, col.name AS color_name, s.name AS size_name, u.name AS user_name
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       JOIN product_variations v ON v.id = m.variation_id
       JOIN colors col ON col.id = v.color_id
       JOIN sizes s ON s.id = v.size_id
       LEFT JOIN users u ON u.id = m.user_id
       ${where}
       ORDER BY m.id DESC
       LIMIT ?`
    )
    .all(...params, cap);
  res.json(rows);
});

router.post("/movements", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const { variation_id, type, quantity, reason } = req.body ?? {};

  if (!variation_id || !["entrada", "saida", "ajuste"].includes(type)) {
    res.status(400).json({ error: "Dados inválidos para a movimentação." });
    return;
  }

  const variation = db
    .prepare(
      `SELECT v.id, v.product_id, v.stock, v.company_id, p.company_id AS product_company_id
       FROM product_variations v JOIN products p ON p.id = v.product_id
       WHERE v.id = ? AND v.company_id = ? AND p.company_id = ?`
    )
    .get(Number(variation_id), companyId, companyId) as { id: number; product_id: number; stock: number; company_id: number; product_company_id: number } | undefined;

  if (!variation) {
    res.status(404).json({ error: "Variação não encontrada." });
    return;
  }

  const qty = Number(quantity);
  if (!Number.isInteger(qty)) {
    res.status(400).json({ error: "Quantidade inválida." });
    return;
  }

  let movementQty = 0;
  let stockAfter = variation.stock;

  if (type === "entrada") {
    if (qty <= 0) {
      res.status(400).json({ error: "A entrada deve ser maior que zero." });
      return;
    }
    movementQty = qty;
    stockAfter = variation.stock + qty;
  } else if (type === "saida") {
    if (qty <= 0) {
      res.status(400).json({ error: "A saída deve ser maior que zero." });
      return;
    }
    if (qty > variation.stock) {
      res.status(400).json({ error: "Estoque insuficiente para esta saída." });
      return;
    }
    movementQty = qty;
    stockAfter = variation.stock - qty;
  } else {
    if (qty < 0) {
      res.status(400).json({ error: "O estoque ajustado não pode ser negativo." });
      return;
    }
    movementQty = qty - variation.stock;
    stockAfter = qty;
  }

  const tx = db.transaction(() => {
    db.prepare("UPDATE product_variations SET stock = ? WHERE id = ? AND company_id = ?").run(stockAfter, variation.id, companyId);
    db.prepare(
      `INSERT INTO stock_movements (variation_id, product_id, type, quantity, stock_before, stock_after, reason, user_id, company_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      variation.id,
      variation.product_id,
      type,
      movementQty,
      variation.stock,
      stockAfter,
      typeof reason === "string" ? reason.trim() : "",
      req.user?.id ?? null,
      companyId,
      now()
    );
  });

  tx();
  res.status(201).json({ ok: true });
});

export default router;
