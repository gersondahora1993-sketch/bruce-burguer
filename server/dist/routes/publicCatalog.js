import { Router } from "express";
import { db } from "../db.js";
import { env } from "../config.js";
const router = Router();
const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.sku, p.description, p.category_id, p.sale_price_cents, p.image_url,
         c.name AS category_name,
         v.id AS variation_id, v.stock, v.min_stock,
         col.id AS color_id, col.name AS color_name, col.hex AS color_hex,
         s.id AS size_id, s.name AS size_name
  FROM products p
  JOIN product_variations v ON v.product_id = p.id
   JOIN colors col ON col.id = v.color_id AND col.company_id = p.company_id
   JOIN sizes s ON s.id = v.size_id AND s.company_id = p.company_id
   LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
   WHERE p.active = 1 AND p.company_id = ? AND v.company_id = ?
`;
function publicCompany(res) {
    if (!env.publicCompanyId) {
        res.status(503).json({ error: "Catálogo público não configurado para uma empresa." });
        return null;
    }
    return env.publicCompanyId;
}
function groupProducts(rows) {
    const map = new Map();
    for (const r of rows) {
        let p = map.get(r.id);
        if (!p) {
            p = {
                id: r.id,
                name: r.name,
                sku: r.sku,
                description: r.description,
                category_id: r.category_id,
                category_name: r.category_name,
                sale_price_cents: r.sale_price_cents,
                image_url: r.image_url,
                total_stock: 0,
                variations: [],
            };
            map.set(r.id, p);
        }
        p.total_stock += r.stock;
        p.variations.push({
            id: r.variation_id,
            color_id: r.color_id,
            color_name: r.color_name,
            color_hex: r.color_hex,
            size_id: r.size_id,
            size_name: r.size_name,
            stock: r.stock,
            min_stock: r.min_stock,
            available: r.stock > 0,
        });
    }
    return Array.from(map.values());
}
function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
}
router.get("/products", (req, res) => {
    const companyId = publicCompany(res);
    if (companyId === null)
        return;
    const { category_id, search } = req.query;
    let sql = PRODUCT_SELECT;
    const params = [companyId, companyId];
    if (category_id && Number(category_id) > 0) {
        sql += " AND p.category_id = ?";
        params.push(Number(category_id));
    }
    if (search && String(search).trim()) {
        sql += " AND (p.name LIKE ? OR p.sku LIKE ?)";
        const term = `%${String(search).trim()}%`;
        params.push(term, term);
    }
    sql += " ORDER BY p.name COLLATE NOCASE ASC, col.name ASC, s.name ASC";
    const rows = db.prepare(sql).all(...params);
    res.json(groupProducts(rows));
});
router.get("/products/:id", (req, res) => {
    const companyId = publicCompany(res);
    if (companyId === null)
        return;
    const rows = db
        .prepare(PRODUCT_SELECT +
        ` AND p.id = ?
         ORDER BY col.name ASC, s.name ASC`)
        .all(companyId, companyId, Number(req.params.id));
    if (rows.length === 0) {
        res.status(404).json({ error: "Produto não encontrado." });
        return;
    }
    res.json(groupProducts(rows)[0]);
});
router.get("/categories", (req, res) => {
    const companyId = publicCompany(res);
    if (companyId === null)
        return;
    const rows = db
        .prepare(`SELECT c.id, c.name
        FROM categories c
         WHERE c.active = 1 AND c.company_id = ? AND EXISTS (
          SELECT 1 FROM products p
          JOIN product_variations pv ON pv.product_id = p.id AND pv.company_id = p.company_id
          WHERE p.category_id = c.id AND p.company_id = ?
        )
        ORDER BY c.name COLLATE NOCASE ASC`)
        .all(companyId, companyId);
    res.json(rows);
});
router.get("/store", (req, res) => {
    const companyId = publicCompany(res);
    if (companyId === null)
        return;
    const row = db
        .prepare(`SELECT business_name, slogan, whatsapp, address, city, uf, cep, hours, logo_url
       FROM business_settings WHERE company_id = ?`)
        .get(companyId);
    if (!row) {
        res.status(503).json({ error: "Configurações da empresa não encontradas." });
        return;
    }
    const digits = digitsOnly(row.whatsapp ?? "");
    const whatsapp = digits.length > 0
        ? digits.length <= 11 && !digits.startsWith("55")
            ? "55" + digits
            : digits
        : "";
    res.json({
        store_name: row.business_name || "Bruce Burguer",
        store_logo_url: row.logo_url || "",
        store_phone: "",
        store_instagram: "",
        store_address: row.address || "",
        store_city: row.city || "",
        store_state: row.uf || "",
        store_zip: row.cep || "",
        opening_hours: row.hours || "",
        whatsapp_digits_only: whatsapp,
        slogan: row.slogan || "",
    });
});
export default router;
