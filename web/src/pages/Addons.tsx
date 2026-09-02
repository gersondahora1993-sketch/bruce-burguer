import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Plus, Trash2, Edit, Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Button, Card, Field, Input, PageHeader, PageLoader, Select } from "../components/ui";

interface Addon {
  id: number;
  name: string;
  price_cents: number;
  active: number;
  created_at: string;
}

interface AddonForm {
  name: string;
  price_cents: number;
  active: number;
}

const EMPTY_FORM = { name: "", price_cents: 0, active: 1 };

export default function Addons() {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();

  const [addons, setAddons] = useState<Addon[]>([]);
  const [form, setForm] = useState<AddonForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAddons();
  }, []);

  async function loadAddons() {
    try {
      const data = await api.get<Addon[]>("/api/addons");
      setAddons(data);
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao carregar adicionais.");
    } finally {
      setLoading(false);
    }
  }

  const setField = useCallback((key: keyof AddonForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => {
      if (key === "price_cents" || key === "active") {
        return { ...f, [key]: Number(e.target.value) };
      }
      return { ...f, [key]: e.target.value };
    });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toastError("Informe o nome do adicional.");
      return;
    }
    if (form.price_cents === undefined || form.price_cents < 0) {
      toastError("Preço deve ser maior ou igual a zero.");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/api/addons/${editingId}`, form);
        success("Adicional atualizado!");
      } else {
        await api.post("/api/addons", form);
        success("Adicional criado!");
      }
      setForm({ name: "", price_cents: 0, active: 1 });
      setEditingId(null);
      loadAddons();
    } catch (err: any) {
      if (err?.message?.includes("UNIQUE")) {
        toastError("Adicional com este nome já existe.");
      } else {
        toastError(err?.message ?? "Erro ao salvar.");
      }
    } finally {
      setSaving(false);
    }
  }

  function startEdit(addon: Addon) {
    setForm({ name: addon.name, price_cents: addon.price_cents, active: addon.active });
    setEditingId(addon.id);
  }

  function cancelEdit() {
    setForm({ name: "", price_cents: 0, active: 1 });
    setEditingId(null);
  }

  async function toggleActive(addon: Addon) {
    try {
      await api.put(`/api/addons/${addon.id}`, { ...addon, active: addon.active === 1 ? 0 : 1 });
      success(`Adicional ${addon.active === 1 ? "desativado" : "ativado"}!`);
      loadAddons();
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao alterar status.");
    }
  }

  async function handleDelete(addon: Addon) {
    if (!confirm(`Tem certeza que deseja ${addon.active === 1 ? "desativar" : "remover"} o adicional "${addon.name}"?`)) return;
    try {
      await api.del(`/api/addons/${addon.id}`);
      success("Adicional removido!");
      loadAddons();
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao remover.");
    }
  }

  function formatPrice(cents: number) {
    return "R$ " + (cents / 100).toFixed(2).replace(".", ",");
  }

  if (loading) return <PageLoader />;

  return (
    <div>
      <PageHeader title="Adicionais" subtitle="Gerenciar adicionais dos produtos" />
      
      <Card className="p-5 mb-5">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-zinc-900">
          {editingId ? "Editar Adicional" : "Novo Adicional"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" required>
              <Input value={form.name} onChange={setField("name")} placeholder="Ex: Bacon" />
            </Field>
            
            <Field label="Preço (centavos)" required hint="Ex: 400 = R$ 4,00">
              <Input 
                type="number" 
                min="0" 
                value={form.price_cents} 
                onChange={setField("price_cents")} 
                placeholder="400" 
                inputMode="numeric"
              />
            </Field>
            
            <Field label="Status">
              <Select value={form.active} onChange={setField("active")}>
                <option value={1}>Ativo</option>
                <option value={0}>Inativo</option>
              </Select>
            </Field>
          </div>
          <div className="flex gap-3">
            <Button type="submit" loading={saving}>{editingId ? "Atualizar" : "Criar"}</Button>
            {editingId && <Button type="button" variant="secondary" onClick={cancelEdit}>Cancelar</Button>}
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-display text-lg font-semibold text-zinc-900">Lista de Adicionais</h2>
        {addons.length === 0 ? (
          <p className="text-center text-zinc-500 py-8">Nenhum adicional cadastrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th className="pb-2 pr-4">ID</th>
                  <th className="pb-2 pr-4">Nome</th>
                  <th className="pb-2 pr-4">Preço</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Criado em</th>
                  <th className="pb-2 pr-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {addons.map((addon) => (
                  <tr key={addon.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                    <td className="py-3 pr-4 text-zinc-600">{addon.id}</td>
                    <td className="py-3 pr-4 font-medium text-zinc-900">{addon.name}</td>
                    <td className="py-3 pr-4 font-semibold text-rose-600">R$ {(addon.price_cents/100).toFixed(2).replace(".", ",")}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        addon.active === 1 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      }`}>
                        {addon.active === 1 ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-zinc-500">{addon.created_at.slice(0, 16).replace("T", " ")}</td>
                    <td className="py-3 pr-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(addon)}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleActive(addon)}>
                          {addon.active === 1 ? (
                            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                          ) : (
                            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          )}
                        </Button>
                        <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => handleDelete(addon)}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}