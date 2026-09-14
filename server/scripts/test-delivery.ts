import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

type ApiResponse = { status: number; data: any };

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const testSecret = "delivery-secret-only-not-production-1234567890";

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
    // corpo não-JSON
  }
  return { status: response.status, data };
}

async function requestPdf(base: string, route: string, token: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${base}${route}`, { headers: { Authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await response.arrayBuffer());
  return { status: response.status, body: buf.toString("latin1") };
}

function openDb(dbPath: string, readonly = false): Database.Database {
  const db = new Database(dbPath, readonly ? { readonly: true, fileMustExist: true } : {});
  db.pragma("busy_timeout = 5000");
  return db;
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

function onboardingBody(slug: string, email: string, planId: number) {
  return {
    company: { name: `Delivery ${slug}`, slug, cnpj: "", phone: "11988887777" },
    admin: { name: "Admin Delivery B", email, password: "homolog123" },
    plan_id: planId,
  };
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bruce-burger-delivery-"));
  const dbPath = path.join(tempDir, "delivery.db");
  let checks = 0;
  const pass = (condition: unknown, message: string) => {
    checks += 1;
    assert.ok(condition, message);
  };
  const equal = (actual: unknown, expected: unknown, message: string) => {
    checks += 1;
    assert.deepEqual(actual, expected, message);
  };

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const tsx = path.join(serverRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsx, "src/index.ts"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DB_INIT: "demo",
      DB_PATH: dbPath,
      LEGACY_COMPANY_ID: "1",
      PUBLIC_COMPANY_ID: "1",
      PORT: String(port),
      HOST: "127.0.0.1",
      JWT_SECRET: testSecret,
      UPLOADS_DIR: path.join(tempDir, "uploads"),
    },
    stdio: "ignore",
  });

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
        // ainda iniciando
      }
      await wait(500);
    }
    pass(healthy, "API não iniciou no banco temporário");

    // ------------------------------ Logins e identidade ------------------------------
    const raianiLogin = await request(base, "POST", "/api/auth/login", { email: "raiani@bruce-burguer.local", password: "Rayane@123" });
    const amandaLogin = await request(base, "POST", "/api/auth/login", { email: "amanda@bruce-burguer.local", password: "Amanda@123" });
    const alanaLogin = await request(base, "POST", "/api/auth/login", { email: "alana@bruce-burguer.local", password: "Alana@123" });
    equal(raianiLogin.status, 200, "login Raiani (administradora)");
    equal(amandaLogin.status, 200, "login Amanda (vendedora)");
    equal(alanaLogin.status, 200, "login Alana (vendedora)");
    const raiani = raianiLogin.data.token as string;
    const amanda = amandaLogin.data.token as string;
    const alana = alanaLogin.data.token as string;
    equal(raianiLogin.data.user.name, "Raiani Flor Nogueira Viana", "nome da administradora atualizado para Raiani");
    equal(raianiLogin.data.user.role, "admin", "Raiani é admin");
    equal(amandaLogin.data.user.role, "vendedora", "Amanda é vendedora");
    equal(alanaLogin.data.user.role, "vendedora", "Alana é vendedora");
    equal((await request(base, "POST", "/api/auth/login", { email: "raiane@bruce-burguer.local", password: "Rayane@123" })).status, 401, "e-mail antigo da Raiani não faz mais login");

    const dbIds = openDb(dbPath, true);
    const amandaId = (dbIds.prepare("SELECT id FROM users WHERE email = 'amanda@bruce-burguer.local'").get() as { id: number }).id;
    const alanaId = (dbIds.prepare("SELECT id FROM users WHERE email = 'alana@bruce-burguer.local'").get() as { id: number }).id;
    dbIds.close();

    // ------------------------------ 1/2. Raiani: administrativo + financeiro ------------------------------
    equal((await request(base, "GET", "/api/users", undefined, raiani)).status, 200, "1a. Raiani acessa administração (usuários)");
    equal((await request(base, "PUT", "/api/settings", { store_name: "Bruce Burguer" }, raiani)).status, 200, "1b. Raiani acessa configurações");
    equal((await request(base, "GET", "/api/receivables", undefined, raiani)).status, 200, "2a. Raiani acessa contas a receber");
    equal((await request(base, "GET", "/api/reports", undefined, raiani)).status, 200, "2b. Raiani acessa relatórios financeiros");
    equal((await request(base, "GET", "/api/billing/plans", undefined, raiani)).status, 200, "2c. Raiani acessa billing");

    // ------------------------------ 3/4. Amanda e Alana: operação ------------------------------
    for (const [name, token] of [["Amanda", amanda], ["Alana", alana]] as const) {
      equal((await request(base, "GET", "/api/dashboard", undefined, token)).status, 200, `3/4. ${name} acessa dashboard operacional`);
      equal((await request(base, "GET", "/api/products", undefined, token)).status, 200, `3/4. ${name} consulta produtos`);
      equal((await request(base, "GET", "/api/stock", undefined, token)).status, 200, `3/4. ${name} consulta estoque`);
      equal((await request(base, "GET", "/api/customers", undefined, token)).status, 200, `3/4. ${name} consulta clientes`);
      equal((await request(base, "GET", "/api/cash", undefined, token)).status, 200, `3/4. ${name} opera o caixa`);
      equal((await request(base, "GET", "/api/orders", undefined, token)).status, 200, `3/4. ${name} acessa pedidos`);
    }

    // ------------------------------ 5-8. Bloqueios administrativo/financeiro ------------------------------
    for (const [name, token] of [["Amanda", amanda], ["Alana", alana]] as const) {
      equal((await request(base, "GET", "/api/receivables", undefined, token)).status, 403, `5/6. ${name} NÃO acessa contas a receber`);
      equal((await request(base, "GET", "/api/reports", undefined, token)).status, 403, `5/6. ${name} NÃO acessa relatórios`);
      equal((await request(base, "GET", "/api/users", undefined, token)).status, 403, `7/8. ${name} NÃO acessa usuários`);
      equal((await request(base, "GET", "/api/billing/subscription", undefined, token)).status, 403, `7/8. ${name} NÃO acessa assinatura`);
      equal((await request(base, "PUT", "/api/settings", { store_name: "X" }, token)).status, 403, `7/8. ${name} NÃO altera configurações`);
    }

    // ------------------------------ Base: categoria/cor/tamanho ------------------------------
    const cat = await request(base, "POST", "/api/categories", { name: "Cat Entrega" }, amanda);
    const cor = await request(base, "POST", "/api/colors", { name: "Cor Entrega", hex: "#334455" }, amanda);
    const tam = await request(base, "POST", "/api/sizes", { name: "Tam Entrega" }, amanda);
    equal(cat.status, 201, "Amanda cadastra categoria");
    equal(cor.status, 201, "Amanda cadastra cor");
    equal(tam.status, 201, "Amanda cadastra tamanho");

    // ------------------------------ 9/10. Produtos por vendedora ------------------------------
    const payloadP = (sku: string, name: string) => ({
      name,
      sku,
      description: "",
      category_id: cat.data.id,
      cost_price_cents: 2500,
      sale_price_cents: 8900,
      image_url: "",
      company_id: 999,
      role: "admin",
      variations: [{ color_id: cor.data.id, size_id: tam.data.id, stock: 6, min_stock: 1 }],
    });
    const prodAmanda = await request(base, "POST", "/api/products", payloadP("DEL-001", "Vestido Entrega A"), amanda);
    const prodAlana = await request(base, "POST", "/api/products", payloadP("DEL-002", "Blusa Entrega B"), alana);
    equal(prodAmanda.status, 201, "9. Amanda cria produto");
    equal(prodAlana.status, 201, "10. Alana cria produto");
    const varAmanda = (await request(base, "GET", `/api/products/${prodAmanda.data.id}`, undefined, amanda)).data.variations[0].id as number;
    const varAlana = (await request(base, "GET", `/api/products/${prodAlana.data.id}`, undefined, alana)).data.variations[0].id as number;

    // ------------------------------ 11/12. Clientes por vendedora ------------------------------
    const custAmanda = await request(base, "POST", "/api/customers", { name: "Cliente da Amanda", phone: "11911110001" }, amanda);
    const custAlana = await request(base, "POST", "/api/customers", { name: "Cliente da Alana", phone: "11911110002" }, alana);
    equal(custAmanda.status, 201, "11. Amanda cadastra cliente");
    equal(custAlana.status, 201, "12. Alana cadastra cliente");

    // ------------------------------ 18. Amanda abre caixa ------------------------------
    const cashOpen = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, amanda);
    equal(cashOpen.status, 201, "18. Amanda abre caixa");
    const sessionId = cashOpen.data.id as number;

    // ------------------------------ 13-17. Vendas com vendedora correta ------------------------------
    const saleAmanda = await request(base, "POST", "/api/sales", {
      payment_method: "dinheiro",
      amount_received_cents: 10000,
      user_id: alanaId,
      company_id: 999,
      items: [{ variation_id: varAmanda, quantity: 1 }],
    }, amanda);
    equal(saleAmanda.status, 201, "13. Amanda cria venda");
    const saleAlana = await request(base, "POST", "/api/sales", {
      payment_method: "pix",
      user_id: amandaId,
      company_id: 999,
      items: [{ variation_id: varAlana, quantity: 1 }],
    }, alana);
    equal(saleAlana.status, 201, "14. Alana cria venda");
    {
      const dbv = openDb(dbPath, true);
      const rows = dbv.prepare("SELECT id, user_id, company_id FROM sales WHERE id IN (?, ?)").all(saleAmanda.data.saleId, saleAlana.data.saleId) as any[];
      const rowAmanda = rows.find((r) => r.id === saleAmanda.data.saleId);
      const rowAlana = rows.find((r) => r.id === saleAlana.data.saleId);
      equal(rowAmanda?.user_id, amandaId, "15. venda da Amanda registra Amanda (user_id do body ignorado)");
      equal(rowAlana?.user_id, alanaId, "16. venda da Alana registra Alana (user_id do body ignorado)");
      pass(rows.every((r) => r.company_id === 1), "17. company_id enviado pelo cliente é ignorado");
      dbv.close();
    }

    // ------------------------------ 22/23. Comprovantes ------------------------------
    const compAmanda = await request(base, "GET", `/api/sales/${saleAmanda.data.saleId}/comprovante`, undefined, amanda);
    equal(compAmanda.status, 200, "comprovante da venda da Amanda acessível");
    equal(compAmanda.data.sale.user_name, "Amanda Viana Peixoto", "22a. comprovante mostra Amanda como vendedora");
    const compAlana = await request(base, "GET", `/api/sales/${saleAlana.data.saleId}/comprovante`, undefined, alana);
    equal(compAlana.status, 200, "comprovante da venda da Alana acessível");
    equal(compAlana.data.sale.user_name, "Alana dos Santos da Hora", "22b. comprovante mostra Alana como vendedora");
    pass(String(compAmanda.data.store.store_name ?? "").length > 0, "22c. comprovante identifica a loja");
    const pdfAmanda = await requestPdf(base, `/api/sales/${saleAmanda.data.saleId}/comprovante/pdf`, amanda);
    equal(pdfAmanda.status, 200, "23a. PDF do comprovante gerado para vendedora");
    pass(pdfAmanda.body.startsWith("%PDF"), "23b. PDF válido");
    pass(pdfAmanda.body.includes("COMPROVANTE DE VENDA"), "23c. PDF contém COMPROVANTE DE VENDA");
    pass(pdfAmanda.body.includes("NAO E DOCUMENTO FISCAL") || pdfAmanda.body.includes("NÃO É DOCUMENTO FISCAL"), "23d. PDF declara que não é documento fiscal");
    equal((await request(base, "GET", `/api/sales/${saleAmanda.data.saleId}/comprovante`, undefined, alana)).status, 404, "Alana NÃO abre comprovante da venda da Amanda");

    // ------------------------------ 19-21. Fechar/abrir/fechar caixa ------------------------------
    const current = (await request(base, "GET", "/api/cash", undefined, amanda)).data.current;
    const closedByAmanda = await request(base, "POST", `/api/cash/${sessionId}/close`, { closing_cents: current.expected_cents }, amanda);
    equal(closedByAmanda.status, 200, "19. Amanda fecha caixa");
    const reopenByAlana = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, alana);
    equal(reopenByAlana.status, 201, "20. Alana abre caixa");
    const current2 = (await request(base, "GET", "/api/cash", undefined, alana)).data.current;
    const closedByAlana = await request(base, "POST", `/api/cash/${current2.id}/close`, { closing_cents: current2.expected_cents }, alana);
    equal(closedByAlana.status, 200, "21. Alana fecha caixa");

    // ------------------------------ Venda com caixa fechado ------------------------------
    const saleClosedCash = await request(base, "POST", "/api/sales", {
      payment_method: "pix",
      items: [{ variation_id: varAmanda, quantity: 1 }],
    }, amanda);
    equal(saleClosedCash.status, 400, "venda com caixa fechado rejeitada (HTTP 400)");

    // ------------------------------ Fiado cria recebível ------------------------------
    const reopenFinal = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, amanda);
    equal(reopenFinal.status, 201, "caixa reaberto para testes finais");
    const saleFiado = await request(base, "POST", "/api/sales", {
      payment_method: "fiado",
      customer_id: custAmanda.data.id,
      items: [{ variation_id: varAmanda, quantity: 1 }],
    }, amanda);
    equal(saleFiado.status, 201, "venda fiado criada");
    pass(Number.isInteger(saleFiado.data.receivable_id) && saleFiado.data.receivable_id > 0, "fiado cria recebível corretamente");

    // ------------------------------ Cancelamento restaura estoque ------------------------------
    const stockBeforeCancel = (await request(base, "GET", `/api/products/${prodAlana.data.id}`, undefined, alana)).data.variations[0].stock as number;
    const saleToCancel = await request(base, "POST", "/api/sales", {
      payment_method: "dinheiro",
      amount_received_cents: 17800,
      items: [{ variation_id: varAlana, quantity: 2 }],
    }, alana);
    equal(saleToCancel.status, 201, "venda para cancelamento criada");
    const cancelled = await request(base, "DELETE", `/api/sales/${saleToCancel.data.saleId}`, undefined, alana);
    equal(cancelled.status, 200, "venda cancelada pela própria vendedora");
    const stockAfterCancel = (await request(base, "GET", `/api/products/${prodAlana.data.id}`, undefined, alana)).data.variations[0].stock;
    equal(stockAfterCancel, stockBeforeCancel, "cancelamento restaura estoque corretamente");

    // ------------------------------ 25. Isolamento tenant ------------------------------
    {
      const plans = await request(base, "GET", "/api/onboarding/plans");
      const tenantB = await request(base, "POST", "/api/onboarding", onboardingBody("delivery-b", "beta@delivery.test", plans.data[0].id));
      pass(tenantB.status === 200 || tenantB.status === 201, "25a. tenant B criado");
      const bLogin = await request(base, "POST", "/api/auth/login", { email: "beta@delivery.test", password: "homolog123" });
      equal(bLogin.status, 200, "25b. login tenant B");
      const b = bLogin.data.token as string;

      const bProducts = await request(base, "GET", "/api/products", undefined, b);
      pass(Array.isArray(bProducts.data) && bProducts.data.every((p: any) => p.id !== prodAmanda.data.id && p.id !== prodAlana.data.id), "25c. tenant B não vê produtos do tenant A");
      equal((await request(base, "GET", `/api/products/${prodAmanda.data.id}`, undefined, b)).status, 404, "25d. produto cross-tenant 404");
      const bCustomers = await request(base, "GET", "/api/customers", undefined, b);
      pass(Array.isArray(bCustomers.data) && bCustomers.data.every((c: any) => c.id !== custAmanda.data.id && c.id !== custAlana.data.id), "25e. tenant B não vê clientes do tenant A");
      const bSales = await request(base, "GET", "/api/sales", undefined, b);
      pass(Array.isArray(bSales.data) && bSales.data.every((s: any) => s.id !== saleAmanda.data.saleId && s.id !== saleAlana.data.saleId), "25f. tenant B não vê vendas do tenant A");
      equal((await request(base, "GET", `/api/sales/${saleAmanda.data.saleId}/comprovante`, undefined, b)).status, 404, "25g. comprovante cross-tenant 404");
      const bCash = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, b);
      equal(bCash.status, 201, "25h. tenant B opera caixa próprio isolado");
    }

    // ------------------------------ 24. Integridade SQLite ------------------------------
    {
      const dbv = openDb(dbPath, true);
      const integrity = (dbv.pragma("integrity_check") as unknown as { integrity_check: string }[])[0]?.integrity_check;
      equal(integrity, "ok", "24a. integrity_check ok");
      const fk = dbv.pragma("foreign_key_check") as unknown as unknown[];
      equal(fk.length, 0, "24b. foreign_key_check sem violações");
      dbv.close();
    }

    await stopProcess(child);
    console.log(JSON.stringify({ status: "PASS", checks }));
  } catch (error) {
    await stopProcess(child);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

void main();
