import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Minus, Plus, Shirt, ShoppingBag } from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Skeleton } from "../../components/ui";
import { money } from "../../lib/format";
import type { StoreProduct, StoreVariation } from "../../types";
import { useStoreCart } from "./StoreCartContext";

export default function StoreProductPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const { add } = useStoreCart();

  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [colorId, setColorId] = useState<number | null>(null);
  const [variation, setVariation] = useState<StoreVariation | null>(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    api
      .get<StoreProduct>(`/api/catalog/products/${id}`)
      .then(setProduct)
      .catch(() => setNotFound(true));
  }, [id]);

  const colors = useMemo(() => {
    if (!product) return [];
    const map = new Map<number, { id: number; name: string; hex: string }>();
    for (const v of product.variations) {
      if (!map.has(v.color_id)) map.set(v.color_id, { id: v.color_id, name: v.color_name, hex: v.color_hex });
    }
    return Array.from(map.values());
  }, [product]);

  const sizes = useMemo(() => {
    if (!product) return [];
    return product.variations.filter((v) => v.color_id === colorId);
  }, [product, colorId]);

  function addToCart() {
    if (!product || !variation) return;
    add({
      variationId: variation.id,
      productId: product.id,
      name: product.name,
      colorName: variation.color_name,
      sizeName: variation.size_name,
      unitCents: product.sale_price_cents,
      maxStock: variation.stock,
      image: product.image_url,
    });
    success("Adicionado ao carrinho!");
  }

  if (notFound) {
    return (
      <div className="py-20 text-center">
        <p className="font-semibold text-zinc-900">Produto não encontrado</p>
        <p className="mt-1 text-sm text-zinc-500">O produto pode ter saído do catálogo.</p>
        <Link to="/loja" className="mt-4 inline-block text-sm font-medium text-rose-600 hover:underline">
          Voltar para a loja
        </Link>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-80 rounded-2xl" />
        <div className="space-y-3">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  const soldOut = product.variations.every((v) => v.stock === 0);

  return (
    <div>
      <Link to="/loja" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
        <ArrowLeft size={15} /> Voltar para a loja
      </Link>

      <div className="grid gap-6 md:grid-cols-2">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="h-80 w-full rounded-2xl object-cover md:h-96" />
        ) : (
          <div className="flex h-80 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-rose-100 to-rose-200 text-rose-300 md:h-96">
            <Shirt size={64} />
          </div>
        )}

        <div className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2">
            {product.category_name && <Badge tone="rose">{product.category_name}</Badge>}
            {soldOut && <Badge tone="red">Esgotado</Badge>}
          </div>
          <h1 className="mt-2 font-display text-2xl font-bold text-zinc-900">{product.name}</h1>
          <p className="mt-1 text-3xl font-bold text-rose-600">{money(product.sale_price_cents)}</p>
          {product.description && <p className="mt-3 text-sm leading-relaxed text-zinc-600">{product.description}</p>}

          {!soldOut && (
            <div className="mt-5 space-y-4">
              {colors.length > 1 && (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-zinc-700">Cor</p>
                  <div className="flex flex-wrap gap-2">
                    {colors.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setColorId(c.id);
                          setVariation(null);
                          setQuantity(1);
                        }}
                        title={c.name}
                        className={`h-9 w-9 rounded-full border-2 transition ${
                          colorId === c.id ? "border-rose-600 ring-2 ring-rose-200" : "border-zinc-300"
                        }`}
                        style={{ backgroundColor: c.hex }}
                        aria-label={`Cor ${c.name}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {sizes.length > 0 && (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-zinc-700">Tamanho</p>
                  <div className="flex flex-wrap gap-2">
                    {sizes.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setVariation(v);
                          setQuantity(1);
                        }}
                        className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition ${
                          variation?.id === v.id
                            ? "border-rose-600 bg-rose-600 text-white"
                            : v.stock === 0
                              ? "cursor-not-allowed border-zinc-200 text-zinc-300"
                              : "border-zinc-300 text-zinc-700 hover:border-rose-400"
                        }`}
                        disabled={v.stock === 0}
                      >
                        {v.size_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {variation && (
                <div className="flex items-center gap-4 rounded-xl bg-zinc-50 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="rounded-md bg-white p-1.5 text-zinc-600 shadow-sm" aria-label="Diminuir">
                      <Minus size={15} />
                    </button>
                    <span className="w-8 text-center font-semibold text-zinc-900">{quantity}</span>
                    <button onClick={() => setQuantity((q) => Math.min(variation.stock, q + 1))} className="rounded-md bg-white p-1.5 text-zinc-600 shadow-sm" aria-label="Aumentar">
                      <Plus size={15} />
                    </button>
                  </div>
                  <p className="ml-auto text-xs text-zinc-400">{variation.stock} em estoque</p>
                </div>
              )}

              <Button size="lg" className="w-full" disabled={!variation} onClick={addToCart}>
                <ShoppingBag size={18} /> {variation ? "Adicionar ao carrinho" : "Escolha a cor e o tamanho"}
              </Button>
              <Button variant="secondary" size="lg" className="w-full" onClick={() => navigate("/loja/carrinho")}>
                Ver carrinho
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}