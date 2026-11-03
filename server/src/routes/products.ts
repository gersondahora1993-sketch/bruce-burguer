import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { adjustStock } from "../lib/stock.js";
import type { Request, Response } from "express";

const router = Router();

function companyNameExists(companyId: number, name: string, excludeId: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM products WHERE company_id = ? AND name = ? COLLATE NOCASE AND id != ?")
    .get(companyId, name, excludeId);
}

function validateAddonIds(companyId: number, addonIds: unknown): { valid: number[]; error?: string } {
  if (!addonIds) return { valid: [] };
  if (!Array.isArray(addonIds)) return { valid: [], error: "addon_ids deve ser um array." };
  const ids = [...new Set(addonIds.map(Number).filter((n) => n > 0))];
  if (ids.length === 0) return { valid: [] };
  const ph = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT id, active FROM addons WHERE company_id = ? AND id IN (${ph})`)
    .all(companyId, ...ids) as { id: number; active: number }[];
  const found = new Map(rows.map((r) => [r.id, r.active === 1]));
  for (const id of ids) {
    if (!found.has(id)) return { valid: [], error: `Adicional ID ${id} não encontrado nesta empresa.` };
    if (!found.get(id)) return { valid: [], error: `Adicional ID ${id} está inativo.` };
  }
  return { valid: ids };
}

// GET - Listar produtos com filtros e addons
router.get("/", requireAuth, (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const { category_id, active, search, limit, offset } = req.query;

    let sql = `
      SELECT p.id, p.name, p.description, p.category_id, p.sale_price_cents,
             p.image_url, p.active, p.stock, p.min_stock, p.created_at,
             c.name as category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
      WHERE p.company_id = ?
    `;
    const params: (string | number)[] = [companyId];

    if (category_id && Number(category_id) > 0) {
      sql += " AND p.category_id = ?";
      params.push(Number(category_id));
    }
    if (active !== undefined && active !== "") {
      sql += " AND p.active = ?";
      params.push(Number(active));
    }
    if (search && String(search).trim()) {
      sql += " AND (p.name LIKE ? OR p.description LIKE ?)";
      const term = `%${String(search).trim()}%`;
      params.push(term, term);
    }

    sql += " ORDER BY c.name, p.name COLLATE NOCASE";

    if (limit && Number(limit) > 0) {
      sql += " LIMIT ?";
      params.push(Number(limit));
      if (offset && Number(offset) > 0) {
        sql += " OFFSET ?";
        params.push(Number(offset));
      }
    }

    const rows = db.prepare(sql).all(...params) as any[];
    if (rows.length === 0) { res.json([]); return; }

    const productIds = rows.map((r: any) => r.id);
    const ph = productIds.map(() => "?").join(",");
    const addonRows = db
      .prepare(
        `SELECT pa.product_id, a.id, a.name, a.price_cents, a.active
         FROM product_addons pa
         JOIN addons a ON a.id = pa.addon_id AND a.company_id = pa.company_id
         WHERE pa.company_id = ? AND pa.product_id IN (${ph})
         ORDER BY a.name COLLATE NOCASE`
      )
      .all(companyId, ...productIds) as { product_id: number; id: number; name: string; price_cents: number; active: number }[];

    const addonsMap = new Map<number, { id: number; name: string; price_cents: number; active: number }[]>();
    for (const ar of addonRows) {
      if (!addonsMap.has(ar.product_id)) addonsMap.set(ar.product_id, []);
      addonsMap.get(ar.product_id)!.push({ id: ar.id, name: ar.name, price_cents: ar.price_cents, active: ar.active });
    }

    res.json(rows.map((r: any) => ({ ...r, addons: addonsMap.get(r.id) ?? [] })));
  } catch (err: any) {
    console.error("[products] GET error:", err);
    res.status(500).json({ error: "Erro ao buscar produtos." });
  }
});

// GET - Obter produto por ID com addons
router.get("/:id", requireAuth, (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const id = Number(req.params.id);

    const row = db
      .prepare(
        `SELECT p.id, p.name, p.description, p.category_id, p.sale_price_cents,
                p.image_url, p.active, p.stock, p.min_stock, p.created_at,
                c.name as category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
         WHERE p.id = ? AND p.company_id = ?`
      )
      .get(id, companyId);

    if (!row) { res.status(404).json({ error: "Produto não encontrado." }); return; }

    const addons = db
      .prepare(
        `SELECT a.id, a.name, a.price_cents, a.active
         FROM addons a
         JOIN product_addons pa ON pa.addon_id = a.id AND pa.company_id = a.company_id
         WHERE pa.product_id = ? AND pa.company_id = ?`
      )
      .all(id, companyId);

    res.json({ ...row, addons });
  } catch (err: any) {
    console.error("[products] GET/:id error:", err);
    res.status(500).json({ error: "Erro ao buscar produto." });
  }
});

function parseNonNegativeInt(raw: unknown): { value: number } | { error: string } {
  if (raw === undefined || raw === null || raw === "") return { value: 0 };
  const text = String(raw);
  if (!/^\d+$/.test(text)) return { error: "Valor numérico inválido." };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0) return { error: "Valor numérico inválido." };
  return { value };
}

// POST - Criar produto
router.post("/", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const { name, description, category_id, sale_price_cents, image_url, active, addon_ids } = req.body ?? {};

    if (!name || !name.trim()) { res.status(400).json({ error: "Nome do produto é obrigatório." }); return; }
    if (!category_id || Number(category_id) <= 0) { res.status(400).json({ error: "Categoria é obrigatória." }); return; }
    if (!sale_price_cents || Number(sale_price_cents) <= 0) { res.status(400).json({ error: "Preço é obrigatório e deve ser maior que zero." }); return; }

    const initialStock = parseNonNegativeInt((req.body ?? {}).stock);
    if ("error" in initialStock) { res.status(400).json({ error: `Estoque inicial inválido: ${initialStock.error}` }); return; }
    const minStock = parseNonNegativeInt((req.body ?? {}).min_stock);
    if ("error" in minStock) { res.status(400).json({ error: `Estoque mínimo inválido: ${minStock.error}` }); return; }

    if (!db.prepare("SELECT 1 FROM categories WHERE id = ? AND company_id = ?").get(Number(category_id), companyId)) {
      res.status(400).json({ error: "Categoria não encontrada." }); return;
    }
    if (companyNameExists(companyId, name.trim(), 0)) {
      res.status(400).json({ error: "Já existe um produto com este nome nesta empresa." }); return;
    }

    const addonResult = validateAddonIds(companyId, addon_ids);
    if (addonResult.error) { res.status(400).json({ error: addonResult.error }); return; }

    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");

    const productId = db.transaction(() => {
      const info = db.prepare(
        `INSERT INTO products (name, description, category_id, sale_price_cents, image_url, active, stock, min_stock, company_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).run(
        name.trim(), String(description || "").trim(), Number(category_id), Number(sale_price_cents),
        String(image_url || "").trim(), active === 0 ? 0 : 1, minStock.value, companyId, ts
      );
      const pid = Number(info.lastInsertRowid);
      if (addonResult.valid.length > 0) {
        const stmt = db.prepare("INSERT INTO product_addons (product_id, addon_id, company_id, created_at) VALUES (?, ?, ?, ?)");
        for (const aid of addonResult.valid) stmt.run(pid, aid, companyId, ts);
      }
      // Estoque inicial SEMPRE com histórico: registra uma movimentação de entrada.
      if (initialStock.value > 0) {
        adjustStock({
          companyId,
          productId: pid,
          type: "entrada",
          quantity: initialStock.value,
          reason: "Estoque inicial",
          userId: (req.user as any)?.id ?? null,
        });
      }
      return pid;
    })();

    res.json({ id: productId, message: "Produto criado com sucesso." });
  } catch (err: any) {
    console.error("[products] POST error:", err);
    res.status(500).json({ error: "Erro ao criar produto." });
  }
});

