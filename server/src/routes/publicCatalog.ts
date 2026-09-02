import { Router } from "express";
import { db } from "../db.js";
import { env } from "../config.js";
import type { Request, Response } from "express";

const router = Router();

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.description, p.category_id, p.sale_price_cents, p.image_url,
         c.name AS category_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
  WHERE p.active = 1 AND p.company_id = ?
`;

const COMBO_SELECT = `
  SELECT c.id, c.name, c.description, c.sale_price_cents, c.image_url, c.active
  FROM combos c
  WHERE c.active = 1 AND c.company_id = ?
`;

const COMBO_ITEMS_SELECT = `
  SELECT ci.combo_id, ci.product_id, ci.quantity,
         p.name AS product_name, p.sale_price_cents, p.image_url, p.category_id,
         cat.name AS category_name
  FROM combo_items ci
  JOIN products p ON p.id = ci.product_id
  LEFT JOIN categories cat ON cat.id = p.category_id
  WHERE ci.combo_id = ?
`;

const ADDON_SELECT = `
  SELECT a.id, a.name, a.price_cents, a.active
  FROM addons a
  WHERE a.active = 1 AND a.company_id = ?
`;

const PRODUCT_ADDONS_SELECT = `
  SELECT pa.product_id, a.id, a.name, a.price_cents
  FROM product_addons pa
  JOIN addons a ON a.id = pa.addon_id
  WHERE pa.company_id = ?
`;

function publicCompany(res: Response): number | null {
  if (!env.publicCompanyId) {
    res.status(503).json({ error: "Catálogo público não configurado para uma empresa." });
    return null;
  }
  return env.publicCompanyId;
}

function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function formatPrice(cents: number): string {
  return "R$ " + (cents / 100).toFixed(2).replace(".", ",");
}

router.get("/products", (req: Request, res: Response) => {
  const companyId = publicCompany(res);
  if (companyId === null) return;
  const { category_id, search, limit, offset } = req.query;
  
  let sql = PRODUCT_SELECT;
  const params: (string | number)[] = [companyId];
  
  if (category_id && Number(category_id) > 0) {
    sql += " AND p.category_id = ?";
    params.push(Number(category_id));
  }
  if (search && String(search).trim()) {
    sql += " AND (p.name LIKE ? OR p.description LIKE ?)";
    const term = `%${String(search).trim()}%`;
    params.push(term, term);
  }
  
  sql += " ORDER BY c.name COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC";
  
  if (limit && Number(limit) > 0) {
    sql += " LIMIT ?";
    params.push(Number(limit));
    if (offset && Number(offset) > 0) {
      sql += " OFFSET ?";
      params.push(Number(offset));
    }
  }
  
  const rows = db.prepare(sql).all(...params) as any[];
  
  // Buscar adicionais para cada produto
  const productIds = rows.map(r => r.id);
  let productAddons: Record<number, any[]> = {};
  if (productIds.length > 0) {
    const placeholders = productIds.map(() => "?").join(",");
    const addonsRows = db.prepare(
      `SELECT pa.product_id, a.id, a.name, a.price_cents
       FROM product_addons pa
       JOIN addons a ON a.id = pa.addon_id
       WHERE pa.product_id IN (${placeholders}) AND pa.company_id = ?`
    ).all(...productIds, companyId) as any[];
    
    for (const row of addonsRows) {
      if (!productAddons[row.product_id]) productAddons[row.product_id] = [];
      productAddons[row.product_id].push({
        id: row.id,
        name: row.name,
        price_cents: row.price_cents
      });
    }
  }
  
  const products = rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    category_id: r.category_id,
    category_name: r.category_name,
    sale_price_cents: r.sale_price_cents,
    image_url: r.image_url,
    addons: productAddons[r.id] || []
  }));
  
  res.json(products);
});

router.get("/products/:id", (req: Request, res: Response) => {
  const companyId = publicCompany(res);
  if (companyId === null) return;
  const id = Number(req.params.id);
  
  const product = db.prepare(`
    SELECT p.id, p.name, p.description, p.category_id, p.sale_price_cents, 
           p.image_url, p.active, p.created_at,
           c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
    WHERE p.id = ? AND p.company_id = ?
  `).get(Number(req.params.id), companyId) as any;
  
  if (!product) {
    res.status(404).json({ error: "Produto não encontrado." });
    return;
  }
  
  // Buscar adicionais do produto
  const addons = db.prepare(`
    SELECT a.id, a.name, a.price_cents
    FROM addons a
    JOIN product_addons pa ON pa.addon_id = a.id
    WHERE pa.product_id = ? AND pa.company_id = ?
  `).all(Number(req.params.id), companyId) as any[];
  
  product.addons = addons;
  res.json(product);
});

router.get("/categories", (req: Request, res: Response) => {
  const companyId = publicCompany(res);
  if (companyId === null) return;
  const rows = db
    .prepare(
       `SELECT c.id, c.name, c.active
        FROM categories c
        WHERE c.active = 1 AND c.company_id = ? AND EXISTS (
          SELECT 1 FROM products p
          WHERE p.category_id = c.id AND p.company_id = ? AND p.active = 1
        )
        ORDER BY c.name COLLATE NOCASE ASC`
    )
    .all(companyId, companyId) as any[];

  res.json(rows);
});

router.get("/combos", (req: Request, res: Response) => {
  const companyId = publicCompany(res);
  if (companyId === null) return;
  
  const combos = db.prepare(COMBO_SELECT).all(companyId) as any[];
  
  // Buscar itens de cada combo
  for (const combo of combos) {
    const items = db.prepare(COMBO_ITEMS_SELECT).all(combo.id) as any[];
    combo.items = items;
  }
  
  res.json(combos);
});

router.get("/combos/:id", (req: Request, res: Response) => {
  const companyId = publicCompany(res);
  if (companyId === null) return;
  const id = Number(req.params.id);
  
  const combo = db.prepare(COMBO_SELECT + " AND c.id = ?").get(companyId, id) as any;
  if (!combo) {
    res.status(404).json({ error: "Combo não encontrado." });
    return;
  }
  
  const items = db.prepare(COMBO_ITEMS_SELECT).all(id) as any[];
  combo.items = items;
  res.json(combo);
});

router.get("/addons", (req: Request, res: Response) => {
  const companyId = publicCompany(res);
  if (companyId === null) return;
  const rows = db.prepare(ADDON_SELECT).all(companyId) as any[];
  res.json(rows);
});

router.get("/store", (req: Request, res: Response) => {
  const companyId = publicCompany(res);
  if (companyId === null) return;
  const row = db
    .prepare(
      `SELECT business_name, slogan, whatsapp, address, city, uf, cep, hours, logo_url
       FROM business_settings WHERE company_id = ?`
    )
    .get(companyId) as {
      business_name: string;
      slogan: string;
      whatsapp: string;
      address: string;
      city: string;
      uf: string;
      cep: string;
      hours: string;
      logo_url: string;
    } | undefined;

  if (!row) {
    res.status(503).json({ error: "Configurações da empresa não encontradas." });
    return;
  }

  const digits = digitsOnly(row.whatsapp ?? "");
  const whatsapp =
    digits.length > 0
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