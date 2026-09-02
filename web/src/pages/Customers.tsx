import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Plus, Pencil, Trash2, Phone, Mail, MapPin, ShoppingBag, HandCoins, Wallet, UserCheck, UserX } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Skeleton,
  Textarea,
} from "../components/ui";
import PayReceivableModal, { type PayReceivableTarget } from "../components/PayReceivableModal";
import { digitsOnly, formatDate, maskCep, maskCpf, maskInputCep, maskInputCpf, maskInputPhone, maskPhone, money } from "../lib/format";
import type { Customer, CustomerDetail } from "../types";
import { PAYMENT_OPTIONS } from "../types";

const EMPTY_FORM = {
  name: "",
  cpf: "",
  phone: "",
  whatsapp: "",
  email: "",
  address: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  uf: "",
  cep: "",
  notes: "",
};

type StatusFilter = "todos" | "ativo" | "inativo";

export default function Customers() {
  const { success, error: toastError } = useToast();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [payingRec, setPayingRec] = useState<PayReceivableTarget | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = statusFilter === "todos" ? "" : `?status=${statusFilter}`;
      setCustomers(await api.get<Customer[]>(`/api/customers${qs}`));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar os clientes.");
    }
  }, [toastError, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = customers?.filter((c) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    const termDigits = digitsOnly(term);
    return (
      [c.name, c.email, c.city].some((f) => f.toLowerCase().includes(term)) ||
      (termDigits && (digitsOnly(c.cpf).includes(termDigits) || digitsOnly(c.phone).includes(termDigits)))
    );
  });

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(c: Customer) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      cpf: c.cpf,
      phone: c.phone,
      whatsapp: c.whatsapp,
      email: c.email,
      address: c.address,
      number: c.number ?? "",
      complement: c.complement ?? "",
      neighborhood: c.neighborhood ?? "",
      city: c.city,
      uf: c.uf ?? "",
      cep: c.cep ?? "",
      notes: c.notes,
    });
    setFormOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toastError("Informe o nome do cliente.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        cpf: digitsOnly(form.cpf),
        phone: digitsOnly(form.phone),
        whatsapp: digitsOnly(form.whatsapp),
        cep: digitsOnly(form.cep),
      };
      if (editingId) {
        await api.put(`/api/customers/${editingId}`, payload);
        success("Cliente atualizado com sucesso!");
      } else {
        await api.post("/api/customers", payload);
        success("Cliente cadastrado com sucesso!");
      }
      setFormOpen(false);
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível salvar o cliente.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(c: Customer) {
    setTogglingId(c.id);
    try {
      await api.patch(`/api/customers/${c.id}/status`, { active: c.status !== "ativo" });
      success(c.status === "ativo" ? "Cliente inativado." : "Cliente ativado.");
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível alterar o status do cliente.");
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api.del(`/api/customers/${deleting.id}`);
      success("Cliente excluído.");
      setDeleting(null);
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível excluir o cliente.");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function openDetail(c: Customer) {
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await api.get<CustomerDetail>(`/api/customers/${c.id}`));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar a ficha do cliente.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function receivePayment() {
    if (!payingRec) return;
    setPayingRec(null);
    if (detail) await openDetail(detail);
  }

  const set = (key: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle={`${filtered?.length ?? 0} cliente(s) cadastrado(s)`}
        action={
          <Button onClick={openNew}>
            <Plus size={16} /> Novo cliente
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nome, CPF, telefone, e-mail ou cidade..." />
        <div className="mt-3 flex gap-2">
          {(["todos", "ativo", "inativo"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition ${
                statusFilter === s ? "bg-rose-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {s === "todos" ? "Todos" : s === "ativo" ? "Ativos" : "Inativos"}
            </button>
          ))}
        </div>
      </Card>

      {!customers ? (
        <Card className="space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </Card>
      ) : filtered && filtered.length === 0 ? (
        <EmptyState
          title="Nenhum cliente encontrado"
          action={
            <Button size="sm" onClick={openNew}>
              <Plus size={15} /> Cadastrar cliente
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered?.map((c) => (
            <Card key={c.id} className="p-4">
              <button onClick={() => openDetail(c)} className="w-full text-left">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-zinc-900 hover:text-rose-600">{c.name}</p>
                    <p className="text-xs text-zinc-400">Cadastro: {formatDate(c.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge tone={c.status === "ativo" ? "emerald" : "zinc"}>
                      {c.status === "ativo" ? "Ativo" : "Inativo"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={togglingId === c.id}
                      onClick={() => toggleStatus(c)}
                      aria-label={c.status === "ativo" ? "Inativar" : "Ativar"}
                      title={c.status === "ativo" ? "Inativar cliente" : "Ativar cliente"}
                      className="hover:text-rose-600"
                    >
                      {c.status === "ativo" ? <UserX size={15} /> : <UserCheck size={15} />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(c)} aria-label="Editar">
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(c)} aria-label="Excluir" className="hover:text-rose-600">
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
                <div className="mt-2.5 space-y-1 text-sm text-zinc-600">
                  {c.cpf && <p className="truncate">CPF: {maskCpf(c.cpf)}</p>}
                  {(c.phone || c.whatsapp) && (
                    <p className="flex items-center gap-1.5 truncate">
                      <Phone size={13} className="shrink-0 text-zinc-400" />
                      {maskPhone(c.phone || c.whatsapp)}
                    </p>
                  )}
                  {c.email && (
                    <p className="flex items-center gap-1.5 truncate">
                      <Mail size={13} className="shrink-0 text-zinc-400" />
                      {c.email}
                    </p>
                  )}
                  {(c.address || c.city) && (
                    <p className="flex items-center gap-1.5 truncate">
                      <MapPin size={13} className="shrink-0 text-zinc-400" />
                      {[
                        c.address,
                        c.number ? `nº ${c.number}` : "",
                        c.complement,
                        c.neighborhood,
                        c.city,
                        c.uf,
                        c.cep ? maskCep(c.cep) : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {c.notes && <p className="rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-500">{c.notes}</p>}
                </div>
              </button>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? "Editar cliente" : "Novo cliente"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={save as any} loading={saving}>{editingId ? "Salvar alterações" : "Cadastrar cliente"}</Button>
          </>
        }
      >
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Nome" required>
              <Input value={form.name} onChange={set("name")} placeholder="Nome completo" />
            </Field>
          </div>
          <Field label="CPF">
            <Input value={form.cpf} onChange={(e) => setForm((f) => ({ ...f, cpf: maskInputCpf(e.target.value) }))} placeholder="000.000.000-00" />
          </Field>
          <Field label="Telefone">
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: maskInputPhone(e.target.value) }))} placeholder="(00) 00000-0000" />
          </Field>
          <Field label="WhatsApp" hint="Somente números, com DDI se precisar (ex.: 5511999990000)">
            <Input value={form.whatsapp} onChange={set("whatsapp")} placeholder="5511999990000" />
          </Field>
          <Field label="E-mail">
            <Input type="email" value={form.email} onChange={set("email")} placeholder="cliente@email.com" />
          </Field>
          <Field label="Endereço">
            <Input value={form.address} onChange={set("address")} placeholder="Rua, avenida..." />
          </Field>
          <Field label="Número">
            <Input value={form.number} onChange={set("number")} placeholder="Número" />
          </Field>
          <Field label="Complemento">
            <Input value={form.complement} onChange={set("complement")} placeholder="Apto, bloco, loja..." />
          </Field>
          <Field label="Bairro">
            <Input value={form.neighborhood} onChange={set("neighborhood")} placeholder="Bairro" />
          </Field>
          <Field label="Cidade">
            <Input value={form.city} onChange={set("city")} placeholder="Cidade" />
          </Field>
          <Field label="UF">
            <Input value={form.uf} onChange={set("uf")} placeholder="UF" maxLength={2} />
          </Field>
          <Field label="CEP">
            <Input value={form.cep} onChange={(e) => setForm((f) => ({ ...f, cep: maskInputCep(e.target.value) }))} placeholder="00000-000" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Observações">
              <Textarea rows={2} value={form.notes} onChange={set("notes")} placeholder="Preferências, anotações..." />
            </Field>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `Ficha de ${detail.name}` : "Ficha do cliente"}
        size="lg"
        footer={<Button variant="secondary" onClick={() => setDetail(null)}>Fechar</Button>}
      >
        {detailLoading || !detail ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-600">
                {[detail.address, detail.number ? `nº ${detail.number}` : "", detail.complement, detail.neighborhood, detail.city, detail.uf, detail.cep ? maskCep(detail.cep) : ""]
                  .filter(Boolean)
                  .join(" · ") || "Sem endereço cadastrado"}
              </p>
              <Badge tone={detail.status === "ativo" ? "emerald" : "zinc"}>
                {detail.status === "ativo" ? "Ativo" : "Inativo"}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-xl bg-zinc-50 p-3">
                <p className="flex items-center gap-1 text-xs text-zinc-400"><ShoppingBag size={12} /> Compras</p>
                <p className="mt-1 text-lg font-bold text-zinc-900">{detail.stats.sale_count}</p>
              </div>
              <div className="rounded-xl bg-zinc-50 p-3">
                <p className="text-xs text-zinc-400">Total comprado</p>
                <p className="mt-1 text-lg font-bold text-rose-600">{money(detail.stats.total_spent_cents)}</p>
              </div>
              <div className="rounded-xl bg-zinc-50 p-3">
                <p className="text-xs text-zinc-400">Em fiado</p>
                <p className="mt-1 text-lg font-bold text-zinc-900">{money(detail.stats.total_fiado_cents)}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3">
                <p className="flex items-center gap-1 text-xs text-emerald-500"><HandCoins size={12} /> Recebido</p>
                <p className="mt-1 text-lg font-bold text-emerald-700">{money(detail.stats.total_received_cents)}</p>
              </div>
              <div className="rounded-xl bg-violet-50 p-3">
                <p className="flex items-center gap-1 text-xs text-violet-500"><Wallet size={12} /> Em aberto</p>
                <p className={`mt-1 text-lg font-bold ${detail.stats.open_balance_cents > 0 ? "text-violet-700" : "text-zinc-900"}`}>
                  {money(detail.stats.open_balance_cents)}
                </p>
              </div>
              <div className="rounded-xl bg-red-50 p-3">
                <p className="text-xs text-red-400">Canceladas</p>
                <p className="mt-1 text-lg font-bold text-red-600">{detail.stats.cancelled_count}</p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Débitos (contas a receber)</p>
              {detail.receivables.length === 0 ? (
                <p className="rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-400">Nenhuma conta registrada.</p>
              ) : (
                <div className="space-y-2">
                  {detail.receivables.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="text-zinc-700">
                          Venda #{String(r.sale_id).padStart(4, "0")} · vence {formatDate(r.due_date)}
                        </p>
                        <p className="text-xs text-zinc-400">{r.status === "pago" ? `Recebido em ${formatDate(r.paid_at ?? "")}` : "Pendente"}</p>
                        {r.received_cents ? (
                          <p className="text-xs text-zinc-400">
                            pago {money(r.received_cents)} de {money(r.total_cents)}
                          </p>
                        ) : null}
                      </div>
                      <p className="font-bold text-zinc-900">{money(r.remaining_cents ?? r.total_cents)}</p>
                      {r.status === "pendente" && (
                        <Button
                          size="sm"
                          onClick={() =>
                            setPayingRec({
                              id: r.id,
                              customer_name: detail.name,
                              total_cents: r.total_cents,
                              remaining_cents: r.remaining_cents ?? r.total_cents,
                            })
                          }
                        >
                          <HandCoins size={14} /> Receber
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Recebimentos</p>
              {detail.payments.length === 0 ? (
                <p className="rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-400">Nenhum recebimento registrado.</p>
              ) : (
                <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {detail.payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-100 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate text-zinc-700">{p.reference} · {formatDate(p.created_at)}</p>
                        <p className="text-xs text-zinc-400">
                          {PAYMENT_OPTIONS.find((o) => o.value === p.payment_method)?.label ?? p.payment_method}
                          {p.user_name ? ` · ${p.user_name}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 font-semibold text-emerald-600">{money(p.amount_cents)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Histórico de compras</p>
              {detail.sales_history.length === 0 ? (
                <p className="rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-400">Nenhuma compra registrada.</p>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {detail.sales_history.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-100 px-3 py-2 text-sm">
                      <span className="text-zinc-600">
                        Venda #{String(s.id).padStart(4, "0")} · {formatDate(s.created_at)}
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone={s.payment_method === "fiado" ? "violet" : s.status === "cancelada" ? "red" : "zinc"}>
                          {s.status === "cancelada"
                            ? "Cancelada"
                            : PAYMENT_OPTIONS.find((p) => p.value === s.payment_method)?.label}
                        </Badge>
                        <span className={`font-semibold ${s.status === "cancelada" ? "text-zinc-400 line-through" : "text-zinc-800"}`}>
                          {money(s.total_cents)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <PayReceivableModal
        target={payingRec}
        onClose={() => setPayingRec(null)}
        onPaid={receivePayment}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Excluir cliente"
        message={`Tem certeza que deseja excluir "${deleting?.name}"?`}
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}