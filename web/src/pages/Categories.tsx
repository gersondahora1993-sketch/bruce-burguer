import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Plus, Trash2, Edit, Check, X, Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Button, Card, Field, Input, PageHeader, PageLoader, Select } from "../components/ui";

interface Category {
  id: number;
  name: string;
  active: number;
  created_at: string;
}

interface CategoryForm {
  name: string;
  active: number;
}

const EMPTY_FORM: CategoryForm = { name: "", active: 1 };

export default function Categories() {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();

  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<CategoryForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadCategories();
  }, []);

  async function loadCategories() {
    try {
      const data = await api.get<Category[]>("/api/categories");
      setCategories(data);
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao carregar categorias.");
    } finally {
      setLoading(false);
    }
  }

  const setField = useCallback((key: keyof CategoryForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [key]: key === "active" ? Number(e.target.value) : e.target.value }));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toastError("Informe o nome da categoria.");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/api/categories/${editingId}`, form);
        success("Categoria atualizada!");
      } else {
        await api.post("/api/categories", form);
        success("Categoria criada!");
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      loadCategories();
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(cat: Category) {
    setForm({ name: cat.name, active: cat.active });
    setEditingId(cat.id);
  }

  function cancelEdit() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  async function toggleActive(cat: Category) {
    try {
      await api.put(`/api/categories/${cat.id}`, { ...cat, active: cat.active === 1 ? 0 : 1 });
      success(`Categoria ${cat.active === 1 ? "desativada" : "ativada"}!`);
      loadCategories();
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao alterar status.");
    }
  }

  async function handleDelete(cat: Category) {
    if (!confirm(`Tem certeza que deseja ${cat.active === 1 ? "desativar" : "remover"} a categoria "${cat.name}"?`)) return;
    try {
      await api.del(`/api/categories/${cat.id}`);
      success("Categoria removida!");
      loadCategories();
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao remover.");
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div>
      <PageHeader title="Categorias" subtitle="Gerenciar categorias do cardápio" />
      
      <Card className="p-5 mb-5">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-zinc-900">
          {editingId ? "Editar Categoria" : "Nova Categoria"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" required>
              <Input value={form.name} onChange={setField("name")} placeholder="Ex: Hambúrgueres" />
            </Field>
            <Field label="Status">
              <Select value={form.active} onChange={setField("active")}>
                <option value={1}>Ativa</option>
                <option value={0}>Inativa</option>
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
        <h2 className="mb-4 font-display text-lg font-semibold text-zinc-900">Lista de Categorias</h2>
        {categories.length === 0 ? (
          <p className="text-center text-zinc-500 py-8">Nenhuma categoria cadastrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th className="pb-2 pr-4">ID</th>
                  <th className="pb-2 pr-4">Nome</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Criada em</th>
                  <th className="pb-2 pr-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => (
                  <tr key={cat.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                    <td className="py-3 pr-4 text-zinc-600">{cat.id}</td>
                    <td className="py-3 pr-4 font-medium text-zinc-900">{cat.name}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        cat.active === 1 
                          ? "bg-emerald-100 text-emerald-700" 
                          : "bg-rose-100 text-rose-700"
                      }`}>
                        {cat.active === 1 ? "Ativa" : "Inativa"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-zinc-500">{cat.created_at.slice(0, 16).replace("T", " ")}</td>
                    <td className="py-3 pr-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(cat)}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleActive(cat)}>
                          {cat.active === 1 ? (
                            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                          ) : (
                            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          )}
                        </Button>
                        <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => handleDelete(cat)}>
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