// PUT - Atualizar produto
router.put("/:id", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const id = Number(req.params.id);
    const body = req.body ?? {};
    const { name, description, category_id, sale_price_cents, image_url, active, addon_ids } = body;

    if ("stock" in body) {
      res.status(400).json({ error: "Alteração de estoque deve ser feita pela API de movimentações de estoque (POST /api/stock/movements)." });
      return;
    }

    const minStock = parseNonNegativeInt(body.min_stock);
    if ("error" in minStock) { res.status(400).json({ error: `Estoque mínimo inválido: ${minStock.error}` }); return; }

    if (!db.prepare("SELECT 1 FROM products WHERE id = ? AND company_id = ?").get(id, companyId)) {
      res.status(404).json({ error: "Produto não encontrado." }); return;
    }
    if (!name || !name.trim()) { res.status(400).json({ error: "Nome do produto é obrigatório." }); return; }
    if (!category_id || Number(category_id) <= 0) { res.status(400).json({ error: "Categoria é obrigatória." }); return; }
    if (!sale_price_cents || Number(sale_price_cents) <= 0) { res.status(400).json({ error: "Preço é obrigatório e deve ser maior que zero." }); return; }

    if (!db.prepare("SELECT 1 FROM categories WHERE id = ? AND company_id = ?").get(Number(category_id), companyId)) {
      res.status(400).json({ error: "Categoria não encontrada." }); return;
    }
    if (companyNameExists(companyId, name.trim(), id)) {
      res.status(400).json({ error: "Já existe um produto com este nome nesta empresa." }); return;
    }

    const addonResult = validateAddonIds(companyId, addon_ids);
    if (addonResult.error) { res.status(400).json({ error: addonResult.error }); return; }

    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");

    db.transaction(() => {
      db.prepare(
        `UPDATE products SET name = ?, description = ?, category_id = ?, sale_price_cents = ?, image_url = ?, active = ?
         WHERE id = ? AND company_id = ?`
      ).run(
        name.trim(), String(description || "").trim(), Number(category_id), Number(sale_price_cents),
        String(image_url || "").trim(), active === 0 ? 0 : 1, id, companyId
      );
      if (body.min_stock !== undefined && body.min_stock !== null && body.min_stock !== "") {
        db.prepare("UPDATE products SET min_stock = ? WHERE id = ? AND company_id = ?").run(minStock.value, id, companyId);
      }
      if (addon_ids && Array.isArray(addon_ids)) {
        db.prepare("DELETE FROM product_addons WHERE product_id = ? AND company_id = ?").run(id, companyId);
        if (addonResult.valid.length > 0) {
          const stmt = db.prepare("INSERT INTO product_addons (product_id, addon_id, company_id, created_at) VALUES (?, ?, ?, ?)");
          for (const aid of addonResult.valid) stmt.run(id, aid, companyId, ts);
        }
      }
    })();

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[products] PUT error:", err);
    res.status(500).json({ error: "Erro ao atualizar produto." });
  }
});

