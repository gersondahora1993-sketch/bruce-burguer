import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save, ImagePlus, Camera, X } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Button, Card, Field, Input, PageHeader, Select, Textarea, Toggle, PageLoader, EmptyState } from "../components/ui";
import VariationsEditor from "../components/VariationsEditor";
import type { VariationRow } from "../components/VariationsEditor";
import { parseMoney, centsToInput } from "../lib/format";
import type { Category, Color, Product, Size } from "../types";

export default function ProductForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [categories, setCategories] = useState<Category[]>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [removedPhoto, setRemovedPhoto] = useState(false);
  const [active, setActive] = useState(true);
  const [variations, setVariations] = useState<VariationRow[]>([]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [c, co, s] = await Promise.all([
          api.get<Category[]>("/api/categories?includeInactive=1"),
          api.get<Color[]>("/api/colors?includeInactive=1"),
          api.get<Size[]>("/api/sizes?includeInactive=1"),
        ]);
        setCategories(c);
        setColors(co);
        setSizes(s);

        if (isEdit) {
          const p = await api.get<Product>(`/api/products/${id}`);
          setName(p.name);
          setSku(p.sku);
          setCategoryId(p.category_id ? String(p.category_id) : "");
          setDescription(p.description);
          setCostPrice(centsToInput(p.cost_price_cents));
          setSalePrice(centsToInput(p.sale_price_cents));
          setImageUrl(p.image_url);
          setUrlDraft(p.image_url.startsWith("data:") ? "" : p.image_url);
          setActive(p.active);
          setVariations(p.variations.map((v) => ({ color_id: v.color_id, size_id: v.size_id, stock: v.stock, min_stock: v.min_stock })));
        }
      } catch (err: any) {
        toastError(err?.message ?? "Não foi possível carregar os dados.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isEdit, toastError]);

  function onImageFile(file: File | null) {
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      toastError("Formato não suportado. Use uma foto JPG, PNG ou WEBP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toastError("Imagem muito grande. Envie uma foto de até 5 MB.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setUrlDraft("");
    setRemovedPhoto(false);
  }

  function removePhoto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setPendingFile(null);
    setUrlDraft("");
    if (!pendingFile && imageUrl) setRemovedPhoto(true);
    if (!pendingFile) setImageUrl("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cost = parseMoney(costPrice);
    const sale = parseMoney(salePrice);
    const errs = {
      name: !name.trim(),
      sku: !sku.trim(),
      category: !categoryId,
      cost: cost === null,
      sale: sale === null,
      variations: variations.length === 0,
    };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      toastError("Verifique os campos destacados antes de salvar.");
      return;
    }

    setSaving(true);
    const finalImageUrl = removedPhoto ? "" : imageUrl;
    const payload = {
      name: name.trim(),
      sku: sku.trim(),
      description: description.trim(),
      category_id: Number(categoryId),
      cost_price_cents: cost!,
      sale_price_cents: sale!,
      image_url: finalImageUrl,
      active,
      variations,
    };
    try {
      if (isEdit && removedPhoto) {
        await api.del(`/api/products/${id}/image`);
      }
      let productId = Number(id);
      if (isEdit) {
        await api.put(`/api/products/${id}`, payload);
        success("Produto atualizado com sucesso!");
      } else {
        const created = await api.post<{ id: number }>("/api/products", payload);
        productId = created.id;
        success("Produto cadastrado com sucesso!");
      }
      if (pendingFile) {
        await api.uploadImage<{ image_url: string }>(`/api/products/${productId}/image`, pendingFile);
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
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
        subtitle={isEdit ? "Atualize as informações e as variações" : "Cadastre um novo produto com cores e tamanhos"}
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
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Vestido Elegance" invalid={errors.name} />
            </Field>
            <Field label="Código / SKU" required hint="Código único para identificar o produto">
              <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ex.: NY-0008" invalid={errors.sku} />
            </Field>
            <Field label="Categoria" required>
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} invalid={errors.category}>
                <option value="">Selecione...</option>
                {categories.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Preço de custo (R$)" required>
                <Input inputMode="decimal" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="0,00" invalid={errors.cost} />
              </Field>
              <Field label="Preço de venda (R$)" required>
                <Input inputMode="decimal" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="0,00" invalid={errors.sale} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Descrição">
                <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição curta do produto..." />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <div>
                <span className="mb-1.5 block text-sm font-medium text-zinc-700">Foto do produto</span>
                <div className="flex flex-wrap items-center gap-3">
                  {previewUrl || imageUrl ? (
                    <div className="relative">
                      <img src={previewUrl || imageUrl} alt="Prévia" className="h-20 w-20 rounded-xl object-cover" />
                      <button
                        type="button"
                        onClick={() => {
                          removePhoto();
                          if (fileRef.current) fileRef.current.value = "";
                          if (cameraRef.current) cameraRef.current.value = "";
                        }}
                        className="absolute -top-1.5 -right-1.5 rounded-full bg-zinc-800 p-0.5 text-white"
                        aria-label="Remover foto"
                        title="Remover foto"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 text-zinc-400 hover:border-rose-400 hover:text-rose-500"
                      aria-label="Enviar foto"
                      title="Enviar foto"
                    >
                      <ImagePlus size={22} />
                    </button>
                  )}
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => cameraRef.current?.click()}
                      className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:border-rose-400 hover:text-rose-600"
                    >
                      <Camera size={15} /> Tirar foto
                    </button>
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:border-rose-400 hover:text-rose-600"
                    >
                      <ImagePlus size={15} /> {previewUrl || imageUrl ? "Alterar foto" : "Escolher imagem"}
                    </button>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => onImageFile(e.target.files?.[0] ?? null)}
                  />
                  <input
                    ref={cameraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => onImageFile(e.target.files?.[0] ?? null)}
                  />
                  <Input
                    value={urlDraft}
                    onChange={(e) => {
                      if (pendingFile) {
                        if (previewUrl) URL.revokeObjectURL(previewUrl);
                        setPendingFile(null);
                        setPreviewUrl("");
                      }
                      setUrlDraft(e.target.value);
                      if (e.target.value.trim()) setImageUrl(e.target.value.trim());
                    }}
                    placeholder="ou cole a URL da imagem"
                    className="min-w-40 flex-1"
                  />
                </div>
                <span className="mt-1 block text-xs text-zinc-400">
                  No celular, o botão "Tirar foto" abre a câmera; no computador, escolha um arquivo ou cole a URL da imagem (máx. 5 MB).
                </span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Toggle checked={active} onChange={setActive} />
            <span className="text-sm text-zinc-600">Produto ativo (aparece nas vendas)</span>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 font-display text-lg font-semibold text-zinc-900">Variações do produto</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Cada combinação de <strong>cor + tamanho</strong> possui seu próprio estoque.
          </p>
          <VariationsEditor colors={colors} sizes={sizes} variations={variations} onChange={setVariations} />
          {errors.variations && <p className="mt-2 text-sm text-rose-600">Adicione pelo menos uma variação (cor + tamanho).</p>}
          {variations.length === 0 && colors.length === 0 && (
            <div className="mt-3">
              <EmptyState title="Cadastre cores e tamanhos primeiro" description="Acesse o menu Produtos → Cores e Tamanhos para criar as opções." />
            </div>
          )}
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