import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Plus, Trash2, Edit, Loader2, Package } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Button, Card, Field, Input, PageHeader, PageLoader, Select } from "../components/ui";

interface Combo {
  id: number;
  name: string;
  description: string;
  sale_price_cents: number;
  active: number;
  created_at: string;
  items?: ComboItem[];
}

interface ComboItem {
  id: number;
  combo_id: number;
  product_id: number;
  quantity: number;
  product_name?: string;
  product_price_cents?: number;
  category_name?: string;
}

interface Product {
  id: number;
  name: string;
  sale_price_cents: number;
  category_id: number;
  category_name?: string;
  active: number;
}

interface ComboForm {
  name: string;
  description: string;
  sale_price_cents: number;
  active: number;
  items: { product_id: number; quantity: number }[];
}

const EMPTY_FORM = {
  name: "",
  description: "",
  sale_price_cents: 0,
  active: 1,
  items: [] as { product_id: number; quantity: number }[],
};

export default function Combos() {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();

  const [combos, setCombos] = useState<Combo[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState<ComboForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    try {
      const [combosData, productsData] = await Promise.all([
        api.get<any[]>("/api/combos"),
        api.get<any[]>(`/api/products?active=1&limit=200`),
      ]);
      setCombos(combosData);
      setProducts(productsData.filter((p: any) => p.active === 1));
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  const setField = useCallback((key: keyof Omit<ComboForm, "items">) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => {
      if (key === "sale_price_cents" || key === "active") {
        return { ...f, [key]: Number(e.target.value) };
      }
      return { ...f, [key]: e.target.value };
    });
  }, []);

  function addItem() {
    setForm(f => ({ ...f, items: [...f.items, { product_id: 0, quantity: 1 }] }));
  }

  function removeItem(index: number) {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== index) }));
  }

  function setItemField(index: number, key: "product_id" | "quantity", value: number) {
    setForm(f => ({
      ...f,
      items: f.items.map((item, i) => i === index ? { ...item, [key]: value } : item)
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toastError("Informe o nome do combo.");
      return;
    }
    if (!form.sale_price_cents || form.sale_price_cents <= 0) {
      toastError("Preço deve ser maior que zero.");
      return;
    }
    if (!form.items.length) {
      toastError("Combo deve ter pelo menos um item.");
      return;
    }
    if (form.items.some(i => !i.product_id || i.quantity <= 0)) {
      toastError("Todos os itens devem ter produto e quantidade válida.");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/api/combos/${editingId}`, form);
        success("Combo atualizado!");
      } else {
        await api.post("/api/combos", form);
        success("Combo criado!");
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      loadInitialData();
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(combo: Combo) {
    setForm({
      name: combo.name,
      description: combo.description || "",
      sale_price_cents: combo.sale_price_cents,
      active: combo.active,
      items: (combo.items || []).map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
      })),
    });
    setEditingId(combo.id);
  }

  function cancelEdit() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  async function toggleActive(combo: Combo) {
    try {
      await api.put(`/api/combos/${combo.id}`, { ...combo, active: combo.active === 1 ? 0 : 1 });
      success(`Combo ${combo.active === 1 ? "desativado" : "ativado"}!`);
      loadInitialData();
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao alterar status.");
    }
  }

  async function handleDelete(combo: Combo) {
    if (!confirm(`Tem certeza que deseja desativar o combo "${combo.name}"?`)) return;
    try {
      await api.del(`/api/combos/${combo.id}`);
      success("Combo desativado!");
      loadInitialData();
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao remover.");
    }
  }

  function formatPrice(cents: number) {
    return "R$ " + (cents / 100).toFixed(2).replace(".", ",");
  }

  function getProductName(id: number) {
    return products.find(p => p.id === id)?.name || "Produto não encontrado";
  }

  function getItemTotal(item: { product_id: number; quantity: number }) {
    const product = products.find(p => p.id === item.product_id);
    return product ? product.sale_price_cents * item.quantity : 0;
  }

  if (loading) return <PageLoader />;

  return (
    <div>
      <PageHeader title="Combos" subtitle="Gerenciar combos promocionais" />
      
      <Card className="p-5 mb-5">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-zinc-900">
          <svg className="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v12" /></svg>
          {editingId ? "Editar Combo" : "Novo Combo"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Nome" required>
                <Input value={form.name} onChange={setField("name")} placeholder="Ex: COMBO HULK" />
              </Field>
            </div>

            <Field label="Preço (centavos)" required hint="Ex: 11499 = R$ 114,99">
              <Input 
                type="number" 
                min="1" 
                value={form.sale_price_cents} 
                onChange={setField("sale_price_cents")} 
                placeholder="11499" 
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

          <div>
            <Field label="Descrição">
              <textarea 
                value={form.description} 
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} 
                placeholder="Descrição do combo (itens incluídos, detalhes...)" 
                rows={3}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
              />
            </Field>
          </div>

          <div className="border-t border-zinc-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-zinc-900">Itens do Combo</h3>
              <Button type="button" variant="secondary" size="sm" onClick={addItem}>
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Adicionar Item
              </Button>
            </div>

            {form.items.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-4">Nenhum item adicionado. Clique em "Adicionar Item" para começar.</p>
            ) : (
              <div className="space-y-2">
                {form.items.map((item, index) => (
                  <div key={index} className="flex flex-col sm:flex-row gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-200">
                    <div className="flex-1 min-w-0">
                      <label className="block text-xs text-zinc-500 mb-1">Produto</label>
                      <select
                        value={item.product_id}
                        onChange={(e) => setItemField(index, "product_id", Number(e.target.value))}
                        className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                      >
                        <option value={0}>Selecione o produto</option>
                        {products.filter(p => p.active === 1).map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} (R$ {(p.sale_price_cents/100).toFixed(2).replace(".", ",")})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="w-24">
                      <label className="block text-xs text-zinc-500 mb-1">Qtd</label>
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={item.quantity}
                        onChange={(e) => setItemField(index, "quantity", Number(e.target.value))}
                        className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                      />
                    </div>
                    <div className="flex items-end">
                      <span className="text-sm text-rose-600 font-medium min-w-[100px]">
                        {getItemTotal(item) > 0 ? `Subtotal: R$ ${(getItemTotal(item)/100).toFixed(2).replace(".", ",")}` : "—"}
                      </span>
                      <Button type="button" variant="ghost" size="sm" className="text-rose-600 hover:text-rose-800" onClick={() => removeItem(index)}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t border-zinc-200">
            <Button type="submit" loading={saving} className="w-full sm:w-auto">{editingId ? "Atualizar" : "Criar"}</Button>
            {editingId && <Button type="button" variant="secondary" onClick={cancelEdit}>Cancelar</Button>}
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="font-display text-lg font-semibold text-zinc-900">Lista de Combos ({combos.length})</h2>
        </div>

        {combos.length === 0 ? (
          <p className="text-center text-zinc-500 py-8">Nenhum combo cadastrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th className="pb-2 pr-4">ID</th>
                  <th className="pb-2 pr-4">Nome</th>
                  <th className="pb-2 pr-4">Preço</th>
                  <th className="pb-2 pr-4">Itens</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Criado em</th>
                  <th className="pb-2 pr-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {combos.map((combo) => (
                  <tr key={combo.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                    <td className="py-3 pr-4 text-zinc-600">{combo.id}</td>
                    <td className="py-3 pr-4 font-medium text-zinc-900 max-w-xs truncate">{combo.name}</td>
                    <td className="py-3 pr-4 font-semibold text-rose-600">R$ {(combo.sale_price_cents/100).toFixed(2).replace(".", ",")}</td>
                    <td className="py-3 pr-4 text-zinc-500">{combo.items?.length || 0} itens</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        combo.active === 1 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      }`}>
                        {combo.active === 1 ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-zinc-500">{combo.created_at.slice(0, 16).replace("T", " ")}</td>
                    <td className="py-3 pr-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(combo)}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleActive(combo)}>
                          {combo.active === 1 ? (
                            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                          ) : (
                            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          )}
                        </Button>
                        <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => handleDelete(combo)}>
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

function formatPrice(cents: number) {
  return "R$ " + (cents / 100).toFixed(2).replace(".", ",");
}