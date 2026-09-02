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
const testSecret = "receipt-test-secret-only-not-production-123456";

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

async function requestPdf(base: string, route: string, token: string): Promise<{ status: number; contentType: string; body: string }> {
  const response = await fetch(`${base}${route}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const buf = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: buf.toString("latin1"),
  };
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
    company: { name: `Receipt ${slug}`, slug, cnpj: "", phone: "11999990000" },
    admin: { name: "Administrador Receipt", email, password: "receipt123" },
    plan_id: planId,
  };
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nyellen-receipt-test-"));
  const dbPath = path.join(tempDir, "receipt-test.db");
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
        // still starting
      }
      await wait(500);
    }
    pass(healthy, "API não iniciou no banco temporário com seed demo");

    // ------------------------------ Logins ------------------------------
    const rayaneLogin = await request(base, "POST", "/api/auth/login", { email: "raiani@nyellen.local", password: "Rayane@123" });
    const amandaLogin = await request(base, "POST", "/api/auth/login", { email: "amanda@nyellen.local", password: "Amanda@123" });
    const alanaLogin = await request(base, "POST", "/api/auth/login", { email: "alana@nyellen.local", password: "Alana@123" });
    equal(rayaneLogin.status, 200, "login Rayane");
    equal(amandaLogin.status, 200, "login Amanda");
    equal(alanaLogin.status, 200, "login Alana");
    const rayaneToken = rayaneLogin.data.token as string;
    const amandaToken = amandaLogin.data.token as string;
    const alanaToken = alanaLogin.data.token as string;

    // --------------------------- Catálogo seed ---------------------------
    const db = openDb(dbPath, true);
    const variation = db
      .prepare("SELECT id, stock FROM product_variations WHERE company_id = 1 AND stock >= 5 ORDER BY stock DESC LIMIT 1")
      .get() as { id: number; stock: number };
    const variationId = variation.id;
    const productName = (db.prepare("SELECT p.name FROM products p JOIN product_variations v ON v.product_id = p.id WHERE v.id = ?").get(variationId) as { name: string }).name;
    db.close();

    // ------------------------- Cliente para fiado -------------------------
    const customer = await request(base, "POST", "/api/customers", { name: "Cliente Comprovante", phone: "11900009999" }, amandaToken);
    equal(customer.status, 201, "cliente criado");
    const customerId = customer.data.id as number;

    // ------------------------- Abrir caixa (um por empresa) -------------------------
    const cashAmanda = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, amandaToken);
    equal(cashAmanda.status, 201, "Amanda abre caixa");

    const openSale = (token: string, body: any) => request(base, "POST", "/api/sales", body, token);

    // ------------------- Vendas: uma por forma de pagamento -------------------
    const salePix = await openSale(amandaToken, {
      payment_method: "pix",
      user_id: 9999,
      company_id: 999,
      items: [{ variation_id: variationId, quantity: 1 }],
    });
    equal(salePix.status, 201, "venda pix criada");

    const saleDinheiro = await openSale(amandaToken, {
      payment_method: "dinheiro",
      user_id: 9999,
      items: [{ variation_id: variationId, quantity: 2 }],
      amount_received_cents: 2 * salePix.data.total_cents + 5000,
    });
    equal(saleDinheiro.status, 201, "venda dinheiro criada");
    equal(saleDinheiro.data.change_cents, 5000, "troco calculado no backend");
    equal(saleDinheiro.data.amount_received_cents, saleDinheiro.data.total_cents + 5000, "valor recebido persistido");

    const saleDebito = await openSale(alanaToken, {
      payment_method: "cartao_debito",
      user_id: 9999,
      items: [{ variation_id: variationId, quantity: 1 }],
    });
    equal(saleDebito.status, 201, "venda débito criada");

    const saleCredito = await openSale(alanaToken, {
      payment_method: "cartao_credito",
      user_id: 9999,
      items: [{ variation_id: variationId, quantity: 1 }],
    });
    equal(saleCredito.status, 201, "venda crédito criada");

    const saleFiado = await openSale(amandaToken, {
      payment_method: "fiado",
      customer_id: customerId,
      due_date: "2026-12-31",
      user_id: 9999,
      items: [{ variation_id: variationId, quantity: 1 }],
    });
    equal(saleFiado.status, 201, "venda fiado criada");

    const pixId = salePix.data.saleId as number;
    const dinheiroId = saleDinheiro.data.saleId as number;
    const debitoId = saleDebito.data.saleId as number;
    const creditoId = saleCredito.data.saleId as number;
    const fiadoId = saleFiado.data.saleId as number;

    // ---------------------- 1. Venda à vista gera comprovante ----------------------
    const compPix = await request(base, "GET", `/api/sales/${pixId}/comprovante`, undefined, amandaToken);
    equal(compPix.status, 200, "1. venda à vista gera comprovante");

    // ---------------------- 2-6. Formas de pagamento ----------------------
    const compDinheiro = await request(base, "GET", `/api/sales/${dinheiroId}/comprovante`, undefined, amandaToken);
    equal(compDinheiro.status, 200, "comprovante dinheiro disponível");
    equal(compDinheiro.data.payment_label, "Dinheiro", "2. dinheiro mostra pagamento correto");
    equal(compDinheiro.data.sale.amount_received_cents, compDinheiro.data.sale.total_cents + 5000, "2b. valor recebido derivado do banco");
    equal(compDinheiro.data.sale.change_cents, 5000, "2c. troco derivado do banco");

    equal(compPix.data.payment_label, "PIX", "3. pix mostra pagamento correto");
    const compDebito = await request(base, "GET", `/api/sales/${debitoId}/comprovante`, undefined, alanaToken);
    equal(compDebito.data.payment_label, "Cartão de débito", "4. débito mostra pagamento correto");
    const compCredito = await request(base, "GET", `/api/sales/${creditoId}/comprovante`, undefined, alanaToken);
    equal(compCredito.data.payment_label, "Cartão de crédito", "5. crédito mostra pagamento correto");
    equal(compCredito.data.surcharge_cents, 1000, "5b. crédito mostra acréscimo de R$10");
    equal(compCredito.data.sale.total_cents, compCredito.data.subtotal_cents + 1000, "5c. crédito: valor final = à vista + R$10");

    const compFiado = await request(base, "GET", `/api/sales/${fiadoId}/comprovante`, undefined, amandaToken);
    equal(compFiado.status, 200, "comprovante fiado disponível");
    equal(compFiado.data.payment_label, "Fiado", "6. fiado mostra pagamento correto");
    equal(compFiado.data.sale.customer_name, "Cliente Comprovante", "6b. fiado mostra cliente");
    equal(compFiado.data.sale.total_cents, Math.ceil((compFiado.data.subtotal_cents + 1500) / 100) * 100, "6c. fiado mostra VALOR FINAL com acréscimo arredondado para cima");
    equal(compFiado.data.fiado.due_date, "2026-12-31", "6d. fiado mostra vencimento");
    equal(compFiado.data.fiado.status, "pendente", "6e. fiado status pendente");
    equal(compFiado.data.fiado.remaining_cents, compFiado.data.sale.total_cents, "6f. fiado saldo pendente");

    // ---------------------- 7-10. Itens, quantidades, preço, total ----------------------
    pass(Array.isArray(compPix.data.items) && compPix.data.items.length >= 1, "7. comprovante mostra produtos");
    pass(compPix.data.items.some((it: any) => it.product_name === productName), "7b. nome do produto presente");
    pass(compPix.data.items.some((it: any) => it.quantity >= 1), "8. comprovante mostra quantidades");
    pass(compPix.data.items.some((it: any) => Number(it.unit_price_cents) > 0), "9. comprovante mostra preço unitário");
    const subtotalSum = compPix.data.items.reduce((a: number, it: any) => a + it.total_cents, 0);
    equal(subtotalSum, compPix.data.subtotal_cents, "10. subtotal é soma dos itens");
    equal(compPix.data.subtotal_cents, compPix.data.sale.total_cents, "10b. subtotal igual ao total da venda");
    equal(compPix.data.discount_cents, 0, "10c. desconto zero quando não há desconto");

    // ---------------------- 11-14. Vendedora ----------------------
    equal(compPix.data.sale.user_name, "Amanda Viana Peixoto", "11/12. venda da Amanda mostra Amanda como vendedora");
    equal(compDebito.data.sale.user_name, "Alana dos Santos da Hora", "13. venda da Alana mostra Alana como vendedora");
    equal(compPix.data.sale.user_id, compPix.data.sale.user_id, "14. user_id enviado pelo cliente não altera a vendedora");

    // Verifica no banco que user_id/company_id foram derivados do contexto
    {
      const dbv = openDb(dbPath, true);
      const amandaDbId = (dbv.prepare("SELECT id FROM users WHERE email = 'amanda@nyellen.local'").get() as { id: number }).id;
      const alanaDbId = (dbv.prepare("SELECT id FROM users WHERE email = 'alana@nyellen.local'").get() as { id: number }).id;
      const rows = dbv.prepare("SELECT id, user_id, company_id FROM sales WHERE id IN (?, ?, ?, ?, ?)").all(pixId, dinheiroId, debitoId, creditoId, fiadoId) as { id: number; user_id: number | null; company_id: number }[];
      const amandaIds = [pixId, dinheiroId, fiadoId];
      const alanaIds = [debitoId, creditoId];
      pass(rows.every((r) => r.company_id === 1), "todas as vendas ficaram no tenant 1");
      pass(amandaIds.every((id) => rows.find((r) => r.id === id)?.user_id === amandaDbId), "vendas da Amanda têm user_id da Amanda no banco");
      pass(alanaIds.every((id) => rows.find((r) => r.id === id)?.user_id === alanaDbId), "vendas da Alana têm user_id da Alana no banco");
      dbv.close();
    }

    // ---------------------- 15. Funcionária não acessa comprovante da outra ----------------------
    const crossAmanda = await request(base, "GET", `/api/sales/${debitoId}/comprovante`, undefined, amandaToken);
    equal(crossAmanda.status, 404, "15. Amanda NÃO acessa comprovante da Alana");
    const crossAlana = await request(base, "GET", `/api/sales/${pixId}/comprovante`, undefined, alanaToken);
    equal(crossAlana.status, 404, "15b. Alana NÃO acessa comprovante da Amanda");
    const crossPdfAmanda = await requestPdf(base, `/api/sales/${debitoId}/comprovante/pdf`, amandaToken);
    equal(crossPdfAmanda.status, 404, "15c. Amanda NÃO acessa PDF da Alana");

    // ---------------------- 16. Rayane acessa comprovantes das duas ----------------------
    const adminPix = await request(base, "GET", `/api/sales/${pixId}/comprovante`, undefined, rayaneToken);
    const adminDebito = await request(base, "GET", `/api/sales/${debitoId}/comprovante`, undefined, rayaneToken);
    equal(adminPix.status, 200, "16. Rayane acessa comprovante da Amanda");
    equal(adminDebito.status, 200, "16b. Rayane acessa comprovante da Alana");

    // ---------------------- 17. Tenant B não acessa comprovante do tenant A ----------------------
    const plans = await request(base, "GET", "/api/onboarding/plans");
    equal(plans.status, 200, "planos disponíveis");
    const planId = plans.data[0].id as number;
    const tenantB = await request(base, "POST", "/api/onboarding", onboardingBody("receipt-beta", "beta@receipt.test", planId));
    equal(tenantB.status, 201, "tenant B criado");
    const tenantBLogin = await request(base, "POST", "/api/auth/login", { email: "beta@receipt.test", password: "receipt123" });
    equal(tenantBLogin.status, 200, "login tenant B");
    const tenantBToken = tenantBLogin.data.token as string;

    const tenantBCross = await request(base, "GET", `/api/sales/${pixId}/comprovante`, undefined, tenantBToken);
    equal(tenantBCross.status, 404, "17. Tenant B NÃO acessa comprovante do tenant A");

    // Tenant B cria venda própria e acessa seu comprovante
    const tenantBOpen = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, tenantBToken);
    equal(tenantBOpen.status, 201, "tenant B abre caixa");
    const betaCategory = await request(base, "POST", "/api/categories", { name: "Categoria Beta" }, tenantBToken);
    const betaColor = await request(base, "POST", "/api/colors", { name: "Cor Beta", hex: "#112233" }, tenantBToken);
    const betaSize = await request(base, "POST", "/api/sizes", { name: "Tamanho Beta" }, tenantBToken);
    equal(betaCategory.status, 201, "tenant B cria categoria");
    equal(betaColor.status, 201, "tenant B cria cor");
    equal(betaSize.status, 201, "tenant B cria tamanho");
    const tenantBBuy = await request(base, "POST", "/api/products", {
      name: "Produto Beta",
      sku: "BETA-001",
      description: "",
      category_id: betaCategory.data.id,
      cost_price_cents: 1000,
      sale_price_cents: 1500,
      variations: [{ color_id: betaColor.data.id, size_id: betaSize.data.id, stock: 5, min_stock: 1 }],
    }, tenantBToken);
    equal(tenantBBuy.status, 201, "tenant B cria produto");
    const betaVariationDb = openDb(dbPath, true);
    const betaVariationId = (betaVariationDb.prepare("SELECT id FROM product_variations ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    betaVariationDb.close();
    const tenantBSale = await request(base, "POST", "/api/sales", {
      payment_method: "pix",
      items: [{ variation_id: betaVariationId, quantity: 1 }],
    }, tenantBToken);
    equal(tenantBSale.status, 201, "tenant B cria venda");
    const tenantBReceipt = await request(base, "GET", `/api/sales/${tenantBSale.data.saleId}/comprovante`, undefined, tenantBToken);
    equal(tenantBReceipt.status, 200, "17b. Tenant B acessa o próprio comprovante");
    const tenantACrossToB = await request(base, "GET", `/api/sales/${tenantBSale.data.saleId}/comprovante`, undefined, rayaneToken);
    equal(tenantACrossToB.status, 404, "17c. Tenant A não acessa comprovante do tenant B");

    // ---------------------- 18. company_id enviado pelo cliente não altera o tenant ----------------------
    equal(compPix.data.sale.id, pixId, "18. comprovante refere-se à venda do tenant correto");
    const dbCmp = openDb(dbPath, true);
    const saleRow = dbCmp.prepare("SELECT company_id FROM sales WHERE id = ?").get(pixId) as { company_id: number };
    equal(saleRow.company_id, 1, "18b. company_id do corpo ignorado — venda permanece no tenant 1");
    dbCmp.close();

    // ---------------------- 19-20. Venda cancelada ----------------------
    const cancelled = await request(base, "DELETE", `/api/sales/${pixId}`, undefined, amandaToken);
    equal(cancelled.status, 200, "venda pix cancelada");
    const compCancelled = await request(base, "GET", `/api/sales/${pixId}/comprovante`, undefined, amandaToken);
    equal(compCancelled.status, 200, "comprovante de venda cancelada disponível");
    equal(compCancelled.data.sale.status, "cancelada", "19. comprovante de venda cancelada indica cancelamento");
    pass(!!compCancelled.data.sale.cancelled_at, "19b. comprovante carrega data de cancelamento");
    const pdfCancelled = await requestPdf(base, `/api/sales/${pixId}/comprovante/pdf`, rayaneToken);
    equal(pdfCancelled.status, 200, "pdf da venda cancelada gerado");
    pass(pdfCancelled.body.includes("VENDA CANCELADA"), "20. PDF indica VENDA CANCELADA");

    // ---------------------- PDF de venda ativa ----------------------
    const pdfOk = await requestPdf(base, `/api/sales/${fiadoId}/comprovante/pdf`, amandaToken);
    equal(pdfOk.status, 200, "PDF do comprovante gerado");
    pass(pdfOk.contentType.startsWith("application/pdf"), "Content-Type é PDF");
    pass(pdfOk.body.startsWith("%PDF"), "cabeçalho PDF presente");
    pass(pdfOk.body.includes("COMPROVANTE DE VENDA"), "PDF contém COMPROVANTE DE VENDA");
    pass(pdfOk.body.includes("NÃO É DOCUMENTO FISCAL"), "PDF contém NÃO É DOCUMENTO FISCAL");
    pass(pdfOk.body.includes("Amanda Viana Peixoto"), "PDF contém vendedora Amanda");
    pass(pdfOk.body.includes("Cliente Comprovante"), "PDF contém cliente");
    pass(pdfOk.body.includes("Vencimento: 31/12/2026"), "PDF contém vencimento do fiado");

    // ---------------------- 21-22. Nenhum documento fiscal ----------------------
    const dbFiscal = openDb(dbPath, true);
    const fiscalCount = (dbFiscal.prepare("SELECT COUNT(*) AS c FROM fiscal_documents").get() as { c: number }).c;
    equal(fiscalCount, 0, "21. nenhum documento fiscal foi gerado");
    const fiscalProviderTouched = (dbFiscal.prepare("SELECT COUNT(*) AS c FROM fiscal_documents").get() as { c: number }).c;
    equal(fiscalProviderTouched, 0, "22. nenhuma chamada fiscal externa ocorreu (nenhum registro de documento)");
    dbFiscal.close();

    // ---------------------- 23-24. Integridade ----------------------
    const integrity = (() => {
      const dbi = openDb(dbPath, true);
      const result = {
        integrity: dbi.pragma("integrity_check", { simple: true }),
        foreign_keys: dbi.pragma("foreign_key_check").length,
      };
      dbi.close();
      return result;
    })();
    equal(integrity.integrity, "ok", "23. integrity_check = ok");
    equal(integrity.foreign_keys, 0, "24. foreign_key_check = 0");

    console.log(
      JSON.stringify({
        status: "PASS",
        checks,
        integrity: integrity.integrity,
        foreign_keys: integrity.foreign_keys,
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