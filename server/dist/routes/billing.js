import { Router } from "express";
import { addMonthsUtc, billingNow, getCurrentSubscription, transitionSubscription } from "../billing.js";
import { db } from "../db.js";
import { env } from "../config.js";
const router = Router();
router.get("/plans", (_req, res) => {
    const plans = db
        .prepare(`SELECT id, code, name, description, amount_cents, currency, interval_unit, interval_count,
              trial_days, features_json, limits_json
         FROM plans
        WHERE active = 1
        ORDER BY amount_cents ASC, id ASC`)
        .all();
    res.json(plans);
});
router.get("/subscription", (req, res) => {
    const subscription = getCurrentSubscription(req.user.company_id);
    if (!subscription) {
        res.status(404).json({ error: "Nenhuma assinatura encontrada para esta empresa." });
        return;
    }
    res.json({ ...subscription, company_status: req.tenant?.status ?? null });
});
router.get("/payments", (req, res) => {
    const payments = db
        .prepare(`SELECT p.id, p.subscription_id, p.amount_cents, p.currency, p.billing_period_start,
              p.billing_period_end, p.due_at, p.paid_at, p.status, p.payment_method_type,
              p.provider, p.failure_code, p.failure_message, p.created_at, p.updated_at
         FROM payments p
        WHERE p.company_id = ?
        ORDER BY p.id DESC`)
        .all(req.user.company_id);
    res.json(payments);
});
router.get("/events", (req, res) => {
    const events = db
        .prepare(`SELECT id, subscription_id, payment_id, provider, external_event_id, event_type,
              processing_status, processed_at, error_message, created_at, updated_at
         FROM billing_events
        WHERE company_id = ?
        ORDER BY id DESC`)
        .all(req.user.company_id);
    res.json(events);
});
router.post("/payments/:id/simulate", (req, res) => {
    if (env.isProduction || !["development", "test"].includes(env.nodeEnv)) {
        res.status(404).json({ error: "Operação disponível somente em desenvolvimento ou teste." });
        return;
    }
    const companyId = req.user.company_id;
    const paymentId = Number(req.params.id);
    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
        res.status(400).json({ error: "Pagamento inválido." });
        return;
    }
    try {
        const result = db.transaction(() => {
            const payment = db
                .prepare("SELECT * FROM payments WHERE id = ? AND company_id = ?")
                .get(paymentId, companyId);
            if (!payment)
                return { status: 404, body: { error: "Pagamento não encontrado." } };
            if (payment.status === "paid") {
                return { status: 200, body: { payment, subscription: getCurrentSubscription(companyId), idempotent: true } };
            }
            if (payment.status !== "pending") {
                return { status: 400, body: { error: "Somente pagamentos pendentes podem ser simulados." } };
            }
            const timestamp = billingNow();
            db.prepare("UPDATE payments SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ? AND company_id = ?").run(timestamp, timestamp, paymentId, companyId);
            const subscription = db
                .prepare("SELECT id, status, current_period_start, current_period_end FROM subscriptions WHERE id = ? AND company_id = ?")
                .get(payment.subscription_id, companyId);
            if (subscription && ["trialing", "past_due", "grace_period"].includes(subscription.status)) {
                transitionSubscription(subscription.id, "active", timestamp);
                db.prepare(`UPDATE subscriptions
              SET current_period_start = ?, current_period_end = ?, next_billing_at = ?, updated_at = ?
            WHERE id = ? AND company_id = ?`).run(timestamp, addMonthsUtc(timestamp, 1), addMonthsUtc(timestamp, 1), timestamp, subscription.id, companyId);
            }
            db.prepare(`INSERT OR IGNORE INTO billing_events
          (company_id, subscription_id, payment_id, provider, external_event_id, event_type, payload_json, processing_status, processed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'internal', ?, 'payment.paid', ?, 'processed', ?, ?, ?)`).run(companyId, payment.subscription_id, paymentId, `payment:${paymentId}:paid`, JSON.stringify({ payment_id: paymentId, amount_cents: payment.amount_cents }), timestamp, timestamp, timestamp);
            return {
                status: 200,
                body: {
                    payment: db.prepare("SELECT * FROM payments WHERE id = ? AND company_id = ?").get(paymentId, companyId),
                    subscription: getCurrentSubscription(companyId),
                    idempotent: false,
                },
            };
        })();
        res.status(result.status).json(result.body);
    }
    catch (err) {
        res.status(400).json({ error: err?.message ?? "Não foi possível simular o pagamento." });
    }
});
export default router;
