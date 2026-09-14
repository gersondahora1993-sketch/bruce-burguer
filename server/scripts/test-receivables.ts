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
const testSecret = "receivables-secret-only-not-production-1234567890";

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
    company: { name: `Rec ${slug}`, slug, cnpj: "", phone: "11988887777" },
    admin: { name: "Admin Recebíveis B", email, password: "homolog123" },
    plan_id: planId,
  };
}

function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bruce-burger-receivables-"));
  const dbPath = path.join(tempDir, "receivables.db");
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

    // ------------------------------ 1. Login da Rayane ------------------------------
    const rayaneLogin = await request(base, "POST", "/api/auth/login", { email: "raiani@bruce-burguer.local", password: "Rayane@123" });
    equal(rayaneLogin.status, 200, "1: login Rayane (admin)");
    const rayane = rayaneLogin.data.token as string;

    const dbIds = openDb(dbPath, true);
    const rayaneId = (dbIds.prepare("SELECT id FROM users WHERE email = 'raiani@bruce-burguer.local'").get() as { id: number }).id;
    dbIds.close();

    // ------------------------------ 2. Cliente ------------------------------
    const cust = await request(base, "POST", "/api/customers", { name: "Cliente Recebíveis", phone: "11933332222" }, rayane);
    equal(cust.status, 201, "2: cliente criado");
    const custId = cust.data.id as number;

    // Base de produto para as vendas fiado
    const cat = await request(base, "POST", "/api/categories", { name: "Cat Rec" }, rayane);
    const cor = await request(base, "POST", "/api/colors", { name: "Cor Rec", hex: "#101010" }, rayane);
    const tam = await request(base, "POST", "/api/sizes", { name: "Tam Rec" }, rayane);
    equal(cat.status, 201, "base: categoria criada");
    equal(cor.status, 201, "base: cor criada");
    equal(tam.status, 201, "base: tamanho criado");
    const p1 = await request(base, "POST", "/api/products", {
      name: "Produto Recebíveis",
      sku: "REC-001",
      description: "",
      category_id: cat.data.id,
      cost_price_cents: 3000,
      sale_price_cents: 10900,
      image_url: "",
      variations: [{ color_id: cor.data.id, size_id: tam.data.id, stock: 10, min_stock: 1 }],
    }, rayane);
    equal(p1.status, 201, "base: produto criado");
    const varP1 = (await request(base, "GET", `/api/products/${p1.data.id}`, undefined, rayane)).data.variations[0].id as number;

    // Caixa aberto é pré-requisito da venda
    const cashOpen1 = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, rayane);
    equal(cashOpen1.status, 201, "base: caixa #1 aberto");
    const session1Id = cashOpen1.data.id as number;

    // ------------------------------ 3. Venda fiado ------------------------------
    const saleFiado = await request(base, "POST", "/api/sales", {
      payment_method: "fiado",
      customer_id: custId,
      items: [{ variation_id: varP1, quantity: 1 }],
    }, rayane);
    equal(saleFiado.status, 201, "3: venda fiado criada");
    const recId = saleFiado.data.receivable_id as number;
    pass(Number.isInteger(recId) && recId > 0, "3: venda gerou conta a receber");

    // ------------------------------ 4. Conta a receber confirmada ------------------------------
    const recList1 = await request(base, "GET", "/api/receivables", undefined, rayane);
    const row1 = recList1.data.rows.find((r: any) => r.id === recId);
    pass(!!row1 && row1.status === "pendente" && row1.remaining_cents === 12400, "4: conta pendente com saldo total confirmada (fiado R$109,00 + acréscimo = R$125,00)");
    equal(row1?.due_date, plusDays(30), "4: vencimento em 30 dias");

    // ------------------------------ 5. Garantir caixa fechado ------------------------------
    const closed1 = await request(base, "POST", `/api/cash/${session1Id}/close`, { closing_cents: 0 }, rayane);
    equal(closed1.status, 200, "5: caixa #1 fechado");

    // ------------------------------ 6. Receber com caixa fechado → 400 ------------------------------
    const payClosed = await request(base, "POST", `/api/receivables/${recId}/pay`, { amount_cents: 5000, payment_method: "pix" }, rayane);
    equal(payClosed.status, 400, "6: recebimento com caixa fechado rejeitado (HTTP 400)");
    pass(String(payClosed.data?.error ?? "").includes("Abra o caixa"), "6: erro controlado orienta abrir o caixa");

    // ------------------------------ 7. Nenhum dado parcial no banco ------------------------------
    {
      const dbv = openDb(dbPath, true);
      const entries = dbv.prepare("SELECT COUNT(*) AS c FROM cash_entries WHERE receivable_id = ? AND type = 'recebimento'").get(recId) as { c: number };
      equal(entries.c, 0, "7: nenhuma entrada de recebimento criada");
      const orphan = dbv.prepare("SELECT COUNT(*) AS c FROM cash_entries WHERE receivable_id = ? AND type = 'recebimento' AND cash_session_id IS NULL").get(recId) as { c: number };
      equal(orphan.c, 0, "7: nenhuma operação parcial órfã (cash_session_id NULL)");
      const recRow = dbv.prepare("SELECT status, paid_at FROM receivables WHERE id = ?").get(recId) as { status: string; paid_at: string | null };
      equal(recRow.status, "pendente", "7: status da conta não mudou");
      equal(recRow.paid_at, null, "7: paid_at permanece nulo");
      dbv.close();
    }

    // ------------------------------ 8. Abrir caixa ------------------------------
    const cashOpen2 = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, rayane);
    equal(cashOpen2.status, 201, "8: caixa #2 aberto");
    const session2Id = cashOpen2.data.id as number;

    // Segunda conta fiado (criada agora, usada nos itens 16/17)
    const saleFiado2 = await request(base, "POST", "/api/sales", {
      payment_method: "fiado",
      customer_id: custId,
      items: [{ variation_id: varP1, quantity: 1 }],
    }, rayane);
    equal(saleFiado2.status, 201, "16: segunda venda fiado criada");
    const recId2 = saleFiado2.data.receivable_id as number;
    pass(Number.isInteger(recId2) && recId2 > 0, "16: segunda conta a receber gerada");

    // ------------------------------ 9. Recebimento parcial ------------------------------
    const partial = await request(base, "POST", `/api/receivables/${recId}/pay`, { amount_cents: 5000, payment_method: "pix" }, rayane);
    equal(partial.status, 200, "9: pagamento parcial aceito");
    equal(partial.data.remaining_cents, 7400, "9: saldo parcial retornado");

    // ------------------------------ 10. Entrada no caixa ------------------------------
    {
      const dbv = openDb(dbPath, true);
      const entry = dbv.prepare(
        "SELECT id, cash_session_id, amount_cents, company_id, user_id FROM cash_entries WHERE receivable_id = ? AND type = 'recebimento'"
      ).get(recId) as any;
      pass(!!entry, "10: entrada de recebimento registrada");
      equal(entry?.cash_session_id, session2Id, "10: entrada vinculada ao caixa aberto");
      equal(entry?.amount_cents, 5000, "10: valor da entrada correto");
      equal(entry?.company_id, 1, "10: entrada pertence ao tenant autenticado");
      equal(entry?.user_id, rayaneId, "10: entrada atribuída à usuária autenticada");
      dbv.close();
    }

    // ------------------------------ 11. Saldo restante ------------------------------
    const recList2 = await request(base, "GET", "/api/receivables", undefined, rayane);
    const row2 = recList2.data.rows.find((r: any) => r.id === recId);
    pass(!!row2 && row2.status === "pendente" && row2.remaining_cents === 7400, "11: saldo restante 7400 após parcial");

    // ------------------------------ 12. Recebimento do restante ------------------------------
    const full = await request(base, "POST", `/api/receivables/${recId}/pay`, { amount_cents: 7400, payment_method: "dinheiro" }, rayane);
    equal(full.status, 200, "12: pagamento do restante aceito");

    // ------------------------------ 13. Status quitado ------------------------------
    equal(full.data.status, "pago", "13: resposta marca conta como pago");
    {
      const dbv = openDb(dbPath, true);
      const recRow = dbv.prepare("SELECT status, paid_at FROM receivables WHERE id = ?").get(recId) as { status: string; paid_at: string | null };
      equal(recRow.status, "pago", "13: status pago persistido no banco");
      pass(recRow.paid_at !== null, "13: paid_at preenchido");
      dbv.close();
    }

    // ------------------------------ 14. Saldo zero ------------------------------
    equal(full.data.remaining_cents, 0, "14: saldo zerado na resposta");
    const recList3 = await request(base, "GET", "/api/receivables", undefined, rayane);
    const row3 = recList3.data.rows.find((r: any) => r.id === recId);
    pass(!!row3 && row3.remaining_cents === 0, "14: saldo zerado na listagem");
    const again = await request(base, "POST", `/api/receivables/${recId}/pay`, { amount_cents: 100, payment_method: "pix" }, rayane);
    equal(again.status, 400, "14: nova cobrança em conta quitada rejeitada");

    // ------------------------------ 15. Fechar caixa ------------------------------
    const current2 = (await request(base, "GET", "/api/cash", undefined, rayane)).data.current;
    pass(!!current2 && current2.id === session2Id, "15: caixa #2 ainda aberto antes do fechamento");
    const closed2 = await request(base, "POST", `/api/cash/${session2Id}/close`, { closing_cents: current2.expected_cents }, rayane);
    equal(closed2.status, 200, "15: caixa #2 fechado");

    // ------------------------------ 17. Nova tentativa com caixa fechado ------------------------------
    const payClosed2 = await request(base, "POST", `/api/receivables/${recId2}/pay`, { amount_cents: 12400, payment_method: "dinheiro" }, rayane);
    equal(payClosed2.status, 400, "17: segunda conta também rejeitada com caixa fechado");
    pass(String(payClosed2.data?.error ?? "").includes("Abra o caixa"), "17: erro controlado na segunda rejeição");
    {
      const dbv = openDb(dbPath, true);
      const entries2 = dbv.prepare("SELECT COUNT(*) AS c FROM cash_entries WHERE receivable_id = ? AND type = 'recebimento'").get(recId2) as { c: number };
      equal(entries2.c, 0, "17: nenhuma alteração na segunda conta");
      const recRow2 = dbv.prepare("SELECT status FROM receivables WHERE id = ?").get(recId2) as { status: string };
      equal(recRow2.status, "pendente", "17: segunda conta permanece pendente");
      dbv.close();
    }

    // ------------------------------ 18. Isolamento entre tenants ------------------------------
    {
      const plans = await request(base, "GET", "/api/onboarding/plans");
      const tenantB = await request(base, "POST", "/api/onboarding", onboardingBody("rec-beta", "beta@rec.test", plans.data[0].id));
      pass(tenantB.status === 200 || tenantB.status === 201, "18: tenant B criado");
      const bLogin = await request(base, "POST", "/api/auth/login", { email: "beta@rec.test", password: "homolog123" });
      equal(bLogin.status, 200, "18: login admin tenant B");
      const b = bLogin.data.token as string;

      const bList = await request(base, "GET", "/api/receivables", undefined, b);
      pass(Array.isArray(bList.data.rows) && bList.data.rows.every((r: any) => r.id !== recId && r.id !== recId2), "18: tenant B não vê contas do tenant A");
      equal((await request(base, "POST", `/api/receivables/${recId}/pay`, { amount_cents: 1000, payment_method: "pix" }, b)).status, 404, "18: tenant B não paga conta do tenant A");

      // Fluxo próprio do B funciona com a mesma regra
      const bCat = await request(base, "POST", "/api/categories", { name: "Cat B" }, b);
      const bCor = await request(base, "POST", "/api/colors", { name: "Cor B", hex: "#222222" }, b);
      const bTam = await request(base, "POST", "/api/sizes", { name: "Tam B" }, b);
      const bProd = await request(base, "POST", "/api/products", {
        name: "Produto B",
        sku: "REC-B01",
        description: "",
        category_id: bCat.data.id,
        cost_price_cents: 1000,
        sale_price_cents: 7000,
        image_url: "",
        variations: [{ color_id: bCor.data.id, size_id: bTam.data.id, stock: 5, min_stock: 1 }],
      }, b);
      equal(bProd.status, 201, "18: tenant B cria produto");
      const bVar = (await request(base, "GET", `/api/products/${bProd.data.id}`, undefined, b)).data.variations[0].id as number;
      const bCust = await request(base, "POST", "/api/customers", { name: "Cliente B", phone: "11922221111" }, b);
      equal(bCust.status, 201, "18: tenant B cria cliente");
      const bCash = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, b);
      equal(bCash.status, 201, "18: tenant B abre o próprio caixa");
      const bSale = await request(base, "POST", "/api/sales", {
        payment_method: "fiado",
        customer_id: bCust.data.id,
        items: [{ variation_id: bVar, quantity: 1 }],
      }, b);
      equal(bSale.status, 201, "18: tenant B cria venda fiado própria");
      const bPartial = await request(base, "POST", `/api/receivables/${bSale.data.receivable_id}/pay?company_id=1`, { amount_cents: 2000, payment_method: "pix", company_id: 1 }, b);
      equal(bPartial.status, 200, "18: tenant B recebe normalmente com caixa aberto");
      equal(bPartial.data.remaining_cents, 6500, "18: saldo do B independente (fiado R$70,00 + acréscimo = R$85,00 − R$20,00)");
      const bCurrent = (await request(base, "GET", "/api/cash", undefined, b)).data.current;
      pass(!!bCurrent && bCurrent.id === bCash.data.id, "18: caixa do B localizado");
      const bClosed = await request(base, "POST", `/api/cash/${bCurrent.id}/close`, { closing_cents: bCurrent.expected_cents }, b);
      equal(bClosed.status, 200, "18: tenant B fecha o próprio caixa");
      const bPayAfterClose = await request(base, "POST", `/api/receivables/${bSale.data.receivable_id}/pay`, { amount_cents: 3000, payment_method: "pix" }, b);
      equal(bPayAfterClose.status, 400, "18: regra do caixa vale para o tenant B também");

      // ------------------------------ 19. company_id do body/query ignorado ------------------------------
      const reopenA = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, rayane);
      equal(reopenA.status, 201, "19: tenant A reabre caixa #3");
      const session3Id = reopenA.data.id as number;
      const spoofA = await request(base, "POST", `/api/receivables/${recId2}/pay?company_id=999`, { amount_cents: 12400, payment_method: "pix", company_id: 999 }, rayane);
      equal(spoofA.status, 200, "19: recebimento prossegue apesar do company_id spoofado");
      {
        const dbv = openDb(dbPath, true);
        const entryA = dbv.prepare(
          "SELECT ce.cash_session_id, ce.company_id, cs.company_id AS session_company FROM cash_entries ce LEFT JOIN cash_sessions cs ON cs.id = ce.cash_session_id WHERE ce.receivable_id = ? AND ce.type = 'recebimento'"
        ).get(recId2) as any;
        pass(!!entryA, "19: entrada da segunda conta registrada");
        equal(entryA?.company_id, 1, "19: entrada fica no tenant A (spoof ignorado)");
        equal(entryA?.session_company, 1, "19: sessão vinculada pertence ao tenant A");
        equal(entryA?.cash_session_id, session3Id, "19: entrada usa o caixa aberto do tenant autenticado");
        const recRow2 = dbv.prepare("SELECT status, company_id FROM receivables WHERE id = ?").get(recId2) as { status: string; company_id: number };
        equal(recRow2.status, "pago", "19: segunda conta quitada no tenant correto");
        equal(recRow2.company_id, 1, "19: conta permanece no tenant A");

        const bCompanyId = (dbv.prepare("SELECT id FROM companies WHERE slug = 'rec-beta'").get() as { id: number }).id;
        const entryB = dbv.prepare(
          "SELECT ce.company_id FROM cash_entries ce WHERE ce.receivable_id = ? AND ce.type = 'recebimento' ORDER BY ce.id DESC LIMIT 1"
        ).get(bSale.data.receivable_id) as any;
        pass(!!entryB && entryB.company_id === bCompanyId, "19: pagamento do B com company_id:1 spoofado permanece no tenant B");
        dbv.close();
      }
    }

    // ------------------------------ 20/21. Integridade ------------------------------
    {
      const dbv = openDb(dbPath, true);
      const integrity = (dbv.pragma("integrity_check") as unknown as { integrity_check: string }[])[0]?.integrity_check;
      equal(integrity, "ok", "20: integrity_check ok");
      const fk = dbv.pragma("foreign_key_check") as unknown as unknown[];
      equal(fk.length, 0, "21: foreign_key_check sem violações");
      const orphans = dbv.prepare("SELECT COUNT(*) AS c FROM cash_entries WHERE type = 'recebimento' AND cash_session_id IS NULL").get() as { c: number };
      equal(orphans.c, 0, "21: nenhum recebimento sem caixa vinculado");
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
