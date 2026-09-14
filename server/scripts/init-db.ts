/**
 * Inicialização segura do banco de dados.
 *
 * Uso:
 *   npm run db:init           → Produção: cria o schema e o usuário administrador
 *                               (requer ADMIN_EMAIL e ADMIN_PASSWORD no ambiente).
 *   npm run db:init:demo      → Desenvolvimento: cria o schema + dados de demonstração.
 *
 * Nunca executa seed de demonstração em produção (NODE_ENV=production).
 */
import path from "node:path";
import bcrypt from "bcryptjs";
import { env } from "../src/config.js";
import { db, dbFile, ensureBootstrapCompany, ensureDefaultPlans, initSchema, migrateSchema, seed } from "../src/db.js";

function fail(message: string): never {
  console.error(`[db:init] ${message}`);
  process.exit(1);
}

function validateAdminEnv(email: string, password: string, purpose: string): void {
  if (!email || !password) {
    fail(
      `Para ${purpose}, defina ADMIN_EMAIL e ADMIN_PASSWORD no ambiente\n` +
        "        (.env / .env.production / variáveis do Railway).\n" +
        "        A senha nunca é exibida nem gravada em texto puro.\n" +
        `        Status atual no processo: ADMIN_EMAIL ${email ? "definido" : "NÃO definido"}, ` +
        `ADMIN_PASSWORD ${password ? "definido" : "NÃO definido"}.`
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail(`ADMIN_EMAIL inválido: "${email}".`);
  }
  if (password.length < 6) {
    fail("ADMIN_PASSWORD deve ter pelo menos 6 caracteres.");
  }
}

function main(): void {
  const demo = process.argv.includes("--demo");

  if (demo && env.isProduction) {
    fail("Seed de demonstração proibido em produção (NODE_ENV=production).");
  }

  console.log(`[db:init] NODE_ENV=${env.nodeEnv} (DB_INIT=${env.dbInit})`);
  console.log(`[db:init] Banco: ${dbFile}`);
  console.log(`[db:init] DB_PATH do ambiente: ${env.dbPath ? `"${env.dbPath}"` : "(não definido)"}`);
  if (env.isProduction && !env.dbPath) {
    fail(
      "Produção exige DB_PATH definido no ambiente (ex.: Railway: DB_PATH=/data/bruce-burguer.db). " +
        "Verifique se a variável está configurada no serviço/ambiente correto — o processo atual não a recebeu."
    );
  }
  initSchema();
  migrateSchema();
  ensureBootstrapCompany();
  ensureDefaultPlans();
  console.log("[db:init] Schema verificado/criado (idempotente).");

  if (demo) {
    seed();
    console.log("[db:init] Banco de demonstração pronto.");
    return;
  }

  const userCount = (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;

  if (userCount > 0) {
    const email = (process.env.ADMIN_EMAIL ?? "").trim();
    const password = process.env.ADMIN_PASSWORD ?? "";
    if (!email || !password) {
      console.log(`[db:init] Já existem ${userCount} usuário(s) no banco — nada a fazer.`);
      return;
    }
    validateAdminEnv(email, password, "sincronizar as credenciais do administrador");

    const admin = db
      .prepare("SELECT id, email, password_hash FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
      .get() as { id: number; email: string; password_hash: string } | undefined;
    if (!admin) {
      console.log("[db:init] Nenhum usuário administrador encontrado — nada a sincronizar.");
      return;
    }

    const emailChanged = admin.email.toLowerCase() !== email.toLowerCase();
    const passwordOk = bcrypt.compareSync(password, admin.password_hash);
    if (!emailChanged && passwordOk) {
      console.log(`[db:init] Credenciais do administrador já atualizadas: ${email}`);
      return;
    }

    if (emailChanged) {
      const used = db.prepare("SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?").get(email, admin.id);
      if (used) {
        fail(`ADMIN_EMAIL já está em uso por outro usuário: "${email}".`);
      }
    }
    const newHash = passwordOk ? admin.password_hash : bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET email = ?, password_hash = ? WHERE id = ?").run(email, newHash, admin.id);
    console.log(`[db:init] Credenciais do administrador sincronizadas com o ambiente: ${email}`);
    return;
  }

  const email = (process.env.ADMIN_EMAIL ?? "").trim();
  const password = process.env.ADMIN_PASSWORD ?? "";
  validateAdminEnv(email, password, "criar o administrador do banco de produção");

  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  db.prepare(
    "INSERT INTO users (name, email, password_hash, role, active, created_at) VALUES (?, ?, ?, 'admin', 1, ?)"
  ).run("Administrador", email, bcrypt.hashSync(password, 10), ts);
  console.log(`[db:init] Usuário administrador criado: ${email}`);
  console.log("[db:init] Banco de produção pronto.");
}

main();
