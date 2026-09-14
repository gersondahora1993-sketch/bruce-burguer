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
const testSecret = "homolog-secret-only-not-production-1234567890";

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

async function requestRaw(base: string, route: string, body: Buffer, contentType: string, token?: string): Promise<ApiResponse> {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": contentType },
    body,
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
    company: { name: `Homolog ${slug}`, slug, cnpj: "", phone: "11988887777" },
    admin: { name: "Administrador Homolog", email, password: "homolog123" },
    plan_id: planId,
  };
}

function jpegBytes(marker: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, marker & 0xff, 0x11, 0x22, 0x33]);
}

function pngBytes(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("HOMOLOG")]);
}

function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bruce-burger-homolog-"));
  const dbPath = path.join(tempDir, "homolog.db");
  const uploadsDir = path.join(tempDir, "uploads");
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
      UPLOADS_DIR: uploadsDir,
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

    // ------------------------------ Logins ------------------------------
    const rayaneLogin = await request(base, "POST", "/api/auth/login", { email: "raiani@bruce-burguer.local", password: "Rayane@123" });
    const amandaLogin = await request(base, "POST", "/api/auth/login", { email: "amanda@bruce-burguer.local", password: "Amanda@123" });
    const alanaLogin = await request(base, "POST", "/api/auth/login", { email: "alana@bruce-burguer.local", password: "Alana@123" });
    equal(rayaneLogin.status, 200, "login Rayane (admin)");
    equal(amandaLogin.status, 200, "login Amanda (funcionária)");
    equal(alanaLogin.status, 200, "login Alana (funcionária)");
    const rayane = rayaneLogin.data.token as string;
    const amanda = amandaLogin.data.token as string;
    const alana = alanaLogin.data.token as string;

    const dbIds = openDb(dbPath, true);
    const amandaId = (dbIds.prepare("SELECT id FROM users WHERE email = 'amanda@bruce-burguer.local'").get() as { id: number }).id;
    const alanaId = (dbIds.prepare("SELECT id FROM users WHERE email = 'alana@bruce-burguer.local'").get() as { id: number }).id;
    dbIds.close();

    // --------------------- A. Rayane acessa módulos admin ---------------------
    equal((await request(base, "GET", "/api/dashboard", undefined, rayane)).status, 200, "A: Rayane dashboard");
    equal((await request(base, "GET", "/api/products", undefined, rayane)).status, 200, "A: Rayane produtos");
    equal((await request(base, "GET", "/api/categories", undefined, rayane)).status, 200, "A: Rayane categorias");
    equal((await request(base, "GET", "/api/colors", undefined, rayane)).status, 200, "A: Rayane cores");
    equal((await request(base, "GET", "/api/sizes", undefined, rayane)).status, 200, "A: Rayane tamanhos");
    equal((await request(base, "GET", "/api/stock", undefined, rayane)).status, 200, "A: Rayane estoque");
    equal((await request(base, "GET", "/api/customers", undefined, rayane)).status, 200, "A: Rayane clientes");
    equal((await request(base, "GET", "/api/sales", undefined, rayane)).status, 200, "A: Rayane vendas/histórico");
    equal((await request(base, "GET", "/api/receivables", undefined, rayane)).status, 200, "A: Rayane contas a receber");
    equal((await request(base, "GET", "/api/cash", undefined, rayane)).status, 200, "A: Rayane caixa");
    equal((await request(base, "GET", "/api/orders", undefined, rayane)).status, 200, "A: Rayane pedidos");
    equal((await request(base, "GET", "/api/reports", undefined, rayane)).status, 200, "A: Rayane relatórios");
    equal((await request(base, "GET", "/api/settings", undefined, rayane)).status, 200, "A: Rayane configurações");
    equal((await request(base, "GET", "/api/users", undefined, rayane)).status, 200, "A: Rayane usuários");
    equal((await request(base, "GET", "/api/billing/plans", undefined, rayane)).status, 200, "A: Rayane billing");
    equal((await request(base, "GET", "/api/fiscal/status", undefined, rayane)).status, 200, "A: Rayane fiscal (status)");

    // --------------------- B. Amanda opera como funcionária ---------------------
    equal((await request(base, "GET", "/api/dashboard", undefined, amanda)).status, 200, "B: Amanda dashboard");
    const cat = await request(base, "POST", "/api/categories", { name: "Cat Homolog" }, amanda);
    const cor = await request(base, "POST", "/api/colors", { name: "Cor Homolog", hex: "#123456" }, amanda);
    const tam = await request(base, "POST", "/api/sizes", { name: "Tam Homolog" }, amanda);
    equal(cat.status, 201, "B: Amanda cadastra categoria");
    equal(cor.status, 201, "B: Amanda cadastra cor");
    equal(tam.status, 201, "B: Amanda cadastra tamanho");
    const p1 = await request(base, "POST", "/api/products", {
      name: "Vestido Homologação",
      sku: "HOM-001",
      description: "Produto de homologação",
      category_id: cat.data.id,
      cost_price_cents: 5000,
      sale_price_cents: 9900,
      image_url: "",
      variations: [{ color_id: cor.data.id, size_id: tam.data.id, stock: 10, min_stock: 2 }],
    }, amanda);
    equal(p1.status, 201, "B: Amanda cadastra produto (preços/estoque/mínimo/variação)");
    const p1Id = p1.data.id as number;
    const p1Get = await request(base, "GET", `/api/products/${p1Id}`, undefined, amanda);
    equal(p1Get.status, 200, "B: Amanda reabre produto");
    equal(p1Get.data.sale_price_cents, 9900, "B: preço de venda persistido");
    equal(p1Get.data.variations[0].min_stock, 2, "B: estoque mínimo persistido");
    const p1Edit = await request(base, "PUT", `/api/products/${p1Id}`, {
      name: "Vestido Homologação Edit",
      sku: "HOM-001",
      description: "Produto de homologação",
      category_id: cat.data.id,
      cost_price_cents: 5200,
      sale_price_cents: 10900,
      image_url: "",
      active: true,
      variations: [{ color_id: cor.data.id, size_id: tam.data.id, stock: 10, min_stock: 2 }],
    }, amanda);
    equal(p1Edit.status, 200, "B: Amanda edita produto");
    const up1 = await requestRaw(base, `/api/products/${p1Id}/image`, jpegBytes(0x21), "image/jpeg", amanda);
    equal(up1.status, 200, "B: Amanda tira/envia foto");
    const up2 = await requestRaw(base, `/api/products/${p1Id}/image`, pngBytes(), "image/png", amanda);
    equal(up2.status, 200, "B: Amanda altera foto");
    pass(await fs.stat(path.join(uploadsDir, up1.data.image_url.slice("/uploads/".length))).then(() => false).catch(() => true), "B: foto anterior removida ao alterar");
    equal((await request(base, "DELETE", `/api/products/${p1Id}/image`, undefined, amanda)).status, 200, "B: Amanda remove foto");
    const cust1 = await request(base, "POST", "/api/customers", { name: "Cliente Homolog", phone: "11955554444" }, amanda);
    equal(cust1.status, 201, "B: Amanda cadastra cliente");
    const cust1Id = cust1.data.id as number;

    // --------------------- G(antecipado). Caixa aberto pela Amanda ---------------------
    const cashOpen = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, amanda);
    equal(cashOpen.status, 201, "B/G: Amanda abre caixa");
    const cashSessionId = cashOpen.data.id as number;

    // --------------------- H. Vendas da Amanda ---------------------
    const varP1 = p1Get.data.variations[0].id as number;
    const saleDin = await request(base, "POST", "/api/sales", {
      payment_method: "dinheiro",
      user_id: 9999,
      company_id: 999,
      amount_received_cents: 20000,
      items: [{ variation_id: varP1, quantity: 1 }],
    }, amanda);
    equal(saleDin.status, 201, "H: venda dinheiro");
    equal(saleDin.data.total_cents, 10900, "H: dinheiro valor total");
    equal(saleDin.data.change_cents, 9100, "H: dinheiro troco correto");
    const salePix = await request(base, "POST", "/api/sales", {
      payment_method: "pix",
      user_id: 9999,
      company_id: 999,
      items: [{ variation_id: varP1, quantity: 1 }],
    }, amanda);
    equal(salePix.status, 201, "H: venda pix com valor registrado");
    const saleCred = await request(base, "POST", "/api/sales", {
      payment_method: "cartao_credito",
      items: [{ variation_id: varP1, quantity: 1 }],
    }, amanda);
    equal(saleCred.status, 201, "H: venda crédito");
    equal(saleCred.data.total_cents, 11900, "H: crédito aplica acréscimo de R$10 (R$109,00 → R$119,00)");

    // Fiado
    const fiadoSemCliente = await request(base, "POST", "/api/sales", {
      payment_method: "fiado",
      items: [{ variation_id: varP1, quantity: 1 }],
    }, amanda);
    equal(fiadoSemCliente.status, 400, "I: fiado sem cliente rejeitado");
    const saleFiado = await request(base, "POST", "/api/sales", {
      payment_method: "fiado",
      customer_id: cust1Id,
      items: [{ variation_id: varP1, quantity: 1 }],
    }, amanda);
    equal(saleFiado.status, 201, "I: venda fiado criada");
    equal(saleFiado.data.due_date, plusDays(30), "I: fiado vencimento em 30 dias");
    const recId = saleFiado.data.receivable_id as number;
    pass(Number.isInteger(recId) && recId > 0, "I: fiado gerou conta a receber");

    // Atribuição de usuário/tenant
    {
      const dbv = openDb(dbPath, true);
      const rows = dbv.prepare("SELECT id, user_id, company_id FROM sales WHERE id IN (?, ?, ?, ?)").all(saleDin.data.saleId, salePix.data.saleId, saleCred.data.saleId, saleFiado.data.saleId) as any[];
      pass(rows.every((r) => r.company_id === 1), "H: company_id sempre do tenant autenticado (spoof ignorado)");
      pass(rows.filter((r) => r.id !== saleCred.data.saleId).every((r) => r.user_id === amandaId), "H: user_id é sempre a autenticada (spoof ignorado)");
      dbv.close();
    }

    // Histórico próprio e comprovante
    const amandaHistory = await request(base, "GET", "/api/sales", undefined, amanda);
    equal(amandaHistory.status, 200, "B: Amanda vê histórico");
    pass(Array.isArray(amandaHistory.data) && amandaHistory.data.every((s: any) => s.user_id === amandaId), "B: Amanda vê somente o próprio histórico");
    const comp = await request(base, "GET", `/api/sales/${saleDin.data.saleId}/comprovante`, undefined, amanda);
    equal(comp.status, 200, "J: Amanda abre comprovante da própria venda");
    equal(comp.data.payment_label, "Dinheiro", "J: comprovante mostra pagamento");
    equal(comp.data.sale.change_cents, 9100, "J: comprovante mostra troco");
    equal(comp.data.sale.user_name, "Amanda Viana Peixoto", "J: comprovante mostra vendedora");
    pass(!comp.data.sale.customer_name && !comp.data.sale.customer_id, "J: venda à vista sem cliente");
    pass(Array.isArray(comp.data.items) && comp.data.items.some((i: any) => i.product_name === "Vestido Homologação Edit" && i.quantity === 1), "J: comprovante lista produto e quantidade");
    pass(String(comp.data.store.store_name ?? "").length > 0, "J: comprovante identifica a loja");
    equal(comp.data.sale.total_cents, 10900, "J: comprovante mostra total");
    const pdf = await requestPdf(base, `/api/sales/${saleDin.data.saleId}/comprovante/pdf`, amanda);
    equal(pdf.status, 200, "J: PDF do comprovante gerado");
    pass(pdf.body.startsWith("%PDF"), "J: PDF válido");
    pass(pdf.body.includes("COMPROVANTE DE VENDA"), "J: PDF contém COMPROVANTE DE VENDA");
    pass(pdf.body.includes("NAO E DOCUMENTO FISCAL") || pdf.body.includes("NÃO É DOCUMENTO FISCAL"), "J: PDF contém aviso não fiscal");

    // --------------------- C. Amanda bloqueada em rotas admin ---------------------
    equal((await request(base, "GET", "/api/receivables", undefined, amanda)).status, 403, "C: Amanda bloqueada em contas a receber");
    equal((await request(base, "GET", "/api/reports", undefined, amanda)).status, 403, "C: Amanda bloqueada em relatórios");
    equal((await request(base, "GET", "/api/fiscal/status", undefined, amanda)).status, 403, "C: Amanda bloqueada em fiscal");
    equal((await request(base, "GET", "/api/billing/plans", undefined, amanda)).status, 403, "C: Amanda bloqueada em billing");
    equal((await request(base, "GET", "/api/users", undefined, amanda)).status, 403, "C: Amanda bloqueada em usuários");
    equal((await request(base, "PUT", "/api/settings", { store_name: "X" }, amanda)).status, 403, "C: Amanda bloqueada em configurações (gravação)");
    equal((await request(base, "POST", `/api/sales/${saleDin.data.saleId}/fiscal/emit`, {}, amanda)).status, 403, "C: Amanda bloqueada em emissão fiscal");

    // --------------------- D. Alana opera como funcionária ---------------------
    const p2 = await request(base, "POST", "/api/products", {
      name: "Blusa Homolog Alana",
      sku: "HOM-002",
      description: "",
      category_id: cat.data.id,
      cost_price_cents: 3000,
      sale_price_cents: 5900,
      image_url: "",
      variations: [{ color_id: cor.data.id, size_id: tam.data.id, stock: 6, min_stock: 1 }],
    }, alana);
    equal(p2.status, 201, "D: Alana cadastra produto");
    const p2Id = p2.data.id as number;
    const upAlana = await requestRaw(base, `/api/products/${p2Id}/image`, pngBytes(), "image/png", alana);
    equal(upAlana.status, 200, "D: Alana envia foto no próprio produto");
    const varP2 = (await request(base, "GET", `/api/products/${p2Id}`, undefined, alana)).data.variations[0].id as number;
    equal((await request(base, "POST", "/api/stock/movements", { variation_id: varP2, type: "entrada", quantity: 4, reason: "Reposição" }, alana)).status, 201, "D: Alana adiciona estoque");
    const cust2 = await request(base, "POST", "/api/customers", { name: "Cliente Alana", phone: "11944445555" }, alana);
    equal(cust2.status, 201, "D: Alana cadastra cliente");
    const secondCash = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, alana);
    equal(secondCash.status, 400, "D: segundo caixa na mesma loja é rejeitado (um aberto por empresa)");
    const saleDebAlana = await request(base, "POST", "/api/sales", {
      payment_method: "cartao_debito",
      items: [{ variation_id: varP2, quantity: 1 }],
    }, alana);
    equal(saleDebAlana.status, 201, "D: Alana faz venda débito");
    const compAlana = await request(base, "GET", `/api/sales/${saleDebAlana.data.saleId}/comprovante`, undefined, alana);
    equal(compAlana.status, 200, "D: Alana vê comprovante da própria venda");
    equal(compAlana.data.sale.user_name, "Alana dos Santos da Hora", "D: comprovante da Alana mostra Alana");
    equal((await request(base, "GET", `/api/sales/${saleDin.data.saleId}/comprovante`, undefined, alana)).status, 404, "D: Alana NÃO acessa comprovante da Amanda");
    const alanaHistory = await request(base, "GET", "/api/sales", undefined, alana);
    pass(Array.isArray(alanaHistory.data) && alanaHistory.data.every((s: any) => s.user_id === alanaId), "D: Alana vê somente o próprio histórico");
    equal((await request(base, "GET", "/api/receivables", undefined, alana)).status, 403, "D: Alana bloqueada em contas a receber");
    equal((await request(base, "GET", "/api/reports", undefined, alana)).status, 403, "D: Alana bloqueada em relatórios");
    equal((await request(base, "GET", "/api/fiscal/status", undefined, alana)).status, 403, "D: Alana bloqueada em fiscal");
    equal((await request(base, "GET", "/api/billing/plans", undefined, alana)).status, 403, "D: Alana bloqueada em billing");
    equal((await request(base, "GET", "/api/users", undefined, alana)).status, 403, "D: Alana bloqueada em usuários");
    equal((await request(base, "PUT", "/api/settings", { store_name: "X" }, alana)).status, 403, "D: Alana bloqueada em configurações (gravação)");

    // --------------------- G. Caixa: conferência, reforço, fechamento ---------------------
    {
      const current = await request(base, "GET", "/api/cash", undefined, rayane);
      equal(current.status, 200, "G: consulta caixa atual");
      const sess = current.data.current;
      pass(!!sess && sess.id === cashSessionId, "G: caixa aberto encontrado");
      const vendaEntry = (sess.entries as any[]).find((e) => e.type === "venda" && e.sale_id === saleDin.data.saleId);
      pass(!!vendaEntry && vendaEntry.amount_cents === 10900, "G: entrada da venda dinheiro registrada no caixa");
      pass(vendaEntry && vendaEntry.cash_session_id !== null, "G: venda financeira com cash_session_id preenchido");
      const reforco = await request(base, "POST", `/api/cash/${cashSessionId}/entries`, { type: "reforco", amount_cents: 10000, description: "Fundo de troco" }, amanda);
      equal(reforco.status, 201, "G: reforço de caixa registrado");
      const afterReforco = (await request(base, "GET", "/api/cash", undefined, rayane)).data.current;
      const expectedClose = afterReforco.expected_cents as number;
      equal(expectedClose, 10900 + 10900 + (saleCred.data.total_cents as number) + 5900 + 10000, "G: esperado no fechamento confere (vendas com acréscimo do crédito + reforço)");
      const closed = await request(base, "POST", `/api/cash/${cashSessionId}/close`, { closing_cents: expectedClose }, amanda);
      equal(closed.status, 200, "G: caixa fechado");
      equal(closed.data.diff_cents, 0, "G: fechamento sem diferença");
      const saleClosed = await request(base, "POST", "/api/sales", {
        payment_method: "pix",
        items: [{ variation_id: varP1, quantity: 1 }],
      }, amanda);
      equal(saleClosed.status, 400, "G: venda com caixa fechado rejeitada");
      const reopen = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, amanda);
      equal(reopen.status, 201, "G: novo caixa reaberto para continuidade");
    }

    // --------------------- F. Estoque ---------------------
    {
      const v = (await request(base, "GET", `/api/products/${p1Id}`, undefined, rayane)).data.variations[0];
      const stock0 = v.stock as number;
      equal((await request(base, "POST", "/api/stock/movements", { variation_id: varP1, type: "entrada", quantity: 5, reason: "Compra" }, amanda)).status, 201, "F: entrada de estoque");
      equal((await request(base, "POST", "/api/stock/movements", { variation_id: varP1, type: "saida", quantity: 2, reason: "Avaria" }, amanda)).status, 201, "F: saída de estoque");
      const overOut = await request(base, "POST", "/api/stock/movements", { variation_id: varP1, type: "saida", quantity: stock0 + 999 }, amanda);
      equal(overOut.status, 400, "F: saída superior ao estoque bloqueada");
      equal((await request(base, "POST", "/api/stock/movements", { variation_id: varP1, type: "ajuste", quantity: 3, reason: "Contagem" }, amanda)).status, 201, "F: ajuste para valor absoluto");
      equal((await request(base, "POST", "/api/stock/movements", { variation_id: varP1, type: "ajuste", quantity: -1 }, amanda)).status, 400, "F: ajuste negativo rejeitado");
      const afterAdj = (await request(base, "GET", `/api/products/${p1Id}`, undefined, rayane)).data.variations[0].stock;
      equal(afterAdj, 3, "F: estoque final após operações");
      // estoque baixo
      await request(base, "PUT", `/api/products/${p1Id}`, {
        name: "Vestido Homologação Edit",
        sku: "HOM-001",
        description: "",
        category_id: cat.data.id,
        cost_price_cents: 5200,
        sale_price_cents: 10900,
        image_url: "",
        active: true,
        variations: [{ color_id: cor.data.id, size_id: tam.data.id, stock: 3, min_stock: 5 }],
      }, rayane);
      const low = await request(base, "GET", "/api/stock/low", undefined, rayane);
      pass(Array.isArray(low.data) && low.data.some((r: any) => r.id === varP1), "F: variação aparece em estoque baixo");
      // zerado
      equal((await request(base, "POST", "/api/stock/movements", { variation_id: varP1, type: "ajuste", quantity: 0 }, amanda)).status, 201, "F: estoque zerado via ajuste");
      const saleZero = await request(base, "POST", "/api/sales", { payment_method: "pix", items: [{ variation_id: varP1, quantity: 1 }] }, amanda);
      equal(saleZero.status, 400, "F: venda sem estoque rejeitada");
      const movs = await request(base, "GET", "/api/stock/movements?limit=50", undefined, rayane);
      pass(Array.isArray(movs.data) && movs.data.some((m: any) => m.variation_id === varP1 && m.type === "entrada"), "F: histórico de movimentações registrado");
    }

    // --------------------- I. Fiado: parcial, total, quitada ---------------------
    {
      const recList = await request(base, "GET", "/api/receivables", undefined, rayane);
      const row = recList.data.rows.find((r: any) => r.id === recId);
      pass(!!row && row.status === "pendente" && row.remaining_cents === 12400, "I: conta pendente com saldo total (fiado + acréscimo = R$125,00)");
      const partial = await request(base, "POST", `/api/receivables/${recId}/pay`, { amount_cents: 5000, payment_method: "pix" }, rayane);
      equal(partial.status, 200, "I: pagamento parcial aceito");
      equal(partial.data.remaining_cents, 7400, "I: saldo reduzido após parcial");
      const full = await request(base, "POST", `/api/receivables/${recId}/pay`, { amount_cents: 7400, payment_method: "dinheiro" }, rayane);
      equal(full.status, 200, "I: pagamento total aceito");
      equal(full.data.status, "pago", "I: conta quitada após pagamento total");
      const again = await request(base, "POST", `/api/receivables/${recId}/pay`, { amount_cents: 100, payment_method: "pix" }, rayane);
      equal(again.status, 400, "I: pagamento em conta quitada rejeitado");
      const noFiadoInCash = openDb(dbPath, true).prepare("SELECT COUNT(*) AS c FROM cash_entries WHERE type = 'venda' AND sale_id = ?").get(saleFiado.data.saleId) as { c: number };
      equal(noFiadoInCash.c, 0, "I: fiado não entra como dinheiro recebido no caixa");
    }

    // --------------------- E. Produtos: desativação e exclusão ---------------------
    {
      const p4 = await request(base, "POST", "/api/products", {
        name: "Produto Sem Histórico",
        sku: "HOM-004",
        description: "",
        category_id: cat.data.id,
        cost_price_cents: 100,
        sale_price_cents: 200,
        image_url: "",
        variations: [{ color_id: cor.data.id, size_id: tam.data.id, stock: 1, min_stock: 0 }],
      }, rayane);
      equal(p4.status, 201, "E: produto novo criado");
      equal((await request(base, "DELETE", `/api/products/${p4.data.id}`, undefined, rayane)).status, 200, "E: produto sem histórico pode ser excluído");
      const delP1 = await request(base, "DELETE", `/api/products/${p1Id}`, undefined, rayane);
      equal(delP1.status, 400, "E: produto com histórico NÃO é excluído");
      pass(String(delP1.data.error ?? "").includes("desativ"), "E: mensagem orienta desativar");
      const deact = await request(base, "PATCH", `/api/products/${p1Id}/status`, { active: false }, rayane);
      equal(deact.status, 200, "E: produto com histórico desativado");
      const inactiveList = await request(base, "GET", "/api/products?active=0", undefined, rayane);
      pass(inactiveList.data.some((p: any) => p.id === p1Id), "E: produto desativado listado em inativos");
    }

    // --------------------- K. Clientes ---------------------
    {
      equal((await request(base, "PUT", `/api/customers/${cust1Id}`, { name: "Cliente Homolog Edit", phone: "11955554444" }, amanda)).status, 200, "K: cliente editado");
      const search = await request(base, "GET", "/api/customers?search=Homolog%20Edit", undefined, rayane);
      pass(Array.isArray(search.data) && search.data.some((c: any) => c.id === cust1Id), "K: pesquisa de clientes funciona");
      const detail = await request(base, "GET", `/api/customers/${cust1Id}`, undefined, rayane);
      equal(detail.status, 200, "K: detalhes do cliente");
      pass(Array.isArray(detail.data.sales_history), "K: histórico de vendas no detalhe");
      pass(Array.isArray(detail.data.receivables) && detail.data.receivables.some((r: any) => r.id === recId && r.status === "pago"), "K: fiado quitado aparece no cliente");
    }

    // --------------------- L. Pedidos ---------------------
    {
      const pubCat = await request(base, "GET", "/api/catalog/products");
      equal(pubCat.status, 200, "L: catálogo público acessível sem login");
      pass(pubCat.data.some((p: any) => p.id === p2Id), "L: produto ativo aparece no catálogo público");
      const order1 = await request(base, "POST", "/api/orders", {
        customer_name: "Cliente Pedido",
        customer_phone: "11933332222",
        address: "Rua Teste, 10",
        notes: "",
        payment_method: "pix",
        items: [{ variation_id: varP2, quantity: 2 }],
      });
      equal(order1.status, 201, "L: pedido público criado (novo)");
      const o1 = order1.data.order_id as number;
      const badJump = await request(base, "PATCH", `/api/orders/${o1}/status`, { status: "entregue" }, rayane);
      equal(badJump.status, 400, "L: transição inválida rejeitada");
      const confirm = await request(base, "PATCH", `/api/orders/${o1}/status`, { status: "confirmado" }, rayane);
      equal(confirm.status, 200, "L: pedido confirmado");
      const stockAfterConfirm = ((await request(base, "GET", `/api/products/${p2Id}`, undefined, rayane)).data.variations[0] as any).stock;
      equal(stockAfterConfirm, 7, "L: confirmação baixa estoque (6+4-1 venda-2 pedido)");
      equal((await request(base, "PATCH", `/api/orders/${o1}/status`, { status: "em_preparacao" }, rayane)).status, 200, "L: em preparação");
      equal((await request(base, "PATCH", `/api/orders/${o1}/status`, { status: "pronto" }, rayane)).status, 200, "L: pronto");
      equal((await request(base, "PATCH", `/api/orders/${o1}/status`, { status: "entregue" }, rayane)).status, 200, "L: entregue");
      const order2 = await request(base, "POST", "/api/orders", {
        customer_name: "Cliente Cancela",
        customer_phone: "11911112222",
        items: [{ variation_id: varP2, quantity: 1 }],
      });
      const o2 = order2.data.order_id as number;
      await request(base, "PATCH", `/api/orders/${o2}/status`, { status: "confirmado" }, rayane);
      const cancel = await request(base, "PATCH", `/api/orders/${o2}/status`, { status: "cancelado" }, rayane);
      equal(cancel.status, 200, "L: pedido cancelado");
      const stockAfterCancel = ((await request(base, "GET", `/api/products/${p2Id}`, undefined, rayane)).data.variations[0] as any).stock;
      equal(stockAfterCancel, 7, "L: cancelamento restaura estoque");
    }

    // --------------------- M. Multi-tenant ---------------------
    {
      const plans = await request(base, "GET", "/api/onboarding/plans");
      const tenantB = await request(base, "POST", "/api/onboarding", onboardingBody("homolog-beta", "beta@homolog.test", plans.data[0].id));
      equal(tenantB.status, 201, "M: tenant B criado");
      const bLogin = await request(base, "POST", "/api/auth/login", { email: "beta@homolog.test", password: "homolog123" });
      const b = bLogin.data.token as string;

      const bCat = await request(base, "POST", "/api/categories", { name: "Cat B" }, b);
      const bCor = await request(base, "POST", "/api/colors", { name: "Cor B", hex: "#654321" }, b);
      const bTam = await request(base, "POST", "/api/sizes", { name: "Tam B" }, b);
      const bProd = await request(base, "POST", "/api/products", {
        name: "Produto B",
        sku: "B-001",
        description: "",
        category_id: bCat.data.id,
        cost_price_cents: 100,
        sale_price_cents: 300,
        image_url: "",
        variations: [{ color_id: bCor.data.id, size_id: bTam.data.id, stock: 9, min_stock: 0 }],
      }, b);
      const bCust = await request(base, "POST", "/api/customers", { name: "Cliente B" }, b);
      await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, b);
      const bVar = (await request(base, "GET", `/api/products/${bProd.data.id}`, undefined, b)).data.variations[0].id;
      const bSale = await request(base, "POST", "/api/sales", { payment_method: "pix", company_id: 1, items: [{ variation_id: bVar, quantity: 1 }] }, b);
      equal(bSale.status, 201, "M: tenant B cria venda própria");

      const aProds = await request(base, "GET", "/api/products", undefined, rayane);
      pass(!aProds.data.some((p: any) => p.id === bProd.data.id), "M: A não vê produto de B");
      const bProds = await request(base, "GET", "/api/products", undefined, b);
      pass(!bProds.data.some((p: any) => p.id === p1Id || p.id === p2Id), "M: B não vê produtos de A");
      equal((await request(base, "GET", `/api/products/${p1Id}`, undefined, b)).status, 404, "M: B não acessa produto A diretamente");
      const bCrossSale = await request(base, "POST", "/api/sales", { payment_method: "pix", items: [{ variation_id: varP2, quantity: 1 }] }, b);
      equal(bCrossSale.status, 400, "M: B não vende variação de A");
      const bCusts = await request(base, "GET", "/api/customers", undefined, b);
      pass(!bCusts.data.some((c: any) => c.id === cust1Id), "M: B não vê cliente de A");
      equal((await request(base, "GET", `/api/customers/${cust1Id}`, undefined, b)).status, 404, "M: B não acessa cliente A");
      const bSales = await request(base, "GET", "/api/sales", undefined, b);
      pass(!bSales.data.some((s: any) => s.id === saleDin.data.saleId), "M: B não vê vendas de A");
      const bOrders = await request(base, "GET", "/api/orders", undefined, b);
      pass(!bOrders.data.some((o: any) => o.id === (order1?.data?.order_id ?? -1)), "M: B não vê pedidos de A");
      const bCats = await request(base, "GET", "/api/categories", undefined, b);
      pass(!bCats.data.some((c: any) => c.name === "Cat Homolog"), "M: categorias isoladas por tenant");
      equal((await requestRaw(base, `/api/products/${p1Id}/image`, jpegBytes(0x31), "image/jpeg", b)).status, 404, "M: B não envia foto em produto de A");
      equal((await request(base, "DELETE", `/api/products/${p1Id}/image`, undefined, b)).status, 404, "M: B não remove foto de A");
      equal((await request(base, "GET", "/api/billing/plans", undefined, b)).status, 200, "M: billing do tenant B acessível ao próprio admin");
      {
        const dbv = openDb(dbPath, true);
        const bSaleRow = dbv.prepare("SELECT company_id FROM sales WHERE id = ?").get(bSale.data.saleId) as { company_id: number };
        pass(bSaleRow.company_id !== 1, "M: company_id enviado pelo cliente é ignorado (venda fica no tenant B)");
        dbv.close();
      }
    }

    // --------------------- N. Integridade global ---------------------
    {
      const dbv = openDb(dbPath, true);
      const neg = dbv.prepare("SELECT COUNT(*) AS c FROM product_variations WHERE stock < 0").get() as { c: number };
      equal(neg.c, 0, "N: nenhuma variação com estoque negativo");
      const nullCash = dbv.prepare("SELECT COUNT(*) AS c FROM cash_entries WHERE type = 'venda' AND cash_session_id IS NULL").get() as { c: number };
      equal(nullCash.c, 0, "N: nenhuma venda financeira com cash_session_id NULL");
      const integrity = dbv.pragma("integrity_check", { simple: true });
      const fks = dbv.pragma("foreign_key_check").length;
      dbv.close();
      equal(integrity, "ok", "N: integrity_check = ok");
      equal(fks, 0, "N: foreign_key_check = 0");
    }

    console.log(JSON.stringify({ status: "PASS", checks }));
  } finally {
    await stopProcess(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});