import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Field, Input, PageLoader, Select } from "../components/ui";
import { api } from "../api/client";
import { money } from "../lib/format";

interface Plan {
  id: number;
  code: string;
  name: string;
  description: string;
  amount_cents: number;
  currency: string;
  interval_unit: string;
  trial_days: number;
}

interface OnboardingResult {
  company: { id: number; name: string; slug: string };
  subscription: { status: string; trial_ends_at: string };
}

export default function Onboarding() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    companyName: "",
    slug: "",
    cnpj: "",
    phone: "",
    adminName: "",
    email: "",
    password: "",
    planId: "",
  });

  useEffect(() => {
    api
      .get<Plan[]>('/api/onboarding/plans')
      .then((items) => {
        setPlans(items);
        if (items[0]) setForm((current) => ({ ...current, planId: String(items[0].id) }));
      })
      .catch((err: any) => setError(err?.message ?? "Não foi possível carregar os planos."));
  }, []);

  function setField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const data = await api.post<OnboardingResult>('/api/onboarding', {
        company: { name: form.companyName, slug: form.slug, cnpj: form.cnpj, phone: form.phone },
        admin: { name: form.adminName, email: form.email, password: form.password },
        plan_id: Number(form.planId),
      });
      setResult(data);
    } catch (err: any) {
      setError(err?.message ?? "Não foi possível concluir a adesão.");
    } finally {
      setSaving(false);
    }
  }

  if (!plans) return <PageLoader />;

  if (result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-rose-50 via-zinc-50 to-rose-100 p-4">
        <Card className="w-full max-w-lg space-y-4 p-6 sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-widest text-rose-600">Adesão concluída</p>
          <h1 className="font-display text-3xl font-bold text-zinc-900">{result.company.name}</h1>
          <p className="text-sm text-zinc-600">Seu trial está ativo até {new Date(result.subscription.trial_ends_at).toLocaleDateString("pt-BR")}.</p>
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">Status: TRIALING · 30 dias para conhecer o sistema.</p>
          <Link className="inline-flex font-medium text-rose-600 hover:text-rose-700" to="/login">Ir para o login</Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-rose-600">Nyellen Fashion SaaS</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-zinc-900">Comece seu trial de 30 dias</h1>
          <p className="mt-2 text-sm text-zinc-500">Crie sua empresa e o primeiro administrador.</p>
        </div>
        <Card className="p-5 sm:p-8">
          <form className="space-y-5" onSubmit={submit}>
            {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome da empresa" required><Input value={form.companyName} onChange={(e) => setField("companyName", e.target.value)} /></Field>
              <Field label="Slug" required><Input value={form.slug} onChange={(e) => setField("slug", e.target.value)} placeholder="minha-loja" /></Field>
              <Field label="CNPJ"><Input value={form.cnpj} onChange={(e) => setField("cnpj", e.target.value)} /></Field>
              <Field label="Telefone"><Input value={form.phone} onChange={(e) => setField("phone", e.target.value)} /></Field>
            </div>
            <div className="border-t border-zinc-100 pt-5">
              <p className="mb-4 text-sm font-semibold text-zinc-800">Administrador</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nome" required><Input value={form.adminName} onChange={(e) => setField("adminName", e.target.value)} /></Field>
                <Field label="E-mail" required><Input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} /></Field>
                <Field label="Senha" required><Input type="password" minLength={6} value={form.password} onChange={(e) => setField("password", e.target.value)} /></Field>
              </div>
            </div>
            <Field label="Plano" required>
              <Select value={form.planId} onChange={(e) => setField("planId", e.target.value)}>
                {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {money(plan.amount_cents)}/mês · trial {plan.trial_days} dias</option>)}
              </Select>
            </Field>
            <Button type="submit" loading={saving} className="w-full">Criar minha conta</Button>
            <p className="text-center text-sm text-zinc-500">Já possui acesso? <Link className="font-medium text-rose-600" to="/login">Entrar</Link></p>
          </form>
        </Card>
      </div>
    </div>
  );
}
