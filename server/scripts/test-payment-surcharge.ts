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
const testSecret = "surcharge-secret-only-not-production-123456789";

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
    company: { name: `Sur ${slug}`, slug, cnpj: "", phone: "11977776666" },
    admin: { name: "Admin Surcharge B", email, password: "homolog123" },
    plan_id: planId,
  };
}

function expectedFinal(payment: string, subtotalCents: number): { surcharge: number; total: number } {
  if (payment === "cartao_credito") return { surcharge: 1000, total: subtotalCents + 1000 };
  if (payment === "fiado") {
    const total = Math.ceil((subtotalCents + 1500) / 100) * 100;
    return { surcharge: total - subtotalCents, total };
  }
  return { surcharge: 0, total: subtotalCents };
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bruce-burger-surcharge-"));
  const dbPath = path.join(tempDir, "surcharge.db");
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

    // ------------------------------ Login e base ------------------------------
    const rayaneLogin = await request(base, "POST", "/api/auth/login", { email: "raiani@bruce-burguer.local", password: "Rayane@123" });
    equal(rayaneLogin.status, 200, "0a: login Rayane (admin)");
    const rayane = rayaneLogin.data.token as string;

    const cat = await request(base, "POST", "/api/categories", { name: "Cat Sur" }, rayane);
    const cor = await request(base, "POST", "/api/colors", { name: "Cor Sur", hex: "#202020" }, rayane);
    const tam = await request(base, "POST", "/api/sizes", { name: "Tam Sur" }, rayane);
    equal(cat.status, 201, "base: categoria criada");
    equal(cor.status, 201, "base: cor criada");
    equal(tam.status, 201, "base: tamanho criado");

    const p1 = await request(base, "POST", "/api/products", {
      name: "Vestido Surcharge A",
      sku: "SUR-A",
      description: "",
      category_id: cat.data.id,
      cost_price_cents: 3000,
      sale_price_cents: 8999,
      image_url: "",
      variations: [{ color_id: cor.data.id, size_id: tam.data.id, stock: 30, min_stock: 1 }],
    }, rayane);
    equal(p1.status, 201, "base: produto A (R$ 89,99) criado");

    const p2 = await request(base, "POST", "/api/products", {
      name: "Blusa Surcharge B",
      sku: "SUR-B",
      description: "",
      category_id: cat.data.id,
      cost_price_cents: 2000,
      sale_price_cents: 10000,
      image_url: "",
      variations: [{ color_id: cor.data.id, size_id: tam.data.id, stock: 10, min_stock: 1 }],
    }, rayane);
    equal(p2.status, 201, "base: produto B (R$ 100,00) criado");

    const varP1 = (await request(base, "GET", `/api/products/${p1.data.id}`, undefined, rayane)).data.variations[0].id as number;
    const varP2 = (await request(base, "GET", `/api/products/${p2.data.id}`, undefined, rayane)).data.variations[0].id as number;

    const cust = await request(base, "POST", "/api/customers", { name: "Cliente Surcharge", phone: "11944445555" }, rayane);
    equal(cust.status, 201, "base: cliente criado");

    const cashOpen = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, rayane);
    equal(cashOpen.status, 201, "base: caixa aberto");

    async function sell(payment_method: string, items: { variation_id: number; quantity: number }[], extra: Record<string, unknown> = {}) {
      const resp = await request(base, "POST", "/api/sales", { payment_method, items, ...extra }, rayane);
      pass(resp.status === 201, `venda ${payment_method} finalizada (HTTP 201)`);
      return resp.data;
    }

    // ------------------------------ 1. Regra por forma de pagamento sobre R$ 89,99 ------------------------------
    const cashSale = await sell("dinheiro", [{ variation_id: varP1, quantity: 1 }], { amount_received_cents: 10000 });
    equal(cashSale.total_cents, 8999, "1a. R$89,99 + dinheiro = R$89,99 (sem acréscimo)");
    equal(cashSale.surcharge_cents, 0, "1b. dinheiro não gera acréscimo");
    equal(cashSale.subtotal_cents, 8999, "1c. subtotal dinheiro confere");
    equal(cashSale.change_cents, 1001, "1d. troco calculado sobre valor final (100,00 − 89,99)");

    const pixSale = await sell("pix", [{ variation_id: varP1, quantity: 1 }]);
    equal(pixSale.total_cents, 8999, "1e. R$89,99 + Pix = R$89,99 (sem acréscimo)");
    equal(pixSale.surcharge_cents, 0, "1f. Pix não gera acréscimo");

    const debitSale = await sell("cartao_debito", [{ variation_id: varP1, quantity: 1 }]);
    equal(debitSale.total_cents, 8999, "1g. R$89,99 + débito = R$89,99 (sem acréscimo)");
    equal(debitSale.surcharge_cents, 0, "1h. débito não gera acréscimo");

    const creditSale = await sell("cartao_credito", [{ variation_id: varP1, quantity: 1 }]);
    equal(creditSale.total_cents, 9999, "1i. R$89,99 + crédito = R$99,99 (+10 fixos)");
    equal(creditSale.surcharge_cents, 1000, "1j. acréscimo crédito = R$10,00");
    equal(creditSale.subtotal_cents, 8999, "1k. subtotal crédito preservado");

    const fiadoSale = await sell("fiado", [{ variation_id: varP1, quantity: 1 }], { customer_id: cust.data.id });
    equal(fiadoSale.total_cents, 10500, "1l. R$89,99 + fiado = R$105,00 (arredondamento p/ cima)");
    equal(fiadoSale.surcharge_cents, 1500, "1m. acréscimo COMERCIAL fiado = R$15,00 (sem centavo do arredondamento)");
    equal(fiadoSale.rounding_cents, 1, "1m2. arredondamento apresentado separadamente = R$0,01");
    equal(fiadoSale.subtotal_cents, 8999, "1n. subtotal fiado preservado");
    pass(Number.isInteger(fiadoSale.receivable_id) && fiadoSale.receivable_id > 0, "1o. venda fiada gerou recebível");

    // ------------------------------ 1b. Casos exatos sobre R$ 79,99 ------------------------------
    const p3 = await request(base, "POST", "/api/products", {
      name: "Top Surcharge C",
      sku: "SUR-C",
      description: "",
      category_id: cat.data.id,
      cost_price_cents: 2000,
      sale_price_cents: 7999,
      image_url: "",
      variations: [{ color_id: cor.data.id, size_id: tam.data.id, stock: 10, min_stock: 1 }],
    }, rayane);
    equal(p3.status, 201, "1b0. produto C (R$ 79,99) criado");
    const varP3 = (await request(base, "GET", `/api/products/${p3.data.id}`, undefined, rayane)).data.variations[0].id as number;

    const cash79 = await sell("dinheiro", [{ variation_id: varP3, quantity: 1 }]);
    equal(cash79.total_cents, 7999, "1b1. R$79,99 + dinheiro = R$79,99");
    const pix79 = await sell("pix", [{ variation_id: varP3, quantity: 1 }]);
    equal(pix79.total_cents, 7999, "1b2. R$79,99 + Pix = R$79,99");
    const deb79 = await sell("cartao_debito", [{ variation_id: varP3, quantity: 1 }]);
    equal(deb79.total_cents, 7999, "1b3. R$79,99 + débito = R$79,99");
    const cred79 = await sell("cartao_credito", [{ variation_id: varP3, quantity: 1 }]);
    equal(cred79.total_cents, 8999, "1b4. R$79,99 + crédito = R$89,99 (+10 fixos)");
    equal(cred79.rounding_cents, 0, "1b5. crédito não gera arredondamento");
    const fiado79 = await sell("fiado", [{ variation_id: varP3, quantity: 1 }], { customer_id: cust.data.id });
    equal(fiado79.subtotal_cents, 7999, "1b6. fiado 79,99: valor à vista preservado");
    equal(fiado79.surcharge_cents, 1500, "1b7. fiado 79,99: acréscimo comercial R$15,00");
    equal(fiado79.rounding_cents, 1, "1b8. fiado 79,99: arredondamento R$0,01");
    equal(fiado79.total_cents, 9500, "1b9. R$79,99 + fiado = VALOR FINAL R$95,00");

    // ------------------------------ 2. Persistência do valor final ------------------------------
    {
      const dbv = openDb(dbPath, true);
      for (const [label, sale] of [["dinheiro", cashSale], ["pix", pixSale], ["débito", debitSale], ["crédito", creditSale], ["fiado", fiadoSale]] as [string, any][]) {
        const row = dbv.prepare("SELECT total_cents FROM sales WHERE id = ?").get(sale.saleId) as { total_cents: number };
        equal(row.total_cents, sale.total_cents, `2. sales.total_cents persiste valor final (${label})`);
      }
      const creditEntry = dbv.prepare("SELECT amount_cents FROM cash_entries WHERE sale_id = ? AND type = 'venda'").get(creditSale.saleId) as { amount_cents: number };
      equal(creditEntry.amount_cents, 9999, "2. caixa lança valor final da venda a crédito (R$99,99)");
      const cashEntry = dbv.prepare("SELECT amount_cents FROM cash_entries WHERE sale_id = ? AND type = 'venda'").get(cashSale.saleId) as { amount_cents: number };
      equal(cashEntry.amount_cents, 8999, "2. caixa lança R$89,99 na venda em dinheiro");
      const recRow = dbv.prepare("SELECT total_cents, status FROM receivables WHERE id = ?").get(fiadoSale.receivable_id) as { total_cents: number; status: string };
      equal(recRow.total_cents, 10500, "2. recebível fiado criado com VALOR FINAL R$105,00");
      equal(recRow.status, "pendente", "2. recebível fiado nasce pendente");
      dbv.close();
    }

    // ------------------------------ 3. Acréscimo uma única vez por venda ------------------------------
    const multiCredit = await sell("cartao_credito", [
      { variation_id: varP1, quantity: 2 },
      { variation_id: varP2, quantity: 1 },
    ]);
    equal(multiCredit.subtotal_cents, 27998, "3a. múltiplos itens somam corretamente (2×89,99 + 100,00 = R$279,98)");
    equal(multiCredit.surcharge_cents, 1000, "3b. acréscimo de crédito aplicado UMA vez (não por item)");
    equal(multiCredit.total_cents, 28998, "3c. valor final = subtotal + um único acréscimo");

    const multiFiado = await sell("fiado", [{ variation_id: varP1, quantity: 3 }], { customer_id: cust.data.id });
    equal(multiFiado.subtotal_cents, 26997, "3d. fiado com 3 itens soma corretamente (3×89,99 = R$269,97)");
    equal(multiFiado.total_cents, 28500, "3e. fiado 269,97+15 → arredonda para R$285,00 (uma única vez)");
    equal(multiFiado.surcharge_cents, 1500, "3f. acréscimo comercial fiado uma única vez (R$15,00)");
    equal(multiFiado.rounding_cents, 3, "3f2. arredondamento fiado = R$0,03");

    // Fórmulas independentes batem
    equal(expectedFinal("cartao_credito", 27998).total, multiCredit.total_cents, "3g. fórmula independente confere crédito multi-item");
    equal(expectedFinal("fiado", 26997).total, multiFiado.total_cents, "3h. fórmula independente confere fiado multi-item");

    // ------------------------------ 4. Estoque baixado corretamente ------------------------------
    {
      const prodA = (await request(base, "GET", `/api/products/${p1.data.id}`, undefined, rayane)).data;
      const soldA = 1 + 1 + 1 + 1 + 1 + 2 + 3; // vendas 1–5 + multivendas
      equal(prodA.variations[0].stock, 30 - soldA, "4a. estoque produto A baixado conforme quantidade vendida");
      const prodB = (await request(base, "GET", `/api/products/${p2.data.id}`, undefined, rayane)).data;
      equal(prodB.variations[0].stock, 9, "4b. estoque produto B baixado (−1)");
      const dbv = openDb(dbPath, true);
      const movsA = dbv.prepare("SELECT COALESCE(SUM(quantity), 0) AS q FROM stock_movements WHERE variation_id = ? AND type = 'saida' AND company_id = 1").get(varP1) as { q: number };
      equal(movsA.q, soldA, "4c. movimentações de saída somam quantidade vendida (A)");
      dbv.close();
    }

    // ------------------------------ 5. Itens da venda consistentes ------------------------------
    {
      const dbv = openDb(dbPath, true);
      const agg = dbv.prepare("SELECT COUNT(*) AS rows, COALESCE(SUM(total_cents), 0) AS sum FROM sale_items WHERE sale_id = ? AND company_id = 1").get(multiCredit.saleId) as { rows: number; sum: number };
      equal(agg.rows, 2, "5a. dois itens registrados na venda multi-item");
      equal(agg.sum, 27998, "5b. soma dos itens == subtotal (R$279,98), sem acréscimo diluído");
      const units = dbv.prepare("SELECT unit_price_cents FROM sale_items WHERE sale_id = ? ORDER BY id").all(multiCredit.saleId) as { unit_price_cents: number }[];
      equal(units.map((u) => u.unit_price_cents).join(","), "8999,10000", "5c. preços unitários preservados nos itens");
      dbv.close();
    }

    // ------------------------------ 6. Comprovante (texto, payload e PDF) ------------------------------
    {
      const receipt = await request(base, "GET", `/api/sales/${creditSale.saleId}/comprovante`, undefined, rayane);
      equal(receipt.status, 200, "6a. comprovante crédito carregado");
      equal(receipt.data.subtotal_cents, 8999, "6b. comprovante mostra valor à vista R$89,99");
      equal(receipt.data.surcharge_cents, 1000, "6c. comprovante mostra acréscimo R$10,00");
      equal(receipt.data.sale.total_cents, 9999, "6d. comprovante mostra VALOR FINAL R$99,99");
      equal(receipt.data.payment_label, "Cartão de crédito", "6e. comprovante mostra forma de pagamento");
      const text: string = receipt.data.whatsapp_text;
      pass(text.includes("Valor à vista: R$ 89,99"), "6f. texto WhatsApp contém 'Valor à vista: R$ 89,99'");
      pass(text.includes("Pagamento: Cartão de crédito"), "6g. texto WhatsApp contém forma de pagamento");
      pass(text.includes("Acréscimo: R$ 10,00"), "6h. texto WhatsApp contém 'Acréscimo: R$ 10,00'");
      pass(text.includes("VALOR FINAL: R$ 99,99"), "6i. texto WhatsApp contém 'VALOR FINAL: R$ 99,99'");
      pass(!text.includes("Subtotal:"), "6j. rótulo antigo 'Subtotal:' removido do texto");

      const receiptFiado = await request(base, "GET", `/api/sales/${fiadoSale.saleId}/comprovante`, undefined, rayane);
      const textFiado: string = receiptFiado.data.whatsapp_text;
      pass(textFiado.includes("Acréscimo: R$ 15,00"), "6k. comprovante fiado mostra acréscimo COMERCIAL R$15,00 (não 15,01)");
      pass(textFiado.includes("Arredondamento: R$ 0,01"), "6k2. comprovante fiado mostra arredondamento R$0,01");
      pass(!textFiado.includes("15,01"), "6k3. valor 15,01 não aparece como acréscimo em lugar nenhum");
      equal(receiptFiado.data.surcharge_cents, 1500, "6k4. payload surcharge_cents = comercial");
      equal(receiptFiado.data.rounding_cents, 1, "6k5. payload rounding_cents = 1");
      pass(textFiado.includes("VALOR FINAL: R$ 105,00"), "6l. comprovante fiado mostra VALOR FINAL R$105,00");
      pass(textFiado.includes("Saldo fiado: R$ 105,00"), "6m. saldo fiado reflete valor final");

      const receiptCash = await request(base, "GET", `/api/sales/${cashSale.saleId}/comprovante`, undefined, rayane);
      pass(!String(receiptCash.data.whatsapp_text).includes("Acréscimo"), "6n. venda à vista NÃO exibe linha de acréscimo");

      const pdf = await fetch(`${base}/api/sales/${creditSale.saleId}/comprovante/pdf`, { headers: { Authorization: `Bearer ${rayane}` } });
      equal(pdf.status, 200, "6o. PDF do comprovante gerado");
      const buf = Buffer.from(await pdf.arrayBuffer());
      pass(buf.subarray(0, 4).toString() === "%PDF", "6p. PDF válido (assinatura %PDF)");
    }

    // ------------------------------ 7. Cancelamento restaura estoque ------------------------------
    {
      const before = (await request(base, "GET", `/api/products/${p1.data.id}`, undefined, rayane)).data.variations[0].stock as number;
      const cancel = await request(base, "DELETE", `/api/sales/${pixSale.saleId}`, undefined, rayane);
      pass(cancel.status === 200 || cancel.status === 201, "7a. venda Pix cancelada");
      const after = (await request(base, "GET", `/api/products/${p1.data.id}`, undefined, rayane)).data.variations[0].stock as number;
      equal(after, before + 1, "7b. estoque restaurado após cancelamento (+1)");
    }

    // ------------------------------ 8. Isolamento multi-tenant ------------------------------
    {
      const plans = await request(base, "GET", "/api/onboarding/plans");
      const tenantB = await request(base, "POST", "/api/onboarding", onboardingBody("surcharge-b", "beta@surcharge.test", plans.data[0].id));
      pass(tenantB.status === 200 || tenantB.status === 201, "8a. tenant B criado");
      const bLogin = await request(base, "POST", "/api/auth/login", { email: "beta@surcharge.test", password: "homolog123" });
      equal(bLogin.status, 200, "8b. login tenant B");
      const b = bLogin.data.token as string;

      await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, b);
      const forged = await request(base, "POST", "/api/sales", {
        payment_method: "cartao_credito",
        items: [{ variation_id: varP1, quantity: 1 }],
      }, b);
      equal(forged.status, 400, "8c. tenant B não pode vender variação do tenant A");
      pass(String(forged.data?.error ?? "").includes("outra empresa") || String(forged.data?.error ?? "").includes("Não foi possível"), "8d. erro controlado de cross-tenant");

      const crossReceipt = await request(base, "GET", `/api/sales/${creditSale.saleId}/comprovante`, undefined, b);
      equal(crossReceipt.status, 404, "8e. comprovante cross-tenant 404");
    }

    // ------------------------------ 9. Integridade SQLite ------------------------------
    {
      const dbv = openDb(dbPath, true);
      const integrity = (dbv.pragma("integrity_check") as unknown as { integrity_check: string }[])[0]?.integrity_check;
      equal(integrity, "ok", "9a. integrity_check ok");
      const fk = dbv.pragma("foreign_key_check") as unknown as unknown[];
      equal(fk.length, 0, "9b. foreign_key_check sem violações");
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
