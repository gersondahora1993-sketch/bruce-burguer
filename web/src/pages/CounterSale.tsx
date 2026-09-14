import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, CheckCircle, Minus, Package, Plus, ShoppingCart, ShoppingBag } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, SearchInput } from "../components/ui";
import { centsToInput, money, parseMoney } from "../lib/format";

interface CatalogAddon {
  id: number;
  name: string;
  price_cents: number;
  active: number;
}

interface CatalogProduct {
  id: number;
  name: string;
  description: string;
  category_id: number;
  category_name: string;
  sale_price_cents: number;
  image_url: string;
  active: number;
  addons: CatalogAddon[];
}

interface CatalogCategory {
  id: number;
  name: string;
  active: number;
}

interface CatalogCombo {
  id: number;
  name: string;
  description: string;
  sale_price_cents: number;
  active: number;
  items: { product_id: number; product_name: string; quantity: number; product_price_cents: number }[];
}

interface CartAddon {
  addon_id: number;
  name: string;
  price_cents: number;
  quantity: number;
}

interface CartItem {
  key: string;
  kind: "product" | "combo";
  product_id?: number;
  combo_id?: number;
  name: string;
  unitCents: number;
  addons: CartAddon[];
  quantity: number;
}

type LocalPayment = "dinheiro" | "pix" | "cartao_debito" | "cartao_credito" | "fiado";

const PAYMENT_METHODS: { value: LocalPayment; label: string }[] = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "PIX" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "fiado", label: "Fiado" },
];

function addonKeyPart(addons: CartAddon[]): string {
  return addons
    .filter((a) => a.quantity > 0)
    .sort((a, b) => a.addon_id - b.addon_id)
    .map((a) => `${a.addon_id}:${a.quantity}`)
    .join(",");
}

function cartItemKey(kind: "product" | "combo", id: number, addons: CartAddon[]): string {
  return kind === "combo" ? `c-${id}` : `p-${id}-${addonKeyPart(addons)}`;
}

function lineTotal(item: CartItem): number {
  const addonUnit = item.addons.reduce((s, a) => s + a.price_cents * a.quantity, 0);
  return (item.unitCents + addonUnit) * item.quantity;
}

function parseDiscountInput(raw: string): { cents: number } | { error: string } {
  if (!raw.trim()) return { cents: 0 };
  const c = parseMoney(raw);
  if (c === null || c < 0) return { error: "Desconto inválido." };
  return { cents: c };
}