// DELETE - Desativar/Remover produto
router.delete("/:id", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const id = Number(req.params.id);

    if (!db.prepare("SELECT 1 FROM products WHERE id = ? AND company_id = ?").get(id, companyId)) {
      res.status(404).json({ error: "Produto não encontrado." }); return;
    }

    const comboCount = db.prepare("SELECT COUNT(*) as c FROM combo_items WHERE product_id = ? AND company_id = ?").get(id, companyId) as { c: number };
    if (comboCount.c > 0) {
      db.prepare("UPDATE products SET active = 0 WHERE id = ? AND company_id = ?").run(id, companyId);
      res.json({ ok: true, message: "Produto desativado (faz parte de combos)." });
      return;
    }

    const orderCount = db.prepare("SELECT COUNT(*) as c FROM order_items WHERE product_id = ? AND company_id = ?").get(id, companyId) as { c: number };
    if (orderCount.c > 0) {
      db.prepare("UPDATE products SET active = 0 WHERE id = ? AND company_id = ?").run(id, companyId);
      res.json({ ok: true, message: "Produto desativado (possui histórico de pedidos)." });
      return;
    }

    const movementCount = db.prepare("SELECT COUNT(*) as c FROM stock_movements WHERE product_id = ? AND company_id = ?").get(id, companyId) as { c: number };
    if (movementCount.c > 0) {
      db.prepare("UPDATE products SET active = 0 WHERE id = ? AND company_id = ?").run(id, companyId);
      res.json({ ok: true, message: "Produto desativado (possui histórico de estoque)." });
      return;
    }

    db.prepare("DELETE FROM product_addons WHERE product_id = ? AND company_id = ?").run(id, companyId);
    db.prepare("DELETE FROM products WHERE id = ? AND company_id = ?").run(id, companyId);
    res.json({ ok: true, message: "Produto removido." });
  } catch (err: any) {
    console.error("[products] DELETE error:", err);
    res.status(500).json({ error: "Erro ao remover produto." });
  }
});

export default router;
