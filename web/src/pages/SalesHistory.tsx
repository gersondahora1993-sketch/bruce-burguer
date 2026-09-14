import { useCallback, useEffect, useState } from "react";
import { Ban, ChevronDown, ChevronUp, ReceiptText } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader, SearchInput, Select, Skeleton } from "../components/ui";
import { formatDate, money } from "../lib/format";
import type { Order, OrderDetail, OrderStatus } from "../types";
import { ORDER_STATUS_LABELS } from "../types";

type SourceFilter = "all" | "online" | "presencial";

const STATUS_ORDER: OrderStatus[] = ["novo", "confirmado", "em_preparacao", "pronto", "entregue", "cancelado"];

const STATUS_BADGE: Record<OrderStatus, "zinc" | "rose" | "emerald" | "amber" | "red" | "violet"> = {
  novo: "rose",
  confirmado: "amber",
  em_preparacao: "violet",
  pronto: "emerald",
  entregue: "zinc",
  cancelado: "red",
};

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_debito: "Cartão de débito",
  cartao_credito: "Cartão de crédito",
  fiado: "Fiado",
};

const PAYMENT_BADGE: Record<string, "emerald" | "zinc" | "rose" | "amber" | "violet"> = {
  pix: "emerald",
  dinheiro: "zinc",
  cartao_debito: "amber",
  cartao_credito: "rose",
  fiado: "violet",
};

