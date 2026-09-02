import { useCallback, useEffect, useState } from "react";
import { FileText, ReceiptText, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Clock3 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, Select, Skeleton } from "../components/ui";
import { money } from "../lib/format";
import type { FiscalDocument } from "../types";

const STATUS_META: Record<string, { label: string; tone: "zinc" | "rose" | "emerald" | "red" | "violet"; icon: React.ReactNode }> = {
  nao_configurado: { label: "Emissão não configurada", tone: "zinc", icon: <ShieldAlert size={13} /> },
  pendente_provedor: { label: "Aguardando provedor", tone: "violet", icon: <Clock3 size={13} /> },
  autorizado: { label: "Autorizado", tone: "emerald", icon: <CheckCircle2 size={13} /> },
  rejeitado: { label: "Rejeitado", tone: "red", icon: <XCircle size={13} /> },
  cancelado: { label: "Cancelado", tone: "rose", icon: <AlertTriangle size={13} /> },
};

const TYPE_LABELS: Record<string, string> = { nfce: "NFC-e", nfe: "NF-e" };

export default function FiscalDocuments() {
  const { error: toastError } = useToast();
  const [rows, setRows] = useState<FiscalDocument[] | null>(null);
  const [status, setStatus] = useState<"all" | "nao_configurado" | "pendente_provedor" | "autorizado" | "rejeitado" | "cancelado">("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      setRows(await api.get<FiscalDocument[]>(`/api/fiscal/documents?${params.toString()}`));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar os documentos fiscais.");
    }
  }, [status, search, toastError]);

  useEffect(() => {
    const t = window.setTimeout(load, search ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load]);

  function openDetail(docId: number) {
    api.get<FiscalDocument>(`/api/fiscal/documents/${docId}`).catch((err: any) => toastError(err?.message ?? "Erro ao consultar o documento."));
  }

  return (
    <div>
      <PageHeader title="Documentos fiscais" subtitle="Histórico de emissão de NFC-e/NF-e por venda" />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_240px]">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por cliente ou venda..." />
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">Todos os status</option>
            <option value="nao_configurado">Emissão não configurada</option>
            <option value="pendente_provedor">Aguardando provedor</option>
            <option value="autorizado">Autorizado</option>
            <option value="rejeitado">Rejeitado</option>
            <option value="cancelado">Cancelado</option>
          </Select>
        </div>
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <ShieldAlert size={14} />
          Emissão fiscal ainda não configurada: os documentos listados aparecem como pendentes e nenhum foi autorizado junto à SEFAZ. Nenhuma chave, número ou protocolo foi gerado.
        </p>
      </Card>

      {!rows ? (
        <Card className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhum documento fiscal" description="Ao finalizar vendas com emissão de NFC-e, os documentos aparecerão aqui." />
      ) : (
        <div className="space-y-3">
          {rows.map((d) => {
            const meta = STATUS_META[d.status] ?? STATUS_META.nao_configurado;
            return (
              <Card key={d.id} className="flex items-center gap-3 p-4">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600`}>
                  <FileText size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-zinc-900">
                      {TYPE_LABELS[d.type] ?? d.type} · venda #{String(d.sale_id).padStart(4, "0")}
                    </p>
                    <Badge tone={meta.tone}>
                      {meta.icon} {meta.label}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-zinc-500">
                    {d.sale_customer_name || "Cliente não informado"} · {money(d.sale_total_cents ?? 0)}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    criado em {new Date(d.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    {d.access_key ? ` · chave ${d.access_key}` : ""}
                    {d.status === "cancelado" && d.cancellation_reason ? ` · motivo: ${d.cancellation_reason}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => openDetail(d.id)}>
                  <ReceiptText size={14} /> Detalhes
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}