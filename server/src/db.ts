import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { env } from "./config.js";

const dataDir = path.join(process.cwd(), "data");

export const dbFile = env.dbPath
  ? path.resolve(env.dbPath)
  : path.join(dataDir, "bruce-burguer.db");

fs.mkdirSync(path.dirname(dbFile), { recursive: true });
console.log(
  `[db] Arquivo do banco: ${dbFile}${env.dbPath ? " (DB_PATH do ambiente)" : " (padrão local — apenas desenvolvimento)"}`
);

export const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export const BOOTSTRAP_COMPANY_ID = 1;
const BOOTSTRAP_COMPANY_NAME = "Bruce Burguer";
const BOOTSTRAP_COMPANY_SLUG = "bruce-burguer";

export function ensureBootstrapCompany(): void {
  const existing = db
    .prepare("SELECT id, name, slug FROM companies WHERE id = ?")
    .get(BOOTSTRAP_COMPANY_ID) as { id: number; name: string; slug: string } | undefined;
  if (existing) {
    if (existing.name !== BOOTSTRAP_COMPANY_NAME || existing.slug !== BOOTSTRAP_COMPANY_SLUG) {
      throw new Error("[db] A empresa bootstrap id=1 existe com identidade diferente; operação interrompida.");
    }
    return;
  }

  const conflictingSlug = db
    .prepare("SELECT id FROM companies WHERE slug = ?")
    .get(BOOTSTRAP_COMPANY_SLUG) as { id: number } | undefined;
  if (conflictingSlug) {
    throw new Error("[db] O slug da empresa bootstrap já pertence a outra empresa; operação interrompida.");
  }

  db.prepare("INSERT INTO companies (id, name, slug) VALUES (?, ?, ?)").run(
    BOOTSTRAP_COMPANY_ID,
    BOOTSTRAP_COMPANY_NAME,
    BOOTSTRAP_COMPANY_SLUG
  );
}

