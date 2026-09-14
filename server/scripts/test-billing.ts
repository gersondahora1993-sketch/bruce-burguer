import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import jwt from "jsonwebtoken";

type ApiResponse = { status: number; data: any };

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");

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
    company: { name: `Billing ${slug}`, slug, cnpj: "", phone: "11999990000" },
    admin: { name: "Administrador Billing", email, password: "billing123" },
    plan_id: planId,
  };
}

function databaseSummary(dbPath: string) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  const summary = {
    companies: count("companies"),
    users: count("users"),
    subscriptions: count("subscriptions"),
    payments: count("payments"),
    billing_events: count("billing_events"),
    integrity: db.pragma("integrity_check", { simple: true }),
    foreign_keys: db.pragma("foreign_key_check").length,
  };
  db.close();
  return summary;
}

function mutateDatabase(dbPath: string, sql: string, ...params: unknown[]): void {
  const db = new Database(dbPath);
  db.prepare(sql).run(...params);
  db.close();
}

function createCatalogFixture(dbPath: string, companyId: number, suffix: string) {
  const db = new Database(dbPath);
  const category = Number(db.prepare("INSERT INTO categories (name, company_id) VALUES (?, ?)").run(`Categoria ${suffix}`, companyId).lastInsertRowid);
  const color = Number(db.prepare("INSERT INTO colors (name, hex, company_id) VALUES (?, ?, ?)").run(`Cor ${suffix}`, "#123456", companyId).lastInsertRowid);
  const size = Number(db.prepare("INSERT INTO sizes (name, sort_order, company_id) VALUES (?, 1, ?)").run(`Tamanho ${suffix}`, companyId).lastInsertRowid);
  db.close();
  return { category, color, size };
}

