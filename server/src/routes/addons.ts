import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import type { Request, Response } from "express";

const router = Router();

// GET - Listar adicionais
router.get("/", requireAuth, (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const { active } = req.query;
    
    let sql = "SELECT id, name, price_cents, active, created_at FROM addons WHERE company_id = ?";
    const params: (string | number)[] = [Number((req.user as any).company_id ?? 1)];
    
    if (active !== undefined && active !== "") {
      sql += " AND active = ?";
      params.push(Number(active));
    }
    
    sql += " ORDER BY name COLLATE NOCASE";
    
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error("[addons] GET error:", err);
    res.status(500).json({ error: "Erro ao buscar adicionais." });
  }
});

// POST - Criar adicional
router.post("/", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const { name, price_cents } = req.body ?? {};
    
    if (!name || !name.trim()) {
      res.status(400).json({ error: "Nome do adicional é obrigatório." });
      return;
    }
    if (!price_cents || Number(price_cents) < 0) {
      res.status(400).json({ error: "Preço é obrigatório e deve ser maior ou igual a zero." });
      return;
    }
    
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    const info = db.prepare(
      "INSERT INTO addons (name, price_cents, active, company_id, created_at) VALUES (?, ?, 1, ?, ?)"
    ).run(name.trim(), Number(price_cents), companyId, new Date().toISOString().slice(0, 19).replace("T", " "));
    
    res.json({ id: Number(info.lastInsertRowid), name: name.trim(), price_cents: Number(price_cents), active: 1 });
  } catch (err: any) {
    console.error("[addons] POST error:", err);
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(400).json({ error: "Adicional com este nome já existe." });
    } else {
      res.status(500).json({ error: "Erro ao criar adicional." });
    }
  }
});

// PUT - Atualizar adicional
router.put("/:id", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const id = Number(req.params.id);
    const { name, price_cents, active } = req.body ?? {};
    
    if (!name || !name.trim()) {
      res.status(400).json({ error: "Nome do adicional é obrigatório." });
      return;
    }
    if (price_cents === undefined || Number(price_cents) < 0) {
      res.status(400).json({ error: "Preço é obrigatório e deve ser maior ou igual a zero." });
      return;
    }
    
    const existing = db.prepare("SELECT id FROM addons WHERE id = ? AND company_id = ?").get(id, companyId);
    if (!existing) {
      res.status(404).json({ error: "Adicional não encontrado." });
      return;
    }
    
    db.prepare(
      "UPDATE addons SET name = ?, price_cents = ?, active = ? WHERE id = ? AND company_id = ?"
    ).run(name.trim(), Number(price_cents), active === 0 ? 0 : 1, id, (req.user as any).company_id ?? 1);
    
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[addons] PUT error:", err);
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(400).json({ error: "Adicional com este nome já existe." });
    } else {
      res.status(500).json({ error: "Erro ao atualizar adicional." });
    }
  }
});

// DELETE - Desativar/Remover adicional
router.delete("/:id", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const id = Number(req.params.id);
    
    const existing = db.prepare("SELECT id FROM addons WHERE id = ? AND company_id = ?").get(id, companyId);
    if (!existing) {
      res.status(404).json({ error: "Adicional não encontrado." });
      return;
    }
    
    // Verificar se está associado a produtos
    const productCount = db.prepare("SELECT COUNT(*) as c FROM product_addons WHERE addon_id = ? AND company_id = ?").get(id, companyId) as { c: number };
    if (productCount.c > 0) {
      db.prepare("UPDATE addons SET active = 0 WHERE id = ? AND company_id = ?").run(id, companyId);
      res.json({ ok: true, message: "Adicional desativado (associado a produtos)." });
      return;
    }
    
    db.prepare("DELETE FROM addons WHERE id = ? AND company_id = ?").run(id, companyId);
    res.json({ ok: true, message: "Adicional removido." });
  } catch (err: any) {
    console.error("[addons] DELETE error:", err);
    res.status(500).json({ error: "Erro ao remover adicional." });
  }
});

export default router;