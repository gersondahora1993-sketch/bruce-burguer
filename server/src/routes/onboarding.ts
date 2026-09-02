import { Router } from "express";
import bcrypt from "bcryptjs";
import { addDaysUtc, addMonthsUtc, billingNow } from "../billing.js";
import { db } from "../db.js";
import type { Request, Response } from "express";

const router = Router();

class OnboardingError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validEmail(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value);
}

function hasControlledField(body: any): boolean {
  return ["company_id", "status", "trial_ends_at", "amount_cents"].some((key) =>
    Object.prototype.hasOwnProperty.call(body, key),
  );
}

router.get("/plans", (_req: Request, res: Response) => {
  const plans = db
    .prepare(
      `SELECT id, code, name, description, amount_cents, currency, interval_unit, interval_count,
              trial_days, features_json, limits_json
         FROM plans
        WHERE active = 1
        ORDER BY amount_cents ASC, id ASC`,
    )
    .all();
  res.json(plans);
});

router.post("/", (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (hasControlledField(body)) {
    res.status(400).json({ error: "Campos de assinatura são definidos pelo servidor." });
    return;
  }

  const company = body.company ?? {};
  const admin = body.admin ?? {};
  const name = text(company.name);
  const slug = text(company.slug).toLowerCase();
  const cnpj = text(company.cnpj);
  const phone = text(company.phone);
  const adminName = text(admin.name);
  const email = text(admin.email).toLowerCase();
  const password = typeof admin.password === "string" ? admin.password : "";
  const planId = Number(body.plan_id);

  if (!name || name.length > 160) {
    res.status(400).json({ error: "Informe um nome de empresa válido." });
    return;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    res.status(400).json({ error: "Informe um slug válido usando letras minúsculas, números e hífens." });
    return;
  }
  if (!adminName || !validEmail(email) || password.length < 6) {
    res.status(400).json({ error: "Informe nome, e-mail válido e senha com pelo menos 6 caracteres." });
    return;
  }
  if (!Number.isSafeInteger(planId) || planId <= 0) {
    res.status(400).json({ error: "Selecione um plano válido." });
    return;
  }

  try {
    const result = db.transaction(() => {
      const plan = db
        .prepare("SELECT id, code, name, description, amount_cents, currency, trial_days FROM plans WHERE id = ? AND active = 1")
        .get(planId) as
        | { id: number; code: string; name: string; description: string; amount_cents: number; currency: string; trial_days: number }
        | undefined;
      if (!plan) throw new OnboardingError("Plano inexistente ou inativo.", 400);

      const timestamp = billingNow();
      const trialEnds = addDaysUtc(timestamp, plan.trial_days);
      const companyInfo = db
        .prepare(
          `INSERT INTO companies (name, slug, cnpj, status, created_at, updated_at)
           VALUES (?, ?, ?, 'ativo', ?, ?)`,
        )
        .run(name, slug, cnpj || null, timestamp, timestamp);
      const companyId = Number(companyInfo.lastInsertRowid);

      if (phone) {
        db.prepare("INSERT INTO settings (company_id, key, value) VALUES (?, 'store_phone', ?)").run(companyId, phone);
      }

      const userInfo = db
        .prepare(
          `INSERT INTO users (name, email, password_hash, role, active, company_id, created_at)
           VALUES (?, ?, ?, 'admin', 1, ?, ?)`,
        )
        .run(adminName, email, bcrypt.hashSync(password, 10), companyId, timestamp);
      const userId = Number(userInfo.lastInsertRowid);

      const subscriptionInfo = db
        .prepare(
          `INSERT INTO subscriptions
            (company_id, plan_id, status, started_at, trial_started_at, trial_ends_at, next_billing_at,
             amount_cents_snapshot, currency, provider, created_at, updated_at)
           VALUES (?, ?, 'trialing', ?, ?, ?, ?, ?, ?, 'internal', ?, ?)`,
        )
        .run(companyId, plan.id, timestamp, timestamp, trialEnds, trialEnds, plan.amount_cents, plan.currency, timestamp, timestamp);
      const subscriptionId = Number(subscriptionInfo.lastInsertRowid);
      const billingPeriodEnd = addMonthsUtc(trialEnds, 1);

      const paymentInfo = db
        .prepare(
          `INSERT INTO payments
            (company_id, subscription_id, amount_cents, currency, billing_period_start, billing_period_end,
             due_at, status, payment_method_type, provider, idempotency_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'simulated', 'internal', ?, ?, ?)`,
        )
        .run(companyId, subscriptionId, plan.amount_cents, plan.currency, trialEnds, billingPeriodEnd, trialEnds, `onboarding:${subscriptionId}`, timestamp, timestamp);
      const paymentId = Number(paymentInfo.lastInsertRowid);

      db.prepare(
        `INSERT INTO billing_events
          (company_id, subscription_id, payment_id, provider, external_event_id, event_type, payload_json, processing_status, processed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'internal', ?, 'subscription.created', ?, 'processed', ?, ?, ?)`,
      ).run(
        companyId,
        subscriptionId,
        paymentId,
        `subscription:${subscriptionId}:created`,
        JSON.stringify({ plan_id: plan.id, trial_ends_at: trialEnds }),
        timestamp,
        timestamp,
        timestamp,
      );

      return {
        company: { id: companyId, name, slug },
        user: { id: userId, name: adminName, email, role: "admin" },
        subscription: { id: subscriptionId, status: "trialing", trial_ends_at: trialEnds },
        payment: { id: paymentId, status: "pending", amount_cents: plan.amount_cents, due_at: trialEnds },
        plan: { id: plan.id, code: plan.code, name: plan.name, trial_days: plan.trial_days },
      };
    })();

    res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof OnboardingError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (String(err?.message ?? err).includes("UNIQUE")) {
      res.status(409).json({ error: "Empresa ou e-mail já cadastrado." });
      return;
    }
    res.status(400).json({ error: "Não foi possível concluir a adesão." });
  }
});

export default router;
