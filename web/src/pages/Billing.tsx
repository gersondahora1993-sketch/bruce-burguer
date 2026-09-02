import { useEffect, useState } from "react";
import { Badge, Card, PageHeader, PageLoader } from "../components/ui";
import { api } from "../api/client";
import { money } from "../lib/format";

interface Subscription {
  status: "trialing" | "active" | "past_due" | "grace_period" | "suspended" | "canceled" | "expired";
  plan_name: string;
  amount_cents_snapshot: number;
  trial_ends_at: string | null;
  next_billing_at: string | null;
  current_period_end: string | null;
}

interface Payment {
  id: number;
  amount_cents: number;
  due_at: string;
  paid_at: string | null;
  status: string;
}

const STATUS_LABELS: Record<Subscription["status"], string> = {
  trialing: "Trial",
  active: "Ativa",
  past_due: "Pagamento pendente",
  grace_period: "Período de tolerância",
  suspended: "Suspensa",
  canceled: "Cancelada",
  expired: "Expirada",
};

function statusTone(status: Subscription["status"]): "emerald" | "amber" | "red" | "zinc" {
  if (status === "trialing" || status === "active") return "emerald";
  if (status === "past_due" || status === "grace_period") return "amber";
  if (status === "suspended" || status === "canceled" || status === "expired") return "red";
  return "zinc";
}

function date(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("pt-BR") : "-";
}

export default function Billing() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api.get<Subscription>("/api/billing/subscription"),
      api.get<Payment[]>("/api/billing/payments"),
    ])
      .then(([current, history]) => {
        setSubscription(current);
        setPayments(history);
      })
      .catch((err: any) => setError(err?.message ?? "Não foi possível carregar a assinatura."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader />;
  if (error) return <Card className="p-5 text-sm text-rose-700">{error}</Card>;
  if (!subscription) return <Card className="p-5">Nenhuma assinatura encontrada.</Card>;

  return (
    <div>
      <PageHeader title="Assinatura" subtitle="Plano, trial e histórico de pagamentos" />
      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <Card className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-xs uppercase tracking-widest text-zinc-400">Plano atual</p><h2 className="mt-1 text-xl font-bold text-zinc-900">{subscription.plan_name}</h2></div>
            <Badge tone={statusTone(subscription.status)}>{STATUS_LABELS[subscription.status]}</Badge>
          </div>
          <p className="text-2xl font-bold text-rose-600">{money(subscription.amount_cents_snapshot)}<span className="text-sm font-normal text-zinc-400">/mês</span></p>
          {subscription.status === "trialing" && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">Trial ativo até {date(subscription.trial_ends_at)}.</p>}
          {subscription.status !== "trialing" && <p className="text-sm text-zinc-500">Próxima cobrança: {date(subscription.next_billing_at ?? subscription.current_period_end)}</p>}
        </Card>
        <Card className="p-5"><h2 className="mb-4 font-semibold text-zinc-900">Histórico de cobranças</h2><div className="space-y-2">{payments.length === 0 ? <p className="text-sm text-zinc-500">Nenhuma cobrança registrada.</p> : payments.map((payment) => <div className="flex items-center justify-between rounded-lg bg-zinc-50 p-3 text-sm" key={payment.id}><span>{date(payment.due_at)}</span><span className="font-medium">{money(payment.amount_cents)}</span><Badge tone={payment.status === "paid" ? "emerald" : "amber"}>{payment.status}</Badge></div>)}</div></Card>
      </div>
    </div>
  );
}
