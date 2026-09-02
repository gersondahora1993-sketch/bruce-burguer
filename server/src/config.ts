import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

export type NodeEnv = "development" | "test" | "production";
export type DbInitMode = "demo" | "schema";

function loadProductionEnvFile(): void {
  if (process.env.NODE_ENV !== "production") return;
  const file = path.join(process.cwd(), ".env.production");
  if (!fs.existsSync(file)) return;
  const parsed: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].replace(/^["']|["']$/g, "");
    if (m[2].startsWith('"') && m[2].endsWith('"')) value = value.replace(/\\n/g, "\n");
    if (process.env[key] === undefined) parsed[key] = value;
  }
  Object.assign(process.env, parsed);
  console.log("✔ .env.production carregado (apenas variáveis ainda não definidas)");
}

loadProductionEnvFile();

function readStr(name: string): string {
  const v = process.env[name];
  return v === undefined ? "" : v.trim();
}

function mustHave(name: string, minLength: number): string {
  const v = readStr(name);
  if (!v || v.length < minLength) {
    throw new Error(
      `Variável de ambiente ausente ou muito curta: ${name} (mínimo ${minLength} caracteres). ` +
        `Copie server/.env.example para server/.env e preencha os valores.`
    );
  }
  return v;
}

function optionalPositiveInt(name: string): number | null {
  const raw = readStr(name);
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Variável de ambiente inválida: ${name} deve ser um inteiro positivo.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Variável de ambiente inválida: ${name} deve ser um inteiro positivo.`);
  }
  return value;
}

export const env = {
  nodeEnv: (readStr("NODE_ENV") || "development") as NodeEnv,
  isProduction: process.env.NODE_ENV === "production",
  port: Number(readStr("PORT")) || 3001,
  host: readStr("HOST") || "0.0.0.0",
  jwtSecret: mustHave("JWT_SECRET", 32),
  dbPath: readStr("DB_PATH"), // vazio = server/data/nyellen.db (apenas desenvolvimento)
  uploadsDir: readStr("UPLOADS_DIR") || path.resolve(process.cwd(), "uploads"), // fotos dos produtos
  dbInit: (readStr("DB_INIT") || (process.env.NODE_ENV === "production" ? "schema" : "demo")) as DbInitMode, // 'demo' (dev) | 'schema' (produção)
  corsOrigin: readStr("CORS_ORIGIN"), // vazio = liberado (dev); produção: https://seudominio.com
  publicUrl: readStr("PUBLIC_URL"), // vazio = auto (usada para links absolutos externos)
  publicCompanyId: Number(readStr("PUBLIC_COMPANY_ID")) || (process.env.NODE_ENV === "production" ? 0 : 1),
  legacyCompanyId: optionalPositiveInt("LEGACY_COMPANY_ID"),
} as const;

// Em produção o banco NUNCA pode cair no caminho padrão local (efêmero no Railway).
// Sem DB_PATH explícita o processo aborta com instruções em vez de criar um banco
// invisível dentro do container que se perde a cada redeploy.
if (env.isProduction && !env.dbPath) {
  throw new Error(
    "Produção exige DB_PATH: defina a variável de ambiente DB_PATH apontando para o arquivo " +
      "persistente do banco (ex.: no Railway: DB_PATH=/data/nyellen.db com volume montado em /data). " +
      "Sem ela o sistema usaria server/data/nyellen.db (banco demo de desenvolvimento)."
  );
}

if (env.isProduction) {
  console.log(`[config] DB_PATH do ambiente: ${env.dbPath}`);
}
