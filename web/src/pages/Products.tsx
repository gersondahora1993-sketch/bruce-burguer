import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Edit, Loader2, Search, Tags } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Button, Card, Field, Input, PageHeader, PageLoader, Select, Textarea } from "../components/ui";

interface Product {
  id: number;
  name: string;
  description: string;
  category_id: number;
  sale_price_cents: number;
  image_url: string;
  active: number;
  created_at: string;
  category_name?: string;
  addons?: { id: number; name: string; price_cents: number }[];
  stock?: number;
  min_stock?: number;
}

interface Addon {
  id: number;
  name: string;
  price_cents: number;
  active: number;
}

interface Category {
  id: number;
  name: string;
  active: number;
}

interface ProductForm {
  name: string;
  description: string;
  category_id: number;
  sale_price_cents: number;
  image_url: string;
  active: number;
  addon_ids: number[];
}

const EMPTY_FORM = {
  name: "",
  description: "",
  category_id: 0,
  sale_price_cents: 0,
  image_url: "",
  active: 1,
  addon_ids: [] as number[],
};

export default function Products() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(0);
  const [activeFilter, setActiveFilter] = useState(-1);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  function getCategoryName(catId: number): string {
    return categories.find(c => c.id === catId)?.name || "—";
  }

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    try {
      const [cats, adds] = await Promise.all([
        api.get<Category[]>(`/api/categories?active=1`),
        api.get<Addon[]>(`/api/addons?active=1`),
      ]);
      setCategories(cats);
      setAddons(adds);
      loadProducts();
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao carregar dados iniciais.");
    } finally {
      setLoading(false);
    }
  }

  async function loadProducts() {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (categoryFilter) params.set("category_id", String(categoryFilter));
      if (activeFilter >= 0) params.set("active", String(activeFilter));
      params.set("limit", "100");
      
      const data = await api.get<any[]>(`/api/products?${params.toString()}`);
      setProducts(data);
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao carregar produtos.");
    }
  }

  const setField = useCallback((key: keyof typeof EMPTY_FORM) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => {
      if (key === "addon_ids") {
        const select = e.target as HTMLSelectElement;
        const values = Array.from(select.selectedOptions).map(opt => Number(opt.value)).filter(v => v > 0);
        return { ...f, [key]: values };
      }
      if (key === "category_id" || key === "active" || key === "sale_price_cents") {
        return { ...f, [key]: Number((e.target as HTMLInputElement | HTMLSelectElement).value) };
      }
      return { ...f, [key]: (e.target as HTMLInputElement | HTMLTextAreaElement).value };
    });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toastError("Informe o nome do produto.");
      return;
    }
    if (!form.category_id) {
      toastError("Selecione uma categoria.");
      return;
    }
    if (!form.sale_price_cents || form.sale_price_cents <= 0) {
      toastError("Preço deve ser maior que zero.");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/api/products/${editingId}`, form);
        success("Produto atualizado!");
      } else {
        await api.post("/api/products", form);
        success("Produto criado!");
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setShowForm(false);
      loadProducts();
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(product: any) {
    const addonIds = product.addons ? product.addons.map((a: any) => a.id) : [];
    setForm({
      name: product.name,
      description: product.description,
      category_id: product.category_id,
      sale_price_cents: product.sale_price_cents,
      image_url: product.image_url || "",
      active: product.active,
      addon_ids: addonIds,
    });
    setEditingId(product.id);
    setShowForm(true);
  }

  function cancelEdit() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  async function toggleActive(product: any) {
    try {
      await api.put(`/api/products/${product.id}`, { active: product.active === 1 ? 0 : 1 });
      success(`Produto ${product.active === 1 ? "desativado" : "ativado"}!`);
      loadProducts();
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao alterar status.");
    }
  }

  async function handleDelete(product: any) {
    if (!confirm(`Tem certeza que deseja ${product.active === 1 ? "desativar" : "remover"} o produto "${product.name}"?`)) return;
    try {
      await api.del(`/api/products/${product.id}`);
      success("Produto removido!");
      loadProducts();
    } catch (err: any) {
      toastError(err?.message ?? "Erro ao remover.");
    }
  }

  function toggleSelect(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function toggleSelectAll() {
    setSelected((s) => (products.length > 0 && products.every((p) => s.includes(p.id)) ? [] : products.map((p) => p.id)));
  }

  function printLabels() {
    if (selected.length === 0) return;
    navigate(`/products/labels?items=${selected.map((id) => `${id}:1`).join(",")}`);
  }

  function formatPrice(cents: number) {
    return "R$ " + (cents / 100).toFixed(2).replace(".", ",");
  }

  if (loading) return <PageLoader />;

  return (
    <div>
      <PageHeader title="Produtos" subtitle="Gerenciar produtos do cardápio" />
      
      <Card className="p-4 mb-5">
        <div className="flex flex-wrap gap-3 items-center">
          <Button onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); }} className="whitespace-nowrap">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Novo Produto
          </Button>
          
          <div className="flex-1 max-w-md">
            <Input 
              placeholder="Buscar por nome ou descrição..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              className="w-full"
            />
          </div>
          
          <Select value={categoryFilter} onChange={(e) => setCategoryFilter(Number(e.target.value))} className="w-48">
            <option value={0}>Todas as categorias</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          
          <Select value={activeFilter} onChange={(e) => setActiveFilter(Number(e.target.value))} className="w-32">
            <option value={-1}>Todos</option>
            <option value={1}>Ativos</option>
            <option value={0}>Inativos</option>
          </Select>
        </div>
      </Card>

      {showForm && (
        <Card className="p-5 mb-5 bg-gradient-to-b from-zinc-50 to-white border-zinc-200">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-zinc-900">
            {editingId ? "Editar Produto" : "Novo Produto"}
            <Button variant="ghost" size="sm" onClick={cancelEdit} className="ml-auto">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </Button>
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2">
                <Field label="Nome" required>
                  <Input value={form.name} onChange={setField("name")} placeholder="Nome do produto" />
                </Field>
              </div>
              
              <div className="sm:col-span-2">
                <Field label="Categoria" required>
                  <Select value={form.category_id} onChange={setField("category_id")}>
                    <option value={0}>Selecione</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
              </div>
              
              <Field label="Preço (centavos)" required hint="Ex: 1499 = R$ 14,99">
                <Input 
                  type="number" 
                  min="1" 
                  value={form.sale_price_cents} 
                  onChange={setField("sale_price_cents")} 
                  placeholder="1499" 
                  inputMode="numeric"
                />
              </Field>
              
              <Field label="Imagem (URL)" hint="URL da imagem do produto">
                <Input value={form.image_url} onChange={setField("image_url")} placeholder="https://..." />
              </Field>
              
              <Field label="Status">
                <Select value={form.active} onChange={setField("active")}>
                  <option value={1}>Ativo</option>
                  <option value={0}>Inativo</option>
                </Select>
              </Field>
              
              <Field label="Adicionais" hint="Selecione os adicionais disponíveis para este produto">
                <Select 
                  value={form.addon_ids.map(String)} 
                  onChange={(e) => setForm(f => ({ ...f, addon_ids: Array.from(e.target.selectedOptions).map(opt => Number(opt.value)).filter(v => v > 0) }))} 
                  multiple
                  className="min-h-[120px]"
                >
                  {addons.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} (+ R$ {(a.price_cents/100).toFixed(2).replace(".", ",")})
                    </option>
                  ))}
                </Select>
              </Field>
              
              <div className="lg:col-span-3">
                <Field label="Descrição">
                  <Textarea 
                    value={form.description} 
                    onChange={setField("description")} 
                    placeholder="Descrição do produto (ingredientes, detalhes...)" 
                    rows={3}
                  />
                </Field>
              </div>
            </div>
            <div className="flex gap-3 pt-2 border-t border-zinc-200">
              <Button type="submit" loading={saving} className="w-full sm:w-auto">
                {editingId ? "Atualizar" : "Criar"}
              </Button>
              <Button type="button" variant="secondary" onClick={cancelEdit}>Cancelar</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="font-display text-lg font-semibold text-zinc-900">Lista de Produtos ({products.length})</h2>
          {selected.length > 0 && (
            <Button size="sm" onClick={printLabels}>
              <Tags size={15} /> Etiquetas ({selected.length})
            </Button>
          )}
          <div className="flex gap-2">
            <Input 
              placeholder="Filtrar por nome..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              className="w-64"
            />
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(Number(e.target.value))} className="w-40">
              <option value={0}>Todas</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select value={activeFilter} onChange={(e) => setActiveFilter(Number(e.target.value))} className="w-28">
              <option value={-1}>Todos</option>
              <option value={1}>Ativos</option>
              <option value={0}>Inativos</option>
            </Select>
          </div>
        </div>

        {products.length === 0 ? (
          <p className="text-center text-zinc-500 py-8">Nenhum produto encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-zinc-500">
                    <th className="pb-2 pr-4">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-rose-600"
                        checked={products.length > 0 && products.every((p) => selected.includes(p.id))}
                        onChange={toggleSelectAll}
                        aria-label="Selecionar todos"
                      />
                    </th>
                    <th className="pb-2 pr-4">ID</th>
                    <th className="pb-2 pr-4">Imagem</th>
                    <th className="pb-2 pr-4">Nome</th>
                    <th className="pb-2 pr-4">Categoria</th>
                    <th className="pb-2 pr-4">Preço</th>
                    <th className="pb-2 pr-4">Estoque</th>
                    <th className="pb-2 pr-4">Mín.</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Adicionais</th>
                    <th className="pb-2 pr-4 text-right">Ações</th>
                  </tr>
                </thead>
              <tbody>
                {products
                  .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
                  .map((p) => (
                    <tr key={p.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                      <td className="py-3 pr-4">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-rose-600"
                          checked={selected.includes(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          aria-label={`Selecionar ${p.name}`}
                        />
                      </td>
                      <td className="py-3 pr-4 text-zinc-600">{p.id}</td>
                      <td className="py-3 pr-4">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.name} className="h-12 w-12 rounded-lg border border-zinc-200 object-cover" onError={(e) => (e.target as HTMLImageElement).style.display = "none"} />
                        ) : (
                          <div className="h-12 w-12 rounded-lg border-2 border-dashed border-zinc-200 flex items-center justify-center">
                            <span className="text-xs text-zinc-400">Sem imagem</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-medium text-zinc-900 truncate max-w-xs">{p.name}</td>
                      <td className="py-3 pr-4 text-zinc-600">{getCategoryName(p.category_id)}</td>
                      <td className="py-3 pr-4 font-semibold text-rose-600">R$ {(p.sale_price_cents/100).toFixed(2).replace(".", ",")}</td>
                      <td className="py-3 pr-4">
                        <span className={`font-bold ${p.stock !== undefined && p.stock <= 0 ? "text-red-600" : p.stock !== undefined && p.min_stock !== undefined && p.min_stock > 0 && p.stock <= p.min_stock ? "text-amber-600" : "text-emerald-600"}`}>
                          {p.stock !== undefined ? p.stock : "—"}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-zinc-500">{p.min_stock ?? "—"}</td>
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          p.active === 1 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                        }`}>
                          {p.active === 1 ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-zinc-500 text-center">
                        {p.addons && p.addons.length > 0 ? p.addons.length : 0}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => toggleActive(p)}>
                            {p.active === 1 ? (
                              <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            ) : (
                              <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            )}
                          </Button>
                          <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => handleDelete(p)}>
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