import { db } from "./db.js";
export const SUBSCRIPTION_STATUSES = [
    "trialing",
    "active",
    "past_due",
    "grace_period",
    "suspended",
    "canceled",
    "expired",
];
const TRANSITIONS = {
    trialing: ["active", "expired", "canceled"],
    active: ["past_due", "canceled"],
    past_due: ["active", "grace_period", "canceled"],
    grace_period: ["active", "suspended", "canceled"],
    suspended: ["active", "canceled"],
    canceled: [],
    expired: [],
};
export function billingNow() {
    return new Date().toISOString();
}
export function addDaysUtc(value, days) {
    return new Date(Date.parse(value) + days * 24 * 60 * 60 * 1000).toISOString();
}
export function addMonthsUtc(value, months) {
    const date = new Date(value);
    date.setUTCMonth(date.getUTCMonth() + months);
    return date.toISOString();
}
export function getCurrentSubscription(companyId) {
    return (db
        .prepare(`SELECT s.*, p.code AS plan_code, p.name AS plan_name, p.description AS plan_description,
                p.features_json, p.limits_json
           FROM subscriptions s
           JOIN plans p ON p.id = s.plan_id
          WHERE s.company_id = ?
          ORDER BY s.id DESC
          LIMIT 1`)
        .get(companyId) ?? null);
}
export function canAccessSubscription(subscription) {
    return !!subscription && ["trialing", "active", "past_due", "grace_period"].includes(subscription.status);
}
export function transitionSubscription(subscriptionId, nextStatus, timestamp = billingNow()) {
    const current = db.prepare("SELECT id, status FROM subscriptions WHERE id = ?").get(subscriptionId);
    if (!current)
        throw new Error("Assinatura não encontrada.");
    if (current.status === nextStatus)
        return current;
    if (!TRANSITIONS[current.status].includes(nextStatus)) {
        throw new Error(`Transição de assinatura inválida: ${current.status} -> ${nextStatus}.`);
    }
    db.prepare(`UPDATE subscriptions
        SET status = ?, canceled_at = CASE WHEN ? = 'canceled' THEN ? ELSE canceled_at END,
            updated_at = ?
      WHERE id = ?`).run(nextStatus, nextStatus, timestamp, timestamp, subscriptionId);
    return { ...current, status: nextStatus };
}
