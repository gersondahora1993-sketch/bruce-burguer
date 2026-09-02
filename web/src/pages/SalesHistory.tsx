import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, ChevronDown, ChevronUp, ReceiptText } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, SearchInput, Select, Skeleton } from "../components/ui";
import { formatDate, money } from "../lib/format";
import type { PaymentMethod, Sale, SaleDetail, User } from "../types";
import { FISCAL_DOC_STATUS_LABELS, PAYMENT_OPTIONS } from "../types";

const PAYMENT_BADGE: Record<PaymentMethod, "emerald" | "zinc" | "rose" | "amber" | "violet"> = {
  pix: "emerald",
  dinheiro: "zinc",
  cartao_debito: "amber",
  cartao_credito: "rose",
  fiado: "violet",
};

export default function SalesHistory() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [search, setSearch] = useState("");
  const [payment, setPayment] = useState("all");
  const [seller, setSeller] = useState("all");
  const [sellers, setSellers] = useState<User[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelling, setCancelling] = useState<SaleDetail | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (payment !== "all") params.set("payment_method", payment);
      if (isAdmin && seller !== "all") params.set("user_id", seller);
      setSales(await api.get<Sale[]>(`/api/sales?${params.toString()}`));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar as vendas.");
    }
  }, [search, payment, seller, isAdmin, toastError]);

  useEffect(() => {
    const t = window.setTimeout(load, search ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get<User[]>("/api/users")
      .then(setSellers)
      .catch(() => undefined);
  }, [isAdmin]);

  async function toggleDetail(id: number) {
    if (expanded === id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(id);
    setDetailLoading(true);
    try {
      setDetail(await api.get<SaleDetail>(`/api/sales/${id}`));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar a venda.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function confirmCancel() {
    if (!cancelling) return;
    setCancelLoading(true);
    try {
      await api.del(`/api/sales/${cancelling.id}`);
      success(`Venda #${String(cancelling.id).padStart(4, "0")} cancelada. Estoque devolvido.`);
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
      <PageHeader title="Histórico de vendas" subtitle="Consulte, detalhe e cancele vendas realizadas" />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por produto ou cliente..." />
          <Select value={payment} onChange={(e) => setPayment(e.target.value)}>
            <option value="all">Todas as formas de pagamento</option>
            {PAYMENT_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>
        </div>
        {isAdmin && (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_220px]">
            <div />
            <Select value={seller} onChange={(e) => setSeller(e.target.value)}>
              <option value="all">Todas as vendedoras</option>
              {sellers.map((u) => (
                <option key={u.id} value={String(u.id)}>{u.name}</option>
              ))}
            </Select>
          </div>
        )}
      </Card>

      {!sales ? (
        <Card className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </Card>
      ) : sales.length === 0 ? (
        <EmptyState title="Nenhuma venda encontrada" description="As vendas finalizadas aparecerão aqui." />
      ) : (
        <div className="space-y-3">
          {sales.map((s) => {
            const cancelled = s.status === "cancelada";
            return (
              <Card key={s.id} className="overflow-hidden">
                <button
                  onClick={() => toggleDetail(s.id)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-zinc-50/70"
                >
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${cancelled ? "bg-zinc-200 text-zinc-500" : "bg-rose-100 text-rose-600"}`}>
                    <ReceiptText size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-zinc-900">{cancelled ? "—" : "#"}{String(s.id).padStart(4, "0")}</p>
                      <Badge tone={PAYMENT_BADGE[s.payment_method]}>
                        {PAYMENT_OPTIONS.find((p) => p.value === s.payment_method)?.label}
                      </Badge>
                      {cancelled && <Badge tone="zinc">Cancelada</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-zinc-500">
                      {s.customer_name || "Cliente não informado"} · {formatDate(s.created_at)} · {s.item_count} item(ns) · Vendedora: {s.user_name ?? "-"}
                      {cancelled && s.cancelled_by_name ? ` · cancelada por ${s.cancelled_by_name}` : ""}
                    </p>
                  </div>
                  <p className={`shrink-0 text-lg font-bold ${cancelled ? "text-zinc-400 line-through" : "text-zinc-900"}`}>{money(s.total_cents)}</p>
                  {expanded === s.id ? <ChevronUp size={18} className="shrink-0 text-zinc-400" /> : <ChevronDown size={18} className="shrink-0 text-zinc-400" />}
                </button>

                {expanded === s.id && (
                  <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-3">
                    {detailLoading ? (
                      <Skeleton className="h-20" />
                    ) : detail && detail.id === s.id ? (
                      <div className="space-y-1.5">
                        {detail.items.map((it) => (
                          <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="text-zinc-700">
                              {it.product_name} <span className="text-zinc-400">({it.color_name}/{it.size_name})</span>{" "}
                              <span className="text-zinc-400">×{it.quantity}</span>
                            </span>
                            <span className="font-medium text-zinc-800">{money(it.total_cents)}</span>
                          </div>
                        ))}
                        {detail.customer_name && (
                          <p className="pt-1 text-xs text-zinc-500">
                            Cliente: <strong>{detail.customer_name}</strong>
                            {detail.customer_id ? ` · id #${detail.customer_id}` : ""}
                          </p>
                        )}
                        {detail.cancelled_at && (
                          <p className="text-xs text-zinc-400">
                            Cancelada em {formatDate(detail.cancelled_at)} {detail.cancelled_by_name ? `por ${detail.cancelled_by_name}` : ""}
                          </p>
                        )}
                        {detail.fiscal_document && (
                          <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                            <span className="font-medium">
                              {detail.fiscal_document.type === "nfce" ? "NFC-e" : "NF-e"} ·{" "}
                              {FISCAL_DOC_STATUS_LABELS[detail.fiscal_document.status] ?? detail.fiscal_document.status}
                            </span>
                            {!detail.fiscal_document.access_key && (
                              <span>Nenhum documento foi autorizado (emissão fiscal não configurada).</span>
                            )}
                          </div>
                        )}
                        {!cancelled && (
                          <div className="flex items-center justify-end gap-2 pt-2">
                            <Button size="sm" variant="danger" onClick={() => setCancelling(detail)}>
                              <Ban size={14} /> Cancelar venda
                            </Button>
                          </div>
                        )}
                        <div className="flex items-center justify-end gap-2 pt-2">
                          <Button size="sm" variant="secondary" onClick={() => navigate(`/sales/${detail.id}/comprovante`)}>
                            <ReceiptText size={14} /> Ver comprovante
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title={`Cancelar venda #${String(cancelling?.id ?? 0).padStart(4, "0")}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(null)}>Voltar</Button>
            <Button onClick={confirmCancel} loading={cancelLoading} variant="danger">
              <Ban size={15} /> Confirmar cancelamento
            </Button>
          </>
        }
      >
        {cancelling && (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Cliente</span>
                <span className="font-semibold text-zinc-800">{cancelling.customer_name || "Não informado"}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-zinc-500">Forma de pagamento</span>
                <Badge tone={PAYMENT_BADGE[cancelling.payment_method]}>
                  {PAYMENT_OPTIONS.find((p) => p.value === cancelling.payment_method)?.label}
                </Badge>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-zinc-500">Data</span>
                <span className="font-medium text-zinc-800">{formatDate(cancelling.created_at)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-zinc-500">Valor total</span>
                <span className="font-bold text-zinc-900">{money(cancelling.total_cents)}</span>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Produtos ({cancelling.items.length})</p>
              <div className="space-y-1">
                {cancelling.items.map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 text-sm">
                    <span className="truncate text-zinc-700">
                      {it.product_name} ({it.color_name}/{it.size_name}) ×{it.quantity}
                    </span>
                    <span className="shrink-0 font-medium text-zinc-800">{money(it.total_cents)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 rounded-xl bg-zinc-50 px-4 py-3 text-sm">
              <p className="flex items-start gap-2 text-zinc-700">
                <span className="mt-0.5">•</span>
                <span>Estoque: os itens acima retornarão ao estoque com movimentação de entrada e registro de auditoria.</span>
              </p>
              {isFiado ? (
                <>
                  <p className="flex items-start gap-2 text-zinc-700">
                    <span className="mt-0.5">•</span>
                    <span>Contas a receber: a obrigação vinculada será removida e o saldo do cliente atualizado.</span>
                  </p>
                  <p className="flex items-start gap-2 text-amber-700">
                    <span className="mt-0.5">•</span>
                    <span>Caixa: nenhuma entrada será criada. Se esta venda ainda não tiver recebimento, o caixa não é afetado.</span>
                  </p>
                </>
              ) : (
                <p className="flex items-start gap-2 text-amber-700">
                  <span className="mt-0.5">•</span>
                  <span>Caixa: o valor de {money(cancelling.total_cents)} deixará de contar como entrada (venda sai do total do caixa).</span>
                </p>
              )}
              <p className="flex items-start gap-2 text-zinc-500">
                <span className="mt-0.5">•</span>
                <span>A venda permanece no histórico com status "Cancelada" e registro de quem cancelou.</span>
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}