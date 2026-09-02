import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import type { Request, Response } from "express";

const router = Router();

// GET - Listar categorias
router.get("/", requireAuth, (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const rows = db
      .prepare("SELECT id, name, active, created_at FROM categories WHERE company_id = ? ORDER BY name")
      .all(companyId);
    res.json(rows);
  } catch (err: any) {
    console.error("[categories] GET error:", err);
    res.status(500).json({ error: "Erro ao buscar categorias." });
  }
});

// POST - Criar categoria
router.post("/", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const { name } = req.body ?? {};
    
    if (!name || !name.trim()) {
      res.status(400).json({ error: "Nome da categoria é obrigatório." });
      return;
    }
    
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    
    try {
      const info = db.prepare(
        "INSERT INTO categories (name, active, company_id, created_at) VALUES (?, 1, ?, ?)"
      ).run(name.trim(), companyId, new Date().toISOString().slice(0, 19).replace("T", " "));
      
      res.json({ id: Number(info.lastInsertRowid), name: name.trim(), active: 1 });
    } catch (err: any) {
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
        res.status(400).json({ error: "Categoria com este nome já existe." });
      } else {
        throw err;
      }
    }
  } catch (err: any) {
    console.error("[categories] POST error:", err);
    res.status(500).json({ error: "Erro ao criar categoria." });
  }
});

// PUT - Atualizar categoria
router.put("/:id", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const id = Number(req.params.id);
    const { name, active } = req.body ?? {};
    
    if (!name || !name.trim()) {
      res.status(400).json({ error: "Nome da categoria é obrigatório." });
      return;
    }
    
    const existing = db.prepare("SELECT id FROM categories WHERE id = ? AND company_id = ?").get(id, companyId);
    if (!existing) {
      res.status(404).json({ error: "Categoria não encontrada." });
      return;
    }
    
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    db.prepare(
      "UPDATE categories SET name = ?, active = ? WHERE id = ? AND company_id = ?"
    ).run(name.trim(), active === 0 ? 0 : 1, id, companyId);
    
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[categories] PUT error:", err);
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(400).json({ error: "Categoria com este nome já existe." });
    } else {
      res.status(500).json({ error: "Erro ao atualizar categoria." });
    }
  }
});

// DELETE - Desativar/Remover categoria (soft delete via active=0)
router.delete("/:id", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const id = Number(req.params.id);
    
    const existing = db.prepare("SELECT id FROM categories WHERE id = ? AND company_id = ?").get(id, companyId);
    if (!existing) {
      res.status(404).json({ error: "Categoria não encontrada." });
      return;
    }
    
    // Verificar se há produtos vinculados
    const productsCount = db.prepare("SELECT COUNT(*) as c FROM products WHERE category_id = ? AND company_id = ?").get(id, companyId) as { c: number };
    if (productsCount.c > 0) {
      // Soft delete - apenas desativar
      db.prepare("UPDATE categories SET active = 0 WHERE id = ? AND company_id = ?").run(id, companyId);
      res.json({ ok: true, message: "Categoria desativada (possui produtos vinculados)." });
    } else {
      // Pode remover completamente
      db.prepare("DELETE FROM categories WHERE id = ? AND company_id = ?").run(id, companyId);
      res.json({ ok: true, message: "Categoria removida." });
    }
  } catch (err: any) {
    console.error("[categories] DELETE error:", err);
    res.status(500).json({ error: "Erro ao remover categoria." });
  }
});

export default router;