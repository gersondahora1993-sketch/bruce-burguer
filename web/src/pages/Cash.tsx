import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Lock,
  Unlock,
  Scale,
  Banknote,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ChevronDown,
  History,
} from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Skeleton, Select } from "../components/ui";
import { formatDate, money } from "../lib/format";
import type { CashEntry, CashResponse, CashSession, CashEntryType } from "../types";
import { PAYMENT_OPTIONS, CASH_ENTRY_TYPE_LABELS, CASH_MOVEMENT_TYPES } from "../types";

const SALE_COLUMN: Record<string, keyof CashSession["sales"]> = {
  dinheiro: "dinheiro",
  pix: "pix",
  cartao_debito: "cartao_debito",
  cartao_credito: "cartao_credito",
  fiado: "fiado",
};

const REDUCES_BALANCE: CashEntryType[] = ["cancelamento", "sangria", "despesa", "saida"];

function entrySign(type: CashEntryType): 1 | -1 {
  return REDUCES_BALANCE.includes(type) ? -1 : 1;
}

function SalesBreakdown({ session }: { session: CashSession }) {
  const sales = session.sales ?? {};
  const fiadoCents = sales.fiado ?? 0;
  return (
    <div className="space-y-2">
      {PAYMENT_OPTIONS.filter((p) => p.value !== "fiado").map((p) => (
        <div key={p.value} className="flex items-center justify-between text-sm">
          <span className="text-zinc-600">{p.label}</span>
          <span className="font-medium text-zinc-900">{money(sales?.[SALE_COLUMN[p.value]] ?? 0)}</span>
        </div>
      ))}
      {fiadoCents > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-violet-50 px-2 py-1 text-sm">
          <span className="text-violet-600">Fiado (a receber)</span>
          <span className="font-medium text-violet-700">{money(fiadoCents)}</span>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-zinc-100 pt-2">
        <span className="font-semibold text-zinc-900">Total recebido</span>
        <span className="font-bold text-rose-600">{money(sales?.total ?? 0)}</span>
      </div>
      {fiadoCents > 0 && (
        <p className="text-xs text-zinc-400">
          Vendas fiadas ainda não pagas não entram no total do caixa — entram quando forem recebidas.
        </p>
      )}
    </div>
  );
}

function MovementRow({ entry }: { entry: CashEntry }) {
  const sign = entrySign(entry.type);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-100 bg-white px-3 py-2.5 text-sm">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          sign > 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
        }`}
      >
        {sign > 0 ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-zinc-800">
          <span className="mr-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600 uppercase">
            {CASH_ENTRY_TYPE_LABELS[entry.type] ?? entry.type}
          </span>
          {entry.reference}
        </p>
        <p className="text-xs text-zinc-400">
          {entry.user_name ?? "—"} · {formatDate(entry.created_at)}
        </p>
      </div>
      <span className={`shrink-0 font-bold ${sign > 0 ? "text-emerald-600" : "text-red-600"}`}>
        {sign > 0 ? "+" : "−"}{money(entry.amount_cents)}
      </span>
    </div>
  );
}

export default function Cash() {
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<CashResponse | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [opening, setOpening] = useState("");
  const [openingLoading, setOpeningLoading] = useState(false);
  const [closingSession, setClosingSession] = useState<CashSession | null>(null);
  const [closing, setClosing] = useState("");
  const [closingLoading, setClosingLoading] = useState(false);
  const [movementModal, setMovementModal] = useState<null | { type: CashEntryType; label: string }>(null);
  const [movementType, setMovementType] = useState<CashEntryType>("sangria");
  const [movementValue, setMovementValue] = useState("");
  const [movementDescription, setMovementDescription] = useState("");
  const [movementLoading, setMovementLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      setData(await api.get<CashResponse>("/api/cash"));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar o caixa.");
    }
  }, [toastError]);

  useEffect(() => {
    load();
  }, [load]);

  function parseCents(v: string): number {
    return Math.round(Number(v.replace(/\D/g, "")) || 0);
  }

  async function openCash() {
    setOpeningLoading(true);
    try {
      await api.post("/api/cash/open", { opening_cents: parseCents(opening) });
      success("Caixa aberto!");
      setOpenModal(false);
      setOpening("");
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível abrir o caixa.");
    } finally {
      setOpeningLoading(false);
    }
  }

  async function closeCash() {
    if (!closingSession) return;
    setClosingLoading(true);
    try {
      await api.post(`/api/cash/${closingSession.id}/close`, { closing_cents: parseCents(closing) });
      success("Caixa fechado!");
      setClosingSession(null);
      setClosing("");
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível fechar o caixa.");
    } finally {
      setClosingLoading(false);
    }
  }

  async function registerMovement() {
    if (!movementModal || !data?.current) return;
    setMovementLoading(true);
    try {
      const amount = parseCents(movementValue);
      if (amount <= 0) {
        toastError("Informe um valor válido.");
        return;
      }
      await api.post(`/api/cash/${data.current.id}/entries`, {
        type: movementType,
        amount_cents: amount,
        description: movementDescription.trim(),
      });
      success(`${movementModal.label} registrada!`);
      setMovementModal(null);
      setMovementValue("");
      setMovementDescription("");
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível registrar a movimentação.");
    } finally {
      setMovementLoading(false);
    }
  }

  const current = data?.current ?? null;
  const totalEntradas = current
    ? current.opening_cents + (current.sales?.total ?? 0) +
      (current.entries ?? []).filter((e) => entrySign(e.type) > 0 && !["abertura", "venda", "recebimento"].includes(e.type)).reduce((s, e) => s + e.amount_cents, 0)
    : 0;
  const totalSaidas = current ? current.total_saidas_cents : 0;
  const expected = current ? current.expected_cents : 0;
  const diff = parseCents(closing) - expected;

  const entriesByDate = useMemo(() => {
    const rows = (current?.entries ?? []).slice().reverse();
    return rows;
  }, [current]);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const closedSessions = (data?.sessions ?? []).filter((s) => s.status === "fechado");

  return (
    <div>
      <PageHeader
        title="Caixa"
        subtitle="Abra o caixa, registre entradas e saídas, e feche com a diferença"
        action={
          current ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setMovementModal({ type: "sangria", label: "Sangria" })}>
                <ArrowUpRight size={16} /> Sangria
              </Button>
              <Button variant="secondary" onClick={() => setMovementModal({ type: "reforco", label: "Reforço" })}>
                <ArrowDownLeft size={16} /> Reforço
              </Button>
              <Button variant="secondary" onClick={() => setMovementModal({ type: "despesa", label: "Despesa" })}>
                <ArrowLeftRight size={16} /> Despesa
              </Button>
              <Button onClick={() => setClosingSession(current)}>
                <Lock size={16} /> Fechar caixa
              </Button>
            </div>
          ) : (
            <Button onClick={() => setOpenModal(true)}>
              <Unlock size={16} /> Abrir caixa
            </Button>
          )
        }
      />

      {!data ? (
        <Card className="space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </Card>
      ) : current ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold text-zinc-900">
                  <Banknote size={18} className="text-emerald-600" /> Caixa aberto
                </h2>
                <Badge tone="emerald">Em andamento</Badge>
              </div>
              <div className="space-y-2 text-sm">
                <p className="text-zinc-500">
                  Aberto em: <strong className="text-zinc-800">{formatDate(current.opened_at)}</strong>
                  {current.user_name ? (
                    <>
                      {" "}· por <strong className="text-zinc-800">{current.user_name}</strong>
                    </>
                  ) : null}
                </p>
                <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2.5">
                  <span className="text-zinc-600">Saldo inicial</span>
                  <span className="font-bold text-zinc-900">{money(current.opening_cents)}</span>
                </div>
              </div>
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Entradas por forma de pagamento</p>
                <SalesBreakdown session={current} />
              </div>
              <div className="mt-4 space-y-2 border-t border-zinc-100 pt-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-600">Entradas extras (reforço/manual)</span>
                  <span className="font-semibold text-emerald-600">{money(totalEntradas - current.opening_cents - (current.sales?.total ?? 0))}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-600">Saídas (sangria/despesa)</span>
                  <span className="font-semibold text-red-600">−{money(totalSaidas)}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-2.5 text-sm">
                  <span className="font-semibold text-zinc-200">Valor esperado no caixa</span>
                  <span className="font-bold text-white">{money(expected)}</span>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold text-zinc-900">
                  <History size={18} className="text-zinc-500" /> Movimentações desta sessão
                </h2>
                <Badge tone="zinc">{current.entries?.length ?? 0} lançamentos</Badge>
              </div>
              {entriesByDate.length === 0 ? (
                <p className="text-sm text-zinc-400">Nenhuma movimentação registrada ainda.</p>
              ) : (
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {entriesByDate.map((e) => (
                    <MovementRow key={e.id} entry={e} />
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold text-zinc-900">
                <History size={18} className="text-zinc-500" /> Histórico de caixas fechados
              </h2>
              <Badge tone="zinc">{closedSessions.length}</Badge>
            </div>
            {closedSessions.length === 0 ? (
              <p className="text-sm text-zinc-400">Nenhum caixa fechado ainda.</p>
            ) : (
              <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                {closedSessions.slice(0, 12).map((s) => (
                  <div key={s.id} className="overflow-hidden rounded-xl border border-zinc-100">
                    <button
                      type="button"
                      onClick={() => toggleExpand(s.id)}
                      className="flex w-full items-center justify-between gap-2 bg-zinc-50 px-3 py-2.5 text-left text-sm hover:bg-zinc-100"
                    >
                      <div>
                        <p className="text-zinc-600">
                          {formatDate(s.opened_at)}
                          {s.user_name ? <span className="text-zinc-400"> · {s.user_name}</span> : null}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Inicial {money(s.opening_cents)} · Entradas {money(s.total_sales_cents)} · Saídas {money(s.total_saidas_cents)} · Final {money(s.closing_cents)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={s.diff_cents < 0 ? "red" : s.diff_cents > 0 ? "amber" : "emerald"}>
                          dif. {s.diff_cents > 0 ? "+" : ""}{money(s.diff_cents)}
                        </Badge>
                        <ChevronDown size={15} className={`text-zinc-400 transition ${expanded.has(s.id) ? "rotate-180" : ""}`} />
                      </div>
                    </button>
                    {expanded.has(s.id) && (
                      <div className="space-y-2 bg-white p-3">
                        {(s.entries ?? []).length === 0 ? (
                          <p className="text-sm text-zinc-400">Sem lançamentos.</p>
                        ) : (
                          (s.entries ?? []).map((e) => <MovementRow key={e.id} entry={e} />)
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : (
        <EmptyState
          title="Nenhum caixa aberto"
          description="Abra o caixa para registrar o saldo inicial e acompanhar as vendas do dia."
          action={
            <Button onClick={() => setOpenModal(true)}>
              <Unlock size={16} /> Abrir caixa
            </Button>
          }
        />
      )}

      <Modal
        open={openModal}
        onClose={() => setOpenModal(false)}
        title="Abrir caixa"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenModal(false)}>Cancelar</Button>
            <Button onClick={openCash} loading={openingLoading}>Abrir caixa</Button>
          </>
        }
      >
        <Field label="Saldo inicial em dinheiro (R$)">
          <Input
            inputMode="numeric"
            placeholder="0,00"
            value={opening}
            onChange={(e) => setOpening(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <p className="mt-2 text-xs text-zinc-400">
          A abertura registra um lançamento de suprimento inicial. A partir dela, todas as vendas entram na contagem do
          caixa até o fechamento.
        </p>
      </Modal>

      {movementModal && (
        <Modal
          open
          onClose={() => setMovementModal(null)}
          title={movementModal.label}
          footer={
            <>
              <Button variant="secondary" onClick={() => setMovementModal(null)}>Cancelar</Button>
              <Button onClick={registerMovement} loading={movementLoading}>Registrar</Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Tipo de movimentação">
              <Select value={movementType} onChange={(e) => setMovementType(e.target.value as CashEntryType)}>
                {CASH_MOVEMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Valor (R$)">
              <Input
                inputMode="numeric"
                placeholder="0,00"
                value={movementValue}
                onChange={(e) => setMovementValue(e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>
            <Field label="Descrição (opcional)">
              <Input
                placeholder="Ex.: compra de sacolas, troco, pagamento de fornecedor"
                value={movementDescription}
                onChange={(e) => setMovementDescription(e.target.value)}
              />
            </Field>
            <p className="text-xs text-zinc-400">
              {entrySign(movementType) > 0
                ? "Entrada: aumenta o saldo esperado do caixa."
                : "Saída: reduz o saldo esperado do caixa."}{" "}
              O lançamento fica registrado com usuário, data e horário.
            </p>
          </div>
        </Modal>
      )}

      {closingSession && (
        <Modal
          open
          onClose={() => setClosingSession(null)}
          title="Fechar caixa"
          footer={
            <>
              <Button variant="secondary" onClick={() => setClosingSession(null)}>Cancelar</Button>
              <Button onClick={closeCash} loading={closingLoading}>Fechar caixa</Button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Entradas desta sessão</p>
              <SalesBreakdown session={closingSession} />
            </div>
            <div className="space-y-1.5 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-600">Saldo inicial</span>
                <span className="font-semibold text-zinc-900">{money(closingSession.opening_cents)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-600">Entradas (vendas + recebimentos)</span>
                <span className="font-semibold text-emerald-600">+{money(closingSession.sales?.total ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-600">Saídas (sangria/despesa)</span>
                <span className="font-semibold text-red-600">−{money(closingSession.total_saidas_cents)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-zinc-200 pt-1.5">
                <span className="font-semibold text-zinc-900">Valor esperado</span>
                <span className="font-bold text-zinc-900">{money(closingSession.expected_cents)}</span>
              </div>
            </div>
            <Field label="Saldo final em dinheiro (R$)">
              <Input
                inputMode="numeric"
                placeholder="0,00"
                value={closing}
                onChange={(e) => setClosing(e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>
            <div
              className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium ${
                diff === 0 ? "bg-emerald-50 text-emerald-700" : diff < 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
              }`}
            >
              <Scale size={15} />
              Diferença: {diff > 0 ? "+" : ""}{money(diff)} {diff === 0 ? "(ok)" : diff < 0 ? "(falta)" : "(sobra)"}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}