async function spawnCatalogApi(dbPath: string, publicCompanyId: number, testSecret: string) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(serverRoot, "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DB_INIT: "schema",
      DB_PATH: dbPath,
      LEGACY_COMPANY_ID: "1",
      PUBLIC_COMPANY_ID: String(publicCompanyId),
      PORT: String(port),
      HOST: "127.0.0.1",
      JWT_SECRET: testSecret,
    },
    stdio: "ignore",
  });
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
  assert.equal(healthy, true, "API de catálogo público não iniciou no banco temporário");
  return { child, base };
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

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bruce-burger-billing-test-"));
  const dbPath = path.join(tempDir, "billing-test.db");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const testSecret = "billing-test-secret-only-not-production-123456";
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
  let closeDatabase: (() => void) | null = null;

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
    assert.equal(healthy, true, "API de billing não iniciou no banco temporário");

    const plans = await request(base, "GET", "/api/onboarding/plans");
    assert.equal(plans.status, 200);
    assert.ok(Array.isArray(plans.data) && plans.data.length === 1);
    const plan = plans.data[0];

    const db = new Database(dbPath);
    assert.throws(() => db.prepare("INSERT INTO plans (code, name, amount_cents) VALUES (?, ?, ?)").run(plan.code, "Duplicado", 1));
    assert.throws(() => db.prepare("INSERT INTO plans (code, name, amount_cents) VALUES (?, ?, ?)").run("negative", "Negativo", -1));
    const inactivePlan = db
      .prepare("INSERT INTO plans (code, name, amount_cents, active) VALUES (?, ?, ?, 0)")
      .run("inactive-test", "Plano inativo", 1000).lastInsertRowid as number;
    db.close();

    const beforeInvalidPlan = databaseSummary(dbPath);
    const inactive = await request(base, "POST", "/api/onboarding", onboardingBody("inactive", "inactive@example.test", Number(inactivePlan)));
    assert.equal(inactive.status, 400);
    assert.deepEqual(databaseSummary(dbPath), beforeInvalidPlan);

    const first = await request(base, "POST", "/api/onboarding", onboardingBody("billing-alpha", "alpha@example.test", plan.id));
    assert.equal(first.status, 201);
    assert.equal(first.data.subscription.status, "trialing");
    assert.equal("password_hash" in first.data, false);
    assert.equal("trial_ends_at" in first.data, false);
    const trialStart = Date.parse(first.data.subscription.trial_ends_at);
    assert.ok(Number.isFinite(trialStart));
    const trialDays = Math.round((trialStart - Date.now()) / (24 * 60 * 60 * 1000));
    assert.ok(trialDays >= 29 && trialDays <= 30);

    const beforeDuplicate = databaseSummary(dbPath);
    const duplicateEmail = await request(base, "POST", "/api/onboarding", onboardingBody("billing-beta", "alpha@example.test", plan.id));
    assert.equal(duplicateEmail.status, 409);
    assert.deepEqual(databaseSummary(dbPath), beforeDuplicate);
    const duplicateSlug = await request(base, "POST", "/api/onboarding", onboardingBody("billing-alpha", "beta@example.test", plan.id));
    assert.equal(duplicateSlug.status, 409);
    assert.deepEqual(databaseSummary(dbPath), beforeDuplicate);
    const forbidden = await request(base, "POST", "/api/onboarding", {
      ...onboardingBody("billing-forbidden", "forbidden@example.test", plan.id),
      company_id: 999,
      status: "active",
      amount_cents: 1,
    });
    assert.equal(forbidden.status, 400);
    assert.deepEqual(databaseSummary(dbPath), beforeDuplicate);

    const second = await request(base, "POST", "/api/onboarding", onboardingBody("billing-beta", "beta@example.test", plan.id));
    assert.equal(second.status, 201);
    assert.equal(second.data.subscription.status, "trialing");

    const catalogA = createCatalogFixture(dbPath, first.data.company.id, "A");
    const catalogB = createCatalogFixture(dbPath, second.data.company.id, "B");

    const alphaLogin = await request(base, "POST", "/api/auth/login", { email: "alpha@example.test", password: "billing123" });
    const betaLogin = await request(base, "POST", "/api/auth/login", { email: "beta@example.test", password: "billing123" });
    assert.equal(alphaLogin.status, 200);
    assert.equal(betaLogin.status, 200);
    const alphaToken = alphaLogin.data.token as string;
    const betaToken = betaLogin.data.token as string;

    const alphaCategories = await request(base, "GET", "/api/categories/all", undefined, alphaToken);
    const betaCategories = await request(base, "GET", "/api/categories/all", undefined, betaToken);
    assert.ok(alphaCategories.data.some((row: any) => row.id === catalogA.category));
    assert.equal(alphaCategories.data.some((row: any) => row.id === catalogB.category), false);
    assert.ok(betaCategories.data.some((row: any) => row.id === catalogB.category));
    assert.equal(betaCategories.data.some((row: any) => row.id === catalogA.category), false);
    const sharedA = await request(base, "POST", "/api/categories", { name: "Shared Category" }, alphaToken);
    const sharedB = await request(base, "POST", "/api/categories", { name: "Shared Category" }, betaToken);
    const sharedDuplicate = await request(base, "POST", "/api/categories", { name: "Shared Category" }, alphaToken);
    assert.equal(sharedA.status, 201, JSON.stringify(sharedA.data));
    assert.equal(sharedB.status, 201, JSON.stringify(sharedB.data));
    assert.equal(sharedDuplicate.status, 400, JSON.stringify(sharedDuplicate.data));
    const crossCategoryEdit = await request(base, "PUT", `/api/categories/${catalogB.category}`, { name: "Cross Tenant" }, alphaToken);
    const crossCategoryDelete = await request(base, "DELETE", `/api/categories/${catalogB.category}`, undefined, alphaToken);
    assert.equal(crossCategoryEdit.status, 404);
    assert.equal(crossCategoryDelete.status, 404);
    const alphaColors = await request(base, "GET", "/api/colors/all", undefined, alphaToken);
    const betaColors = await request(base, "GET", "/api/colors/all", undefined, betaToken);
    const alphaSizes = await request(base, "GET", "/api/sizes/all", undefined, alphaToken);
    const betaSizes = await request(base, "GET", "/api/sizes/all", undefined, betaToken);
    assert.equal(alphaColors.data.some((row: any) => row.id === catalogB.color), false);
    assert.equal(betaColors.data.some((row: any) => row.id === catalogA.color), false);
    assert.equal(alphaSizes.data.some((row: any) => row.id === catalogB.size), false);
    assert.equal(betaSizes.data.some((row: any) => row.id === catalogA.size), false);
    const crossColorEdit = await request(base, "PUT", `/api/colors/${catalogB.color}`, { name: "Cross Color" }, alphaToken);
    const crossSizeDelete = await request(base, "DELETE", `/api/sizes/${catalogB.size}`, undefined, alphaToken);
    assert.equal(crossColorEdit.status, 404);
    assert.equal(crossSizeDelete.status, 404);

    const productA = await request(base, "POST", "/api/products", {
      name: "Tenant A Product",
      sku: "TENANT-A-PRODUCT",
      category_id: catalogA.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      variations: [{ color_id: catalogA.color, size_id: catalogA.size, stock: 2, min_stock: 1 }],
    }, alphaToken);
    const productB = await request(base, "POST", "/api/products", {
      name: "Tenant B Product",
      sku: "TENANT-B-PRODUCT",
      category_id: catalogB.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      variations: [{ color_id: catalogB.color, size_id: catalogB.size, stock: 2, min_stock: 1 }],
    }, betaToken);
    assert.equal(productA.status, 201, JSON.stringify(productA.data));
    assert.equal(productB.status, 201, JSON.stringify(productB.data));
    const alphaProductList = await request(base, "GET", "/api/products", undefined, alphaToken);
    const betaProductList = await request(base, "GET", "/api/products", undefined, betaToken);
    assert.equal(alphaProductList.data.some((row: any) => row.id === productB.data.id), false);
    assert.equal(betaProductList.data.some((row: any) => row.id === productA.data.id), false);
    const productBDetail = await request(base, "GET", `/api/products/${productB.data.id}`, undefined, betaToken);
    const productBVariation = productBDetail.data.variations[0].id;
    const crossProduct = await request(base, "POST", "/api/products", {
      name: "Cross Tenant Product",
      sku: "CROSS-TENANT-PRODUCT",
      category_id: catalogB.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      variations: [{ color_id: catalogB.color, size_id: catalogB.size, stock: 1, min_stock: 1 }],
    }, alphaToken);
    assert.equal(crossProduct.status, 400, JSON.stringify(crossProduct.data));
    const productCountBefore = (await request(base, "GET", "/api/products", undefined, alphaToken)).data.length;
    const crossColorProduct = await request(base, "POST", "/api/products", {
      name: "Cross Color Product",
      sku: "CROSS-COLOR-PRODUCT",
      category_id: catalogA.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      variations: [{ color_id: catalogB.color, size_id: catalogA.size, stock: 1, min_stock: 1 }],
    }, alphaToken);
    assert.equal(crossColorProduct.status, 400, JSON.stringify(crossColorProduct.data));
    const crossSizeProduct = await request(base, "POST", "/api/products", {
      name: "Cross Size Product",
      sku: "CROSS-SIZE-PRODUCT",
      category_id: catalogA.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      variations: [{ color_id: catalogA.color, size_id: catalogB.size, stock: 1, min_stock: 1 }],
    }, alphaToken);
    assert.equal(crossSizeProduct.status, 400, JSON.stringify(crossSizeProduct.data));
    const missingCategoryProduct = await request(base, "POST", "/api/products", {
      name: "Missing Category Product",
      sku: "MISSING-CATEGORY-PRODUCT",
      category_id: 999999,
      cost_price_cents: 100,
      sale_price_cents: 200,
      variations: [{ color_id: catalogA.color, size_id: catalogA.size, stock: 1, min_stock: 1 }],
    }, alphaToken);
    assert.equal(missingCategoryProduct.status, 400, JSON.stringify(missingCategoryProduct.data));
    const missingColorProduct = await request(base, "POST", "/api/products", {
      name: "Missing Color Product",
      sku: "MISSING-COLOR-PRODUCT",
      category_id: catalogA.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      variations: [{ color_id: 999999, size_id: catalogA.size, stock: 1, min_stock: 1 }],
    }, alphaToken);
    assert.equal(missingColorProduct.status, 400, JSON.stringify(missingColorProduct.data));
    const missingSizeProduct = await request(base, "POST", "/api/products", {
      name: "Missing Size Product",
      sku: "MISSING-SIZE-PRODUCT",
      category_id: catalogA.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      variations: [{ color_id: catalogA.color, size_id: 999999, stock: 1, min_stock: 1 }],
    }, alphaToken);
    assert.equal(missingSizeProduct.status, 400, JSON.stringify(missingSizeProduct.data));
    const productCountAfter = (await request(base, "GET", "/api/products", undefined, alphaToken)).data.length;
    assert.equal(productCountAfter, productCountBefore, "Nenhum produto parcial deve ter sido criado");
    const crossProductUpdate = await request(base, "PUT", `/api/products/${productA.data.id}`, {
      name: "Tenant A Product",
      sku: "TENANT-A-PRODUCT",
      category_id: catalogB.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      variations: [{ color_id: catalogB.color, size_id: catalogB.size, stock: 2, min_stock: 1 }],
    }, alphaToken);
    assert.equal(crossProductUpdate.status, 400, JSON.stringify(crossProductUpdate.data));
    const crossColorUpdate = await request(base, "PUT", `/api/products/${productA.data.id}`, {
      name: "Tenant A Product",
      sku: "TENANT-A-PRODUCT",
      category_id: catalogA.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      variations: [{ color_id: catalogB.color, size_id: catalogA.size, stock: 2, min_stock: 1 }],
    }, alphaToken);
    assert.equal(crossColorUpdate.status, 400, JSON.stringify(crossColorUpdate.data));
    const crossSizeUpdate = await request(base, "PUT", `/api/products/${productA.data.id}`, {
      name: "Tenant A Product",
      sku: "TENANT-A-PRODUCT",
      category_id: catalogA.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      variations: [{ color_id: catalogA.color, size_id: catalogB.size, stock: 2, min_stock: 1 }],
    }, alphaToken);
    assert.equal(crossSizeUpdate.status, 400, JSON.stringify(crossSizeUpdate.data));
    const unchangedProduct = await request(base, "GET", `/api/products/${productA.data.id}`, undefined, alphaToken);
    assert.equal(unchangedProduct.status, 200);
    assert.equal(unchangedProduct.data.category_id, catalogA.category);
    assert.equal(unchangedProduct.data.variations[0].color_id, catalogA.color);
    assert.equal(unchangedProduct.data.variations[0].size_id, catalogA.size);
    const ignoredCompanyCreate = await request(base, "POST", "/api/products", {
      name: "Ignored Company Product",
      sku: "IGNORED-COMPANY-PRODUCT",
      category_id: catalogA.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      company_id: second.data.company.id,
      variations: [{ color_id: catalogA.color, size_id: catalogA.size, stock: 1, min_stock: 1 }],
    }, alphaToken);
    assert.equal(ignoredCompanyCreate.status, 201, JSON.stringify(ignoredCompanyCreate.data));
    const ignoredCompanyRead = await request(base, "GET", `/api/products/${ignoredCompanyCreate.data.id}`, undefined, betaToken);
    assert.equal(ignoredCompanyRead.status, 404);
    const ignoredCompanyUpdate = await request(base, "PUT", `/api/products/${productA.data.id}`, {
      name: "Tenant A Product",
      sku: "TENANT-A-PRODUCT",
      category_id: catalogA.category,
      cost_price_cents: 100,
      sale_price_cents: 200,
      company_id: second.data.company.id,
      variations: [{ color_id: catalogA.color, size_id: catalogA.size, stock: 2, min_stock: 1 }],
    }, alphaToken);
    assert.equal(ignoredCompanyUpdate.status, 200, JSON.stringify(ignoredCompanyUpdate.data));
    const crossProductRead = await request(base, "GET", `/api/products/${productA.data.id}`, undefined, betaToken);
    assert.equal(crossProductRead.status, 404);
    const betaStockCross = await request(base, "POST", "/api/stock/movements", { variation_id: productBVariation, type: "entrada", quantity: 1 }, alphaToken);
    assert.equal(betaStockCross.status, 404);

    const publicAlpha = await spawnCatalogApi(dbPath, first.data.company.id, testSecret);
    try {
      const publicProducts = await request(publicAlpha.base, "GET", "/api/catalog/products");
      assert.equal(publicProducts.status, 200);
      assert.ok(publicProducts.data.some((row: any) => row.id === productA.data.id));
      assert.equal(publicProducts.data.some((row: any) => row.id === productB.data.id), false);
      const productADetail = await request(publicAlpha.base, "GET", `/api/catalog/products/${productA.data.id}`);
      assert.equal(productADetail.status, 200);
      assert.ok(productADetail.data.variations.some((v: any) => v.color_id === catalogA.color && v.size_id === catalogA.size));
      assert.equal(productADetail.data.variations.some((v: any) => v.color_id === catalogB.color || v.size_id === catalogB.size), false);
      const publicCategories = await request(publicAlpha.base, "GET", "/api/catalog/categories");
      assert.equal(publicCategories.status, 200);
      assert.ok(publicCategories.data.some((c: any) => c.id === catalogA.category));
      assert.equal(publicCategories.data.some((c: any) => c.id === catalogB.category), false);
      const withCompanyQuery = await request(publicAlpha.base, "GET", `/api/catalog/products?company_id=${second.data.company.id}`);
      assert.equal(withCompanyQuery.status, 200);
      assert.ok(withCompanyQuery.data.some((row: any) => row.id === productA.data.id));
      assert.equal(withCompanyQuery.data.some((row: any) => row.id === productB.data.id), false);
      const withCompanyQueryCats = await request(publicAlpha.base, "GET", `/api/catalog/categories?company_id=${second.data.company.id}`);
      assert.equal(withCompanyQueryCats.status, 200);
      assert.ok(withCompanyQueryCats.data.some((c: any) => c.id === catalogA.category));
      assert.equal(withCompanyQueryCats.data.some((c: any) => c.id === catalogB.category), false);
      const missingPublicProduct = await request(publicAlpha.base, "GET", "/api/catalog/products/999999");
      assert.equal(missingPublicProduct.status, 404);
      mutateDatabase(dbPath, "UPDATE products SET active = 0 WHERE id = ?", productA.data.id);
      const inactiveHidden = await request(publicAlpha.base, "GET", "/api/catalog/products");
      assert.equal(inactiveHidden.data.some((row: any) => row.id === productA.data.id), false);
      mutateDatabase(dbPath, "UPDATE products SET active = 1 WHERE id = ?", productA.data.id);
    } finally {
      await stopProcess(publicAlpha.child);
    }

    const publicBeta = await spawnCatalogApi(dbPath, second.data.company.id, testSecret);
    try {
      const publicProducts = await request(publicBeta.base, "GET", "/api/catalog/products");
      assert.equal(publicProducts.status, 200);
      assert.ok(publicProducts.data.some((row: any) => row.id === productB.data.id));
      assert.equal(publicProducts.data.some((row: any) => row.id === productA.data.id), false);
      const productBDetail = await request(publicBeta.base, "GET", `/api/catalog/products/${productB.data.id}`);
      assert.equal(productBDetail.status, 200);
      assert.ok(productBDetail.data.variations.some((v: any) => v.color_id === catalogB.color && v.size_id === catalogB.size));
      const publicCategories = await request(publicBeta.base, "GET", "/api/catalog/categories");
      assert.equal(publicCategories.status, 200);
      assert.ok(publicCategories.data.some((c: any) => c.id === catalogB.category));
      assert.equal(publicCategories.data.some((c: any) => c.id === catalogA.category), false);
    } finally {
      await stopProcess(publicBeta.child);
    }

    const noAuthPlans = await request(base, "GET", "/api/billing/plans");
    assert.equal(noAuthPlans.status, 401);
    const alphaPlans = await request(base, "GET", "/api/billing/plans", undefined, alphaToken);
    assert.equal(alphaPlans.status, 200);
    const alphaSubscription = await request(base, "GET", "/api/billing/subscription", undefined, alphaToken);
    assert.equal(alphaSubscription.status, 200);
    assert.equal(alphaSubscription.data.company_id, first.data.company.id);
    assert.equal(alphaSubscription.data.company_status, "ativo");
    const crossQuery = await request(base, "GET", `/api/billing/subscription?company_id=${second.data.company.id}`, undefined, alphaToken);
    assert.equal(crossQuery.status, 200);
    assert.equal(crossQuery.data.company_id, first.data.company.id);
    const crossPaymentsQuery = await request(base, "GET", `/api/billing/payments?company_id=${second.data.company.id}`, undefined, alphaToken);
    assert.equal(crossPaymentsQuery.status, 200);
    const alphaPayments = await request(base, "GET", "/api/billing/payments", undefined, alphaToken);
    const betaPayments = await request(base, "GET", "/api/billing/payments", undefined, betaToken);
    assert.equal(alphaPayments.status, 200);
    assert.equal(betaPayments.status, 200);
    assert.ok(alphaPayments.data.length === 1 && betaPayments.data.length === 1);
    assert.notEqual(alphaPayments.data[0].subscription_id, betaPayments.data[0].subscription_id);
    assert.equal(crossPaymentsQuery.data[0].subscription_id, alphaPayments.data[0].subscription_id);
    const alphaEvents = await request(base, "GET", "/api/billing/events", undefined, alphaToken);
    const crossEventsQuery = await request(base, "GET", `/api/billing/events?company_id=${second.data.company.id}`, undefined, alphaToken);
    assert.equal(alphaEvents.status, 200);
    assert.equal(crossEventsQuery.status, 200);
    assert.deepEqual(crossEventsQuery.data, alphaEvents.data);

    mutateDatabase(dbPath, "UPDATE users SET active = 0 WHERE id = ?", first.data.user.id);
    const disabledUser = await request(base, "GET", "/api/billing/subscription", undefined, alphaToken);
    assert.equal(disabledUser.status, 401);
    mutateDatabase(dbPath, "UPDATE users SET active = 1 WHERE id = ?", first.data.user.id);

    mutateDatabase(dbPath, "UPDATE companies SET status = 'suspenso' WHERE id = ?", second.data.company.id);
    const suspendedTenant = await request(base, "GET", "/api/billing/subscription", undefined, betaToken);
    assert.equal(suspendedTenant.status, 200);
    assert.equal(suspendedTenant.data.company_status, "suspenso");
    const suspendedCommercialRoute = await request(base, "GET", "/api/products", undefined, betaToken);
    assert.equal(suspendedCommercialRoute.status, 200);
    mutateDatabase(dbPath, "UPDATE companies SET status = 'ativo' WHERE id = ?", second.data.company.id);

    mutateDatabase(dbPath, "UPDATE users SET company_id = ? WHERE id = ?", second.data.company.id, first.data.user.id);
    const movedTenant = await request(base, "GET", "/api/billing/subscription", undefined, alphaToken);
    assert.equal(movedTenant.status, 200);
    assert.equal(movedTenant.data.company_id, second.data.company.id);
    mutateDatabase(dbPath, "UPDATE users SET company_id = ?, role = 'admin' WHERE id = ?", first.data.company.id, first.data.user.id);

    const clientTenantField = await request(base, "PUT", "/api/settings", { company_id: second.data.company.id, store_name: "Alpha Billing" }, alphaToken);
    assert.equal(clientTenantField.status, 200);
    const ownSettings = await request(base, "GET", "/api/settings", undefined, alphaToken);
    assert.equal(ownSettings.status, 200);
    assert.equal(ownSettings.data.store_name, "Alpha Billing");

    mutateDatabase(dbPath, "UPDATE users SET role = 'viewer' WHERE id = ?", first.data.user.id);
    const roleRevalidated = await request(base, "POST", "/api/sales/999999/fiscal/emit", { type: "nfce" }, alphaToken);
    assert.equal(roleRevalidated.status, 403);
    mutateDatabase(dbPath, "UPDATE users SET role = 'admin' WHERE id = ?", first.data.user.id);

    const expiredToken = jwt.sign({ id: first.data.user.id, role: "admin", company_id: first.data.company.id, exp: Math.floor(Date.now() / 1000) - 1 }, testSecret);
    const expired = await request(base, "GET", "/api/billing/subscription", undefined, expiredToken);
    assert.equal(expired.status, 401);
    const malformed = await request(base, "GET", "/api/billing/subscription", undefined, "invalid.token.value");
    assert.equal(malformed.status, 401);

    const paymentId = alphaPayments.data[0].id;
    const simulated = await request(base, "POST", `/api/billing/payments/${paymentId}/simulate`, undefined, alphaToken);
    assert.equal(simulated.status, 200);
    assert.equal(simulated.data.payment.status, "paid");
    assert.equal(simulated.data.subscription.status, "active");
    const eventsAfterPayment = databaseSummary(dbPath).billing_events;
    const repeated = await request(base, "POST", `/api/billing/payments/${paymentId}/simulate`, undefined, alphaToken);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.data.idempotent, true);
    assert.equal(databaseSummary(dbPath).billing_events, eventsAfterPayment);
    const crossPayment = await request(base, "POST", `/api/billing/payments/${paymentId}/simulate`, undefined, betaToken);
    assert.equal(crossPayment.status, 404);

    await stopProcess(child);
    process.env.DB_PATH = dbPath;
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = testSecret;
    const billing = await import("../src/billing.js");
    const database = await import("../src/db.js");
    closeDatabase = () => database.db.close();
    assert.throws(() => billing.transitionSubscription(first.data.subscription.id, "suspended"));
    const final = databaseSummary(dbPath);
    assert.equal(final.integrity, "ok");
    assert.equal(final.foreign_keys, 0);
    assert.equal(final.companies, 3);
    assert.equal(final.users, 2);
    assert.equal(final.subscriptions, 2);
    assert.equal(final.payments, 2);
    assert.equal(final.billing_events, eventsAfterPayment);

    console.log(JSON.stringify({
      status: "PASS",
      checks: 130,
      companies: final.companies,
      subscriptions: final.subscriptions,
      payments: final.payments,
      billing_events: final.billing_events,
      integrity: final.integrity,
      foreign_keys: final.foreign_keys,
    }));
  } finally {
    await stopProcess(child);
    closeDatabase?.();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
