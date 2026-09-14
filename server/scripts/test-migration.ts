import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

type ApiResponse = { status: number; data: any };

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const testSecret = "migration-test-secret-only-not-production-123456";

function sqlite(dbPath: string) {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

async function runCmd(args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: serverRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("close", (code) => resolve({ code, out, err }));
    child.on("error", (e) => resolve({ code: null, out, err: String(e) }));
  });
}

const tsx = path.join(serverRoot, "node_modules", "tsx", "dist", "cli.mjs");

function migrateEnv(dbPath: string, extra: Record<string, string> = {}) {
  return {
    NODE_ENV: "test",
    DB_INIT: "schema",
    DB_PATH: dbPath,
    JWT_SECRET: testSecret,
    ...extra,
  };
}

function buildLegacyDb(dbPath: string, withCatalog: boolean) {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      cnpj TEXT,
      status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','suspenso','cancelado')),
      trial_start TEXT,
      trial_end TEXT,
      plan TEXT NOT NULL DEFAULT 'basico',
      plan_price_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO companies (id, name, slug) VALUES (1, 'Bruce Burguer', 'bruce-burguer');
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE colors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hex TEXT NOT NULL DEFAULT '#e5e7eb',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE sizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      category_id INTEGER REFERENCES categories(id),
      cost_price_cents INTEGER NOT NULL DEFAULT 0,
      sale_price_cents INTEGER NOT NULL DEFAULT 0,
      image_url TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE product_variations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      color_id INTEGER NOT NULL REFERENCES colors(id),
      size_id INTEGER NOT NULL REFERENCES sizes(id),
      stock INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  if (withCatalog) {
    db.prepare("INSERT INTO categories (id, name) VALUES (10, 'Vestidos'), (11, 'Blusas')").run();
    db.prepare("INSERT INTO colors (id, name, hex) VALUES (20, 'Preto', '#111111'), (21, 'Branco', '#ffffff')").run();
    db.prepare("INSERT INTO sizes (id, name, sort_order) VALUES (30, 'P', 1), (31, 'M', 2)").run();
    db.prepare("INSERT INTO products (id, name, sku, category_id, cost_price_cents, sale_price_cents, active) VALUES (100, 'Vestido Legado', 'LEG-001', 10, 6500, 12990, 1)").run();
    db.prepare(
      "INSERT INTO product_variations (id, product_id, color_id, size_id, stock, min_stock) VALUES (200, 100, 20, 30, 5, 1), (201, 100, 21, 31, 3, 1)"
    ).run();
  }
  db.close();
}

function count(dbPath: string, table: string): number {
  const db = sqlite(dbPath);
  try {
    return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
  } finally {
    db.close();
  }
}

function ids(dbPath: string, table: string): number[] {
  const db = sqlite(dbPath);
  try {
    return (db.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as { id: number }[]).map((r) => r.id);
  } finally {
    db.close();
  }
}

