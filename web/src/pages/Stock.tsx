import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal, Plus, Minus } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Skeleton,
  Textarea,
} from "../components/ui";
import { formatDate, money } from "../lib/format";
import type { Category, StockItem, StockMovement } from "../types";

type StatusFilter = "all" | "out" | "low" | "ok";

const STATUS_BADGE = {
  out: <Badge tone="red">Sem estoque</Badge>,
  low: <Badge tone="amber">Baixo</Badge>,
  ok: <Badge tone="emerald">OK</Badge>,
};

function MovementModal({
  item,
  onClose,
  onDone,
}: {
  item: StockItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [type, setType] = useState<"entrada" | "saida" | "ajuste">("entrada");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (type !== "ajuste" && (!quantity || Number(quantity) <= 0)) {
      toastError("Informe uma quantidade válida.");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        product_id: item.product_id,
        type,
        reason,
      };
      if (type === "ajuste") {
        body.target_stock = Number(quantity);
      } else {
        body.quantity = Number(quantity);
      }
      await api.post("/api/stock/movements", body);
      success("Movimentação registrada com sucesso!");
      onDone();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível registrar a movimentação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Movimentação de estoque"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={saving}>Registrar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-zinc-50 p-3 text-sm">
          <p className="font-medium text-zinc-900">{item.product_name}</p>
          <p className="mt-1 text-xs">
            Estoque atual: <strong className="text-zinc-900">{item.stock}</strong> · Mínimo: {item.min_stock}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {([
            { v: "entrada", label: "Entrada", icon: ArrowDownToLine },
            { v: "saida", label: "Saída", icon: ArrowUpFromLine },
            { v: "ajuste", label: "Ajuste", icon: SlidersHorizontal },
          ] as const).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setType(opt.v)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium transition ${
                type === opt.v ? "border-rose-600 bg-rose-600 text-white shadow-sm" : "border-zinc-300 bg-white text-zinc-600"
              }`}
            >
              <opt.icon size={18} />
              {opt.label}
            </button>
          ))}
        </div>

        <Field label={type === "ajuste" ? "Estoque-alvo" : "Quantidade"} required>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={type === "ajuste" ? "Ex.: 10" : "Ex.: 5"}
          />
        </Field>
        {type === "ajuste" && (
          <p className="text-xs text-zinc-500">O ajuste define o estoque exato, substituindo o valor atual.</p>
        )}
        <Field label="Motivo">
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={type === "saida" ? "Ex.: venda avulsa, quebra, doação..." : "Ex.: compra de fornecedor, devolução..."}
          />
        </Field>
      </div>
    </Modal>
  );
}

export default function Stock({ tab = "atual" }: { tab?: "atual" | "movements" | "low" }) {
  const navigate = useNavigate();
  const { error: toastError } = useToast();
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [movementTarget, setMovementTarget] = useState<StockItem | null>(null);

  const load = useCallback(async () => {
    try {
      const st = await api.get<StockItem[]>("/api/stock");
      const c = await api.get<Category[]>("/api/categories");
      setItems(st);
      setCategories(c);
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar o estoque.");
    }
  }, [toastError]);

  const loadMovements = useCallback(async () => {
    try {
      setMovements(await api.get<StockMovement[]>("/api/stock/movements"));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar as movimentações.");
    }
  }, [toastError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab === "movements") loadMovements();
  }, [tab, loadMovements]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const term = search.trim().toLowerCase();
    return items.filter((i) => {
      if (term && !i.product_name.toLowerCase().includes(term)) return false;
      if (categoryId && i.category_id !== Number(categoryId)) return false;
      if (status !== "all" && i.status !== status) return false;
      return true;
    });
  }, [items, search, categoryId, status]);

  const summary = useMemo(() => {
    if (!items) return { pieces: 0, value: 0, out: 0, low: 0 };
    return {
      pieces: items.reduce((a, i) => a + i.stock, 0),
      value: items.reduce((a, i) => a + i.stock_value_cents, 0),
      out: items.filter((i) => i.status === "out").length,
      low: items.filter((i) => i.status === "low").length,
    };
  }, [items]);

  const tabs = [
    { key: "atual", label: "Estoque atual", path: "/stock" },
    { key: "movements", label: "Movimentações", path: "/stock/movements" },
    { key: "low", label: "Estoque baixo", path: "/stock/low" },
  ] as const;

  return (
    <div>
      <PageHeader
        title="Estoque"
        subtitle={tab === "movements" ? "Histórico de movimentações" : "Controle de estoque"}
      />

      {/* Resumo */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-3.5">
          <p className="text-xs tracking-wide text-zinc-400 uppercase">Total de peças</p>
          <p className="mt-1 text-xl font-bold text-zinc-900">{items ? summary.pieces : "—"}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-xs tracking-wide text-zinc-400 uppercase">Valor em estoque</p>
          <p className="mt-1 text-xl font-bold text-zinc-900">{items ? money(summary.value) : "—"}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-xs tracking-wide text-zinc-400 uppercase">Sem estoque</p>
          <p className="mt-1 text-xl font-bold text-red-600">{items ? summary.out : "—"}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-xs tracking-wide text-zinc-400 uppercase">Estoque baixo</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{items ? summary.low : "—"}</p>
        </Card>
      </div>

      {/* Abas */}
      <div className="mb-4 flex gap-1 rounded-xl border border-zinc-200 bg-white p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => navigate(t.path)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === t.key ? "bg-rose-600 text-white shadow-sm" : "text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "movements" ? (
        <Card className="overflow-hidden">
          {!movements ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : movements.length === 0 ? (
            <div className="p-4">
              <EmptyState title="Nenhuma movimentação registrada" description="As entradas, saídas e ajustes aparecerão aqui." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-xs tracking-wide text-zinc-500 uppercase">
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Produto</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Qtd</th>
                    <th className="px-4 py-3">Antes → Depois</th>
                    <th className="px-4 py-3">Motivo</th>
                    <th className="px-4 py-3">Responsável</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {movements.map((m) => (
                    <tr key={m.id} className="hover:bg-zinc-50/70">
                      <td className="px-4 py-2.5 whitespace-nowrap text-zinc-500">{formatDate(m.created_at)}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-zinc-900">{m.product_name}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        {m.type === "entrada" && <Badge tone="emerald">Entrada</Badge>}
                        {m.type === "saida" && <Badge tone="red">Saída</Badge>}
                        {m.type === "ajuste" && <Badge tone="amber">Ajuste</Badge>}
                        {m.type === "venda" && <Badge tone="violet">Venda</Badge>}
                        {m.type === "estorno" && <Badge tone="zinc">Estorno</Badge>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 font-semibold ${m.type === "entrada" ? "text-emerald-600" : m.type === "saida" || m.type === "venda" || m.type === "estorno" ? "text-red-600" : "text-amber-600"}`}>
                          {m.type === "entrada" ? <Plus size={14} /> : <Minus size={14} />}
                          {Math.abs(m.quantity)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">{m.stock_before} → {m.stock_after}</td>
                      <td className="px-4 py-2.5 text-zinc-500">{m.reason || "—"}</td>
                      <td className="px-4 py-2.5 text-zinc-500">{m.user_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SearchInput value={search} onChange={setSearch} placeholder="Buscar produto..." className="lg:col-span-2" />
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Todas as categorias</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
              <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="w-32">
                <option value="all">Todos</option>
                <option value="ok">OK</option>
                <option value="low">Baixo</option>
                <option value="out">Zero</option>
              </Select>
            </div>
          </Card>

          {tab === "low" && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Exibindo apenas produtos com estoque igual ou abaixo do mínimo. Registre uma <strong>entrada</strong> para normalizar.
            </div>
          )}

          {!items ? (
            <Card className="space-y-3 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </Card>
          ) : filtered.length === 0 ? (
            <EmptyState title={tab === "low" ? "Nenhum estoque baixo" : "Nenhum item encontrado"} description={tab === "low" ? "Todos os produtos têm estoque acima do mínimo." : "Ajuste os filtros para ver mais itens."} />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-xs tracking-wide text-zinc-500 uppercase">
                      <th className="px-4 py-3">Produto</th>
                      <th className="px-4 py-3">Categoria</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Estoque</th>
                      <th className="px-4 py-3">Mín.</th>
                      <th className="px-4 py-3">Preço</th>
                      <th className="px-4 py-3">Valor total</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filtered.map((i) => (
                      <tr key={i.product_id} className="hover:bg-zinc-50/70">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-zinc-900">{i.product_name}</p>
                        </td>
                        <td className="px-4 py-2.5 text-zinc-600">{i.category_name ?? "—"}</td>
                        <td className="px-4 py-2.5">{STATUS_BADGE[i.status]}</td>
                        <td className="px-4 py-2.5">
                          <span className={`font-bold ${i.status === "out" ? "text-red-600" : i.status === "low" ? "text-amber-600" : "text-emerald-600"}`}>
                            {i.stock}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-zinc-500">{i.min_stock}</td>
                        <td className="px-4 py-2.5 text-zinc-700">{money(i.sale_price_cents)}</td>
                        <td className="px-4 py-2.5 font-medium text-zinc-900">{money(i.stock_value_cents)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1.5">
                            <Button variant="secondary" size="sm" onClick={() => setMovementTarget(i)}>
                              <SlidersHorizontal size={13} /> Movimentar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {movementTarget && (
        <MovementModal
          item={movementTarget}
          onClose={() => setMovementTarget(null)}
          onDone={() => {
            setMovementTarget(null);
            load();
            loadMovements();
          }}
        />
      )}
    </div>
  );
}
