import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import {
  adjustStock,
  MANUAL_MOVEMENT_TYPES,
  STOCK_MOVEMENT_TYPES,
  type StockMovementType,
} from "../lib/stock.js";
import type { Request, Response } from "express";

// FASE 4B — API de estoque por produto (sem variações de produto).

const router = Router();

function stockStatus(stock: number, min_stock: number): "out" | "low" | "ok" {
  if (stock <= 0) return "out";
  if (stock <= min_stock) return "low";
  return "ok";
}

// GET /api/stock — resumo de estoque dos produtos da empresa
router.get("/", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const { search, category_id, status } = req.query;
  const where: string[] = ["p.company_id = ?"];
  const params: (string | number)[] = [companyId];

  if (search && String(search).trim()) {
    where.push("(p.name LIKE ? OR p.description LIKE ?)");
    const term = `%${String(search).trim()}%`;
    params.push(term, term);
  }
  if (category_id && Number(category_id) > 0) {
    where.push("p.category_id = ?");
    params.push(Number(category_id));
  }

  const rows = db
    .prepare(
      `SELECT p.id AS product_id, p.name AS product_name, p.description,
              p.category_id, c.name AS category_name, p.sale_price_cents, p.image_url,
              p.active, p.stock, p.min_stock
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
       WHERE ${where.join(" AND ")}
       ORDER BY c.name, p.name COLLATE NOCASE`
    )
    .all(...params) as any[];

  let result = rows.map((r) => ({
    product_id: r.product_id,
    product_name: r.product_name,
    description: r.description,
    category_id: r.category_id,
    category_name: r.category_name,
    sale_price_cents: r.sale_price_cents,
    image_url: r.image_url,
    active: r.active,
    stock: r.stock,
    min_stock: r.min_stock,
    status: stockStatus(r.stock, r.min_stock),
    stock_value_cents: r.stock * r.sale_price_cents,
  }));

  if (status === "out") result = result.filter((r) => r.status === "out");
  if (status === "low") result = result.filter((r) => r.status === "low");
  if (status === "ok") result = result.filter((r) => r.status === "ok");

  res.json(result);
});

// GET /api/stock/low — produtos em estoque baixo ou zerado (ativo apenas)
router.get("/low", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const rows = db
    .prepare(
      `SELECT p.id AS product_id, p.name AS product_name, p.sale_price_cents, p.image_url,
              p.active, p.stock, p.min_stock
       FROM products p
       WHERE p.company_id = ? AND p.active = 1 AND p.stock <= p.min_stock
       ORDER BY p.stock ASC`
    )
    .all(companyId) as any[];
  res.json(
    rows.map((r) => ({
      ...r,
      status: stockStatus(r.stock, r.min_stock),
      stock_value_cents: r.stock * r.sale_price_cents,
    }))
  );
});

// GET /api/stock/movements — histórico de movimentações (separado por tenant)
router.get("/movements", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const { limit, type, product_id } = req.query;
  const cap = Math.min(500, Math.max(1, Number(limit) || 200));

  const where: string[] = ["m.company_id = ?"];
  const params: (string | number)[] = [companyId];
  if (type && STOCK_MOVEMENT_TYPES.includes(String(type) as StockMovementType)) {
    where.push("m.type = ?");
    params.push(String(type));
  }
  if (product_id && Number(product_id) > 0) {
    where.push("m.product_id = ?");
    params.push(Number(product_id));
  }

  const rows = db
    .prepare(
      `SELECT m.id, m.product_id, m.type, m.quantity, m.stock_before, m.stock_after,
              m.reason, m.reference_type, m.reference_id, m.user_id, m.created_at,
              p.name AS product_name, u.name AS user_name
       FROM stock_movements m
       LEFT JOIN products p ON p.id = m.product_id AND p.company_id = m.company_id
       LEFT JOIN users u ON u.id = m.user_id
       WHERE ${where.join(" AND ")}
       ORDER BY m.id DESC
       LIMIT ?`
    )
    .all(...params, cap);

  res.json(rows);
});

// POST /api/stock/movements — movimentação manual (somente admin; entrada/saida/ajuste)
router.post("/movements", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const userId = (req.user as any).id ?? null;
  const body = req.body ?? {};
  const { product_id, type } = body;

  const pid = Number(product_id);
  if (!Number.isInteger(pid) || pid <= 0) {
    res.status(400).json({ error: "Produto inválido para a movimentação." });
    return;
  }
  if (!MANUAL_MOVEMENT_TYPES.includes(type)) {
    res.status(400).json({ error: "Tipo de movimentação inválido para uso manual (use entrada, saida ou ajuste)." });
    return;
  }

  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 255) : "";

  let targetStock: number | undefined;
  let quantity = 0;
  if (type === "ajuste") {
    const t = Number(body.target_stock);
    if (!Number.isInteger(t) || t < 0) {
      res.status(400).json({ error: "Para o ajuste informe o estoque-alvo (target_stock) não negativo." });
      return;
    }
    targetStock = t;
  } else {
    const q = Number(body.quantity);
    if (!Number.isInteger(q) || q <= 0) {
      res.status(400).json({ error: "A quantidade da movimentação deve ser um inteiro positivo." });
      return;
    }
    quantity = q;
  }

  try {
    db.transaction(() => {
      adjustStock({
        companyId,
        productId: pid,
        type,
        quantity,
        targetStock,
        reason,
        userId,
      });
    })();
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Não foi possível registrar a movimentação." });
  }
});

export default router;