export function now(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function todayStart(): string {
  return `${now().slice(0, 10)} 00:00:00`;
}

export function monthStart(): string {
  return `${now().slice(0, 7)}-01 00:00:00`;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  active INTEGER NOT NULL DEFAULT 1,
  company_id INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ativo',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  company_id INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id),
  sale_price_cents INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  company_id DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  company_id DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  addon_id INTEGER REFERENCES addons(id) ON DELETE CASCADE,
  company_id DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS combos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sale_price_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  company_id DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS combo_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_id INTEGER REFERENCES combos(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  company_id DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  company_id DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL DEFAULT '',
  complement TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'pix',
  change_for_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'novo' CHECK(status IN ('novo','confirmado','em_preparacao','pronto','entregue','cancelado')),
  source TEXT NOT NULL DEFAULT 'online',
  delivery_type TEXT NOT NULL DEFAULT 'entrega',
  user_id INTEGER,
  customer_id INTEGER,
  paid_at TEXT,
  completed_at TEXT,
  company_id INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  combo_id INTEGER,
  quantity INTEGER NOT NULL DEFAULT 1,
  price_cents INTEGER NOT NULL DEFAULT 0,
  observation TEXT NOT NULL DEFAULT '',
  company_id DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_item_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER REFERENCES order_items(id) ON DELETE CASCADE,
  addon_id INTEGER REFERENCES addons(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  price_cents INTEGER NOT NULL DEFAULT 0,
  company_id DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER DEFAULT 1,
  product_id INTEGER REFERENCES products(id),
  type TEXT NOT NULL CHECK(type IN ('entrada','saida','ajuste','venda','estorno')),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  stock_before INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  reference_type TEXT,
  reference_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS business_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER DEFAULT 1,
  business_name TEXT NOT NULL DEFAULT 'Bruce Burguer',
  slogan TEXT NOT NULL DEFAULT 'Hamburgueria Artesanal',
  whatsapp TEXT NOT NULL DEFAULT '+5522988620861',
  address TEXT NOT NULL DEFAULT 'Loteamento Nova Macuco, em frente à Mercearia do Davi',
  city TEXT NOT NULL DEFAULT 'São Francisco de Itabapoana',
  uf TEXT NOT NULL DEFAULT 'RJ',
  cep TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL DEFAULT 'Terça a sábado, das 18:30 às 23:00',
  logo_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function initSchema() {
  db.exec(SCHEMA);
}

export function ensureDefaultPlans(): void {
  // Plans (SaaS/subscriptions) não são utilizados na arquitetura Bruce Burguer.
  // Esta função permanece como reserva/placeholder.
  return;
}

export function seed(): void {
  // Seed completo: garante bootstrap company, admin, configurações, catálogo completo.
  const ts = now();
  ensureBootstrapCompany();

  // Admin user (idempotente)
  const existingAdmin = db.prepare("SELECT id FROM users WHERE email = ?").get("admin@bruceburguer.com");
  if (!existingAdmin) {
    const adminHash = bcrypt.hashSync("admin123", 10);
    db.prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)").run(
      "Administrador",
      "admin@bruceburguer.com",
      adminHash,
      ts
    );
  }

  // Inserir/atualizar configurações oficiais da Bruce Burguer (idempotente)
  const existingSettings = db.prepare("SELECT id FROM business_settings WHERE company_id = ?").get(BOOTSTRAP_COMPANY_ID);
  if (existingSettings) {
    db.prepare(`
      UPDATE business_settings SET
        business_name = ?, slogan = ?, whatsapp = ?, address = ?, city = ?, uf = ?, cep = ?, hours = ?, logo_url = ?, updated_at = ?
      WHERE company_id = ?
    `).run(
      "Bruce Burguer",
      "Seu hambúrguer artesanal, do nosso jeito para você.",
      "5522981667509",
      "Loteamento Nova Macuco, em frente à Mercearia do Davi",
      "São Francisco de Itabapoana",
      "RJ",
      "",
      "Terça a sábado, das 18:30 às 23:00",
      "",
      ts,
      BOOTSTRAP_COMPANY_ID
    );
  } else {
    db.prepare(`
      INSERT INTO business_settings (
        company_id, business_name, slogan, whatsapp, address, city, uf, cep, hours, logo_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      BOOTSTRAP_COMPANY_ID,
      "Bruce Burguer",
      "Seu hambúrguer artesanal, do nosso jeito para você.",
      "5522981667509",
      "Loteamento Nova Macuco, em frente à Mercearia do Davi",
      "São Francisco de Itabapoana",
      "RJ",
      "",
      "Terça a sábado, das 18:30 às 23:00",
      "",
      ts,
      ts
    );
  }

  // ========== CATEGORIAS (7) ==========
  const categories = [
    "Hambúrgueres",
    "Combos",
    "Porções",
    "Bebidas",
    "Adicionais",
    "Novidades",
    "Mini Salgadinhos"
  ];
  for (const cat of categories) {
    db.prepare("INSERT OR IGNORE INTO categories (name, active, company_id, created_at) VALUES (?, 1, ?, ?)")
      .run(cat, BOOTSTRAP_COMPANY_ID, ts);
  }

  // Helper para obter category_id
  const getCatId = (name: string): number => {
    const row = db.prepare("SELECT id FROM categories WHERE name = ? AND company_id = ?").get(name, BOOTSTRAP_COMPANY_ID) as { id: number } | undefined;
    if (!row) throw new Error(`Categoria não encontrada: ${name}`);
    return row.id;
  };

  const catHamburgueres = getCatId("Hambúrgueres");
  const catCombos = getCatId("Combos");
  const catPorcoes = getCatId("Porções");
  const catBebidas = getCatId("Bebidas");
  const catAdicionais = getCatId("Adicionais");
  const catNovidades = getCatId("Novidades");
  const catMiniSalgadinhos = getCatId("Mini Salgadinhos");

  // ========== ADICIONAIS (4) ==========
  const addons = [
    { name: "Carne 140g", price: 800 },
    { name: "Bacon", price: 400 },
    { name: "Ovo", price: 250 },
    { name: "Mussarela", price: 350 }
  ];
  for (const a of addons) {
    db.prepare("INSERT OR IGNORE INTO addons (name, price_cents, active, company_id, created_at) VALUES (?, ?, 1, ?, ?)")
      .run(a.name, a.price, BOOTSTRAP_COMPANY_ID, ts);
  }

  // Helper para obter addon_id
  const getAddonId = (name: string): number => {
    const row = db.prepare("SELECT id FROM addons WHERE name = ? AND company_id = ?").get(name, BOOTSTRAP_COMPANY_ID) as { id: number } | undefined;
    if (!row) throw new Error(`Adicional não encontrado: ${name}`);
    return row.id;
  };

  const addonCarne = getAddonId("Carne 140g");
  const addonBacon = getAddonId("Bacon");
  const addonOvo = getAddonId("Ovo");
  const addonMussarela = getAddonId("Mussarela");

  // ========== PRODUTOS ==========
  
  // HAMBÚRGUERES (11)
  const hamburgueres = [
    { name: "BURGuer BABY", desc: "Pão Brioche, blend bovino 80g, cheddar cremoso, salada, com fritas + brinde 1 Fini", price: 1499 },
    { name: "BURGUER KIDS 1", desc: "Pão Brioche, blend bovino 140g, cheddar cremoso, salada, com fritas + brinde 1 Fini", price: 1999 },
    { name: "BURGUER KIDS 2", desc: "Pão Brioche, blend bovino 140g, cheddar cremoso, salada, com fritas + Guaravita + brinde 1 Fini", price: 2299 },
    { name: "BURGUER EGGS", desc: "Pão Brioche, blend bovino 140g, queijo, ovo, molho Billy Jack, salada, com fritas", price: 2499 },
    { name: "BURGUER BACON", desc: "Pão Brioche, blend bovino 140g, queijo, cheddar cremoso, bacon em fatias, cebola caramelizada, com fritas", price: 2699 },
    { name: "BURGUER BACON EGGS", desc: "Pão Brioche, blend bovino 140g, queijo, ovo, cheddar cremoso, bacon em fatias, cebola caramelizada, com fritas", price: 2799 },
    { name: "BURGUER TOSCANA", desc: "Pão Brioche, blend bovino 140g, 2 fatias de queijo cheddar, linguiça Toscana, molho Billy Jack, salada, com fritas", price: 2799 },
    { name: "BURGUER COSTELA BOVINA", desc: "Pão Brioche, blend bovino 140g, 2 fatias de queijo cheddar, costela desfiada, Catupiry, salada, com fritas", price: 3199 },
    { name: "BURGUER PROVOLETA", desc: "Pão Brioche, blend bovino 180g, queijo provolone, banana no melaço, salada, com fritas", price: 2899 },
    { name: "BURGUER COSTELA DUPLO", desc: "Pão Brioche, 2 blend bovino 140g, 2 fatias de queijo cheddar, costela desfiada, Catupiry, salada, com fritas", price: 3599 },
    { name: "BURGUER BRUTO DUPLO", desc: "Pão Brioche, 2 blend bovino 140g, 4 fatias de queijo cheddar, empanado de frango da casa, ovo, bacon em fatias, molho Billy Jack, salada, com fritas", price: 4499 },
  ];

  for (const h of hamburgueres) {
    const existing = db.prepare("SELECT id FROM products WHERE name = ? AND company_id = ?").get(h.name, BOOTSTRAP_COMPANY_ID);
    if (!existing) {
      const info = db.prepare(
        "INSERT INTO products (name, description, category_id, sale_price_cents, image_url, active, company_id, created_at, stock, min_stock) VALUES (?, ?, ?, ?, '', 1, ?, ?, 100, 0)"
      ).run(h.name, h.desc, catHamburgueres, h.price, BOOTSTRAP_COMPANY_ID, ts);
      const productId = Number(info.lastInsertRowid);
      // Relacionar adicionais aplicáveis a todos os hambúrgueres
      for (const addonId of [addonCarne, addonBacon, addonOvo, addonMussarela]) {
        db.prepare("INSERT OR IGNORE INTO product_addons (product_id, addon_id, company_id, created_at) VALUES (?, ?, ?, ?)")
          .run(productId, addonId, BOOTSTRAP_COMPANY_ID, ts);
      }
    }
  }

  // PORÇÕES (3)
  const porcoes = [
    { name: "BATATA P", desc: "", price: 400 },
    { name: "BATATA SIMPLES 300G", desc: "", price: 1699 },
    { name: "BATATA RECHEADA 500G", desc: "", price: 2899 },
  ];
  for (const p of porcoes) {
    db.prepare(
      "INSERT OR IGNORE INTO products (name, description, category_id, sale_price_cents, image_url, active, company_id, created_at, stock, min_stock) VALUES (?, ?, ?, ?, '', 1, ?, ?, 100, 0)"
    ).run(p.name, p.desc, catPorcoes, p.price, BOOTSTRAP_COMPANY_ID, ts);
  }

  // BEBIDAS (5)
  const bebidas = [
    { name: "GUARAVITA", desc: "", price: 300 },
    { name: "GUARANÁ ANTÁRTICA 350ML", desc: "", price: 500 },
    { name: "COCA-COLA 350ML", desc: "", price: 600 },
    { name: "GUARANÁ ANTÁRTICA 2L", desc: "", price: 1300 },
    { name: "COCA-COLA 2L", desc: "", price: 1400 },
  ];
  for (const b of bebidas) {
    db.prepare(
      "INSERT OR IGNORE INTO products (name, description, category_id, sale_price_cents, image_url, active, company_id, created_at, stock, min_stock) VALUES (?, ?, ?, ?, '', 1, ?, ?, 100, 0)"
    ).run(b.name, b.desc, catBebidas, b.price, BOOTSTRAP_COMPANY_ID, ts);
  }

  // MINI SALGADINHOS (4 itens: 3 sabores + 100 unidades)
  const miniSalgadinhos = [
    { name: "Bolinha de calabresa", desc: "Mini salgado sabor calabresa", price: 0 }, // preço por unidade não definido, usar porções
    { name: "Bolinho de presunto e queijo", desc: "Mini salgado sabor presunto e queijo", price: 0 },
    { name: "Coxinha", desc: "Mini salgado sabor coxinha", price: 0 },
    { name: "PORÇÃO M — 550ml", desc: "Porção média de mini salgados mistos (aprox. 550ml)", price: 1499 },
    { name: "PORÇÃO G — 770ml", desc: "Porção grande de mini salgados mistos (aprox. 770ml)", price: 1999 },
    { name: "100 MINI SALGADOS", desc: "Cento de mini salgados sortidos", price: 4500 },
  ];
  for (const m of miniSalgadinhos) {
    db.prepare(
      "INSERT OR IGNORE INTO products (name, description, category_id, sale_price_cents, image_url, active, company_id, created_at, stock, min_stock) VALUES (?, ?, ?, ?, '', 1, ?, ?, 100, 0)"
    ).run(m.name, m.desc, catMiniSalgadinhos, m.price, BOOTSTRAP_COMPANY_ID, ts);
  }

  // NOVIDADE (1)
  db.prepare(
    "INSERT OR IGNORE INTO products (name, description, category_id, sale_price_cents, image_url, active, company_id, created_at, stock, min_stock) VALUES (?, ?, ?, ?, '', 1, ?, ?, 100, 0)"
  ).run(
    "PARMEGIANA DE FILÉ DE FRANGO EMPANADA",
    "Filé de frango empanado, coberto com queijo/molho, acompanhado de arroz e batata. Serve 2 pessoas.",
    catNovidades,
    6499,
    BOOTSTRAP_COMPANY_ID,
    ts
  );

  // ========== COMBOS (5) ==========
  const combos = [
    { 
      name: "COMBO HULK FAMÍLIA", 
      desc: "1 Burguer Kids + 1 Burguer Eggs + 1 Burguer Toscana + 1 Burguer Costela + 1 Burguer Bacon + Batata frita 500g + 20 mini salgadinhos mistos de coxinha e bolinha de queijo + 1 Kuat 2 litros", 
      price: 17699 
    },
    { 
      name: "COMBO HULK", 
      desc: "1 Burguer Costela + 1 Burguer Bacon + 1 Burguer Toscana + Batata frita 500g + Porção mista de coxinha e bolinha de queijo", 
      price: 11499 
    },
    { 
      name: "COMBO BRUCE", 
      desc: "1 Burguer Costela + 1 Burguer Bacon + Batata frita 500g + Porção mista de coxinha e bolinha de queijo", 
      price: 9199 
    },
    { 
      name: "COMBO BENNER", 
      desc: "2 Burguer Kids + Batata frita 300g + Porção mista de coxinha e bolinha de queijo + 2 Guaravitas", 
      price: 6499 
    },
    { 
      name: "COMBO STARK", 
      desc: "1 Burguer Provoleta + Batata frita 300g + Porção mista de coxinha e bolinha de queijo", 
      price: 4499 
    },
  ];

  // Helper para obter product_id
  const getProductId = (name: string): number | undefined => {
    const row = db.prepare("SELECT id FROM products WHERE name = ? AND company_id = ?").get(name, BOOTSTRAP_COMPANY_ID) as { id: number } | undefined;
    return row?.id;
  };

  for (const c of combos) {
    const existingCombo = db.prepare("SELECT id FROM combos WHERE name = ? AND company_id = ?").get(c.name, BOOTSTRAP_COMPANY_ID);
    if (!existingCombo) {
      const info = db.prepare(
        "INSERT INTO combos (name, description, sale_price_cents, active, company_id, created_at) VALUES (?, ?, ?, 1, ?, ?)"
      ).run(c.name, c.desc, c.price, BOOTSTRAP_COMPANY_ID, ts);
      const comboId = Number(info.lastInsertRowid);
      
      // Definir itens do combo baseando-se nos nomes dos produtos
      const comboItems: { productName: string; qty: number }[] = [];
      
      switch (c.name) {
        case "COMBO HULK FAMÍLIA":
          comboItems.push(
            { productName: "BURGUER KIDS 1", qty: 1 },
            { productName: "BURGUER EGGS", qty: 1 },
            { productName: "BURGUER TOSCANA", qty: 1 },
            { productName: "BURGUER COSTELA BOVINA", qty: 1 },
            { productName: "BURGUER BACON", qty: 1 },
            { productName: "BATATA RECHEADA 500G", qty: 1 }, // Batata frita 500g
            { productName: "100 MINI SALGADOS", qty: 1 }, // 20 mini salgadinhos - usar o centão como referência
            { productName: "GUARANÁ ANTÁRTICA 2L", qty: 1 }, // Kuat 2 litros - usar Guaraná 2L como proxy
          );
          break;
        case "COMBO HULK":
          comboItems.push(
            { productName: "BURGUER COSTELA BOVINA", qty: 1 },
            { productName: "BURGUER BACON", qty: 1 },
            { productName: "BURGUER TOSCANA", qty: 1 },
            { productName: "BATATA RECHEADA 500G", qty: 1 }, // Batata frita 500g
            { productName: "PORÇÃO M — 550ml", qty: 1 }, // Porção mista - usar porção M como proxy
          );
          break;
        case "COMBO BRUCE":
          comboItems.push(
            { productName: "BURGUER COSTELA BOVINA", qty: 1 },
            { productName: "BURGUER BACON", qty: 1 },
            { productName: "BATATA RECHEADA 500G", qty: 1 },
            { productName: "PORÇÃO M — 550ml", qty: 1 },
          );
          break;
        case "COMBO BENNER":
          comboItems.push(
            { productName: "BURGUER KIDS 1", qty: 2 },
            { productName: "BATATA SIMPLES 300G", qty: 1 },
            { productName: "PORÇÃO M — 550ml", qty: 1 },
            { productName: "GUARAVITA", qty: 2 },
          );
          break;
        case "COMBO STARK":
          comboItems.push(
            { productName: "BURGUER PROVOLETA", qty: 1 },
            { productName: "BATATA SIMPLES 300G", qty: 1 },
            { productName: "PORÇÃO M — 550ml", qty: 1 },
          );
          break;
      }
      
      for (const item of comboItems) {
        const productId = getProductId(item.productName);
        if (productId) {
          db.prepare(
            "INSERT INTO combo_items (combo_id, product_id, quantity, company_id, created_at) VALUES (?, ?, ?, ?, ?)"
          ).run(comboId, productId, item.qty, BOOTSTRAP_COMPANY_ID, ts);
        } else {
          console.warn(`[seed] Produto não encontrado para combo ${c.name}: ${item.productName}`);
        }
      }
    }
  }

  console.log("✔ Seed completo executado para Bruce Burguer (categorias, produtos, adicionais, combos)");
}

export function migrateSchema(): void {
  // Migration simplificada: schema novo criado por initSchema() (CREATE TABLE IF NOT EXISTS).
  // Bancos existentes recebem colunas novas de forma idempotente (ALTER TABLE guiado por PRAGMA).
  ensureBootstrapCompany();
  ensurePresencialColumns();
  ensureStockColumns();
  ensureTenantIndexes();
  db.pragma("foreign_keys = ON");
}

function tableColumnNames(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function addColumnIfMissing(table: string, column: string, ddl: string): void {
  if (tableColumnNames(table).some((c) => c === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// FASE 3A — Vendas presenciais: ordens ganham origem, responsável (funcionário),
// cliente opcional (Fase 5), desconto, pagamento e conclusão; itens ganham combo_id.
function ensurePresencialColumns(): void {
  addColumnIfMissing("orders", "source", "source TEXT NOT NULL DEFAULT 'online'");
  addColumnIfMissing("orders", "delivery_type", "delivery_type TEXT NOT NULL DEFAULT 'entrega'");
  addColumnIfMissing("orders", "user_id", "user_id INTEGER");
  addColumnIfMissing("orders", "customer_id", "customer_id INTEGER");
  addColumnIfMissing("orders", "discount_cents", "discount_cents INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("orders", "paid_at", "paid_at TEXT");
  addColumnIfMissing("orders", "completed_at", "completed_at TEXT");
  addColumnIfMissing("order_items", "combo_id", "combo_id INTEGER");
}

// FASE 4B — Estoque por produto: produtos ganham estoque, estoque mínimo e
// histórico de movimentações (stock_movements).
function ensureStockColumns(): void {
  addColumnIfMissing("products", "stock", "stock INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("products", "min_stock", "min_stock INTEGER NOT NULL DEFAULT 0");
}

export function ensureVariationBarcodes(opts?: { productId?: number; companyId?: number }): number {
  // Tabela product_variations removida; retornar 0.
  return 0;
}

function ensureTenantIndexes(): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
    CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug);
    CREATE INDEX IF NOT EXISTS idx_categories_company ON categories(company_id);
    CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_addons_company ON addons(company_id);
    CREATE INDEX IF NOT EXISTS idx_product_addons_product ON product_addons(product_id);
    CREATE INDEX IF NOT EXISTS idx_product_addons_addon ON product_addons(addon_id);
    CREATE INDEX IF NOT EXISTS idx_combos_company ON combos(company_id);
    CREATE INDEX IF NOT EXISTS idx_combo_items_combo ON combo_items(combo_id);
    CREATE INDEX IF NOT EXISTS idx_combo_items_product ON combo_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_areas_company ON delivery_areas(company_id);
    CREATE INDEX IF NOT EXISTS idx_orders_company ON orders(company_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_combo ON order_items(combo_id);
    CREATE INDEX IF NOT EXISTS idx_order_item_addons_order ON order_item_addons(order_item_id);
    CREATE INDEX IF NOT EXISTS idx_order_item_addons_addon ON order_item_addons(addon_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_company_product ON stock_movements(company_id, product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements(reference_type, reference_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_company_created ON stock_movements(company_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_business_settings_company ON business_settings(company_id);
  `);
}