import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import type { Request, Response } from "express";

const router = Router();

const COMBO_ITEMS_SELECT = `
  SELECT ci.combo_id, ci.product_id, ci.quantity,
         p.name as product_name, p.sale_price_cents as product_price_cents,
         p.category_id, cat.name as category_name
  FROM combo_items ci
  JOIN products p ON p.id = ci.product_id AND p.company_id = ci.company_id
  LEFT JOIN categories cat ON cat.id = p.category_id AND cat.company_id = p.company_id
  WHERE ci.company_id = ?
`;

function validateComboItems(companyId: number, items: unknown): string | null {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return "Combo deve ter pelo menos um item.";
  }
  for (const item of items) {
    if (!item || !item.product_id || Number(item.product_id) <= 0) {
      return "Cada item deve ter um product_id válido.";
    }
    if (!item.quantity || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
      return "Quantidade deve ser um inteiro maior que zero.";
    }
    const prod = db.prepare("SELECT active FROM products WHERE id = ? AND company_id = ?").get(Number(item.product_id), companyId) as { active: number } | undefined;
    if (!prod) {
      return `Produto ID ${item.product_id} não encontrado nesta empresa.`;
    }
    if (prod.active !== 1) {
      return `Produto ID ${item.product_id} está inativo e não pode entrar num combo.`;
    }
  }
  return null;
}

// GET - Listar combos com itens
router.get("/", requireAuth, (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const { active } = req.query;

    let sql = `
      SELECT c.id, c.name, c.description, c.sale_price_cents, c.active, c.created_at
      FROM combos c
      WHERE c.company_id = ?
    `;
    const params: (string | number)[] = [companyId];

    if (active !== undefined && active !== "") {
      sql += " AND c.active = ?";
      params.push(Number(active));
    }

    sql += " ORDER BY c.name COLLATE NOCASE";

    const rows = db.prepare(sql).all(...params) as any[];
    if (rows.length === 0) { res.json([]); return; }

    const comboIds = rows.map((r: any) => r.id);
    const ph = comboIds.map(() => "?").join(",");
    const itemRows = db
      .prepare(`${COMBO_ITEMS_SELECT} AND ci.combo_id IN (${ph})`)
      .all(companyId, ...comboIds) as any[];

    const itemsMap = new Map<number, any[]>();
    for (const ir of itemRows) {
      if (!itemsMap.has(ir.combo_id)) itemsMap.set(ir.combo_id, []);
      itemsMap.get(ir.combo_id)!.push({
        product_id: ir.product_id,
        product_name: ir.product_name,
        quantity: ir.quantity,
        product_price_cents: ir.product_price_cents,
      });
    }

    res.json(rows.map((r: any) => ({ ...r, items: itemsMap.get(r.id) ?? [] })));
  } catch (err: any) {
    console.error("[combos] GET error:", err);
    res.status(500).json({ error: "Erro ao buscar combos." });
  }
});

// GET - Obter combo por ID com itens
router.get("/:id", requireAuth, (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const id = Number(req.params.id);

    const combo = db
      .prepare(
        `SELECT c.id, c.name, c.description, c.sale_price_cents, c.active, c.created_at
         FROM combos c
         WHERE c.id = ? AND c.company_id = ?`
      )
      .get(id, companyId);

    if (!combo) { res.status(404).json({ error: "Combo não encontrado." }); return; }

    const items = db
      .prepare(`${COMBO_ITEMS_SELECT} AND ci.combo_id = ?`)
      .all(companyId, id);

    res.json({ ...combo, items });
  } catch (err: any) {
    console.error("[combos] GET/:id error:", err);
    res.status(500).json({ error: "Erro ao buscar combo." });
  }
});

// POST - Criar combo
router.post("/", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const { name, description, sale_price_cents, items } = req.body ?? {};

    if (!name || !name.trim()) { res.status(400).json({ error: "Nome do combo é obrigatório." }); return; }
    if (!sale_price_cents || Number(sale_price_cents) <= 0) { res.status(400).json({ error: "Preço é obrigatório e deve ser maior que zero." }); return; }

    const itemError = validateComboItems(companyId, items);
    if (itemError) { res.status(400).json({ error: itemError }); return; }

    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");

    const comboId = db.transaction(() => {
      const info = db.prepare(
        `INSERT INTO combos (name, description, sale_price_cents, active, company_id, created_at)
         VALUES (?, ?, ?, 1, ?, ?)`
      ).run(name.trim(), String(description || "").trim(), Number(sale_price_cents), companyId, ts);
      const cid = Number(info.lastInsertRowid);
      const stmt = db.prepare("INSERT INTO combo_items (combo_id, product_id, quantity, company_id, created_at) VALUES (?, ?, ?, ?, ?)");
      for (const item of items as any[]) stmt.run(cid, Number(item.product_id), Number(item.quantity), companyId, ts);
      return cid;
    })();

    res.json({ id: comboId, message: "Combo criado com sucesso." });
  } catch (err: any) {
    console.error("[combos] POST error:", err);
    res.status(500).json({ error: "Erro ao criar combo." });
  }
});

// PUT - Atualizar combo (all-or-nothing)
router.put("/:id", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const id = Number(req.params.id);
    const { name, description, sale_price_cents, active, items } = req.body ?? {};

    if (!db.prepare("SELECT 1 FROM combos WHERE id = ? AND company_id = ?").get(id, companyId)) {
      res.status(404).json({ error: "Combo não encontrado." }); return;
    }
    if (!name || !name.trim()) { res.status(400).json({ error: "Nome do combo é obrigatório." }); return; }
    if (!sale_price_cents || Number(sale_price_cents) <= 0) { res.status(400).json({ error: "Preço é obrigatório e deve ser maior que zero." }); return; }

    let itemList: any[] | null = null;
    if (items !== undefined) {
      const itemError = validateComboItems(companyId, items);
      if (itemError) { res.status(400).json({ error: itemError }); return; }
      itemList = items as any[];
    }

    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");

    db.transaction(() => {
      db.prepare(
        "UPDATE combos SET name = ?, description = ?, sale_price_cents = ?, active = ? WHERE id = ? AND company_id = ?"
      ).run(name.trim(), String(description || "").trim(), Number(sale_price_cents), active === 0 ? 0 : 1, id, companyId);
      if (itemList) {
        db.prepare("DELETE FROM combo_items WHERE combo_id = ? AND company_id = ?").run(id, companyId);
        const stmt = db.prepare("INSERT INTO combo_items (combo_id, product_id, quantity, company_id, created_at) VALUES (?, ?, ?, ?, ?)");
        for (const item of itemList) stmt.run(id, Number(item.product_id), Number(item.quantity), companyId, ts);
      }
    })();

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[combos] PUT error:", err);
    res.status(500).json({ error: "Erro ao atualizar combo." });
  }
});

// DELETE - Desativar combo (soft-delete sempre, preserva histórico de pedidos)
router.delete("/:id", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const id = Number(req.params.id);

    if (!db.prepare("SELECT 1 FROM combos WHERE id = ? AND company_id = ?").get(id, companyId)) {
      res.status(404).json({ error: "Combo não encontrado." }); return;
    }

    db.prepare("UPDATE combos SET active = 0 WHERE id = ? AND company_id = ?").run(id, companyId);
    res.json({ ok: true, message: "Combo desativado." });
  } catch (err: any) {
    console.error("[combos] DELETE error:", err);
    res.status(500).json({ error: "Erro ao remover combo." });
  }
});

export default router;