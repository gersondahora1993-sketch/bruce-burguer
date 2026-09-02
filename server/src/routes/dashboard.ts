import { Router } from "express";
import { db, todayStart, monthStart } from "../db.js";
import { requireAuth } from "../auth.js";
import type { Request, Response } from "express";

const router = Router();

router.get("/", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const count = (sql: string) => (db.prepare(sql).get(companyId) as any).c;

  const totals = {
    products: count("SELECT COUNT(*) AS c FROM products WHERE company_id = ?"),
    active_products: count("SELECT COUNT(*) AS c FROM products WHERE active = 1 AND company_id = ?"),
  };

  const outOfStock = db
    .prepare(
       `SELECT COUNT(*) AS c FROM products p WHERE p.active = 1 AND p.company_id = ? AND EXISTS (
         SELECT 1 FROM product_variations v WHERE v.product_id = p.id AND v.company_id = p.company_id GROUP BY v.product_id HAVING MAX(v.stock) <= 0
       )`
    )
    .get(companyId) as { c: number };

  const lowStock = db
    .prepare(
       `SELECT COUNT(*) AS c FROM products p WHERE p.active = 1 AND p.company_id = ? AND EXISTS (
         SELECT 1 FROM product_variations v WHERE v.product_id = p.id AND v.company_id = p.company_id AND v.stock > 0 AND v.stock <= v.min_stock
       )`
    )
    .get(companyId) as { c: number };

  const stockAgg = db
    .prepare(
      `SELECT COALESCE(SUM(v.stock), 0) AS pieces,
              COALESCE(SUM(v.stock * p.sale_price_cents), 0) AS value_cents
        FROM product_variations v JOIN products p ON p.id = v.product_id
        WHERE v.company_id = ? AND p.company_id = ?`
    )
    .get(companyId, companyId) as { pieces: number; value_cents: number };

  const salesDay = db
     .prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(total_cents), 0) AS total FROM sales WHERE status = 'ativa' AND created_at >= ? AND company_id = ?`)
    .get(todayStart(), companyId) as { c: number; total: number };

  const salesMonth = db
     .prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(total_cents), 0) AS total FROM sales WHERE status = 'ativa' AND created_at >= ? AND company_id = ?`)
    .get(monthStart(), companyId) as { c: number; total: number };

  const monthItems = db
    .prepare(
       `SELECT COALESCE(SUM(si.quantity), 0) AS c
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id AND p.company_id = s.company_id
        JOIN product_variations v ON v.id = si.variation_id AND v.company_id = s.company_id
        WHERE s.status = 'ativa' AND s.created_at >= ? AND s.company_id = ?`
    )
    .get(monthStart(), companyId) as { c: number };

  const chartSales = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total_cents
       FROM sales
        WHERE status = 'ativa' AND created_at >= datetime('now', '-14 days') AND company_id = ?
       GROUP BY date(created_at)
       ORDER BY date ASC`
    )
    .all(companyId) as any[];

  const topProducts = db
    .prepare(
       `SELECT si.product_name AS name, SUM(si.quantity) AS quantity, SUM(si.total_cents) AS total_cents
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id AND p.company_id = s.company_id
         JOIN product_variations v ON v.id = si.variation_id AND v.company_id = s.company_id
         WHERE s.status = 'ativa' AND s.created_at >= ? AND s.company_id = ?
       GROUP BY si.product_id
       ORDER BY quantity DESC
       LIMIT 5`
    )
    .all(monthStart(), companyId) as any[];

  const stockByCategory = db
    .prepare(
      `SELECT COALESCE(c.name, 'Sem categoria') AS name,
              SUM(v.stock) AS pieces,
              SUM(v.stock * p.sale_price_cents) AS value_cents
       FROM product_variations v
       JOIN products p ON p.id = v.product_id
        LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
        WHERE v.company_id = ? AND p.company_id = ?
        GROUP BY c.name
       ORDER BY pieces DESC`
    )
    .all(companyId, companyId) as any[];

  res.json({
    totals: {
      products: totals.products,
      active_products: totals.active_products,
      out_of_stock_products: outOfStock.c,
      low_stock_products: lowStock.c,
      total_pieces: stockAgg.pieces,
      stock_value_cents: stockAgg.value_cents,
    },
    sales: {
      today: { count: salesDay.c, total_cents: salesDay.total },
      month: { count: salesMonth.c, total_cents: salesMonth.total, items: monthItems.c },
    },
    chart_sales: chartSales,
    top_products: topProducts,
    stock_by_category: stockByCategory,
  });
});

export default router;