export default function SalesHistory() {
  const { success, error: toastError } = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState<SourceFilter>("presencial");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelling, setCancelling] = useState<OrderDetail | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (status !== "all") params.set("status", status);
      if (source !== "all") params.set("source", source);
      setOrders(await api.get<Order[]>(`/api/orders?${params.toString()}`));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar as vendas.");
    }
  }, [search, status, source, toastError]);

  useEffect(() => {
    const t = window.setTimeout(load, search ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function toggleDetail(id: number) {
    if (expanded === id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(id);
    setDetailLoading(true);
    try {
      setDetail(await api.get<OrderDetail>(`/api/orders/${id}`));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar a venda.");
    } finally {
      setDetailLoading(false);
    }
  }

  function refreshDetail(orderId: number) {
    api
      .get<OrderDetail>(`/api/orders/${orderId}`)
      .then((d) => setDetail(d))
      .catch(() => undefined);
  }

  async function confirmCancel() {
    if (!cancelling) return;
    setCancelLoading(true);
    try {
      await api.patch(`/api/orders/${cancelling.id}/status`, { status: "cancelado" });
      success(`Venda #${String(cancelling.id).padStart(4, "0")} cancelada.`);
      setCancelling(null);
      setExpanded(null);
      setDetail(null);
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível cancelar a venda.");
    } finally {
      setCancelLoading(false);
    }
  }

  const isFiado = cancelling?.payment_method === "fiado";

  return (
    <div>
      <PageHeader title="Histórico de vendas" subtitle="Vendas realizadas no balcão e na loja" />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_180px]">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por cliente, telefone ou produto..." />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todos os status</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)}>
            <option value="presencial">Presencial</option>
            <option value="online">Loja online</option>
            <option value="all">Todas as origens</option>
          </Select>
        </div>
      </Card>

      {!orders ? (
        <Card className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </Card>
      ) : orders.length === 0 ? (
        <EmptyState title="Nenhuma venda encontrada" description="As vendas realizadas aparecerão aqui." />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const cancelled = o.status === "cancelado";
            return (
              <Card key={o.id} className="overflow-hidden">
                <button
                  onClick={() => toggleDetail(o.id)}
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3.5 text-left transition hover:bg-zinc-50/70"
                >
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${cancelled ? "bg-zinc-200 text-zinc-500" : "bg-rose-100 text-rose-600"}`}>
                    <ReceiptText size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-zinc-900">#{String(o.id).padStart(4, "0")}</p>
                      <Badge tone={STATUS_BADGE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                      <Badge tone={o.source === "presencial" ? "violet" : "emerald"}>
                        {o.source === "presencial" ? "Presencial" : "Loja online"}
                      </Badge>
                      <Badge tone={PAYMENT_BADGE[o.payment_method] ?? "zinc"}>
                        {PAYMENT_LABELS[o.payment_method] ?? o.payment_method}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-zinc-500">
                      {o.customer_name || "Cliente não informado"} · {formatDate(o.created_at)} · {o.item_count} item(ns)
                      {o.user_id ? ` · Vendedora: ${o.user_name ?? `#${o.user_id}`}` : ""}
                    </p>
                  </div>
                  <p className={`shrink-0 text-lg font-bold ${cancelled ? "text-zinc-400 line-through" : "text-zinc-900"}`}>{money(o.total_cents)}</p>
                  {expanded === o.id ? <ChevronUp size={18} className="shrink-0 text-zinc-400" /> : <ChevronDown size={18} className="shrink-0 text-zinc-400" />}
                </button>

                {expanded === o.id && (
                  <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-3">
                    {detailLoading ? (
                      <Skeleton className="h-28" />
                    ) : detail && detail.id === o.id ? (
                      <div className="space-y-3">
                        <div className="grid gap-2 text-sm sm:grid-cols-2">
                          <div className="rounded-lg bg-white px-3 py-2">
                            <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Cliente</p>
                            <p className="text-zinc-800">{detail.customer_name || "Não informado"}</p>
                            {detail.customer_phone && <p className="text-xs text-zinc-500">{detail.customer_phone}</p>}
                          </div>
                          <div className="rounded-lg bg-white px-3 py-2">
                            <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Vendedora</p>
                            <p className="text-zinc-800">
                              {detail.user_id ? detail.user_name ?? `#${detail.user_id}` : "—"}
                            </p>
                          </div>
                        </div>

                        <div>
                          <p className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Itens ({detail.items.length})</p>
                          <div className="space-y-1.5">
                            {detail.items.map((it) => {
                              const isCombo = it.combo_id != null && it.product_id == null;
                              return (
                                <div key={it.id} className="rounded-lg bg-white px-3 py-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-sm text-zinc-700">
                                      <Badge tone={isCombo ? "amber" : "rose"}>{isCombo ? "Combo" : "Produto"}</Badge>{" "}
                                      {it.product_name} <span className="text-zinc-400">×{it.quantity}</span>
                                    </span>
                                    <span className="font-medium text-zinc-800">{money(it.total_cents)}</span>
                                  </div>
                                  {it.addons && it.addons.length > 0 && (
                                    <div className="mt-1 space-y-0.5">
                                      {it.addons.map((a) => (
                                        <p key={a.addon_id} className="text-xs text-zinc-500">
                                          + {a.name} {a.quantity > 1 ? `×${a.quantity}` : ""} — {money(a.total_cents)}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                  <p className="mt-1 text-xs text-zinc-400">
                                    {money(it.unit_price_cents)} / un · subtotal {money(it.total_cents)}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="space-y-1 rounded-lg bg-white px-3 py-2 text-sm">
                          <div className="flex justify-between text-zinc-500">
                            <span>Subtotal</span>
                            <span>{money(detail.subtotal_cents)}</span>
                          </div>
                          {detail.discount_cents > 0 && (
                            <div className="flex justify-between text-emerald-600">
                              <span>Desconto</span>
                              <span>-{money(detail.discount_cents)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-semibold text-zinc-900">
                            <span>Total</span>
                            <span>{money(detail.total_cents)}</span>
                          </div>
                          <div className="flex justify-between text-zinc-500">
                            <span>Pagamento</span>
                            <span>{PAYMENT_LABELS[detail.payment_method] ?? detail.payment_method}</span>
                          </div>
                          {detail.paid_at && <div className="flex justify-between text-zinc-500">
                            <span>Pago em</span>
                            <span>{formatDate(detail.paid_at)}</span>
                          </div>}
                        </div>

                        {!cancelled && (
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <Button size="sm" variant="danger" onClick={() => setCancelling(detail)}>
                              <Ban size={14} /> Cancelar venda
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title={`Cancelar venda #${String(cancelling?.id ?? 0).padStart(4, "0")}`}
        message={
          cancelling
            ? `Confirma o cancelamento da venda de ${money(cancelling.total_cents)} para ${
                cancelling.customer_name || "cliente não informado"
              }? O pedido ficará registrado com status "Cancelado".`
            : ""
        }
        confirmLabel="Confirmar cancelamento"
        loading={cancelLoading}
        onConfirm={confirmCancel}
      />
    </div>
  );
}