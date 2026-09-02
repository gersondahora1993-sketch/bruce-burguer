import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import type { Request, Response } from "express";
import { PAYMENT_METHODS } from "./sales.js";

const router = Router();

router.use(requireRole("admin"));

function buildFilters(query: any, companyId: number) {
  const where: string[] = ["s.status = 'ativa'", "s.company_id = ?"];
  const params: (string | number)[] = [companyId];

  if (query.from && String(query.from)) {
    where.push("s.created_at >= ?");
    params.push(`${String(query.from)} 00:00:00`);
  }
  if (query.to && String(query.to)) {
    where.push("s.created_at <= ?");
    params.push(`${String(query.to)} 23:59:59`);
  }
  if (query.payment_method && query.payment_method !== "all" && PAYMENT_METHODS.includes(String(query.payment_method))) {
    where.push("s.payment_method = ?");
    params.push(String(query.payment_method));
  }
  if (query.category_id && Number(query.category_id) > 0) {
    where.push("EXISTS (SELECT 1 FROM sale_items si JOIN products p2 ON p2.id = si.product_id AND p2.company_id = s.company_id WHERE si.sale_id = s.id AND p2.category_id = ?)");
    params.push(Number(query.category_id));
  }
  if (query.product_id && Number(query.product_id) > 0) {
    where.push("EXISTS (SELECT 1 FROM sale_items si2 JOIN products p2 ON p2.id = si2.product_id AND p2.company_id = s.company_id WHERE si2.sale_id = s.id AND si2.product_id = ?)");
    params.push(Number(query.product_id));
  }

  return { where, params };
}

router.get("/", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const { where, params } = buildFilters(req.query, companyId);
  const clause = where.length ? "WHERE " + where.join(" AND ") : "";
  const categoryActive = Number(req.query.category_id) > 0;
  const itemClause = categoryActive ? " AND p.category_id = ?" : "";
  const itemParams = categoryActive ? [...params, Number(req.query.category_id)] : params;
  const topParams = categoryActive ? [...params, companyId, Number(req.query.category_id)] : [...params, companyId];

  const summary = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total_cents,
              COALESCE(SUM(total_cents) * 1.0 / NULLIF(COUNT(*), 0), 0) AS avg_ticket_cents
       FROM sales s ${clause}`
    )
    .get(...params) as any;

  const items = db
    .prepare(
      `SELECT si.product_name, si.color_name, si.size_name, si.quantity, si.unit_price_cents, si.total_cents,
              p.category_id, c.name AS category_name, s.created_at
        FROM sale_items si
        JOIN (SELECT id, created_at, company_id FROM sales s ${clause}) s ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id AND p.company_id = s.company_id
        JOIN product_variations v ON v.id = si.variation_id AND v.company_id = s.company_id
         LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = s.company_id
       WHERE 1=1 ${itemClause}
       ORDER BY si.id DESC`
    )
    .all(...itemParams) as any[];

  const daily = db
    .prepare(
      `SELECT substr(s.created_at, 1, 10) AS date, COUNT(*) AS count, COALESCE(SUM(s.total_cents), 0) AS total_cents
       FROM sales s ${clause}
       GROUP BY date(s.created_at)
       ORDER BY date ASC`
    )
    .all(...params) as any[];

  const byPayment = db
    .prepare(
      `SELECT s.payment_method, COUNT(*) AS count, COALESCE(SUM(s.total_cents), 0) AS total_cents
       FROM sales s ${clause}
       GROUP BY s.payment_method
       ORDER BY total_cents DESC`
    )
    .all(...params) as any[];

  const top = db
    .prepare(
      `SELECT si.product_name AS name, SUM(si.quantity) AS quantity, SUM(si.total_cents) AS total_cents
        FROM sale_items si
        JOIN (SELECT id, company_id FROM sales s ${clause}) s ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id AND p.company_id = ?
        JOIN product_variations v ON v.id = si.variation_id AND v.company_id = s.company_id
       WHERE 1=1 ${itemClause}
       GROUP BY si.product_id
       ORDER BY quantity DESC
       LIMIT 10`
    )
    .all(...topParams) as any[];

  const categoryFilter = Number(req.query.category_id) > 0 ? "AND p.category_id = ?" : "";
  const categoryParams = Number(req.query.category_id) > 0 ? [companyId, companyId, Number(req.query.category_id)] : [companyId, companyId];

  const stock = db
    .prepare(
      `SELECT v.id, v.product_id, p.name AS product_name, p.sku, col.name AS color_name, s.name AS size_name,
              v.stock, v.min_stock, p.sale_price_cents, p.sale_price_cents * v.stock AS stock_value_cents
       FROM product_variations v
       JOIN products p ON p.id = v.product_id
       JOIN colors col ON col.id = v.color_id
       JOIN sizes s ON s.id = v.size_id
        WHERE p.company_id = ? AND v.company_id = ? ${categoryFilter}
       ORDER BY p.name, s.sort_order, col.name`
    )
    .all(...categoryParams) as any[];

  const stockByCategory = db
    .prepare(
      `SELECT COALESCE(c.name, 'Sem categoria') AS name,
              SUM(v.stock) AS pieces,
              COALESCE(SUM(v.stock * p.sale_price_cents), 0) AS value_cents
       FROM product_variations v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.company_id = ? AND v.company_id = ? ${categoryFilter}
       GROUP BY c.name
       ORDER BY pieces DESC`
    )
    .all(...categoryParams) as any[];

  res.json({
    summary: {
      count: summary.count,
      total_cents: summary.total_cents,
      avg_ticket_cents: Math.round(Number(summary.avg_ticket_cents)),
    },
    daily,
    items,
    by_payment: byPayment,
    top,
    stock: {
      rows: stock,
      by_category: stockByCategory,
      total_value_cents: stock.reduce((a, r) => a + r.stock_value_cents, 0),
      total_pieces: stock.reduce((a, r) => a + r.stock, 0),
      out_of_stock: stock.filter((r) => r.stock <= 0),
      low_stock: stock.filter((r) => r.stock > 0 && r.stock <= r.min_stock),
    },
  });
});

export default router;
