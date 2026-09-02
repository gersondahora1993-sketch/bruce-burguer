import { db } from "./db.js";

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "grace_period",
  "suspended",
  "canceled",
  "expired",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  trialing: ["active", "expired", "canceled"],
  active: ["past_due", "canceled"],
  past_due: ["active", "grace_period", "canceled"],
  grace_period: ["active", "suspended", "canceled"],
  suspended: ["active", "canceled"],
  canceled: [],
  expired: [],
};

export function billingNow(): string {
  return new Date().toISOString();
}

export function addDaysUtc(value: string, days: number): string {
  return new Date(Date.parse(value) + days * 24 * 60 * 60 * 1000).toISOString();
}

export function addMonthsUtc(value: string, months: number): string {
  const date = new Date(value);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

export function getCurrentSubscription(companyId: number): any | null {
  return (
    db
      .prepare(
        `SELECT s.*, p.code AS plan_code, p.name AS plan_name, p.description AS plan_description,
                p.features_json, p.limits_json
           FROM subscriptions s
           JOIN plans p ON p.id = s.plan_id
          WHERE s.company_id = ?
          ORDER BY s.id DESC
          LIMIT 1`
      )
      .get(companyId) ?? null
  );
}

export function canAccessSubscription(subscription: { status: SubscriptionStatus } | null): boolean {
  return !!subscription && ["trialing", "active", "past_due", "grace_period"].includes(subscription.status);
}

export function transitionSubscription(
  subscriptionId: number,
  nextStatus: SubscriptionStatus,
  timestamp = billingNow(),
): any {
  const current = db.prepare("SELECT id, status FROM subscriptions WHERE id = ?").get(subscriptionId) as
    | { id: number; status: SubscriptionStatus }
    | undefined;
  if (!current) throw new Error("Assinatura não encontrada.");
  if (current.status === nextStatus) return current;
  if (!TRANSITIONS[current.status].includes(nextStatus)) {
    throw new Error(`Transição de assinatura inválida: ${current.status} -> ${nextStatus}.`);
  }

  db.prepare(
    `UPDATE subscriptions
        SET status = ?, canceled_at = CASE WHEN ? = 'canceled' THEN ? ELSE canceled_at END,
            updated_at = ?
      WHERE id = ?`
  ).run(nextStatus, nextStatus, timestamp, timestamp, subscriptionId);

  return { ...current, status: nextStatus };
}
