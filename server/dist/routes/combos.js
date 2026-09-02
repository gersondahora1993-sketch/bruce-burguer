import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
const router = Router();
// GET - Listar combos
router.get("/", requireAuth, (req, res) => {
    try {
        const companyId = req.user.company_id ?? 1;
        const { active } = req.query;
        let sql = `
      SELECT c.id, c.name, c.description, c.sale_price_cents, c.active, c.created_at
      FROM combos c
      WHERE c.company_id = ?
    `;
        const params = [Number(req.user.company_id ?? 1)];
        if (active !== undefined && active !== "") {
            sql += " AND c.active = ?";
            params.push(Number(active));
        }
        sql += " ORDER BY c.name COLLATE NOCASE";
        const rows = db.prepare(sql).all(...params);
        res.json(rows);
    }
    catch (err) {
        console.error("[combos] GET error:", err);
        res.status(500).json({ error: "Erro ao buscar combos." });
    }
});
// GET - Obter combo por ID com itens
router.get("/:id", requireAuth, (req, res) => {
    try {
        const companyId = req.user.company_id ?? 1;
        const id = Number(req.params.id);
        const combo = db
            .prepare(`SELECT c.id, c.name, c.description, c.sale_price_cents, c.active, c.created_at
         FROM combos c
         WHERE c.id = ? AND c.company_id = ?`)
            .get(Number(req.params.id), req.user.company_id ?? 1);
        if (!combo) {
            res.status(404).json({ error: "Combo não encontrado." });
            return;
        }
        // Buscar itens do combo
        const items = db
            .prepare(`SELECT ci.id, ci.combo_id, ci.product_id, ci.quantity,
                p.name as product_name, p.sale_price_cents as product_price,
                p.category_id, cat.name as category_name
         FROM combo_items ci
         JOIN products p ON p.id = ci.product_id
         LEFT JOIN categories cat ON cat.id = p.category_id
         WHERE ci.combo_id = ? AND ci.company_id = ?`)
            .all(Number(req.params.id), req.user.company_id ?? 1);
        res.json({ ...combo, items });
    }
    catch (err) {
        console.error("[combos] GET/:id error:", err);
        res.status(500).json({ error: "Erro ao buscar combo." });
    }
});
// POST - Criar combo
router.post("/", requireAuth, requireRole("admin"), (req, res) => {
    try {
        const companyId = req.user.company_id ?? 1;
        const { name, description, sale_price_cents, items } = req.body ?? {};
        if (!name || !name.trim()) {
            res.status(400).json({ error: "Nome do combo é obrigatório." });
            return;
        }
        if (!sale_price_cents || Number(sale_price_cents) <= 0) {
            res.status(400).json({ error: "Preço é obrigatório e deve ser maior que zero." });
            return;
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
            res.status(400).json({ error: "Combo deve ter pelo menos um item." });
            return;
        }
        // Validar itens
        for (const item of items) {
            if (!item.product_id || Number(item.product_id) <= 0) {
                res.status(400).json({ error: "Cada item deve ter um product_id válido." });
                return;
            }
            if (!item.quantity || Number(item.quantity) <= 0) {
                res.status(400).json({ error: "Quantidade deve ser maior que zero." });
                return;
            }
            // Verificar se produto existe
            const prod = db.prepare("SELECT id FROM products WHERE id = ? AND company_id = ?").get(Number(item.product_id), companyId);
            if (!prod) {
                res.status(400).json({ error: `Produto ID ${item.product_id} não encontrado.` });
                return;
            }
        }
        const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
        const info = db.prepare(`INSERT INTO combos (name, description, sale_price_cents, active, company_id, created_at)
       VALUES (?, ?, ?, 1, ?, ?)`).run(name.trim(), String(req.body.description || "").trim(), Number(sale_price_cents), companyId, ts);
        const comboId = Number(info.lastInsertRowid);
        // Inserir itens
        const stmt = db.prepare("INSERT INTO combo_items (combo_id, product_id, quantity, company_id, created_at) VALUES (?, ?, ?, ?, ?)");
        for (const item of items) {
            stmt.run(comboId, Number(item.product_id), Number(item.quantity), companyId, ts);
        }
        res.json({ id: comboId, message: "Combo criado com sucesso." });
    }
    catch (err) {
        console.error("[combos] POST error:", err);
        res.status(500).json({ error: "Erro ao criar combo." });
    }
});
// PUT - Atualizar combo
router.put("/:id", requireAuth, requireRole("admin"), (req, res) => {
    try {
        const companyId = req.user.company_id ?? 1;
        const id = Number(req.params.id);
        const { name, description, sale_price_cents, active, items } = req.body ?? {};
        const existing = db.prepare("SELECT id FROM combos WHERE id = ? AND company_id = ?").get(id, companyId);
        if (!existing) {
            res.status(404).json({ error: "Combo não encontrado." });
            return;
        }
        if (!name || !name.trim()) {
            res.status(400).json({ error: "Nome do combo é obrigatório." });
            return;
        }
        if (!sale_price_cents || Number(sale_price_cents) <= 0) {
            res.status(400).json({ error: "Preço é obrigatório e deve ser maior que zero." });
            return;
        }
        db.prepare("UPDATE combos SET name = ?, description = ?, sale_price_cents = ?, active = ? WHERE id = ? AND company_id = ?").run(name.trim(), String(req.body.description || "").trim(), Number(sale_price_cents), active === 0 ? 0 : 1, id, companyId);
        // Atualizar itens se fornecidos
        if (items && Array.isArray(items)) {
            // Validar itens
            for (const item of items) {
                if (!item.product_id || Number(item.product_id) <= 0) {
                    res.status(400).json({ error: "Cada item deve ter um product_id válido." });
                    return;
                }
                if (!item.quantity || Number(item.quantity) <= 0) {
                    res.status(400).json({ error: "Quantidade deve ser maior que zero." });
                    return;
                }
                const prod = db.prepare("SELECT id FROM products WHERE id = ? AND company_id = ?").get(Number(item.product_id), companyId);
                if (!prod) {
                    res.status(400).json({ error: `Produto ID ${item.product_id} não encontrado.` });
                    return;
                }
            }
            // Remover itens antigos e inserir novos
            db.prepare("DELETE FROM combo_items WHERE combo_id = ? AND company_id = ?").run(id, companyId);
            const stmt = db.prepare("INSERT INTO combo_items (combo_id, product_id, quantity, company_id, created_at) VALUES (?, ?, ?, ?, ?)");
            const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
            for (const item of items) {
                stmt.run(id, Number(item.product_id), Number(item.quantity), companyId, ts);
            }
        }
        res.json({ ok: true });
    }
    catch (err) {
        console.error("[combos] PUT error:", err);
        res.status(500).json({ error: "Erro ao atualizar combo." });
    }
});
// DELETE - Desativar/Remover combo
router.delete("/:id", requireAuth, requireRole("admin"), (req, res) => {
    try {
        const companyId = req.user.company_id ?? 1;
        const id = Number(req.params.id);
        const existing = db.prepare("SELECT id FROM combos WHERE id = ? AND company_id = ?").get(id, companyId);
        if (!existing) {
            res.status(404).json({ error: "Combo não encontrado." });
            return;
        }
        // Verificar se está em pedidos
        const orderCount = db.prepare("SELECT COUNT(*) as c FROM order_items WHERE product_id IN (SELECT product_id FROM combo_items WHERE combo_id = ?) AND company_id = ?").get(id, companyId);
        // Para simplificar, apenas desativar
        db.prepare("UPDATE combos SET active = 0 WHERE id = ? AND company_id = ?").run(id, companyId);
        res.json({ ok: true, message: "Combo desativado." });
    }
    catch (err) {
        console.error("[combos] DELETE error:", err);
        res.status(500).json({ error: "Erro ao remover combo." });
    }
});
export default router;
