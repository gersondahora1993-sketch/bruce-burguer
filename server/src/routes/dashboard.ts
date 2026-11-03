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
      `SELECT COUNT(*) AS c FROM products WHERE active = 1 AND company_id = ? AND stock <= 0`
    )
    .get(companyId) as { c: number };

  const lowStock = db
    .prepare(
      `SELECT COUNT(*) AS c FROM products WHERE active = 1 AND company_id = ? AND stock > 0 AND stock <= min_stock`
    )
    .get(companyId) as { c: number };

  const stockAgg = db
    .prepare(
      `SELECT COALESCE(SUM(stock), 0) AS pieces,
              COALESCE(SUM(stock * sale_price_cents), 0) AS value_cents
         FROM products
        WHERE company_id = ?`
    )
    .get(companyId) as { pieces: number; value_cents: number };

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
         WHERE s.status = 'ativa' AND s.created_at >= ? AND s.company_id = ?
       GROUP BY si.product_id
       ORDER BY quantity DESC
       LIMIT 5`
    )
    .all(monthStart(), companyId) as any[];

  const stockByCategory = db
    .prepare(
      `SELECT COALESCE(c.name, 'Sem categoria') AS name,
              SUM(p.stock) AS pieces,
              SUM(p.stock * p.sale_price_cents) AS value_cents
        FROM products p
         LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
         WHERE p.company_id = ?
         GROUP BY c.name
       ORDER BY pieces DESC`
    )
    .all(companyId) as any[];

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
