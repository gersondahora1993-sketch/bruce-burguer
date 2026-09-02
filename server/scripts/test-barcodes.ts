import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { code128Bits, code128Svg } from "../../web/src/lib/barcode128.js";

type ApiResponse = { status: number; data: any };

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");

let checks = 0;
function pass(condition: boolean, label: string): void {
  assert.equal(condition, true, label);
  checks += 1;
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return port;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(base: string, method: string, route: string, body?: unknown, token?: string): Promise<ApiResponse> {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    // Keep non-JSON error bodies out of the test output.
  }
  return { status: response.status, data };
}

function onboardingBody(slug: string, email: string, planId: number) {
  return {
    company: { name: `Barcodes ${slug}`, slug, cnpj: "", phone: "11999990000" },
    admin: { name: "Administrador Barcodes", email, password: "barcode123" },
    plan_id: planId,
  };
}

function mutateDatabase(dbPath: string, sql: string, ...params: unknown[]): void {
  const db = new Database(dbPath);
  db.prepare(sql).run(...params);
  db.close();
}

function readDatabase(dbPath: string, sql: string, ...params: unknown[]): any[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = db.prepare(sql).all(...params);
  db.close();
  return rows;
}

function createCatalogFixture(dbPath: string, companyId: number, suffix: string) {
  const db = new Database(dbPath);
  const category = Number(db.prepare("INSERT INTO categories (name, company_id) VALUES (?, ?)").run(`Categoria ${suffix}`, companyId).lastInsertRowid);
  const color = Number(db.prepare("INSERT INTO colors (name, hex, company_id) VALUES (?, ?, ?)").run(`Cor ${suffix}`, "#123456", companyId).lastInsertRowid);
  const size = Number(db.prepare("INSERT INTO sizes (name, sort_order, company_id) VALUES (?, 1, ?)").run(`Tamanho ${suffix}`, companyId).lastInsertRowid);
  const size2 = Number(db.prepare("INSERT INTO sizes (name, sort_order, company_id) VALUES (?, 2, ?)").run(`Tamanho ${suffix} 2`, companyId).lastInsertRowid);
  db.close();
  return { category, color, size, size2 };
}

async function stopProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"]);
      killer.once("close", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }
  child.kill("SIGTERM");
  await wait(300);
}