function rows(dbPath: string, sql: string, ...params: unknown[]): any[] {
  const db = sqlite(dbPath);
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

function integrity(dbPath: string): string {
  const db = sqlite(dbPath);
  try {
    return db.pragma("integrity_check", { simple: true });
  } finally {
    db.close();
  }
}

function foreignKeyViolations(dbPath: string): number {
  const db = sqlite(dbPath);
  try {
    return db.pragma("foreign_key_check").length;
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bruce-burger-migration-test-"));
  try {
    let checks = 0;
    const pass = (condition: unknown, message: string) => {
      checks += 1;
      assert.ok(condition, message);
    };

    // TESTE 1 — Migração legada com LEGACY_COMPANY_ID=1
    const legacy = path.join(tempDir, "legacy.db");
    buildLegacyDb(legacy, true);
    const first = await runCmd([tsx, "scripts/migrate-runner.ts"], migrateEnv(legacy, { LEGACY_COMPANY_ID: "1" }));
    pass(first.code === 0, `migração legada deveria passar; stdout=${first.out} stderr=${first.err}`);
    pass(first.out.includes("MIGRATION_OK"), "runner deveria reportar sucesso");
    assert.deepEqual(ids(legacy, "categories"), [10, 11]);
    assert.deepEqual(ids(legacy, "colors"), [20, 21]);
    assert.deepEqual(ids(legacy, "sizes"), [30, 31]);
    checks += 3;
    pass(
      rows(legacy, "SELECT COUNT(*) AS c FROM categories WHERE company_id = 1")[0].c === 2 &&
        rows(legacy, "SELECT COUNT(*) AS c FROM colors WHERE company_id = 1")[0].c === 2 &&
        rows(legacy, "SELECT COUNT(*) AS c FROM sizes WHERE company_id = 1")[0].c === 2,
      "todos os catálogos legados deveriam ter company_id = 1"
    );
    checks += 1;
    assert.deepEqual(rows(legacy, "SELECT id, name FROM categories ORDER BY id").map((r) => r.name), ["Vestidos", "Blusas"]);
    assert.deepEqual(rows(legacy, "SELECT id, name FROM colors ORDER BY id").map((r) => r.name), ["Preto", "Branco"]);
    assert.deepEqual(rows(legacy, "SELECT id, name FROM sizes ORDER BY id").map((r) => r.name), ["P", "M"]);
    checks += 3;
    const productLinks = rows(legacy, "SELECT id, category_id, company_id FROM products ORDER BY id");
    assert.deepEqual(productLinks, [{ id: 100, category_id: 10, company_id: 1 }]);
    const variationLinks = rows(legacy, "SELECT id, product_id, color_id, size_id, company_id FROM product_variations ORDER BY id");
    assert.deepEqual(variationLinks, [
      { id: 200, product_id: 100, color_id: 20, size_id: 30, company_id: 1 },
      { id: 201, product_id: 100, color_id: 21, size_id: 31, company_id: 1 },
    ]);
    checks += 2;
    assert.equal(count(legacy, "categories"), 2);
    assert.equal(count(legacy, "colors"), 2);
    assert.equal(count(legacy, "sizes"), 2);
    assert.equal(count(legacy, "products"), 1);
    assert.equal(count(legacy, "product_variations"), 2);
    checks += 5;
    pass(integrity(legacy) === "ok", "integrity legada deveria ser ok");
    pass(foreignKeyViolations(legacy) === 0, "foreign_key legada deveria ser 0");
    checks += 2;

    // TESTE 2 — Migração repetida (idempotência)
    const beforeRepeat = {
      categories: count(legacy, "categories"),
      colors: count(legacy, "colors"),
      sizes: count(legacy, "sizes"),
      products: count(legacy, "products"),
      variations: count(legacy, "product_variations"),
    };
    const second = await runCmd([tsx, "scripts/migrate-runner.ts"], migrateEnv(legacy, { LEGACY_COMPANY_ID: "1" }));
    pass(second.code === 0, `repetição da migração deveria passar; stderr=${second.err}`);
    assert.equal(count(legacy, "categories"), beforeRepeat.categories);
    assert.equal(count(legacy, "colors"), beforeRepeat.colors);
    assert.equal(count(legacy, "sizes"), beforeRepeat.sizes);
    assert.equal(count(legacy, "products"), beforeRepeat.products);
    assert.equal(count(legacy, "product_variations"), beforeRepeat.variations);
    assert.deepEqual(ids(legacy, "categories"), [10, 11]);
    checks += 6;

    // TESTE 9 — Preservação explícita dos IDs
    assert.deepEqual(ids(legacy, "categories"), [10, 11]);
    assert.deepEqual(ids(legacy, "colors"), [20, 21]);
    assert.deepEqual(ids(legacy, "sizes"), [30, 31]);
    assert.deepEqual(ids(legacy, "products"), [100]);
    assert.deepEqual(ids(legacy, "product_variations"), [200, 201]);
    checks += 5;

    // TESTE 3 — LEGACY_COMPANY_ID ausente (banco legado com catálogo)
    const noLegacy = path.join(tempDir, "no-legacy.db");
    buildLegacyDb(noLegacy, true);
    const missing = await runCmd([tsx, "scripts/migrate-runner.ts"], migrateEnv(noLegacy));
    pass(missing.code !== 0, "migração sem LEGACY_COMPANY_ID deveria falhar");
    pass(missing.err.includes("LEGACY_COMPANY_ID"), `mensagem deveria citar LEGACY_COMPANY_ID; stderr=${missing.err}`);
    const catNoLegacy = rows(noLegacy, "SELECT id FROM categories ORDER BY id").map((r) => r.id);
    assert.deepEqual(catNoLegacy, [10, 11]);
    checks += 3;
    pass(integrity(noLegacy) === "ok", "banco sem LEGACY_COMPANY_ID deveria preservar integridade");
    pass(foreignKeyViolations(noLegacy) === 0, "banco sem LEGACY_COMPANY_ID deveria ter foreign_key 0");
    checks += 2;

    // TESTE 4 — LEGACY_COMPANY_ID inválido (empresa inexistente)
    const invalid = path.join(tempDir, "invalid.db");
    buildLegacyDb(invalid, true);
    const invalidRun = await runCmd([tsx, "scripts/migrate-runner.ts"], migrateEnv(invalid, { LEGACY_COMPANY_ID: "999" }));
    pass(invalidRun.code !== 0, "LEGACY_COMPANY_ID inexistente deveria falhar");
    pass(invalidRun.err.includes("não corresponde a uma empresa existente"), `mensagem deveria indicar empresa inexistente; stderr=${invalidRun.err}`);
    assert.deepEqual(ids(invalid, "categories"), [10, 11]);
    checks += 3;
    pass(integrity(invalid) === "ok", "banco com LEGACY inválido deveria preservar integridade");
    pass(foreignKeyViolations(invalid) === 0, "banco com LEGACY inválido deveria ter foreign_key 0");
    checks += 2;

    // TESTE 5 — Seed idempotente
    const seedDb = path.join(tempDir, "seed.db");
    const seedEnv = { NODE_ENV: "test", DB_INIT: "demo", DB_PATH: seedDb, JWT_SECRET: testSecret };
    const seedOne = await runCmd([tsx, "scripts/init-db.ts", "--demo"], seedEnv);
    pass(seedOne.code === 0, `primeiro seed deveria passar; stderr=${seedOne.err}`);
    const seedTwo = await runCmd([tsx, "scripts/init-db.ts", "--demo"], seedEnv);
    pass(seedTwo.code === 0, `segundo seed deveria passar; stderr=${seedTwo.err}`);
    checks += 2;
    assert.equal(count(seedDb, "companies"), 1);
    assert.equal(count(seedDb, "users"), 4);
    assert.equal(count(seedDb, "plans"), 1);
    assert.equal(count(seedDb, "categories"), 9);
    assert.equal(count(seedDb, "colors"), 10);
    assert.equal(count(seedDb, "sizes"), 13);
    assert.equal(count(seedDb, "products"), 7);
    assert.equal(count(seedDb, "product_variations"), 46);
    checks += 8;
    pass(
      rows(seedDb, "SELECT COUNT(*) AS c FROM categories WHERE company_id != 1")[0].c === 0 &&
        rows(seedDb, "SELECT COUNT(*) AS c FROM colors WHERE company_id != 1")[0].c === 0 &&
        rows(seedDb, "SELECT COUNT(*) AS c FROM sizes WHERE company_id != 1")[0].c === 0 &&
        rows(seedDb, "SELECT COUNT(*) AS c FROM products WHERE company_id != 1")[0].c === 0 &&
        rows(seedDb, "SELECT COUNT(*) AS c FROM product_variations WHERE company_id != 1")[0].c === 0,
      "seed deveria criar tudo para company_id = 1"
    );
    checks += 1;
    const seedPlans = rows(seedDb, "SELECT code FROM plans");
    assert.deepEqual(seedPlans.map((r) => r.code), ["basico"]);
    checks += 1;

    // TESTE 6 — Dois tenants com nomes iguais + duplicidade no mesmo tenant
    const multi = path.join(tempDir, "multi.db");
    buildLegacyDb(multi, false);
    const multiRun = await runCmd([tsx, "scripts/migrate-runner.ts"], migrateEnv(multi, { LEGACY_COMPANY_ID: "1" }));
    pass(multiRun.code === 0, `migração base para teste multi-tenant deveria passar; stderr=${multiRun.err}`);
    checks += 1;
    {
      const db = new Database(multi);
      db.pragma("foreign_keys = ON");
      db.prepare("INSERT INTO companies (id, name, slug) VALUES (2, 'Tenant B', 'tenant-b')").run();
      const catA = Number(db.prepare("INSERT INTO categories (name, company_id) VALUES ('Camisas', 1)").run().lastInsertRowid);
      const catB = Number(db.prepare("INSERT INTO categories (name, company_id) VALUES ('Camisas', 2)").run().lastInsertRowid);
      const colorA = Number(db.prepare("INSERT INTO colors (name, hex, company_id) VALUES ('Preto', '#111111', 1)").run().lastInsertRowid);
      const colorB = Number(db.prepare("INSERT INTO colors (name, hex, company_id) VALUES ('Preto', '#111111', 2)").run().lastInsertRowid);
      const sizeA = Number(db.prepare("INSERT INTO sizes (name, sort_order, company_id) VALUES ('M', 1, 1)").run().lastInsertRowid);
      const sizeB = Number(db.prepare("INSERT INTO sizes (name, sort_order, company_id) VALUES ('M', 1, 2)").run().lastInsertRowid);
      assert.equal(catA === catB, false);
      assert.equal(colorA === colorB, false);
      assert.equal(sizeA === sizeB, false);
      checks += 3;
      assert.throws(() => db.prepare("INSERT INTO categories (name, company_id) VALUES ('Camisas', 1)").run());
      assert.throws(() => db.prepare("INSERT INTO colors (name, hex, company_id) VALUES ('Preto', '#111111', 1)").run());
      assert.throws(() => db.prepare("INSERT INTO sizes (name, sort_order, company_id) VALUES ('M', 1, 1)").run());
      checks += 3;
      assert.equal(foreignKeyViolations(multi), 0);
      checks += 1;
      db.close();
    }

    // TESTE 7 — Vínculos de produto por tenant (sem cruzamento)
    {
      const db = new Database(multi);
      db.pragma("foreign_keys = ON");
      const productA = Number(
        db
          .prepare("INSERT INTO products (name, sku, category_id, company_id) VALUES ('Camisa A', 'A-001', 1, 1)")
          .run().lastInsertRowid
      );
      const productB = Number(
        db
          .prepare("INSERT INTO products (name, sku, category_id, company_id) VALUES ('Camisa B', 'B-001', 2, 2)")
          .run().lastInsertRowid
      );
      db.prepare(
        "INSERT INTO product_variations (product_id, color_id, size_id, company_id) VALUES (?, ?, ?, ?)"
      ).run(productA, 1, 1, 1);
      db.prepare(
        "INSERT INTO product_variations (product_id, color_id, size_id, company_id) VALUES (?, ?, ?, ?)"
      ).run(productB, 2, 2, 2);
      db.close();
    }
    const crossLinks = rows(
      multi,
      `SELECT COUNT(*) AS c
       FROM product_variations pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.company_id != p.company_id`
    )[0].c;
    assert.equal(crossLinks, 0);
    checks += 1;
    pass(integrity(multi) === "ok", "banco multi-tenant deveria ter integrity ok");
    pass(foreignKeyViolations(multi) === 0, "banco multi-tenant deveria ter foreign_key 0");
    checks += 2;

    console.log(
      JSON.stringify({
        status: "PASS",
        checks,
        legacy_ok: true,
        legacy_repeat: true,
        legacy_missing: true,
        legacy_invalid: true,
        seed_idempotent: true,
        multi_tenant: true,
      })
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});