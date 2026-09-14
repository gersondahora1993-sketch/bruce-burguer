import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDefaultPlans, initSchema, migrateSchema, seed } from "./db.js";
import { requireAuth, requireRole, requireSubscriptionContext, requireTenant } from "./auth.js";
import { env } from "./config.js";

import authRoutes from "./routes/auth.js";
import categoriesRoutes from "./routes/categories.js";
import colorsRoutes from "./routes/colors.js";
import sizesRoutes from "./routes/sizes.js";
import productsRoutes from "./routes/products.js";
import stockRoutes from "./routes/stock.js";
import salesRoutes from "./routes/sales.js";
import customersRoutes from "./routes/customers.js";
import reportsRoutes from "./routes/reports.js";
import dashboardRoutes from "./routes/dashboard.js";
import settingsRoutes from "./routes/settings.js";
import receivablesRoutes from "./routes/receivables.js";
import cashRoutes from "./routes/cash.js";
import ordersRoutes from "./routes/orders.js";
import catalogRoutes from "./routes/publicCatalog.js";
import fiscalRoutes from "./routes/fiscal.js";
import onboardingRoutes from "./routes/onboarding.js";
import billingRoutes from "./routes/billing.js";
import usersRoutes from "./routes/users.js";
import businessSettingsRoutes from "./routes/businessSettings.js";
import addonsRoutes from "./routes/addons.js";
import combosRoutes from "./routes/combos.js";

initSchema();
migrateSchema();
ensureDefaultPlans();
seed();

const app = express();
if (env.corsOrigin) {
  app.use(cors({ origin: env.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean) }));
} else {
  if (env.isProduction) {
    console.warn("[cors] CORS liberado para qualquer origem. Defina CORS_ORIGIN em produção.");
  }
  app.use(cors());
}
app.use(express.json({ limit: "20mb" }));
app.use(express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Bruce Burguer API", env: env.nodeEnv, time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/billing", requireAuth, requireTenant, requireSubscriptionContext, requireRole("admin"), billingRoutes);
app.use("/api/users", requireAuth, requireTenant, requireSubscriptionContext, requireRole("admin"), usersRoutes);

app.use("/api/catalog", catalogRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/business-settings", requireAuth, requireTenant, businessSettingsRoutes);
app.use("/api/categories", requireAuth, requireTenant, requireSubscriptionContext, categoriesRoutes);
app.use("/api/products", requireAuth, requireTenant, requireSubscriptionContext, productsRoutes);
app.use("/api/addons", requireAuth, requireTenant, requireSubscriptionContext, addonsRoutes);
app.use("/api/combos", requireAuth, requireTenant, requireSubscriptionContext, combosRoutes);
app.use("/api/colors", requireAuth, requireTenant, requireSubscriptionContext, colorsRoutes);
app.use("/api/sizes", requireAuth, requireTenant, requireSubscriptionContext, sizesRoutes);
app.use("/api/products", requireAuth, requireTenant, requireSubscriptionContext, productsRoutes);
app.use("/api/stock", requireAuth, requireTenant, requireSubscriptionContext, stockRoutes);
app.use("/api/sales", requireAuth, requireTenant, requireSubscriptionContext, salesRoutes);
app.use("/api/customers", requireAuth, requireTenant, requireSubscriptionContext, customersRoutes);
app.use("/api/reports", requireAuth, requireTenant, requireSubscriptionContext, reportsRoutes);
app.use("/api/dashboard", requireAuth, requireTenant, requireSubscriptionContext, dashboardRoutes);
app.use("/api/settings", requireAuth, requireTenant, requireSubscriptionContext, settingsRoutes);
app.use("/api/receivables", requireAuth, requireTenant, requireSubscriptionContext, receivablesRoutes);
app.use("/api/cash", requireAuth, requireTenant, requireSubscriptionContext, cashRoutes);
app.use("/api/fiscal", requireAuth, requireTenant, requireSubscriptionContext, fiscalRoutes);

/* --------------------- Frontend estático (produção) --------------------- */

const here = path.dirname(fileURLToPath(import.meta.url));

/* --------------------- Fotos dos produtos --------------------- */
fs.mkdirSync(env.uploadsDir, { recursive: true });
app.use("/uploads", express.static(env.uploadsDir, { maxAge: "7d" }));
console.log(`✔ Uploads servidos de ${env.uploadsDir}`);

function findWebDist(): string | null {
  const candidates = [
    process.env.WEB_DIST,
    path.resolve(process.cwd(), "web/dist"),
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(here, "../../web/dist"),
    path.resolve(here, "../../../web/dist"),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

const webDist = findWebDist();
if (webDist) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
  console.log(`✔ Frontend servido de ${webDist}`);
} else {
  console.warn(
    "[web] web/dist não encontrado — servindo apenas a API. " +
      "Para servir o frontend junto, rode npm run build (gera web/dist)."
  );
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "Imagem muito grande. Envie uma foto de até 5 MB." });
    return;
  }
  if (err?.type === "entity.unsupported.media.type") {
    res.status(415).json({ error: "Tipo de imagem não suportado. Use JPG, PNG ou WEBP." });
    return;
  }
  console.error(err);
  res.status(err.status ?? 500).json({ error: err?.message ?? "Erro interno do servidor." });
});

export { app };

if (process.env.NODE_ENV !== "test") {
  app.listen(env.port, env.host, () => {
    console.log(`✔ API Bruce Burguer rodando em http://${env.host}:${env.port} (${env.nodeEnv})`);
  });
}