function digitsOf(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nyellen-barcodes-test-"));
  const dbPath = path.join(tempDir, "barcodes-test.db");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const testSecret = "barcodes-test-secret-only-not-production-123456";
  const tsx = path.join(serverRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsx, "src/index.ts"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DB_INIT: "schema",
      DB_PATH: dbPath,
      LEGACY_COMPANY_ID: "1",
      PUBLIC_COMPANY_ID: "1",
      PORT: String(port),
      HOST: "127.0.0.1",
      JWT_SECRET: testSecret,
    },
    stdio: "ignore",
  });

  const summary = {
    products: 0,
    variations: 0,
    barcodes: 0,
    barcodes_unique: 0,
    idempotent: true,
    regenerated: 0,
    salesByCode: 0,
    stockBeforePrint: 0,
    stockAfterPrint: 0,
    movementsBeforeOps: 0,
    movementsAfterOps: 0,
  };

  try {
    let healthy = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const health = await request(base, "GET", "/api/health");
        if (health.status === 200 && health.data?.ok) {
          healthy = true;
          break;
        }
      } catch {
        // The child may still be starting.
      }
      await wait(500);
    }
    assert.equal(healthy, true, "API não iniciou no banco temporário");

    const plans = await request(base, "GET", "/api/onboarding/plans");
    assert.equal(plans.status, 200);
    assert.ok(Array.isArray(plans.data) && plans.data.length === 1);
    const plan = plans.data[0];

    const alpha = await request(base, "POST", "/api/onboarding", onboardingBody("bars-alpha", "alpha.barcodes@example.test", plan.id));
    const beta = await request(base, "POST", "/api/onboarding", onboardingBody("bars-beta", "beta.barcodes@example.test", plan.id));
    assert.equal(alpha.status, 201, JSON.stringify(alpha.data));
    assert.equal(beta.status, 201, JSON.stringify(beta.data));
    checks += 2;
    const alphaCompany = alpha.data.company.id as number;
    const betaCompany = beta.data.company.id as number;
    const alphaUser = alpha.data.user.id as number;

    const alphaLogin = await request(base, "POST", "/api/auth/login", { email: "alpha.barcodes@example.test", password: "barcode123" });
    const betaLogin = await request(base, "POST", "/api/auth/login", { email: "beta.barcodes@example.test", password: "barcode123" });
    assert.equal(alphaLogin.status, 200);
    assert.equal(betaLogin.status, 200);
    checks += 2;
    const alphaToken = alphaLogin.data.token as string;
    const betaToken = betaLogin.data.token as string;

    const catalogA = createCatalogFixture(dbPath, alphaCompany, "A");
    const catalogB = createCatalogFixture(dbPath, betaCompany, "B");

    // ---- 1. Criação de produtos gera códigos de barras automaticamente ----
    const dress = await request(base, "POST", "/api/products", {
      name: "Vestido Elegance",
      sku: "80",
      category_id: catalogA.category,
      cost_price_cents: 6500,
      sale_price_cents: 12990,
      variations: [
        { color_id: catalogA.color, size_id: catalogA.size, stock: 3, min_stock: 1 },
        { color_id: catalogA.color, size_id: catalogA.size2, stock: 2, min_stock: 1 },
      ],
    }, alphaToken);
    assert.equal(dress.status, 201, JSON.stringify(dress.data));
    checks += 1;

    const blouse = await request(base, "POST", "/api/products", {
      name: "Blusa Floral",
      sku: "85",
      category_id: catalogA.category,
      cost_price_cents: 4000,
      sale_price_cents: 8990,
      variations: [{ color_id: catalogA.color, size_id: catalogA.size, stock: 2, min_stock: 1 }],
    }, alphaToken);
    assert.equal(blouse.status, 201, JSON.stringify(blouse.data));
    checks += 1;

    const betaProduct = await request(base, "POST", "/api/products", {
      name: "Calça Beta",
      sku: "90",
      category_id: catalogB.category,
      cost_price_cents: 3000,
      sale_price_cents: 7000,
      variations: [{ color_id: catalogB.color, size_id: catalogB.size, stock: 5, min_stock: 1 }],
    }, betaToken);
    assert.equal(betaProduct.status, 201, JSON.stringify(betaProduct.data));
    checks += 1;

    // Produto sem variações deve ser recusado (nenhum produto órfão).
    const noVariations = await request(base, "POST", "/api/products", {
      name: "Sem Variações",
      sku: "99",
      category_id: catalogA.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      variations: [],
    }, alphaToken);
    assert.equal(noVariations.status, 400, JSON.stringify(noVariations.data));
    checks += 1;

    const dressDetail = await request(base, "GET", `/api/products/${dress.data.id}`, undefined, alphaToken);
    assert.equal(dressDetail.status, 200);
    checks += 1;
    assert.ok(Array.isArray(dressDetail.data.variations) && dressDetail.data.variations.length === 2);
    checks += 1;
    for (const v of dressDetail.data.variations) {
      assert.ok(typeof v.barcode === "string" && v.barcode.length >= 4, `variação sem código: ${JSON.stringify(v)}`);
    }
    checks += 1;
    const codesDress = dressDetail.data.variations.map((v: any) => v.barcode as string);
    const codesDressDigits = codesDress.map(digitsOf);

    // O código deve preservar o SKU (dígitos) como prefixo e ser determinístico por variação.
    for (let i = 0; i < codesDress.length; i++) {
      const varId = dressDetail.data.variations[i].id;
      const expected = `${digitsOf("80")}${String(varId).padStart(4, "0").slice(-4)}`;
      assert.equal(codesDress[i], expected, "padrão SKU + variação");
      assert.equal(codesDressDigits[i].startsWith(digitsOf("80") || "0"), true, "SKU preservado no código");
    }
    checks += 2;
    assert.equal(new Set(codesDressDigits).size, codesDressDigits.length, "códigos distintos por variação");
    checks += 1;

    const blouseDetail = await request(base, "GET", `/api/products/${blouse.data.id}`, undefined, alphaToken);
    const blouseCode = blouseDetail.data.variations[0].barcode as string;
    const betaProductDetail = await request(base, "GET", `/api/products/${betaProduct.data.id}`, undefined, betaToken);
    const betaCode = betaProductDetail.data.variations[0].barcode as string;

    const allCodes = [...codesDress, blouseCode, betaCode];
    assert.equal(new Set(allCodes).size, allCodes.length, "códigos únicos entre produtos e tenants");
    checks += 1;
    assert.notEqual(blouseCode, codesDress[0], "códigos de produtos diferentes não podem coincidir");
    assert.notEqual(betaCode, codesDress[0], "código de outro tenant não pode coincidir");
    checks += 2;

    // Determinismo: a mesma SKU + variação sempre gera o mesmo valor.
    const regen = await request(base, "POST", `/api/products/${dress.data.id}/barcodes`, undefined, alphaToken);
    assert.equal(regen.status, 200, JSON.stringify(regen.data));
    assert.equal(regen.data.generated, 0, "segunda geração deve ser no-op");
    const dressDetail2 = await request(base, "GET", `/api/products/${dress.data.id}`, undefined, alphaToken);
    const codesDress2 = dressDetail2.data.variations.map((v: any) => v.barcode as string);
    assert.deepEqual(codesDress2, codesDress, "códigos não mudam após geração repetida");
    checks += 2;
    summary.idempotent = regen.data.generated === 0 && JSON.stringify(codesDress2) === JSON.stringify(codesDress);

    // Código existente deve ser preservado (nunca substituído), mesmo com SKU diferente.
    const customCode = "CUSTOM123";
    mutateDatabase(dbPath, `UPDATE product_variations SET barcode = ? WHERE id = ?`, customCode, dressDetail.data.variations[0].id);
    const afterCustom = await request(base, "POST", `/api/products/${dress.data.id}/barcodes`, undefined, alphaToken);
    assert.equal(afterCustom.status, 200);
    const dressDetail3 = await request(base, "GET", `/api/products/${dress.data.id}`, undefined, alphaToken);
    const variationCustom = dressDetail3.data.variations.find((v: any) => v.id === dressDetail.data.variations[0].id);
    assert.equal(variationCustom.barcode, customCode, "código customizado não pode ser sobrescrito");
    checks += 2;
    mutateDatabase(dbPath, `UPDATE product_variations SET barcode = ? WHERE id = ?`, codesDress[0], dressDetail.data.variations[0].id);

    // ---- 2. Lookup por código ----
    const lookupFound = await request(base, "GET", `/api/products/lookup/${encodeURIComponent(codesDress[1])}`, undefined, alphaToken);
    assert.equal(lookupFound.status, 200, JSON.stringify(lookupFound.data));
    assert.equal(lookupFound.data.id, dress.data.id);
    assert.ok(lookupFound.data.variations.some((v: any) => v.barcode === codesDress[1]));
    checks += 2;

    const lookupDigitsNoise = await request(base, "GET", `/api/products/lookup/${encodeURIComponent(`>${codesDress[1]}<`)}`, undefined, alphaToken);
    assert.equal(lookupDigitsNoise.status, 200, "lookup deve tolerar caracteres extras (leitor <> prefixo)");
    assert.equal(lookupDigitsNoise.data.id, dress.data.id);
    checks += 2;

    const lookupUnknown = await request(base, "GET", "/api/products/lookup/999999999", undefined, alphaToken);
    assert.equal(lookupUnknown.status, 404);
    const lookupEmpty = await request(base, "GET", "/api/products/lookup/___", undefined, alphaToken);
    assert.equal(lookupEmpty.status, 400);
    checks += 2;

    // Isolamento entre tenants: código do tenant A invisível no tenant B.
    const lookupCross = await request(base, "GET", `/api/products/lookup/${encodeURIComponent(codesDress[1])}`, undefined, betaToken);
    assert.equal(lookupCross.status, 404, "código de outro tenant não pode ser resolvido");
    checks += 1;

    // ---- 3. Buscas por código (produtos e estoque) ----
    const searchProducts = await request(base, "GET", `/api/products?search=${encodeURIComponent(codesDress[1])}`, undefined, alphaToken);
    assert.equal(searchProducts.status, 200);
    assert.ok(searchProducts.data.some((p: any) => p.id === dress.data.id));
    checks += 1;

    const stockRows = await request(base, "GET", `/api/stock?search=${encodeURIComponent(codesDress[1])}`, undefined, alphaToken);
    assert.equal(stockRows.status, 200);
    assert.ok(stockRows.data.some((s: any) => s.id === dressDetail.data.variations[1].id && s.barcode === codesDress[1]));
    checks += 1;

    // ---- 4. Bulk generate (códigos em falta) ----
    const movementsBefore = Number(readDatabase(dbPath, "SELECT COUNT(*) AS c FROM stock_movements")[0].c);
    summary.movementsBeforeOps = movementsBefore;
    const bulkNoOp = await request(base, "POST", "/api/products/barcodes/generate", undefined, alphaToken);
    assert.equal(bulkNoOp.status, 200, JSON.stringify(bulkNoOp.data));
    assert.equal(bulkNoOp.data.generated, 0, "sem códigos em falta, nada deve ser gerado");
    checks += 1;

    mutateDatabase(dbPath, `UPDATE product_variations SET barcode = '' WHERE id = ?`, dressDetail.data.variations[1].id);
    const bulkRefresh = await request(base, "POST", "/api/products/barcodes/generate", undefined, alphaToken);
    assert.equal(bulkRefresh.status, 200);
    assert.equal(bulkRefresh.data.generated, 1, "código em falta deve ser regenerado");
    const dressDetail4 = await request(base, "GET", `/api/products/${dress.data.id}`, undefined, alphaToken);
    const regenerated = dressDetail4.data.variations.find((v: any) => v.id === dressDetail.data.variations[1].id).barcode as string;
    assert.equal(regenerated, codesDress[1], "regeneração deve ser determinística (mesmo valor)");
    checks += 2;
    summary.regenerated = bulkRefresh.data.generated;

    const movementsAfterGenerate = Number(readDatabase(dbPath, "SELECT COUNT(*) AS c FROM stock_movements")[0].c);
    assert.equal(movementsAfterGenerate, movementsBefore, "gerar códigos não pode mover estoque");
    checks += 1;

    // ---- 5. "Impressão" não altera estoque (somente leitura) ----
    const stockBefore = Number(readDatabase(dbPath, "SELECT stock FROM product_variations WHERE id = ?", dressDetail.data.variations[0].id)[0].stock);
    summary.stockBeforePrint = stockBefore;
    await request(base, "GET", "/api/products", undefined, alphaToken);
    await request(base, "GET", `/api/products/lookup/${encodeURIComponent(codesDress[0])}`, undefined, alphaToken);
    await request(base, "GET", "/api/stock", undefined, alphaToken);
    await request(base, "GET", `/api/products/${dress.data.id}`, undefined, alphaToken);
    const stockAfter = Number(readDatabase(dbPath, "SELECT stock FROM product_variations WHERE id = ?", dressDetail.data.variations[0].id)[0].stock);
    summary.stockAfterPrint = stockAfter;
    assert.equal(stockAfter, stockBefore, "leitura/listagem/lookup não podem alterar estoque (impressão = apenas leitura)");
    checks += 1;
    const movementsAfterRead = Number(readDatabase(dbPath, "SELECT COUNT(*) AS c FROM stock_movements")[0].c);
    summary.movementsAfterOps = movementsAfterRead;
    assert.equal(movementsAfterRead, movementsBefore, "nenhuma operação de leitura pode criar movimentação de estoque");
    checks += 1;

    // ---- 6. Venda pelo código lido (fluxo do leitor) ----
    // Sem caixa aberto, a venda deve falhar (lógica de caixa preservada).
    const saleWithoutCash = await request(base, "POST", "/api/sales", {
      payment_method: "pix",
      items: [{ variation_id: dressDetail.data.variations[1].id, quantity: 1 }],
    }, alphaToken);
    assert.equal(saleWithoutCash.status, 400);
    assert.ok(String(saleWithoutCash.data?.error ?? "").includes("caixa"));
    checks += 1;

    const openCash = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, alphaToken);
    assert.equal(openCash.status, 201, JSON.stringify(openCash.data));
    checks += 1;

    const saleByCode = await request(base, "POST", "/api/sales", {
      payment_method: "pix",
      items: [{ variation_id: dressDetail.data.variations[1].id, quantity: 2 }],
    }, alphaToken);
    assert.equal(saleByCode.status, 201, JSON.stringify(saleByCode.data));
    assert.ok(saleByCode.data.saleId > 0);
    const saleTotal = saleByCode.data.total_cents;
    assert.equal(saleTotal, 12990 * 2, "preço da etiqueta aplicado à venda por código");
    checks += 2;
    summary.salesByCode += 1;

    const afterSaleStock = Number(readDatabase(dbPath, "SELECT stock FROM product_variations WHERE id = ?", dressDetail.data.variations[1].id)[0].stock);
    assert.equal(afterSaleStock, 0, "estoque baixado após venda por código");
    checks += 1;

    const saleOutOfStock = await request(base, "POST", "/api/sales", {
      payment_method: "pix",
      items: [{ variation_id: dressDetail.data.variations[1].id, quantity: 1 }],
    }, alphaToken);
    assert.equal(saleOutOfStock.status, 400);
    assert.ok(String(saleOutOfStock.data?.error ?? "").includes("disponível"));
    checks += 1;

    // Venda com variação de outro tenant via código de barras não pode acontecer.
    const saleCrossTenant = await request(base, "POST", "/api/sales", {
      payment_method: "pix",
      items: [{ variation_id: betaProductDetail.data.variations[0].id, quantity: 1 }],
    }, alphaToken);
    assert.equal(saleCrossTenant.status, 400);
    assert.ok(
      String(saleCrossTenant.data?.error ?? "").includes("não encontrado") ||
        String(saleCrossTenant.data?.error ?? "").includes("outra empresa"),
      `erro esperado de variação inválida: ${saleCrossTenant.data?.error}`
    );
    checks += 1;

    // ---- 7. Encoder Code 128 do frontend: válido e lê de volta ----
    for (const code of allCodes) {
      const bits = code128Bits(code);
      assert.ok(bits.length > 20, `code128 vazio para ${code}`);
      assert.equal(bits.endsWith("1100011101011"), true, `stop pattern ausente em ${code}`);
      const svg = code128Svg(code, { moduleWidth: 2, height: 40 });
      assert.ok(svg.startsWith("<svg"), `svg inválido para ${code}`);
      assert.ok(svg.includes(code), `svg sem human-readable para ${code}`);
      checks += 1;
    }

    // ---- 8. Dados existentes preservados ----
    mutateDatabase(
      dbPath,
      `INSERT INTO users (name, email, password_hash, role, active, company_id) VALUES (?, ?, ?, 'vendedora', 1, ?)`,
      "Colaboradora Bar", "colaboradora.bar@example.test", "hash-teste", alphaCompany
    );
    const beforeRows = {
      products: Number(readDatabase(dbPath, "SELECT COUNT(*) AS c FROM products")[0].c),
      customers: Number(readDatabase(dbPath, "SELECT COUNT(*) AS c FROM customers")[0].c),
      users: Number(readDatabase(dbPath, "SELECT COUNT(*) AS c FROM users")[0].c),
      companies: Number(readDatabase(dbPath, "SELECT COUNT(*) AS c FROM companies")[0].c),
    };
    // Operações de código de barras não criam clientes/usuários/empresas.
    await request(base, "POST", `/api/products/${dress.data.id}/barcodes`, undefined, alphaToken);
    await request(base, "POST", "/api/products/barcodes/generate", undefined, alphaToken);
    const afterRows = {
      products: Number(readDatabase(dbPath, "SELECT COUNT(*) AS c FROM products")[0].c),
      customers: Number(readDatabase(dbPath, "SELECT COUNT(*) AS c FROM customers")[0].c),
      users: Number(readDatabase(dbPath, "SELECT COUNT(*) AS c FROM users")[0].c),
      companies: Number(readDatabase(dbPath, "SELECT COUNT(*) AS c FROM companies")[0].c),
    };
    assert.deepEqual(afterRows, beforeRows, "geração idempotente não altera contagens de registros");
    checks += 1;

    const alphaUsers = readDatabase(dbPath, "SELECT id, email, role, active FROM users WHERE company_id = ?", alphaCompany);
    assert.ok(alphaUsers.every((u: any) => u.email.endsWith("@example.test")));
    assert.ok(alphaUsers.some((u: any) => u.id === alphaUser));
    checks += 1;

    const integrity = readDatabase(dbPath, "PRAGMA integrity_check")[0].integrity_check as string;
    const fkViolations = readDatabase(dbPath, "PRAGMA foreign_key_check").length;
    summary.products = beforeRows.products;
    summary.variations = allCodes.length;
    summary.barcodes = allCodes.length;
    summary.barcodes_unique = new Set(allCodes).size;

    console.log(
      JSON.stringify({
        status: "PASS",
        checks,
        integrity,
        foreign_keys: fkViolations,
        ...summary,
      })
    );
  } finally {
    await stopProcess(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});