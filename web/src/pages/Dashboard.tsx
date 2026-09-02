import { useCallback, useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  Legend,
  CartesianGrid,
} from "recharts";
import {
  Shirt,
  PackageOpen,
  AlertTriangle,
  AlertOctagon,
  Layers,
  ShoppingBag,
  CalendarDays,
  RefreshCw,
  TrendingUp,
  PackageX,
  Archive,
} from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton } from "../components/ui";
import { dayLabel, money } from "../lib/format";
import type { DashboardData } from "../types";

const PIE_COLORS = ["#e11d48", "#fb7185", "#a78bfa", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#64748b"];

function StatCard({ icon: Icon, label, value, tone = "rose", sub }: { icon: any; label: string; value: string; tone?: "rose" | "emerald" | "amber" | "zinc" | "violet" | "red"; sub?: string }) {
  const tones = {
    rose: "bg-rose-100 text-rose-600",
    emerald: "bg-emerald-100 text-emerald-600",
    amber: "bg-amber-100 text-amber-600",
    zinc: "bg-zinc-100 text-zinc-600",
    violet: "bg-violet-100 text-violet-600",
    red: "bg-red-100 text-red-600",
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">{label}</p>
          <p className="mt-1.5 text-xl font-bold text-zinc-900 sm:text-2xl">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon size={20} />
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { error: toastError } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setData(await api.get<DashboardData>("/api/dashboard"));
    } catch (err: any) {
      setFailed(true);
      toastError(err?.message ?? "Não foi possível carregar o dashboard.");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (failed || !data) {
    return (
      <EmptyState
        title="Não foi possível carregar o dashboard"
        description="Verifique se a API está rodando e tente novamente."
        action={
          <Button onClick={load}>
            <RefreshCw size={16} /> Tentar novamente
          </Button>
        }
      />
    );
  }

  const t = data.totals;
  const s = data.sales;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral da sua loja"
        action={
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw size={15} /> Atualizar
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Shirt} label="Produtos" value={String(t.products)} sub={`${t.active_products} ativos`} tone="rose" />
        <StatCard icon={PackageX} label="Sem estoque" value={String(t.out_of_stock_products)} tone="red" />
        <StatCard icon={AlertTriangle} label="Estoque baixo" value={String(t.low_stock_products)} tone="amber" />
        <StatCard icon={Layers} label="Total de peças" value={String(t.total_pieces)} sub={`R$ médio ${t.total_pieces ? money(Math.round(t.stock_value_cents / t.total_pieces)) : "-"}`} tone="violet" />
        <StatCard icon={Archive} label="Valor do estoque" value={money(t.stock_value_cents)} tone="zinc" />
        <StatCard icon={ShoppingBag} label="Vendas hoje" value={`${s.today.count} · ${money(s.today.total_cents)}`} tone="emerald" />
        <StatCard icon={CalendarDays} label="Vendas do mês" value={`${s.month.count} · ${money(s.month.total_cents)}`} tone="emerald" />
        <StatCard icon={TrendingUp} label="Peças vendidas no mês" value={String(s.month.items)} tone="rose" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-rose-600" />
            <h2 className="font-medium text-zinc-900">Vendas por período (14 dias)</h2>
          </div>
          <div className="h-64">
            {data.chart_sales.length === 0 ? (
              <EmptyState title="Sem vendas no período" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.chart_sales} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                  <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: "#a1a1aa" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} tickFormatter={(v) => `R$ ${Math.round(v / 100)}`} width={70} />
                  <Tooltip formatter={(v: any) => money(Number(v))} labelFormatter={dayLabel} />
                  <Line type="monotone" dataKey="total_cents" name="Vendas" stroke="#e11d48" strokeWidth={2.5} dot={{ r: 3, fill: "#e11d48" }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <PackageOpen size={18} className="text-rose-600" />
            <h2 className="font-medium text-zinc-900">Estoque por categoria</h2>
          </div>
          <div className="h-64">
            {data.stock_by_category.length === 0 ? (
              <EmptyState title="Sem dados" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.stock_by_category} dataKey="pieces" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                    {data.stock_by_category.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any, n: any) => [`${v} peças`, n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <AlertOctagon size={18} className="text-rose-600" />
          <h2 className="font-medium text-zinc-900">Produtos mais vendidos (mês)</h2>
        </div>
        <div className="h-64">
          {data.top_products.length === 0 ? (
            <EmptyState title="Sem vendas registradas no mês" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.top_products} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#a1a1aa" }} interval={0} />
                <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} />
                <Tooltip formatter={(v: any, n: any) => (n === "quantity" ? [`${v} unidades`, "Vendidos"] : [money(Number(v)), "Faturamento"])} />
                <Bar dataKey="quantity" name="quantity" fill="#e11d48" radius={[6, 6, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        {data.top_products.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.top_products.map((p, i) => (
              <Badge key={i} tone={i === 0 ? "rose" : "zinc"}>
                {i + 1}º {p.name} · {p.quantity} un · {money(p.total_cents)}
              </Badge>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}