export default function CounterSale() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [combos, setCombos] = useState<CatalogCombo[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [tab, setTab] = useState<"products" | "combos">("products");

  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountRaw, setDiscountRaw] = useState("");
  const [payment, setPayment] = useState<LocalPayment>("dinheiro");
  const [cashReceived, setCashReceived] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [addonModal, setAddonModal] = useState<{ product: CatalogProduct; quantity: number; addons: CartAddon[] } | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmFinalizeOpen, setConfirmFinalizeOpen] = useState(false);
  const [result, setResult] = useState<{ order_id: number; total_cents: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [p, c, cats] = await Promise.all([
          api.get<CatalogProduct[]>("/api/products?active=1"),
          api.get<CatalogCombo[]>("/api/combos?active=1"),
          api.get<CatalogCategory[]>("/api/categories?active=1"),
        ]);
        setProducts(p);
        setCombos(c);
        setCategories(cats.filter((x) => x.active));
      } catch (err: any) {
        toastError(err?.message ?? "Erro ao carregar catálogo.");
      } finally {
        setLoading(false);
      }
    })();
  }, [toastError]);

  const term = search.trim().toLowerCase();

  const filteredProducts = useMemo(
    () =>
      products.filter(
        (p) =>
          (!term || p.name.toLowerCase().includes(term) || p.description.toLowerCase().includes(term)) &&
          (activeCategory === null || p.category_id === activeCategory)
      ),
    [products, term, activeCategory]
  );

  const filteredCombos = useMemo(
    () => combos.filter((c) => !term || c.name.toLowerCase().includes(term) || (c.description || "").toLowerCase().includes(term)),
    [combos, term]
  );

  const subtotal = useMemo(() => cart.reduce((s, i) => s + lineTotal(i), 0), [cart]);

  const parsedDiscount = useMemo(() => parseDiscountInput(discountRaw), [discountRaw]);
  const discountCents = "error" in parsedDiscount ? 0 : parsedDiscount.cents;
  const discountError =
    "error" in parsedDiscount ? parsedDiscount.error : discountCents > subtotal ? "O desconto não pode ser maior que o subtotal." : null;
  const validDiscount = !discountError;
  const total = Math.max(0, subtotal - discountCents);

  const isDinheiro = payment === "dinheiro";
  const receivedCents = isDinheiro ? parseMoney(cashReceived) : null;
  const cashValid = !isDinheiro || (receivedCents !== null && receivedCents >= total);
  const change = isDinheiro && receivedCents !== null ? Math.max(0, receivedCents - total) : 0;

  const customerValid = customerName.trim().length > 0 && customerPhone.trim().length > 0;
  const canFinalize = cart.length > 0 && total > 0 && validDiscount && cashValid && customerValid && !finalizing && !result;

  function openAddProduct(product: CatalogProduct) {
    const baseAddons: CartAddon[] = (product.addons || []).filter((a) => a.active).map((a) => ({
      addon_id: a.id,
      name: a.name,
      price_cents: a.price_cents,
      quantity: 0,
    }));
    setAddonModal({ product, quantity: 1, addons: baseAddons });
  }

  function addProductFromModal() {
    if (!addonModal) return;
    const { product, quantity, addons } = addonModal;
    const selected = addons.filter((a) => a.quantity > 0);
    const key = cartItemKey("product", product.id, selected);
    setCart((prev) => {
      const exists = prev.find((i) => i.key === key);
      if (exists) return prev.map((i) => (i.key === key ? { ...i, quantity: i.quantity + quantity } : i));
      return [
        ...prev,
        { key, kind: "product", product_id: product.id, name: product.name, unitCents: product.sale_price_cents, addons: selected, quantity },
      ];
    });
    setAddonModal(null);
    success("Item adicionado!");
  }

  function addCombo(combo: CatalogCombo) {
    const key = cartItemKey("combo", combo.id, []);
    setCart((prev) => {
      const exists = prev.find((i) => i.key === key);
      if (exists) return prev.map((i) => (i.key === key ? { ...i, quantity: i.quantity + 1 } : i));
      return [...prev, { key, kind: "combo", combo_id: combo.id, name: combo.name, unitCents: combo.sale_price_cents, addons: [], quantity: 1 }];
    });
    success("Combo adicionado!");
  }

  function updateQty(key: string, delta: number) {
    setCart((prev) => prev.map((i) => (i.key === key ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i)));
  }

  function removeItem(key: string) {
    setCart((prev) => prev.filter((i) => i.key !== key));
  }

  function clearCart() {
    setCart([]);
    setClearConfirmOpen(false);
    success("Carrinho limpo!");
  }

  async function doFinalize() {
    setConfirmFinalizeOpen(false);
    setFinalizing(true);
    try {
      const res = await api.post<{ order_id: number; total_cents: number }>("/api/orders/presencial", {
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        payment_method: payment,
        discount_cents: discountCents || 0,
        delivery_type: "retirada",
        items: cart.map((i) => {
          if (i.kind === "product") {
            return {
              product_id: i.product_id,
              quantity: i.quantity,
              addons: i.addons.filter((a) => a.quantity > 0).map((a) => ({ addon_id: a.addon_id, quantity: a.quantity })),
            };
          }
          return { combo_id: i.combo_id, quantity: i.quantity };
        }),
      });
      setResult({ order_id: res.order_id, total_cents: res.total_cents });
      setCart([]);
      setDiscountRaw("");
      setCashReceived("");
      setCustomerName("");
      setCustomerPhone("");
      setPayment("dinheiro");
      success("Venda realizada com sucesso!");
    } catch (err: any) {
      const status = err?.status ?? 0;
      let msg: string;
      if (status === 401) msg = "Não autorizado. Faça login novamente.";
      else if (status === 403) msg = "Você não tem permissão para realizar vendas.";
      else if (status === 404) msg = "Pedido/produto/combo não encontrado.";
      else if (status >= 500) msg = "Não foi possível concluir a venda. Tente novamente.";
      else msg = err?.message || "Não foi possível concluir a venda.";
      toastError(msg);
    } finally {
      setFinalizing(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-lg">
        <Card className="p-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle size={34} />
          </div>
          <h2 className="font-display text-2xl font-bold text-zinc-900">Venda realizada!</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Pedido #{String(result.order_id).padStart(4, "0")} · Total {money(result.total_cents)}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button onClick={() => setResult(null)}>
              <ShoppingBag size={16} /> Nova venda
            </Button>
            <Button variant="secondary" onClick={() => navigate("/orders")}>
              <Package size={16} /> Ver pedidos
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Venda presencial" subtitle="Monte o pedido e finalize no balcão" />

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => setTab("products")}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                tab === "products" ? "bg-rose-600 text-white shadow-sm shadow-rose-600/30" : "border border-zinc-300 bg-white text-zinc-600"
              }`}
            >
              Produtos
            </button>
            <button
              type="button"
              onClick={() => setTab("combos")}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                tab === "combos" ? "bg-rose-600 text-white shadow-sm shadow-rose-600/30" : "border border-zinc-300 bg-white text-zinc-600"
              }`}
            >
              Combos
            </button>
          </div>

          <div className="mb-4 space-y-3">
            <SearchInput value={search} onChange={setSearch} placeholder={tab === "products" ? "Buscar produto..." : "Buscar combo..."} />
            {tab === "products" && categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveCategory(null)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    activeCategory === null ? "border-rose-600 bg-rose-600 text-white" : "border-zinc-300 bg-white text-zinc-600"
                  }`}
                >
                  Todos
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveCategory(activeCategory === c.id ? null : c.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      activeCategory === c.id ? "border-rose-600 bg-rose-600 text-white" : "border-zinc-300 bg-white text-zinc-600"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="h-56 animate-pulse bg-zinc-100" />
              ))}
            </div>
          ) : tab === "products" ? (
            filteredProducts.length === 0 ? (
              <EmptyState title="Nenhum produto encontrado" description="Cadastre produtos ativos para vender." />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {filteredProducts.map((p) => (
                  <Card key={p.id} className="flex flex-col overflow-hidden">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="h-32 w-full object-cover" />
                    ) : (
                      <div className="flex h-32 w-full items-center justify-center bg-gradient-to-br from-rose-100 to-rose-200 text-rose-300">
                        <ShoppingCart size={40} />
                      </div>
                    )}
                    <div className="flex flex-1 flex-col gap-2 p-3.5">
                      <div>
                        <p className="truncate text-sm font-semibold text-zinc-900">{p.name}</p>
                        <p className="text-xs text-zinc-400">{p.category_name}</p>
                        {p.description && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{p.description}</p>}
                      </div>
                      <p className="font-bold text-rose-600">{money(p.sale_price_cents)}</p>
                      <Button size="sm" className="mt-auto w-full" onClick={() => openAddProduct(p)}>
                        <Plus size={15} /> {p.addons?.length ? "Montar" : "Adicionar"}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )
          ) : filteredCombos.length === 0 ? (
            <EmptyState title="Nenhum combo encontrado" description="Cadastre combos para oferecer." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {filteredCombos.map((c) => (
                <Card key={c.id} className="flex flex-col gap-2 p-4">
                  <div>
                    <p className="font-semibold text-zinc-900">{c.name}</p>
                    {c.description && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{c.description}</p>}
                  </div>
                  {c.items && c.items.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-zinc-600">
                      {c.items.map((it, i) => (
                        <li key={i}>&bull; {it.product_name} x{it.quantity}</li>
                      ))}
                    </ul>
                  )}
                  <p className="font-bold text-rose-600">{money(c.sale_price_cents)}</p>
                  <Button size="sm" className="mt-auto" onClick={() => addCombo(c)}>
                    <Plus size={15} /> Adicionar
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-6 lg:h-fit">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <ShoppingCart size={18} className="text-rose-600" />
                <h2 className="font-semibold text-zinc-900">Carrinho</h2>
              </div>
              {cart.length > 0 && (
                <button type="button" onClick={() => setClearConfirmOpen(true)} className="text-xs font-medium text-zinc-400 hover:text-rose-600">
                  Limpar
                </button>
              )}
            </div>

            {cart.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-400">
                Nenhum item ainda.
                <br />
                Selecione um produto ou combo.
              </p>
            ) : (
              <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
                {cart.map((item) => (
                  <div key={item.key} className="flex items-center gap-2 rounded-xl border border-zinc-100 bg-zinc-50 p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900">{item.name}</p>
                      {item.addons.length > 0 && (
                        <p className="text-xs text-zinc-400">
                          {item.addons
                            .filter((a) => a.quantity > 0)
                            .map((a) => `${a.name}${a.quantity > 1 ? ` x${a.quantity}` : ""}`)
                            .join(", ")}
                        </p>
                      )}
                      <p className="text-xs text-zinc-400">
                        {money(item.unitCents)} x {item.quantity} ={" "}
                        <strong className="text-zinc-700">{money(lineTotal(item))}</strong>
                      </p>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => updateQty(item.key, -1)}
                          className="rounded-md bg-white p-1 text-zinc-600 shadow-sm hover:text-rose-600"
                          aria-label="Diminuir"
                        >
                          <Minus size={13} />
                        </button>
                        <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateQty(item.key, 1)}
                          className="rounded-md bg-white p-1 text-zinc-600 shadow-sm hover:text-rose-600"
                          aria-label="Aumentar"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      <button type="button" onClick={() => removeItem(item.key)} className="text-xs text-zinc-400 hover:text-rose-600">
                        remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {cart.length > 0 && (
              <>
                <div className="mt-3 space-y-1.5">
                  <Field label="Desconto (R$)" hint="Opcional">
                    <Input
                      inputMode="decimal"
                      placeholder="0,00"
                      value={discountRaw}
                      onChange={(e) => setDiscountRaw(e.target.value)}
                      invalid={!!discountError && discountRaw !== ""}
                    />
                  </Field>
                  {discountRaw.trim() !== "" && discountError && (
                    <p className="text-xs font-medium text-rose-600">{discountError}</p>
                  )}
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Field label="Nome do cliente" hint="Obrigatório" required>
                    <Input placeholder="Ex.: João da Silva" value={customerName} onChange={(e) => setCustomerName(e.target.value)} invalid={!customerValid && (customerName.length > 0 || customerPhone.length > 0)} />
                  </Field>
                  <Field label="Telefone" hint="Obrigatório" required>
                    <Input placeholder="(00) 00000-0000" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} invalid={!customerValid && (customerName.length > 0 || customerPhone.length > 0)} />
                  </Field>
                </div>

                <div className="mt-4">
                  <p className="mb-1.5 text-sm font-medium text-zinc-700">Pagamento</p>
                  <div className="grid grid-cols-2 gap-2">
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setPayment(m.value)}
                        className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                          payment === m.value
                            ? m.value === "fiado"
                              ? "border-violet-600 bg-violet-600 text-white shadow-sm"
                              : "border-rose-600 bg-rose-600 text-white shadow-sm"
                            : "border-zinc-300 bg-white text-zinc-600"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {isDinheiro && (
                    <div className="mt-2.5 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                      <Field label="Valor recebido" hint={total > 0 ? `Mínimo: ${money(total)}` : undefined}>
                        <Input
                          inputMode="decimal"
                          placeholder={centsToInput(total)}
                          value={cashReceived}
                          onChange={(e) => setCashReceived(e.target.value)}
                        />
                      </Field>
                      {receivedCents !== null && receivedCents < total && (
                        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                          <AlertCircle size={13} /> Valor recebido menor que o total.
                        </p>
                      )}
                      {receivedCents !== null && receivedCents >= total && change > 0 && (
                        <p className="text-xs font-semibold text-emerald-700">Troco: {money(change)}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-col gap-1 border-t border-zinc-100 pt-3">
                  {discountCents > 0 && (
                    <>
                      <div className="flex justify-between text-sm text-zinc-500">
                        <span>Subtotal</span>
                        <span>{money(subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-emerald-600">
                        <span>Desconto</span>
                        <span>-{money(discountCents)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between">
                    <span className="text-sm font-semibold text-zinc-900">Total</span>
                    <span className="text-2xl font-bold text-rose-600">{money(total)}</span>
                  </div>
                  {isDinheiro && receivedCents !== null && receivedCents >= total && (
                    <>
                      <div className="flex justify-between text-sm text-zinc-500">
                        <span>Recebido</span>
                        <span className="font-medium text-zinc-700">{money(receivedCents)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-emerald-700">Troco</span>
                        <span className="font-bold text-emerald-700">{money(change)}</span>
                      </div>
                    </>
                  )}
                </div>

                <Button size="lg" className="mt-3 w-full" disabled={!canFinalize} onClick={() => setConfirmFinalizeOpen(true)}>
                  <ShoppingBag size={18} /> Finalizar venda
                </Button>
              </>
            )}
          </Card>
        </div>
      </div>

      <Modal open={!!addonModal} onClose={() => setAddonModal(null)} title={addonModal?.product.name ?? ""} size="sm">
        {addonModal && (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-sm font-medium text-zinc-700">Quantidade</p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setAddonModal((m) => (m ? { ...m, quantity: Math.max(1, m.quantity - 1) } : m))}
                  className="rounded-md bg-zinc-100 p-2 text-zinc-600 hover:bg-zinc-200"
                  aria-label="Diminuir"
                >
                  <Minus size={16} />
                </button>
                <span className="w-8 text-center text-lg font-semibold">{addonModal.quantity}</span>
                <button
                  type="button"
                  onClick={() => setAddonModal((m) => (m ? { ...m, quantity: m.quantity + 1 } : m))}
                  className="rounded-md bg-zinc-100 p-2 text-zinc-600 hover:bg-zinc-200"
                  aria-label="Aumentar"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            {addonModal.addons.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-zinc-700">Adicionais</p>
                <div className="space-y-2">
                  {addonModal.addons.map((a, i) => (
                    <div key={a.addon_id} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-900">{a.name}</p>
                        <p className="text-xs text-zinc-400">{money(a.price_cents)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setAddonModal((m) =>
                              m ? { ...m, addons: m.addons.map((x, j) => (j === i ? { ...x, quantity: Math.max(0, x.quantity - 1) } : x)) } : m
                            )
                          }
                          className="rounded-md bg-white p-1 text-zinc-600 shadow-sm"
                          aria-label="Diminuir"
                        >
                          <Minus size={13} />
                        </button>
                        <span className="w-5 text-center text-sm font-semibold">{a.quantity}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setAddonModal((m) =>
                              m ? { ...m, addons: m.addons.map((x, j) => (j === i ? { ...x, quantity: x.quantity + 1 } : x)) } : m
                            )
                          }
                          className="rounded-md bg-white p-1 text-zinc-600 shadow-sm"
                          aria-label="Aumentar"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl bg-zinc-50 p-3 text-sm text-zinc-600">
              Prévia:{" "}
              <strong className="text-zinc-900">
                {money(
                  (addonModal.product.sale_price_cents + addonModal.addons.reduce((s, a) => s + a.price_cents * a.quantity, 0)) *
                    addonModal.quantity
                )}
              </strong>
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-100 pt-3">
              <Button variant="secondary" onClick={() => setAddonModal(null)}>
                Cancelar
              </Button>
              <Button onClick={addProductFromModal}>Adicionar ao carrinho</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={clearConfirmOpen}
        title="Limpar carrinho"
        message="Remover todos os itens do carrinho?"
        confirmLabel="Limpar"
        onConfirm={clearCart}
        onClose={() => setClearConfirmOpen(false)}
      />

      <ConfirmDialog
        open={confirmFinalizeOpen}
        title="Finalizar venda"
        message={`Confirma venda de ${cart.length} item(ns) no valor de ${money(total)} com pagamento em ${
          PAYMENT_METHODS.find((m) => m.value === payment)?.label ?? payment
        }${isDinheiro && receivedCents !== null && receivedCents > total ? ` (troco: ${money(change)})` : ""}?`}
        confirmLabel="Finalizar venda"
        loading={finalizing}
        onConfirm={doFinalize}
        onClose={() => setConfirmFinalizeOpen(false)}
      />
    </>
  );
}
