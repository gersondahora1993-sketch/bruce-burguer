import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Button, Card, Field, Input, PageHeader, PageLoader, Select, Textarea, Toggle } from "../components/ui";
import { centsToInput, parseMoney } from "../lib/format";

interface Category {
  id: number;
  name: string;
  active: number;
}

interface Addon {
  id: number;
  name: string;
  price_cents: number;
  active: number;
}

export default function ProductForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [categories, setCategories] = useState<Category[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [active, setActive] = useState(true);
  const [addonIds, setAddonIds] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const [cats, adds] = await Promise.all([
          api.get<Category[]>("/api/categories"),
          api.get<Addon[]>("/api/addons"),
        ]);
        setCategories(cats);
        setAddons(adds);

        if (isEdit) {
          const p = await api.get<any>(`/api/products/${id}`);
          setName(p.name);
          setCategoryId(p.category_id ? String(p.category_id) : "");
          setDescription(p.description);
          setSalePrice(centsToInput(p.sale_price_cents));
          setImageUrl(p.image_url || "");
          setActive(p.active === 1);
          setAddonIds((p.addons ?? []).map((a: Addon) => a.id));
        }
      } catch (err: any) {
        toastError(err?.message ?? "Não foi possível carregar os dados.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isEdit, toastError]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const sale = parseMoney(salePrice);
    const errs = {
      name: !name.trim(),
      category: !categoryId,
      sale: sale === null || sale <= 0,
    };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      toastError("Verifique os campos destacados antes de salvar.");
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim(),
      category_id: Number(categoryId),
      sale_price_cents: sale!,
      image_url: imageUrl.trim(),
      active: active ? 1 : 0,
      addon_ids: addonIds,
    };

    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/api/products/${id}`, payload);
        success("Produto atualizado com sucesso!");
      } else {
        await api.post("/api/products", payload);
        success("Produto cadastrado com sucesso!");
      }
      navigate("/products");
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível salvar o produto.");
      setSaving(false);
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title={isEdit ? "Editar produto" : "Cadastrar produto"}
        subtitle={isEdit ? "Atualize as informações do produto" : "Cadastre um produto do cardápio"}
        action={
          <Link to="/products">
            <Button variant="secondary">
              <ArrowLeft size={16} /> Voltar
            </Button>
          </Link>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card className="p-5">
          <h2 className="mb-4 font-display text-lg font-semibold text-zinc-900">Informações do produto</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do produto" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: X-Burguer" invalid={errors.name} />
            </Field>

            <Field label="Categoria" required>
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} invalid={errors.category}>
                <option value="">Selecione...</option>
                {categories.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Preço de venda (R$)" required>
              <Input
                inputMode="decimal"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="0,00"
                invalid={errors.sale}
              />
            </Field>

            <Field label="Imagem (URL)" hint="Cole o link da imagem do produto">
              <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Adicionais" hint="Selecione os adicionais disponíveis para este produto">
                <Select
                  value={addonIds.map(String)}
                  onChange={(e) =>
                    setAddonIds(
                      Array.from(e.target.selectedOptions)
                        .map((opt) => Number(opt.value))
                        .filter((v) => v > 0)
                    )
                  }
                  multiple
                  className="min-h-[120px]"
                >
                  {addons.filter((a) => a.active).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} (+ R$ {(a.price_cents / 100).toFixed(2).replace(".", ",")})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="Descrição">
                <Textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descrição do produto (ingredientes, detalhes...)"
                />
              </Field>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Toggle checked={active} onChange={setActive} />
            <span className="text-sm text-zinc-600">Produto ativo (aparece no cardápio)</span>
          </div>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Link to="/products" className="w-full sm:w-auto">
            <Button variant="secondary" type="button" className="w-full sm:w-auto">
              Cancelar
            </Button>
          </Link>
          <Button type="submit" loading={saving} size="lg" className="w-full sm:w-auto">
            {!saving && <Save size={17} />}
            {isEdit ? "Salvar alterações" : "Cadastrar produto"}
          </Button>
        </div>
      </form>
    </div>
  );
}