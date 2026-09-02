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
const testSecret = "users-test-secret-only-not-production-123456";

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

function openDb(dbPath: string, readonly = false): Database.Database {
  const db = new Database(dbPath, readonly ? { readonly: true, fileMustExist: true } : {});
  db.pragma("busy_timeout = 5000");
  return db;
}

function databaseSummary(dbPath: string) {
  const db = openDb(dbPath, true);
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  const summary = {
    users: count("users"),
    integrity: db.pragma("integrity_check", { simple: true }),
    foreign_keys: db.pragma("foreign_key_check").length,
  };
  db.close();
  return summary;
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nyellen-users-test-"));
  const dbPath = path.join(tempDir, "users-test.db");
  let checks = 0;
  const pass = (condition: unknown, message: string) => {
    checks += 1;
    assert.ok(condition, message);
  };
  const equal = (actual: unknown, expected: unknown, message: string) => {
    checks += 1;
    assert.deepEqual(actual, expected, message);
  };

  try {
    // ------------------------------------------------------------------
    // TESTE — Seed idempotente dos usuários da loja (executar 2x)
    // ------------------------------------------------------------------
    const seedDb = path.join(tempDir, "seed.db");
    const seedEnv = { NODE_ENV: "test", DB_INIT: "demo", DB_PATH: seedDb, JWT_SECRET: testSecret };
    const seedOne = await runCmd([tsx, "scripts/init-db.ts", "--demo"], seedEnv);
    const seedTwo = await runCmd([tsx, "scripts/init-db.ts", "--demo"], seedEnv);
    pass(seedOne.code === 0, `primeiro seed deveria passar; stderr=${seedOne.err}`);
    pass(seedTwo.code === 0, `segundo seed deveria passar; stderr=${seedTwo.err}`);
    {
      const db = openDb(seedDb, true);
      const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
      equal(count("users"), 4, "seed 2x deveria manter 4 usuários (admin + 3 da loja)");
      const emails = (db.prepare("SELECT email FROM users ORDER BY email").all() as { email: string }[]).map((r) => r.email);
      equal(
        emails.filter((e) => e === "raiani@nyellen.local").length,
        1,
        "raiani@nyellen.local não deveria duplicar"
      );
      equal(
        emails.filter((e) => e === "amanda@nyellen.local").length,
        1,
        "amanda@nyellen.local não deveria duplicar"
      );
      equal(
        emails.filter((e) => e === "alana@nyellen.local").length,
        1,
        "alana@nyellen.local não deveria duplicar"
      );
      const store = db
        .prepare("SELECT email, role, company_id, password_hash FROM users WHERE email IN (?, ?, ?) ORDER BY email")
        .all("raiani@nyellen.local", "amanda@nyellen.local", "alana@nyellen.local") as { email: string; role: string; company_id: number; password_hash: string }[];
      equal(store.length, 3, "os três usuários da loja deveriam existir");
      pass(store.every((u) => u.company_id === 1), "todos os usuários da loja deveriam ter company_id = 1");
      pass(store.every((u) => u.password_hash.startsWith("$2")), "senhas deveriam ser bcrypt hash");
      pass(store.find((u) => u.email === "raiani@nyellen.local")?.role === "admin", "Raiani deveria ser admin");
      pass(
        store.find((u) => u.email === "amanda@nyellen.local")?.role === "vendedora" &&
          store.find((u) => u.email === "alana@nyellen.local")?.role === "vendedora",
        "Amanda e Alana deveriam ser vendedoras"
      );
      db.close();
    }

    // ------------------------------------------------------------------
    // API principal com seed demo
    // ------------------------------------------------------------------
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
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
      stdio: ["ignore", "pipe", "pipe"],
    });
    let childLog = "";
    child.stdout.on("data", (d) => (childLog += String(d)));
    child.stderr.on("data", (d) => (childLog += String(d)));

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
      if (!healthy) {
        const exited = child.exitCode !== null ? `(processo encerrado com código ${child.exitCode})` : "(processo ainda rodando)";
        throw new Error(`API não iniciou no banco temporário com seed demo ${exited}\n--- log do processo ---\n${childLog}`);
      }

      // ------------------------------------------------------------------
      // TESTES 1-3 — Logins
      // ------------------------------------------------------------------
      const rayaneLogin = await request(base, "POST", "/api/auth/login", { email: "raiani@nyellen.local", password: "Rayane@123" });
      const amandaLogin = await request(base, "POST", "/api/auth/login", { email: "amanda@nyellen.local", password: "Amanda@123" });
      const alanaLogin = await request(base, "POST", "/api/auth/login", { email: "alana@nyellen.local", password: "Alana@123" });
      equal(rayaneLogin.status, 200, "1. Rayane consegue login");
      equal(amandaLogin.status, 200, "2. Amanda consegue login");
      equal(alanaLogin.status, 200, "3. Alana consegue login");

      // TESTES 4-5 — Credenciais inválidas
      const wrongPassword = await request(base, "POST", "/api/auth/login", { email: "raiani@nyellen.local", password: "senha-errada" });
      equal(wrongPassword.status, 401, "4. Senha incorreta bloqueia");
      const noUser = await request(base, "POST", "/api/auth/login", { email: "naoexiste@nyellen.local", password: "qualquer123" });
      equal(noUser.status, 401, "5. Usuário inexistente bloqueia");

      // TESTES 6-8 — Roles
      equal(rayaneLogin.data.user.role, "admin", "6. Rayane possui role admin");
      equal(amandaLogin.data.user.role, "vendedora", "7. Amanda possui role vendedora");
      equal(alanaLogin.data.user.role, "vendedora", "8. Alana possui role vendedora");

      const rayaneToken = rayaneLogin.data.token as string;
      const amandaToken = amandaLogin.data.token as string;
      const alanaToken = alanaLogin.data.token as string;

      // TESTE 11 — role enviada pelo cliente é ignorada no login
      const roleInBodyLogin = await request(base, "POST", "/api/auth/login", {
        email: "amanda@nyellen.local",
        password: "Amanda@123",
        role: "admin",
      });
      equal(roleInBodyLogin.status, 200, "login com role no body deveria continuar aceito");
      equal(roleInBodyLogin.data.user.role, "vendedora", "role no body do login é ignorada");

      // TESTE 9 — Usuários pertencem ao tenant correto
      const db = openDb(dbPath, true);
      const users = db
        .prepare("SELECT id, email, role, company_id FROM users WHERE email IN (?, ?, ?) ORDER BY email")
        .all("raiani@nyellen.local", "amanda@nyellen.local", "alana@nyellen.local") as { id: number; email: string; role: string; company_id: number }[];
      equal(users.length, 3, "deveriam existir 3 usuários da loja no banco");
      pass(users.every((u) => u.company_id === 1), "9. Usuários pertencem ao tenant correto");
      const rayaneId = users.find((u) => u.email === "raiani@nyellen.local")!.id;
      const amandaId = users.find((u) => u.email === "amanda@nyellen.local")!.id;
      const alanaId = users.find((u) => u.email === "alana@nyellen.local")!.id;
      db.close();

      // Me endpoint não expõe password_hash
      const me = await request(base, "GET", "/api/auth/me", undefined, amandaToken);
      equal(me.status, 200, "GET /api/auth/me deveria funcionar");
      pass(me.data && !("password_hash" in me.data), "me não deveria expor password_hash");

      // ------------------------------------------------------------------
      // Catálogo do tenant (dados do seed demo)
      // ------------------------------------------------------------------
      const catDb = openDb(dbPath, true);
      const categoryId = (catDb.prepare("SELECT id FROM categories WHERE company_id = 1 ORDER BY id LIMIT 1").get() as { id: number }).id;
      const colorId = (catDb.prepare("SELECT id FROM colors WHERE company_id = 1 ORDER BY id LIMIT 1").get() as { id: number }).id;
      const sizeId = (catDb.prepare("SELECT id FROM sizes WHERE company_id = 1 ORDER BY id LIMIT 1").get() as { id: number }).id;
      const variation = catDb
        .prepare("SELECT id, stock FROM product_variations WHERE company_id = 1 AND stock >= 3 ORDER BY stock DESC LIMIT 1")
        .get() as { id: number; stock: number };
      const variationId = variation.id;
      catDb.close();

      // ------------------------------------------------------------------
      // TESTES 12-13 — Funcionárias criam produto (company_id/role do body ignorados)
      // ------------------------------------------------------------------
      const productPayload = (sku: string) => ({
        name: `Produto ${sku}`,
        sku,
        description: "Criado em teste de permissões",
        category_id: categoryId,
        cost_price_cents: 1000,
        sale_price_cents: 2990,
        company_id: 999,
        role: "admin",
        variations: [{ color_id: colorId, size_id: sizeId, stock: 5, min_stock: 1 }],
      });
      const productAmanda = await request(base, "POST", "/api/products", productPayload("AM-001"), amandaToken);
      const productAlana = await request(base, "POST", "/api/products", productPayload("AL-001"), alanaToken);
      equal(productAmanda.status, 201, "12. Amanda pode criar produto");
      equal(productAlana.status, 201, "13. Alana pode criar produto");
      const prodDb = openDb(dbPath, true);
      const productCompanies = prodDb
        .prepare("SELECT company_id FROM products WHERE sku IN ('AM-001', 'AL-001')")
        .all() as { company_id: number }[];
      pass(productCompanies.every((p) => p.company_id === 1), "10. company_id enviado pelo cliente é ignorado (produtos criados no tenant 1)");
      const amandaRoleAfter = (prodDb.prepare("SELECT role FROM users WHERE id = ?").get(amandaId) as { role: string }).role;
      equal(amandaRoleAfter, "vendedora", "11. role enviada pelo cliente é ignorada (permanece vendedora)");
      prodDb.close();

      // ------------------------------------------------------------------
      // TESTES 14-15 — Funcionárias alteram estoque
      // ------------------------------------------------------------------
      const stockAmanda = await request(base, "POST", "/api/stock/movements", { variation_id: variationId, type: "entrada", quantity: 2, reason: "teste permissões" }, amandaToken);
      const stockAlana = await request(base, "POST", "/api/stock/movements", { variation_id: variationId, type: "entrada", quantity: 2, reason: "teste permissões" }, alanaToken);
      equal(stockAmanda.status, 201, "14. Amanda pode alterar estoque");
      equal(stockAlana.status, 201, "15. Alana pode alterar estoque");

      // ------------------------------------------------------------------
      // TESTES 16-17 — Funcionárias cadastram cliente
      // ------------------------------------------------------------------
      const customerAmanda = await request(base, "POST", "/api/customers", { name: "Cliente Amanda", phone: "11900000001" }, amandaToken);
      const customerAlana = await request(base, "POST", "/api/customers", { name: "Cliente Alana", phone: "11900000002" }, alanaToken);
      equal(customerAmanda.status, 201, "16. Amanda pode cadastrar cliente");
      equal(customerAlana.status, 201, "17. Alana pode cadastrar cliente");
      const customerId = customerAmanda.data.id as number;

      // ------------------------------------------------------------------
      // TESTES 26-27 — Amanda abre e fecha caixa
      // ------------------------------------------------------------------
      const openAmanda = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, amandaToken);
      equal(openAmanda.status, 201, "26. Amanda consegue abrir caixa");

      // TESTES 18/20/22 — Amanda cria venda; user_id do body ignorado
      const saleAmanda = await request(base, "POST", "/api/sales", {
        payment_method: "pix",
        user_id: alanaId,
        items: [{ variation_id: variationId, quantity: 1 }],
      }, amandaToken);
      equal(saleAmanda.status, 201, "18. Amanda pode criar venda");

      // Venda fiado (permitido para funcionária)
      const saleFiadoAmanda = await request(base, "POST", "/api/sales", {
        payment_method: "fiado",
        customer_id: customerId,
        due_date: "2026-12-31",
        user_id: alanaId,
        items: [{ variation_id: variationId, quantity: 1 }],
      }, amandaToken);
      equal(saleFiadoAmanda.status, 201, "Amanda pode fazer venda fiado");

      const closeAmanda = await request(base, "POST", `/api/cash/${openAmanda.data.id}/close`, { closing_cents: 0 }, amandaToken);
      equal(closeAmanda.status, 200, "27. Amanda consegue fechar caixa");

      // ------------------------------------------------------------------
      // TESTES 28-29 — Alana abre e fecha caixa
      // ------------------------------------------------------------------
      const openAlana = await request(base, "POST", "/api/cash/open", { opening_cents: 0 }, alanaToken);
      equal(openAlana.status, 201, "28. Alana consegue abrir caixa");

      // TESTES 19/21/22 — Alana cria venda
      const saleAlana = await request(base, "POST", "/api/sales", {
        payment_method: "pix",
        user_id: amandaId,
        items: [{ variation_id: variationId, quantity: 1 }],
      }, alanaToken);
      equal(saleAlana.status, 201, "19. Alana pode criar venda");

      const closeAlana = await request(base, "POST", `/api/cash/${openAlana.data.id}/close`, { closing_cents: 0 }, alanaToken);
      equal(closeAlana.status, 200, "29. Alana consegue fechar caixa");

      // TESTES 20-22 — Vendedor registrado automaticamente
      const saleDb = openDb(dbPath, true);
      const saleUsers = saleDb
        .prepare("SELECT id, user_id FROM sales ORDER BY id")
        .all() as { id: number; user_id: number | null }[];
      const amandaSale = saleUsers.find((s) => s.id === saleAmanda.data.saleId)!;
      const amandaFiadoSale = saleUsers.find((s) => s.id === saleFiadoAmanda.data.saleId)!;
      const alanaSale = saleUsers.find((s) => s.id === saleAlana.data.saleId)!;
      equal(amandaSale.user_id, amandaId, "20. Venda da Amanda registra Amanda como vendedora");
      equal(alanaSale.user_id, alanaId, "21. Venda da Alana registra Alana como vendedora");
      equal(amandaSale.user_id, amandaId, "22. user_id enviado pelo cliente não altera o vendedor (Amanda)");
      equal(amandaFiadoSale.user_id, amandaId, "22b. venda fiado também registra Amanda");
      equal(alanaSale.user_id, alanaId, "22c. user_id enviado pelo cliente não altera o vendedor (Alana)");
      saleDb.close();

      // ------------------------------------------------------------------
      // TESTES 23-25 — Isolamento por vendedor
      // ------------------------------------------------------------------
      const amandaSeeAlana = await request(base, "GET", `/api/sales/${alanaSale.id}`, undefined, amandaToken);
      equal(amandaSeeAlana.status, 404, "23. Amanda não consegue consultar venda privada de Alana");
      const alanaSeeAmanda = await request(base, "GET", `/api/sales/${amandaSale.id}`, undefined, alanaToken);
      equal(alanaSeeAmanda.status, 404, "23b. Alana não consegue consultar venda privada de Amanda");
      const rayaneSeeAmanda = await request(base, "GET", `/api/sales/${amandaSale.id}`, undefined, rayaneToken);
      equal(rayaneSeeAmanda.status, 200, "24. Rayane consegue consultar venda da Amanda");
      const rayaneSeeAlana = await request(base, "GET", `/api/sales/${alanaSale.id}`, undefined, rayaneToken);
      equal(rayaneSeeAlana.status, 200, "25. Rayane consegue consultar venda da Alana");

      // Lista: Amanda/Alana veem só as próprias; Rayane vê todas e filtra por vendedora
      const amandaList = await request(base, "GET", "/api/sales", undefined, amandaToken);
      const alanaList = await request(base, "GET", "/api/sales", undefined, alanaToken);
      pass(Array.isArray(amandaList.data) && amandaList.data.length === 2 && amandaList.data.every((s: any) => s.user_id === amandaId), "Amanda vê somente as próprias vendas");
      pass(Array.isArray(alanaList.data) && alanaList.data.length === 1 && alanaList.data.every((s: any) => s.user_id === alanaId), "Alana vê somente as próprias vendas");
      const rayaneAll = await request(base, "GET", "/api/sales", undefined, rayaneToken);
      pass(Array.isArray(rayaneAll.data) && rayaneAll.data.length >= 3, "Rayane vê todas as vendas");
      const rayaneByAmanda = await request(base, "GET", `/api/sales?user_id=${amandaId}`, undefined, rayaneToken);
      pass(Array.isArray(rayaneByAmanda.data) && rayaneByAmanda.data.length === 2 && rayaneByAmanda.data.every((s: any) => s.user_id === amandaId), "Rayane filtra vendas por funcionária");

      // Cancelamento cruzado bloqueado
      const crossCancel = await request(base, "DELETE", `/api/sales/${amandaSale.id}`, undefined, alanaToken);
      equal(crossCancel.status, 403, "funcionária não cancela venda de outra funcionária");

      // ------------------------------------------------------------------
      // TESTES 30-35 — Funcionárias bloqueadas no administrativo/financeiro
      // ------------------------------------------------------------------
      equal((await request(base, "GET", "/api/receivables", undefined, amandaToken)).status, 403, "30. Amanda NÃO acessa financeiro (receivables)");
      equal((await request(base, "GET", "/api/receivables", undefined, alanaToken)).status, 403, "31. Alana NÃO acessa financeiro (receivables)");
      equal((await request(base, "GET", "/api/reports", undefined, amandaToken)).status, 403, "32. Amanda NÃO acessa relatórios financeiros");
      equal((await request(base, "GET", "/api/reports", undefined, alanaToken)).status, 403, "33. Alana NÃO acessa relatórios financeiros");
      equal((await request(base, "GET", "/api/users", undefined, amandaToken)).status, 403, "34. Amanda NÃO gerencia usuários");
      equal((await request(base, "GET", "/api/users", undefined, alanaToken)).status, 403, "35. Alana NÃO gerencia usuários");
      equal((await request(base, "POST", "/api/users", { name: "X", email: "x@nyellen.local", password: "123456" }, amandaToken)).status, 403, "funcionária não cria usuário");
      equal((await request(base, "POST", "/api/users", { name: "X", email: "x@nyellen.local", password: "123456", role: "admin" }, alanaToken)).status, 403, "funcionária não cria usuário mesmo com role admin no body");
      equal((await request(base, "GET", "/api/billing/subscription", undefined, amandaToken)).status, 403, "funcionária NÃO acessa billing");
      equal((await request(base, "GET", "/api/billing/plans", undefined, alanaToken)).status, 403, "funcionária NÃO acessa billing/plans");
      equal((await request(base, "GET", "/api/fiscal/documents", undefined, amandaToken)).status, 403, "funcionária NÃO acessa documentos fiscais");
      equal((await request(base, "PUT", "/api/settings", { store_name: "X" }, amandaToken)).status, 403, "funcionária NÃO altera configurações administrativas");
      equal((await request(base, "GET", "/api/settings", undefined, amandaToken)).status, 200, "funcionária consegue ler dados da loja (não sensível)");
      equal((await request(base, "GET", "/api/cash", undefined, amandaToken)).status, 200, "funcionária consegue operar o caixa");
      equal((await request(base, "GET", "/api/dashboard", undefined, amandaToken)).status, 200, "funcionária consegue o dashboard operacional");

      // ------------------------------------------------------------------
      // TESTES 36-38 — Rayane acessa tudo
      // ------------------------------------------------------------------
      equal((await request(base, "GET", "/api/receivables", undefined, rayaneToken)).status, 200, "36. Rayane acessa financeiro");
      equal((await request(base, "GET", "/api/reports", undefined, rayaneToken)).status, 200, "37. Rayane acessa relatórios");
      equal((await request(base, "GET", "/api/users", undefined, rayaneToken)).status, 200, "38. Rayane acessa usuários");
      equal((await request(base, "GET", "/api/billing/plans", undefined, rayaneToken)).status, 200, "Rayane acessa billing");

      // Rayane gerencia usuários (criar, alterar role, desativar, resetar senha)
      const created = await request(base, "POST", "/api/users", { name: "Teste Vendedora", email: "teste.func@nyellen.local", password: "teste123", role: "vendedora", company_id: 999 }, rayaneToken);
      equal(created.status, 201, "Rayane cria usuário (company_id do body ignorado)");
      const newUserId = created.data.id as number;
      const newUserDb = openDb(dbPath, true);
      const newUserCompany = (newUserDb.prepare("SELECT company_id, role FROM users WHERE id = ?").get(newUserId) as { company_id: number; role: string });
      equal(newUserCompany.company_id, 1, "usuário criado pertence ao tenant da Rayane");
      equal(newUserCompany.role, "vendedora", "role criada respeitada");
      newUserDb.close();

      const patched = await request(base, "PATCH", `/api/users/${newUserId}`, { role: "admin", company_id: 5 }, rayaneToken);
      equal(patched.status, 200, "Rayane altera perfil do usuário");
      const patchedUserDb = openDb(dbPath, true);
      const patchedUser = patchedUserDb.prepare("SELECT role, active, company_id FROM users WHERE id = ?").get(newUserId) as { role: string; active: number; company_id: number };
      equal(patchedUser.role, "admin", "role alterada refletida");
      equal(patchedUser.active, 1, "usuário permanece ativo");
      equal(patchedUser.company_id, 1, "company_id não pode ser alterado pelo cliente");
      patchedUserDb.close();

      const resetPw = await request(base, "POST", `/api/users/${newUserId}/password`, { password: "nova123" }, rayaneToken);
      equal(resetPw.status, 200, "Rayane redefine senha");
      const loginAfterReset = await request(base, "POST", "/api/auth/login", { email: "teste.func@nyellen.local", password: "nova123" });
      equal(loginAfterReset.status, 200, "login com a nova senha funciona");
      equal(loginAfterReset.data.user.role, "admin", "novo usuário acessa como admin após revalidação");

      const deactivateNew = await request(base, "PATCH", `/api/users/${newUserId}`, { active: false }, rayaneToken);
      equal(deactivateNew.status, 200, "Rayane desativa usuário");
      const loginDeactivatedNew = await request(base, "POST", "/api/auth/login", { email: "teste.func@nyellen.local", password: "nova123" });
      equal(loginDeactivatedNew.status, 403, "usuário desativado não consegue login");

      // Auto-rebaixamento bloqueado
      const selfDemote = await request(base, "PATCH", `/api/users/${rayaneId}`, { role: "vendedora" }, rayaneToken);
      equal(selfDemote.status, 400, "administradora não pode rebaixar a si mesma");

      // ------------------------------------------------------------------
      // TESTE 39 — Usuário desativado perde acesso após revalidação
      // ------------------------------------------------------------------
      const deactDb = openDb(dbPath);
      deactDb.prepare("UPDATE users SET active = 0 WHERE id = ?").run(amandaId);
      deactDb.close();
      const deactivated = await request(base, "GET", "/api/products", undefined, amandaToken);
      equal(deactivated.status, 401, "39. Usuário desativado perde acesso após revalidação");
      const loginDeactivated = await request(base, "POST", "/api/auth/login", { email: "amanda@nyellen.local", password: "Amanda@123" });
      equal(loginDeactivated.status, 403, "usuário desativado não consegue login");

      // ------------------------------------------------------------------
      // TESTE 40 — Alteração de role no banco é refletida após revalidação
      // ------------------------------------------------------------------
      const roleDb = openDb(dbPath);
      roleDb.prepare("UPDATE users SET role = 'admin', active = 1 WHERE id = ?").run(amandaId);
      roleDb.close();
      const asAdminNow = await request(base, "GET", "/api/users", undefined, amandaToken);
      equal(asAdminNow.status, 200, "40. Alteração de role no banco é refletida após revalidação");
      const roleBackDb = openDb(dbPath);
      roleBackDb.prepare("UPDATE users SET role = 'vendedora' WHERE id = ?").run(amandaId);
      roleBackDb.close();
      const asFuncionariaAgain = await request(base, "GET", "/api/users", undefined, amandaToken);
      equal(asFuncionariaAgain.status, 403, "40b. rebaixamento de role refletido após revalidação");

      // ------------------------------------------------------------------
      // TESTES 41-42 — Integridade
      // ------------------------------------------------------------------
      const finalSummary = databaseSummary(dbPath);
      equal(finalSummary.integrity, "ok", "41. integrity_check = ok");
      equal(finalSummary.foreign_keys, 0, "42. foreign_key_check = 0");

      console.log(
        JSON.stringify({
          status: "PASS",
          checks,
          integrity: finalSummary.integrity,
          foreign_keys: finalSummary.foreign_keys,
        })
      );
    } finally {
      await stopProcess(child);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});