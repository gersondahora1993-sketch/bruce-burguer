import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Package, Phone, MapPin, StickyNote } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, Select, Skeleton } from "../components/ui";
import { formatDate, money } from "../lib/format";
import type { Order, OrderDetail, OrderStatus } from "../types";
import { ORDER_STATUS_LABELS } from "../types";
import { PAYMENT_OPTIONS } from "../types";

const STATUS_ORDER = ["novo", "confirmado", "em_preparacao", "pronto", "entregue", "cancelado"] as const;

const STATUS_BADGE: Record<OrderStatus, "zinc" | "rose" | "emerald" | "amber" | "red" | "violet"> = {
  novo: "rose",
  confirmado: "amber",
  em_preparacao: "violet",
  pronto: "emerald",
  entregue: "zinc",
  cancelado: "red",
};

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  novo: "confirmado",
  confirmado: "em_preparacao",
  em_preparacao: "pronto",
  pronto: "entregue",
};

export default function Orders() {
  const { success, error: toastError } = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (status !== "all") params.set("status", status);
      setOrders(await api.get<Order[]>(`/api/orders?${params.toString()}`));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar os pedidos.");
    }
  }, [search, status, toastError]);

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
      toastError(err?.message ?? "Não foi possível carregar o pedido.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function setOrderStatus(order: Order, next: OrderStatus) {
    setUpdatingId(order.id);
    try {
      await api.patch(`/api/orders/${order.id}/status`, { status: next });
      if (next === "confirmado") {
        success(`Pedido #${String(order.id).padStart(4, "0")} confirmado.`);
      } else if (next === "cancelado") {
        success(
          order.status === "novo"
            ? `Pedido #${String(order.id).padStart(4, "0")} cancelado.`
            : `Pedido #${String(order.id).padStart(4, "0")} cancelado.`
        );
      } else {
        success(`Pedido #${String(order.id).padStart(4, "0")} marcado como ${ORDER_STATUS_LABELS[next].toLowerCase()}.`);
      }
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível atualizar o pedido.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Pedidos online" subtitle="Pedidos do catálogo público da loja" />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por cliente, telefone ou produto..." />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todos os status</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {!orders ? (
        <Card className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </Card>
      ) : orders.length === 0 ? (
        <EmptyState title="Nenhum pedido encontrado" description="Os pedidos feitos no catálogo público aparecerão aqui." />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Card key={o.id} className="overflow-hidden">
              <button
                onClick={() => toggleDetail(o.id)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3.5 text-left transition hover:bg-zinc-50/70"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                  <Package size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-zinc-900">#{String(o.id).padStart(4, "0")}</p>
                    <Badge tone={STATUS_BADGE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-zinc-500">
                    {o.customer_name} · {o.customer_phone} · {formatDate(o.created_at)} · {o.item_count} item(ns)
                  </p>
                </div>
                <p className="shrink-0 text-lg font-bold text-zinc-900">{money(o.total_cents)}</p>
                {expanded === o.id ? <ChevronUp size={18} className="shrink-0 text-zinc-400" /> : <ChevronDown size={18} className="shrink-0 text-zinc-400" />}
              </button>

              {expanded === o.id && (
                <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-3">
                  {detailLoading ? (
                    <Skeleton className="h-24" />
                  ) : detail && detail.id === o.id ? (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        {detail.items.map((it) => (
                          <div key={it.id} className="text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-zinc-700">
                                {it.product_name} <span className="text-zinc-400">×{it.quantity}</span>
                              </span>
                              <span className="font-medium text-zinc-800">{money(it.total_cents)}</span>
                            </div>
                            {it.addons && it.addons.length > 0 && (
                              <p className="mt-0.5 text-xs text-zinc-400">
                                Adicionais: {it.addons.map((a) => `${a.name}${a.quantity > 1 ? ` ×${a.quantity}` : ""}`).join(", ")} (+{money(it.addons.reduce((sum, a) => sum + a.total_cents, 0))})
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="space-y-1 text-xs text-zinc-600">
                        <p className="flex items-center gap-1.5">
                          <Phone size={12} className="text-zinc-400" /> {detail.customer_phone}
                        </p>
                        {(detail.street || detail.neighborhood) && (
                          <p className="flex items-center gap-1.5">
                            <MapPin size={12} className="text-zinc-400" />{" "}
                            {[detail.street, detail.neighborhood, detail.complement, detail.reference].filter(Boolean).join(", ")}
                          </p>
                        )}
                        {detail.notes && (
                          <p className="flex items-center gap-1.5">
                            <StickyNote size={12} className="text-zinc-400" /> {detail.notes}
                          </p>
                        )}
                        <p className="text-zinc-500">
                          Pagamento: {PAYMENT_OPTIONS.find((p) => p.value === detail.payment_method)?.label ?? detail.payment_method} · Total{" "}
                          <strong>{money(detail.total_cents)}</strong>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-2.5">
                        {NEXT_STATUS[o.status] && (
                          <Button size="sm" loading={updatingId === o.id} onClick={() => setOrderStatus(o, NEXT_STATUS[o.status]!)}>
                            Avançar para {ORDER_STATUS_LABELS[NEXT_STATUS[o.status]!].toLowerCase()}
                          </Button>
                        )}
                        {o.status !== "cancelado" && o.status !== "entregue" && (
                          <Button size="sm" variant="secondary" className="text-red-600 hover:text-red-700" loading={updatingId === o.id} onClick={() => setOrderStatus(o, "cancelado")}>
                            Cancelar pedido
                          </Button>
                        )}
                        {o.status !== "cancelado" && (
                          <Select
                            className="w-44"
                            value={o.status}
                            onChange={(e) => setOrderStatus(o, e.target.value as OrderStatus)}
                          >
                            {STATUS_ORDER.map((s) => (
                              <option key={s} value={s}>
                                {ORDER_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </Select>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}