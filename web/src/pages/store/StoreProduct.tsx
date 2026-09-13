import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Minus, Plus, ShoppingBag } from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Skeleton } from "../../components/ui";
import { money } from "../../lib/format";
import type { StoreProduct } from "../../types";
import { useStoreCart } from "./StoreCartContext";

export default function StoreProductPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const { add } = useStoreCart();

  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [selectedAddons, setSelectedAddons] = useState<Record<number, number>>({});

  useEffect(() => {
    api
      .get<StoreProduct>(`/api/catalog/products/${id}`)
      .then(setProduct)
      .catch(() => setNotFound(true));
  }, [id]);

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

  const prod = product;
  const addonTotalCents = Object.entries(selectedAddons).reduce((sum, [addonId, addonQty]) => {
    const addon = prod.addons.find((a) => String(a.id) === addonId);
    return sum + (addon ? addon.price_cents * addonQty : 0);
  }, 0);

  const toggleAddon = (addonId: number) => {
    setSelectedAddons((prev) => {
      const next = { ...prev };
      if (next[addonId]) {
        delete next[addonId];
      } else {
        next[addonId] = 1;
      }
      return next;
    });
  };

  const setAddonQty = (addonId: number, qty: number) => {
    setSelectedAddons((prev) => (qty <= 0 ? { ...prev, [addonId]: 1 } : { ...prev, [addonId]: qty }));
  };

  function addToCart() {
    const addons = prod.addons
      .filter((a) => selectedAddons[a.id])
      .map((a) => ({ id: a.id, name: a.name, price_cents: a.price_cents, quantity: selectedAddons[a.id] }));
    add({
      productId: prod.id,
      comboId: null,
      name: prod.name,
      image: prod.image_url,
      unitCents: prod.sale_price_cents,
      addons,
    });
    success("Adicionado ao carrinho!");
  }

  return (
    <div>
      <Link to="/loja" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
        <ArrowLeft size={15} /> Voltar para a loja
      </Link>

      <div className="grid gap-6 md:grid-cols-2">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="h-80 w-full rounded-2xl object-cover md:h-96" />
        ) : (
          <div className="flex h-80 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-amber-200 text-amber-300 md:h-96">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.105 0 2-.895 2-2S13.532 8 12 8s-2 .895-2 2" />
            </svg>
          </div>
        )}

        <div className="flex flex-col">
          {product.category_name && <Badge tone="amber">{product.category_name}</Badge>}
          <h1 className="mt-2 font-display text-2xl font-bold text-zinc-900">{product.name}</h1>
          <p className="mt-1 text-3xl font-bold text-amber-600">
            {product.sale_price_cents === 0 ? (
              <span className="text-amber-500">Consulte o preço</span>
            ) : (
              money(product.sale_price_cents)
            )}
          </p>
          {product.description && <p className="mt-3 text-sm leading-relaxed text-zinc-600">{product.description}</p>}

          {product.addons.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-sm font-medium text-zinc-700">Adicionais</p>
              <div className="space-y-2">
                {product.addons.map((addon) => {
                  const selected = Boolean(selectedAddons[addon.id]);
                  return (
                    <div
                      key={addon.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                        selected ? "border-amber-500 bg-amber-50" : "border-zinc-200 bg-white"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleAddon(addon.id)}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${
                          selected ? "border-amber-600 bg-amber-600 text-white" : "border-zinc-300 bg-white"
                        }`}
                        aria-pressed={selected}
                      >
                        {selected && (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <span className="flex-1 text-sm font-medium text-zinc-700">{addon.name}</span>
                      <span className="text-sm font-semibold text-zinc-500">+ {money(addon.price_cents)}</span>
                      {selected && (
                        <div className="flex items-center gap-1 rounded-lg bg-white px-1 py-0.5 shadow-sm">
                          <button type="button" onClick={() => setAddonQty(addon.id, selectedAddons[addon.id] - 1)} className="rounded p-1 text-zinc-500" aria-label="Diminuir adicional">
                            <Minus size={13} />
                          </button>
                          <span className="w-5 text-center text-sm font-semibold">{selectedAddons[addon.id]}</span>
                          <button type="button" onClick={() => setAddonQty(addon.id, selectedAddons[addon.id] + 1)} className="rounded p-1 text-zinc-500" aria-label="Aumentar adicional">
                            <Plus size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="rounded-md bg-white p-1.5 text-zinc-600 shadow-sm" aria-label="Diminuir quantidade">
                <Minus size={15} />
              </button>
              <span className="w-8 text-center font-semibold text-zinc-900">{quantity}</span>
              <button onClick={() => setQuantity((q) => q + 1)} className="rounded-md bg-white p-1.5 text-zinc-600 shadow-sm" aria-label="Aumentar quantidade">
                <Plus size={15} />
              </button>
            </div>
            {addonTotalCents > 0 && (
              <p className="text-xs text-zinc-500">
                Adicionais: <strong className="text-zinc-700">+ {money(addonTotalCents)}</strong> / un
              </p>
            )}
          </div>

          {addonTotalCents > 0 && (
            <p className="mt-3 text-right text-sm text-zinc-500">
              Total desta unidade:{" "}
              <strong className="text-zinc-800">
                {money((product.sale_price_cents + addonTotalCents) * quantity)} ({quantity}×)
              </strong>
            </p>
          )}

          <div className="mt-4 space-y-2">
            <Button size="lg" className="w-full" onClick={addToCart}>
              <ShoppingBag size={18} /> Adicionar ao carrinho
            </Button>
            <Button variant="secondary" size="lg" className="w-full" onClick={() => navigate("/loja/carrinho")}>
              Ver carrinho
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}