import { useCallback, useEffect, useState } from "react";
import { HandCoins, Wallet, AlertTriangle, CheckCircle2, CalendarClock, ReceiptText } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, Select, Skeleton } from "../components/ui";
import PayReceivableModal, { type PayReceivableTarget } from "../components/PayReceivableModal";
import ReceiptModal from "../components/ReceiptModal";
import { formatDate, money } from "../lib/format";
import type { Receivable, ReceivablesResponse } from "../types";

type Tab = "aberto" | "vencido" | "pago" | "all";

const TABS: { value: Tab; label: string }[] = [
  { value: "aberto", label: "Em aberto" },
  { value: "vencido", label: "Vencidos" },
  { value: "pago", label: "Recebidos" },
  { value: "all", label: "Todos" },
];

function SummaryCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</div>
      <div className="min-w-0">
        <p className="truncate text-xs capitalize text-zinc-500">{label}</p>
        <p className="truncate text-lg font-bold text-zinc-900">{money(value)}</p>
      </div>
    </Card>
  );
}

export default function Receivables() {
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<ReceivablesResponse | null>(null);
  const [tab, setTab] = useState<Tab>("aberto");
  const [search, setSearch] = useState("");
  const [paying, setPaying] = useState<PayReceivableTarget | null>(null);
  const [receipt, setReceipt] = useState<{ receivableId: number; paymentId: number } | null>(null);

  async function openLastReceipt(r: Receivable) {
    try {
      const detail = await api.get<{ payments: { id: number }[] }>(`/api/receivables/${r.id}`);
      const last = detail.payments[0];
      if (!last) {
        toastError("Nenhum recebimento registrado para esta conta.");
        return;
      }
      setReceipt({ receivableId: r.id, paymentId: last.id });
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar o comprovante.");
    }
  }

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (tab !== "all") params.set("status", tab === "aberto" ? "pendente" : tab);
      if (search.trim()) params.set("search", search.trim());
      setData(await api.get<ReceivablesResponse>(`/api/receivables?${params.toString()}`));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar as contas a receber.");
    }
  }, [tab, search, toastError]);

  useEffect(() => {
    const t = window.setTimeout(load, search ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <div>
      <PageHeader title="Contas a receber" subtitle="Vendas fiadas, vencimentos e recebimentos" />

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Em aberto" value={data?.summary.total_aberto ?? 0} tone="bg-violet-100 text-violet-700" icon={<Wallet size={20} />} />
        <SummaryCard label="Vencido" value={data?.summary.total_vencido ?? 0} tone="bg-red-100 text-red-700" icon={<AlertTriangle size={20} />} />
        <SummaryCard label="Recebido" value={data?.summary.total_recebido ?? 0} tone="bg-emerald-100 text-emerald-700" icon={<CheckCircle2 size={20} />} />
      </div>

      <Card className="mb-4 mt-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por cliente..." />
          <Select value={tab} onChange={(e) => setTab(e.target.value as Tab)}>
            {TABS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {!data ? (
        <Card className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhuma conta encontrada"
          description={tab === "vencido" ? "Nenhuma venda fiada vencida. Que ótima notícia!" : "Vendas fiadas aparecerão aqui automaticamente."}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className="flex items-center gap-3 p-4">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                  r.status === "pago" ? "bg-emerald-100 text-emerald-600" : r.vencido ? "bg-red-100 text-red-600" : "bg-violet-100 text-violet-600"
                }`}
              >
                {r.status === "pago" ? <CheckCircle2 size={20} /> : <HandCoins size={20} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-zinc-900">{r.customer_name || "Cliente não informado"}</p>
                  <Badge tone={r.status === "pago" ? "emerald" : r.vencido ? "red" : "violet"}>
                    {r.status === "pago" ? "Recebido" : r.vencido ? `${r.days_overdue} dia(s) em atraso` : "Em aberto"}
                  </Badge>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 truncate text-sm text-zinc-500">
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock size={13} className="text-zinc-400" /> vence {formatDate(r.due_date)}
                  </span>
                  <span className="text-xs">venda {formatDate(r.sale_date)} · ref. venda #{String(r.sale_id).padStart(4, "0")}</span>
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-lg font-bold text-zinc-900">{money(r.remaining_cents ?? r.total_cents)}</p>
                {r.received_cents ? (
                  <p className="text-xs text-zinc-400">{money(r.total_cents)} · pago {money(r.received_cents)}</p>
                ) : null}
              </div>
              {r.status === "pendente" && (
                <Button
                  size="sm"
                  onClick={() =>
                    setPaying({
                      id: r.id,
                      customer_name: r.customer_name,
                      total_cents: r.total_cents,
                      remaining_cents: r.remaining_cents ?? r.total_cents,
                    })
                  }
                >
                  <HandCoins size={15} /> Receber
                </Button>
              )}
              {r.status === "pago" && (
                <Button size="sm" variant="secondary" onClick={() => openLastReceipt(r)}>
                  <ReceiptText size={15} /> Comprovante
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      <PayReceivableModal
        target={paying}
        onClose={() => setPaying(null)}
        onPaid={(paymentId) => {
          setPaying(null);
          load();
          if (paying && paymentId > 0) setReceipt({ receivableId: paying.id, paymentId });
        }}
      />
      <ReceiptModal
        receivableId={receipt ? receipt.receivableId : null}
        paymentId={receipt && receipt.paymentId > 0 ? receipt.paymentId : null}
        onClose={() => setReceipt(null)}
      />
    </div>
  );
}