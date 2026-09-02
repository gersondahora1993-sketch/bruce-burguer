import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Download, TrendingUp, ReceiptText, Ticket, Wallet, PackageX, TriangleAlert } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Badge, Button, Card, EmptyState, PageHeader, Select, Skeleton } from "../components/ui";
import { dayLabel, formatDate, money, monthStartIso, todayIso } from "../lib/format";
import type { Category, PaymentMethod, Product, ReportData } from "../types";
import { PAYMENT_OPTIONS } from "../types";

const PAYMENT_LABEL: Record<string, string> = Object.fromEntries(PAYMENT_OPTIONS.map((p) => [p.value, p.label]));

function SectionTitle({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-semibold text-zinc-900">
      <Icon size={17} className="text-rose-600" /> {children}
    </h2>
  );
}

export default function Reports() {
  const { error: toastError } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [categoryId, setCategoryId] = useState("");
  const [productId, setProductId] = useState("");
  const [payment, setPayment] = useState("all");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [c, p] = await Promise.all([
          api.get<Category[]>("/api/categories"),
          api.get<Product[]>("/api/products"),
        ]);
        setCategories(c);
        setProducts(p);
      } catch (err: any) {
        toastError(err?.message ?? "Não foi possível carregar os filtros.");
      }
    };
    load();
  }, [toastError]);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (categoryId) params.set("category_id", categoryId);
      if (productId) params.set("product_id", productId);
      if (payment !== "all") params.set("payment_method", payment);
      setData(await api.get<ReportData>(`/api/reports?${params.toString()}`));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível gerar o relatório.");
    } finally {
      setLoading(false);
    }
  }, [from, to, categoryId, productId, payment, toastError]);

  useEffect(() => {
    run();
  }, [run]);

  function exportCsv() {
    if (!data) return;
    const lines = [
      ["Data", "Produto", "Cor", "Tamanho", "Qtd", "Preço unitário", "Total", "Categoria"].join(";"),
      ...data.items.map((it) =>
        [formatDate(it.created_at), `"${it.product_name}"`, it.color_name, it.size_name, it.quantity, (it.unit_price_cents / 100).toFixed(2).replace(".", ","), (it.total_cents / 100).toFixed(2).replace(".", ","), `"${it.category_name}"`].join(";")
      ),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-vendas-${from}_a_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totals = useMemo(
    () =>
      data
        ? [
            { label: "Vendas no período", value: String(data.summary.count), icon: ReceiptText, tone: "bg-rose-100 text-rose-600" },
            { label: "Faturamento", value: money(data.summary.total_cents), icon: Wallet, tone: "bg-emerald-100 text-emerald-600" },
            { label: "Ticket médio", value: money(data.summary.avg_ticket_cents), icon: Ticket, tone: "bg-violet-100 text-violet-600" },
            { label: "Itens vendidos", value: String(data.items.reduce((a, i) => a + i.quantity, 0)), icon: TrendingUp, tone: "bg-amber-100 text-amber-600" },
          ]
        : [],
    [data]
  );

  return (
    <div>
      <PageHeader
        title="Relatórios"
        subtitle="Análise de vendas, produtos e estoque"
        action={
          <Button variant="secondary" onClick={exportCsv} disabled={!data || data.items.length === 0}>
            <Download size={16} /> Exportar CSV
          </Button>
        }
      />

      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">De</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-rose-500" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Até</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-rose-500" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Categoria</span>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="!py-2.5">
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Produto</span>
            <Select value={productId} onChange={(e) => setProductId(e.target.value)} className="!py-2.5">
              <option value="">Todos</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Pagamento</span>
            <Select value={payment} onChange={(e) => setPayment(e.target.value)} className="!py-2.5">
              <option value="all">Todos</option>
              {PAYMENT_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      {loading || !data ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {totals.map((t) => (
              <Card key={t.label} className="flex items-center gap-3 p-4">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${t.tone}`}>
                  <t.icon size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs tracking-wide text-zinc-400 uppercase">{t.label}</p>
                  <p className="truncate text-xl font-bold text-zinc-900">{t.value}</p>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-5">
              <SectionTitle icon={TrendingUp}>Vendas por dia</SectionTitle>
              {data.daily.length === 0 ? (
                <EmptyState title="Sem vendas no período" />
              ) : (
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.daily} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                      <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: "#a1a1aa" }} />
                      <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} tickFormatter={(v) => `R$ ${Math.round(Number(v) / 100)}`} width={70} />
                      <Tooltip formatter={(v: any) => money(Number(v))} />
                      <Bar dataKey="total_cents" name="Faturamento" fill="#e11d48" radius={[6, 6, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="mt-3 space-y-1">
                {data.daily.map((d) => (
                  <div key={d.date} className="flex justify-between border-b border-zinc-50 py-1 text-sm last:border-0">
                    <span className="text-zinc-600">{dayLabel(d.date)}</span>
                    <span className="text-zinc-500">{d.count} venda(s) · <strong className="text-zinc-800">{money(d.total_cents)}</strong></span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <SectionTitle icon={TrendingUp}>Produtos mais vendidos</SectionTitle>
              {data.top.length === 0 ? (
                <EmptyState title="Sem dados no período" />
              ) : (
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.top} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#a1a1aa" }} interval={0} />
                      <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} />
                      <Tooltip formatter={(v: any, n: any) => (n === "quantity" ? [`${v} unidades`, "Vendidos"] : [money(Number(v)), "Faturamento"])} />
                      <Bar dataKey="quantity" name="quantity" fill="#e11d48" radius={[6, 6, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="mt-3 space-y-1">
                {data.top.map((t, i) => (
                  <div key={t.name} className="flex justify-between border-b border-zinc-50 py-1 text-sm last:border-0">
                    <span className="truncate text-zinc-600">
                      <span className="mr-1 font-bold text-rose-600">{i + 1}º</span> {t.name}
                    </span>
                    <span className="shrink-0 text-zinc-500">{t.quantity} un · <strong className="text-zinc-800">{money(t.total_cents)}</strong></span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <SectionTitle icon={Wallet}>Formas de pagamento</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {data.by_payment.map((p) => (
                <Badge key={p.payment_method} tone="emerald">
                  {PAYMENT_LABEL[p.payment_method] ?? p.payment_method}: {p.count} venda(s) · {money(p.total_cents)}
                </Badge>
              ))}
              {data.by_payment.length === 0 && <p className="text-sm text-zinc-400">Sem vendas no período.</p>}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle icon={Wallet}>Produtos vendidos (detalhado)</SectionTitle>
            {data.items.length === 0 ? (
              <EmptyState title="Nenhum item vendido no período" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 text-left text-xs tracking-wide text-zinc-500 uppercase">
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Produto</th>
                      <th className="px-3 py-2">Variação</th>
                      <th className="px-3 py-2">Qtd</th>
                      <th className="px-3 py-2">Unitário</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {data.items.map((it, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{formatDate(it.created_at)}</td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-zinc-900">{it.product_name}</p>
                          <p className="text-xs text-zinc-400">{it.category_name}</p>
                        </td>
                        <td className="px-3 py-2 text-zinc-600">{it.color_name}/{it.size_name}</td>
                        <td className="px-3 py-2 text-zinc-700">{it.quantity}</td>
                        <td className="px-3 py-2 text-zinc-700">{money(it.unit_price_cents)}</td>
                        <td className="px-3 py-2 text-right font-medium text-zinc-900">{money(it.total_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <SectionTitle icon={PackageX}>Estoque atual</SectionTitle>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-zinc-50 p-3">
                <p className="text-xs text-zinc-400 uppercase">Total de peças</p>
                <p className="text-lg font-bold text-zinc-900">{data.stock.total_pieces}</p>
              </div>
              <div className="rounded-xl bg-zinc-50 p-3">
                <p className="text-xs text-zinc-400 uppercase">Valor do estoque</p>
                <p className="text-lg font-bold text-zinc-900">{money(data.stock.total_value_cents)}</p>
              </div>
              <div className="rounded-xl bg-red-50 p-3">
                <p className="text-xs text-red-400 uppercase">Sem estoque</p>
                <p className="text-lg font-bold text-red-600">{data.stock.out_of_stock.length}</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3">
                <p className="text-xs text-amber-500 uppercase">Estoque baixo</p>
                <p className="text-lg font-bold text-amber-600">{data.stock.low_stock.length}</p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium text-zinc-700">Estoque por categoria</p>
                <div className="space-y-1.5">
                  {data.stock.by_category.map((c) => (
                    <div key={c.name} className="flex items-center justify-between text-sm">
                      <span className="text-zinc-600">{c.name}</span>
                      <span className="text-zinc-500">{c.pieces} pç · <strong className="text-zinc-800">{money(c.value_cents)}</strong></span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <p className="mb-2 text-sm font-medium text-zinc-700">Itens de estoque ({data.stock.rows.length})</p>
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 text-left text-xs tracking-wide text-zinc-500 uppercase">
                      <th className="px-2 py-1.5">Produto</th>
                      <th className="px-2 py-1.5">Var.</th>
                      <th className="px-2 py-1.5">Estoque</th>
                      <th className="px-2 py-1.5 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {data.stock.rows.slice(0, 30).map((r) => (
                      <tr key={r.id}>
                        <td className="px-2 py-1.5">
                          <p className="truncate font-medium text-zinc-900">{r.product_name}</p>
                          <p className="text-xs text-zinc-400">{r.sku}</p>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-zinc-500">{r.color_name}/{r.size_name}</td>
                        <td className="px-2 py-1.5">
                          <Badge tone={r.stock <= 0 ? "red" : r.stock <= r.min_stock ? "amber" : "emerald"}>{r.stock}</Badge>
                        </td>
                        <td className="px-2 py-1.5 text-right text-zinc-700">{money(r.stock_value_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}