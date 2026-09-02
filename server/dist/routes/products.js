import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
const router = Router();
// GET - Listar produtos com filtros
router.get("/", requireAuth, (req, res) => {
    try {
        const companyId = req.user.company_id ?? 1;
        const { category_id, active, search, limit, offset } = req.query;
        let sql = `
      SELECT p.id, p.name, p.description, p.category_id, p.sale_price_cents, 
             p.image_url, p.active, p.created_at,
             c.name as category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.company_id = ?
    `;
        const params = [Number(req.user.company_id ?? 1)];
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
        const rows = db.prepare(sql).all(...params);
        res.json(rows);
    }
    catch (err) {
        console.error("[products] GET error:", err);
        res.status(500).json({ error: "Erro ao buscar produtos." });
    }
});
// GET - Obter produto por ID
router.get("/:id", requireAuth, (req, res) => {
    try {
        const companyId = req.user.company_id ?? 1;
        const id = Number(req.params.id);
        const row = db
            .prepare(`SELECT p.id, p.name, p.description, p.category_id, p.sale_price_cents, 
                p.image_url, p.active, p.created_at,
                c.name as category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = ? AND p.company_id = ?`)
            .get(Number(req.params.id), req.user.company_id ?? 1);
        if (!row) {
            res.status(404).json({ error: "Produto não encontrado." });
            return;
        }
        // Buscar adicionais associados
        const addons = db
            .prepare(`SELECT a.id, a.name, a.price_cents, a.active
         FROM addons a
         JOIN product_addons pa ON pa.addon_id = a.id
         WHERE pa.product_id = ? AND a.company_id = ?`)
            .all(Number(req.params.id), req.user.company_id ?? 1);
        res.json({ ...row, addons });
    }
    catch (err) {
        console.error("[products] GET/:id error:", err);
        res.status(500).json({ error: "Erro ao buscar produto." });
    }
});
// POST - Criar produto
router.post("/", requireAuth, requireRole("admin"), (req, res) => {
    try {
        const companyId = req.user.company_id ?? 1;
        const { name, description, category_id, sale_price_cents, image_url, addon_ids } = req.body ?? {};
        if (!name || !name.trim()) {
            res.status(400).json({ error: "Nome do produto é obrigatório." });
            return;
        }
        if (!category_id || Number(category_id) <= 0) {
            res.status(400).json({ error: "Categoria é obrigatória." });
            return;
        }
        if (!sale_price_cents || Number(sale_price_cents) <= 0) {
            res.status(400).json({ error: "Preço é obrigatório e deve ser maior que zero." });
            return;
        }
        // Verificar se categoria existe
        const cat = db.prepare("SELECT id FROM categories WHERE id = ? AND company_id = ?").get(Number(category_id), companyId);
        if (!cat) {
            res.status(400).json({ error: "Categoria não encontrada." });
            return;
        }
        const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
        const info = db.prepare(`INSERT INTO products (name, description, category_id, sale_price_cents, image_url, active, company_id, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(name.trim(), String(description || "").trim(), Number(category_id), Number(sale_price_cents), String(image_url || "").trim(), companyId, new Date().toISOString().slice(0, 19).replace("T", " "));
        const productId = Number(info.lastInsertRowid);
        // Associar adicionais
        if (addon_ids && Array.isArray(addon_ids)) {
            const stmt = db.prepare("INSERT OR IGNORE INTO product_addons (product_id, addon_id, company_id, created_at) VALUES (?, ?, ?, ?)");
            const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
            for (const addonId of addon_ids) {
                if (Number(addonId) > 0) {
                    stmt.run(productId, Number(addonId), companyId, new Date().toISOString().slice(0, 19).replace("T", " "));
                }
            }
        }
        res.json({ id: productId, message: "Produto criado com sucesso." });
    }
    catch (err) {
        console.error("[products] POST error:", err);
        res.status(500).json({ error: "Erro ao criar produto." });
    }
});
// PUT - Atualizar produto
router.put("/:id", requireAuth, requireRole("admin"), (req, res) => {
    try {
        const companyId = req.user.company_id ?? 1;
        const id = Number(req.params.id);
        const { name, description, category_id, sale_price_cents, image_url, active, addon_ids } = req.body ?? {};
        const existing = db.prepare("SELECT id FROM products WHERE id = ? AND company_id = ?").get(id, companyId);
        if (!existing) {
            res.status(404).json({ error: "Produto não encontrado." });
            return;
        }
        if (!name || !name.trim()) {
            res.status(400).json({ error: "Nome do produto é obrigatório." });
            return;
        }
        if (!category_id || Number(category_id) <= 0) {
            res.status(400).json({ error: "Categoria é obrigatória." });
            return;
        }
        if (!sale_price_cents || Number(sale_price_cents) <= 0) {
            res.status(400).json({ error: "Preço é obrigatório e deve ser maior que zero." });
            return;
        }
        // Verificar categoria
        const cat = db.prepare("SELECT id FROM categories WHERE id = ? AND company_id = ?").get(Number(category_id), companyId);
        if (!cat) {
            res.status(400).json({ error: "Categoria não encontrada." });
            return;
        }
        db.prepare(`UPDATE products SET name = ?, description = ?, category_id = ?, sale_price_cents = ?, image_url = ?, active = ?
       WHERE id = ? AND company_id = ?`).run(name.trim(), String(description || "").trim(), Number(category_id), Number(sale_price_cents), String(image_url || "").trim(), active === 0 ? 0 : 1, id, companyId);
        // Atualizar adicionais (remover todos e recriar)
        if (addon_ids && Array.isArray(addon_ids)) {
            db.prepare("DELETE FROM product_addons WHERE product_id = ? AND company_id = ?").run(id, companyId);
            const stmt = db.prepare("INSERT OR IGNORE INTO product_addons (product_id, addon_id, company_id, created_at) VALUES (?, ?, ?, ?)");
            const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
            for (const addonId of addon_ids) {
                if (Number(addonId) > 0) {
                    stmt.run(id, Number(addonId), companyId, new Date().toISOString().slice(0, 19).replace("T", " "));
                }
            }
        }
        res.json({ ok: true });
    }
    catch (err) {
        console.error("[products] PUT error:", err);
        res.status(500).json({ error: "Erro ao atualizar produto." });
    }
});
// DELETE - Desativar/Remover produto
router.delete("/:id", requireAuth, requireRole("admin"), (req, res) => {
    try {
        const companyId = req.user.company_id ?? 1;
        const id = Number(req.params.id);
        const existing = db.prepare("SELECT id FROM products WHERE id = ? AND company_id = ?").get(id, companyId);
        if (!existing) {
            res.status(404).json({ error: "Produto não encontrado." });
            return;
        }
        // Verificar se está em combos
        const comboCount = db.prepare("SELECT COUNT(*) as c FROM combo_items WHERE product_id = ? AND company_id = ?").get(id, companyId);
        if (comboCount.c > 0) {
            // Soft delete
            db.prepare("UPDATE products SET active = 0 WHERE id = ? AND company_id = ?").run(id, companyId);
            res.json({ ok: true, message: "Produto desativado (faz parte de combos)." });
            return;
        }
        // Verificar se está em pedidos
        const orderCount = db.prepare("SELECT COUNT(*) as c FROM order_items WHERE product_id = ? AND company_id = ?").get(id, companyId);
        if (orderCount.c > 0) {
            db.prepare("UPDATE products SET active = 0 WHERE id = ? AND company_id = ?").run(id, companyId);
            res.json({ ok: true, message: "Produto desativado (possui histórico de pedidos)." });
            return;
        }
        // Pode remover completamente
        db.prepare("DELETE FROM product_addons WHERE product_id = ? AND company_id = ?").run(id, companyId);
        db.prepare("DELETE FROM products WHERE id = ? AND company_id = ?").run(id, companyId);
        res.json({ ok: true, message: "Produto removido." });
    }
    catch (err) {
        console.error("[products] DELETE error:", err);
        res.status(500).json({ error: "Erro ao remover produto." });
    }
});
export default router;
