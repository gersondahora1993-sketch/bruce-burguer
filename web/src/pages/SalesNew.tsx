import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Minus, Trash2, ShoppingCart, ShoppingBag, CheckCircle2, AlertCircle, Shirt, ReceiptText, Barcode } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, SearchInput } from "../components/ui";
import { digitsOnly, maskInputCpf, maskInputPhone, money, parseMoney, centsToInput } from "../lib/format";
import { buildOrderMessage, sendOrderWhatsApp } from "../lib/whatsapp";
import { paymentHint, paymentTotals } from "../lib/payments";
import type { AppSettings, Color, Customer, FiscalDocument, PaymentMethod, Product } from "../types";
import { FISCAL_DOC_STATUS_LABELS, PAYMENT_OPTIONS } from "../types";

interface CartLine {
  key: string;
  variationId: number;
  productName: string;
  colorName: string;
  sizeName: string;
  unitCents: number;
  quantity: number;
  available: number;
}

interface SaleResult {
  saleId: number;
  total_cents: number;
  amount_received_cents?: number;
  change_cents?: number;
  receivable_id?: number | null;
  due_date?: string;
  items: { name: string; color: string; size: string; quantity: number; unit: number; line: number }[];
  fiscal_document?: FiscalDocument | null;
  fiscal_message?: string;
  fiscal_configured?: boolean;
}

function ProductCard({
  product,
  colors,
  onAdd,
}: {
  product: Product;
  colors: Color[];
  onAdd: (variationId: number, colorName: string, sizeName: string, unitCents: number, available: number) => void;
}) {
  const [colorId, setColorId] = useState<number | null>(null);
  const [sizeId, setSizeId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);

  const variations = useMemo(() => product.variations.filter((v) => v.stock > 0), [product]);
  const availableSizes = useMemo(
    () => (colorId ? variations.filter((v) => v.color_id === colorId) : []),
    [variations, colorId]
  );
  const selected = useMemo(
    () => (colorId && sizeId ? variations.find((v) => v.color_id === colorId && v.size_id === sizeId) : undefined),
    [variations, colorId, sizeId]
  );

  useEffect(() => {
    setColorId(null);
    setSizeId(null);
    setQuantity(1);
  }, [product.id]);

  function resetSelection() {
    setColorId(null);
    setSizeId(null);
    setQuantity(1);
  }

  const canAdd = !!selected && quantity >= 1 && quantity <= selected.stock;

  return (
    <Card className="flex flex-col overflow-hidden">
      {product.image_url ? (
        <img src={product.image_url} alt={product.name} className="h-32 w-full object-cover" />
      ) : (
        <div className="flex h-32 w-full items-center justify-center bg-gradient-to-br from-rose-100 to-rose-200 text-rose-300">
          <Shirt size={40} />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div>
          <p className="truncate text-sm font-semibold text-zinc-900">{product.name}</p>
          <p className="text-xs text-zinc-400">{product.category_name}</p>
        </div>
        <p className="font-bold text-rose-600">{money(product.sale_price_cents)}</p>

        {/* Cores */}
        <div className="flex flex-wrap gap-1.5">
          {colors.filter((c) => variations.some((v) => v.color_id === c.id)).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setColorId(c.id);
                setSizeId(null);
              }}
              title={c.name}
              className={`h-7 w-7 rounded-full border-2 transition ${colorId === c.id ? "border-rose-600 ring-2 ring-rose-200" : "border-zinc-300"}`}
              style={{ backgroundColor: c.hex }}
              aria-label={`Cor ${c.name}`}
            />
          ))}
        </div>

        {availableSizes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {availableSizes.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setSizeId(v.size_id);
                  setQuantity(1);
                }}
                className={`rounded-md border px-2 py-1 text-xs font-medium transition ${
                  sizeId === v.size_id ? "border-rose-600 bg-rose-600 text-white" : "border-zinc-300 text-zinc-600 hover:border-rose-400"
                }`}
              >
                {v.size_name}
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-2 py-1.5">
            <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="rounded-md p-1 text-zinc-600 hover:bg-zinc-200" aria-label="Diminuir quantidade">
              <Minus size={15} />
            </button>
            <span className="text-sm font-semibold text-zinc-900">{quantity}</span>
            <button type="button" onClick={() => setQuantity((q) => Math.min(selected.stock, q + 1))} className="rounded-md p-1 text-zinc-600 hover:bg-zinc-200" aria-label="Aumentar quantidade">
              <Plus size={15} />
            </button>
            <span className="text-xs text-zinc-400">disp.: {selected.stock}</span>
          </div>
        )}

        <Button
          size="sm"
          disabled={!canAdd}
          onClick={() => {
            if (!selected) return;
            onAdd(selected.id, selected.color_name, selected.size_name, product.sale_price_cents, selected.stock);
            resetSelection();
          }}
          className="mt-auto w-full"
        >
          <Plus size={15} /> {selected ? "Adicionar" : "Escolha cor e tamanho"}
        </Button>
      </div>
    </Card>
  );
}

export default function SalesNew() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [products, setProducts] = useState<Product[] | null>(null);
  const [colors, setColors] = useState<Color[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [search, setSearch] = useState("");
  const [scanInput, setScanInput] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("pix");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickForm, setQuickForm] = useState({ name: "", phone: "", whatsapp: "", cpf: "" });
  const [quickSaving, setQuickSaving] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [emitFiscal, setEmitFiscal] = useState(false);

  const isFiado = payment === "fiado";
  const isDinheiro = payment === "dinheiro";
  const hasCustomer = !!customerId || customerName.trim().length > 0;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [result, setResult] = useState<SaleResult | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [p, c, cust] = await Promise.all([
          api.get<Product[]>("/api/products"),
          api.get<Color[]>("/api/colors"),
          api.get<Customer[]>("/api/customers"),
        ]);
        setProducts(p.filter((x) => x.active));
        setColors(c.filter((x) => x.active));
        setCustomers(cust);
        api.get<AppSettings>("/api/settings").then(setSettings).catch(() => null);
      } catch (err: any) {
        toastError(err?.message ?? "Não foi possível carregar os dados.");
      }
    };
    load();
  }, [toastError]);

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    const term = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        !term ||
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        p.variations.some((v) => String(v.barcode ?? "").toLowerCase().includes(term))
    );
  }, [products, search]);

  const total = useMemo(() => cart.reduce((a, l) => a + l.unitCents * l.quantity, 0), [cart]);
  const totals = useMemo(() => paymentTotals(payment, total), [payment, total]);

  const cashReceivedCents = isDinheiro && cashReceived.trim() ? parseMoney(cashReceived) : null;
  const cashValid = !isDinheiro || cashReceivedCents === null || (cashReceivedCents ?? 0) >= totals.finalCents;
  const canFinalize = cart.length > 0 && (!isFiado || hasCustomer) && cashValid;

  function addToCart(variationId: number, colorName: string, sizeName: string, unitCents: number, available: number, productName: string) {
    setCart((prev) => {
      const key = `${variationId}`;
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) =>
          l.key === key ? { ...l, quantity: Math.min(l.available, l.quantity + 1) } : l
        );
      }
      return [...prev, { key, variationId, productName, colorName, sizeName, unitCents, quantity: 1, available }];
    });
    success("Item adicionado ao carrinho!");
  }

  function handleScan() {
    const term = scanInput.trim();
    setScanInput("");
    if (!term) return;
    const digits = term.replace(/\D/g, "");
    const candidate = products
      ?.flatMap((p) => p.variations.map((v) => ({ product: p, v })))
      .find(
        ({ product, v }) =>
          product.active &&
          !!v.barcode &&
          (String(v.barcode).trim() === term || (digits !== "" && String(v.barcode).replace(/\D/g, "") === digits))
      );
    if (!candidate) {
      toastError("Produto não encontrado. Verifique o código lido.");
      scanRef.current?.focus();
      return;
    }
    if (candidate.v.stock <= 0) {
      toastError("Produto sem estoque no momento.");
      scanRef.current?.focus();
      return;
    }
    addToCart(
      candidate.v.id,
      candidate.v.color_name,
      candidate.v.size_name,
      candidate.product.sale_price_cents,
      candidate.v.stock,
      candidate.product.name
    );
    scanRef.current?.focus();
  }

  const filteredCustomers = useMemo(() => {
    const active = customers.filter((c) => c.status !== "inativo");
    const term = customerSearch.trim().toLowerCase();
    const termDigits = customerSearch.replace(/\D/g, "");
    if (!term) return active.slice(0, 6);
    return active.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (termDigits !== "" && (c.phone || "").replace(/\D/g, "").includes(termDigits))
    );
  }, [customers, customerSearch]);

  function openQuick() {
    setQuickForm((f) => ({ ...f, name: customerName.trim() }));
    setQuickOpen(true);
  }

  async function saveQuick(e: FormEvent) {
    e.preventDefault();
    if (!quickForm.name.trim()) {
      toastError("Informe o nome do cliente.");
      return;
    }
    setQuickSaving(true);
    try {
      const payload = {
        ...quickForm,
        cpf: quickForm.cpf.replace(/\D/g, ""),
        phone: quickForm.phone.replace(/\D/g, ""),
        whatsapp: quickForm.whatsapp.replace(/\D/g, ""),
      };
      const created = await api.post<{ id: number }>("/api/customers", payload);
      const fresh = await api.get<Customer[]>("/api/customers");
      setCustomers(fresh);
      setCustomerId(created.id);
      setCustomerName(quickForm.name.trim());
      setCustomerSearch(quickForm.name.trim());
      setCustomerOpen(false);
      setQuickOpen(false);
      success("Cliente cadastrado e selecionado!");
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível cadastrar o cliente.");
    } finally {
      setQuickSaving(false);
    }
  }

  async function finalize() {
    const items = cart.map((l) => ({ variation_id: l.variationId, quantity: l.quantity }));
    const receivedCents = isDinheiro && cashReceived.trim() ? parseMoney(cashReceived) : null;
    setFinalizing(true);
    try {
      const res = await api.post<SaleResult>("/api/sales", {
        customer_id: customerId,
        customer_name: customerName.trim() || undefined,
        payment_method: payment,
        due_date: isFiado ? dueDate || undefined : undefined,
        amount_received_cents: receivedCents ?? undefined,
        items,
      });
      setResult(res);
      setConfirmOpen(false);
      success(isFiado ? "Venda fiada registrada em Contas a receber!" : "Venda finalizada com sucesso!");

      if (emitFiscal) {
        try {
          const fiscal = await api.post<{ document: FiscalDocument; configured: boolean; message: string }>(
            `/api/sales/${res.saleId}/fiscal/emit`,
            { type: "nfce" }
          );
          setResult((prev) =>
            prev
              ? { ...prev, fiscal_document: fiscal.document, fiscal_configured: fiscal.configured, fiscal_message: fiscal.message }
              : prev
          );
        } catch (err: any) {
          setResult((prev) =>
            prev
              ? {
                  ...prev,
                  fiscal_configured: false,
                  fiscal_message: err?.message ?? "Não foi possível emitir o documento fiscal.",
                }
              : prev
          );
        }
      }
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível finalizar a venda.");
    } finally {
      setFinalizing(false);
    }
  }

  function sendWhatsApp() {
    if (!settings?.whatsapp_digits_only) {
      toastError("Cadastre o número de WhatsApp nas Configurações para enviar pedidos.");
      return;
    }
    const message = buildOrderMessage({
      customerName: customerName.trim() || (customerId ? customers.find((c) => c.id === customerId)?.name ?? "" : ""),
      paymentLabel: PAYMENT_OPTIONS.find((p) => p.value === payment)?.label ?? payment,
      totalCents: result?.total_cents ?? 0,
      items:
        result?.items.map((it) => ({
          name: it.name,
          color: it.color,
          size: it.size,
          quantity: it.quantity,
          unit_cents: it.unit,
          line_cents: it.line,
        })) ?? [],
    });
    sendOrderWhatsApp(settings.whatsapp_digits_only, message);
  }

  if (result) {
    return (
      <div className="mx-auto max-w-lg">
        <Card className="p-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 size={34} />
          </div>
          <h2 className="font-display text-2xl font-bold text-zinc-900">Venda finalizada!</h2>
          <p className="mt-1 text-sm text-zinc-500">Venda #{String(result.saleId).padStart(4, "0")} · O estoque foi baixado automaticamente.</p>

          {result.receivable_id ? (
            <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-violet-50 px-3 py-2.5 text-sm font-medium text-violet-700">
              <AlertCircle size={16} />
              Venda fiada lançada em Contas a receber{result.due_date ? ` · vence em ${result.due_date.split("-").reverse().join("/")}` : ""}.
            </div>
          ) : null}

          {result.fiscal_message ? (
            <div
              className={`mt-3 rounded-xl px-3 py-2.5 text-left text-xs leading-relaxed ${
                result.fiscal_configured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
              }`}
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                <AlertCircle size={14} /> Documento fiscal
              </p>
              <p className="mt-1">{result.fiscal_message}</p>
              {result.fiscal_document && (
                <p className="mt-1 text-xs">
                  Status: {FISCAL_DOC_STATUS_LABELS[result.fiscal_document.status] ?? result.fiscal_document.status}
                  {result.fiscal_document.access_key ? ` · Chave: ${result.fiscal_document.access_key}` : ""}
                </p>
              )}
            </div>
          ) : null}

          <div className="mt-5 rounded-xl bg-zinc-50 p-4 text-left">
            <p className="mb-2 text-sm font-semibold text-zinc-700">Itens</p>
            <div className="space-y-1.5">
              {result.items.map((it, i) => (
                <div key={i} className="flex justify-between text-sm text-zinc-600">
                  <span>
                    {it.name} ({it.color}/{it.size}) <span className="text-zinc-400">x{it.quantity}</span>
                  </span>
                  <span className="font-medium">{money(it.line)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between border-t border-zinc-200 pt-3">
              <span className="font-semibold text-zinc-900">Total</span>
              <span className="font-bold text-rose-600">{money(result.total_cents)}</span>
            </div>
          </div>

          {settings?.whatsapp_digits_only ? (
            <Button variant="whatsapp" size="lg" onClick={sendWhatsApp} className="mt-5 w-full">
              <ShoppingBag size={18} /> Enviar pedido pelo WhatsApp
            </Button>
          ) : (
            <p className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertCircle size={14} /> Cadastre o número de WhatsApp em Configurações para enviar o pedido.
            </p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Nova venda
            </Button>
            <Button variant="secondary" onClick={() => navigate(result.receivable_id ? "/receivables" : "/sales")}>
              {result.receivable_id ? "Ver contas a receber" : "Ver histórico"}
            </Button>
          </div>

          <Button size="lg" onClick={() => navigate(`/sales/${result.saleId}/comprovante`)} className="mt-2 w-full">
            <ReceiptText size={18} /> Ver comprovante
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Nova venda" subtitle="Monte o carrinho e finalize a venda" />

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        {/* Produtos */}
        <div>
          <div className="mb-4 space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
              <Barcode size={22} className="shrink-0 text-rose-600" />
              <div className="flex-1">
                <Field label="Ler código de barras (leitor)">
                  <Input
                    ref={scanRef}
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleScan();
                      }
                    }}
                    placeholder="Aponte o leitor aqui e leia a etiqueta do produto..."
                    autoFocus
                  />
                </Field>
              </div>
            </div>
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar produto pelo nome, SKU ou código de barras..." />
          </div>
          {!products ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="h-64 animate-pulse bg-zinc-100" />
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <EmptyState title="Nenhum produto encontrado" description="Cadastre produtos ativos com estoque para vender." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {filteredProducts.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  colors={colors}
                  onAdd={(variationId, colorName, sizeName, unitCents, available) =>
                    addToCart(variationId, colorName, sizeName, unitCents, available, p.name)
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* Carrinho */}
        <div className="lg:sticky lg:top-6 lg:h-fit">
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2 border-b border-zinc-100 pb-3">
              <ShoppingCart size={18} className="text-rose-600" />
              <h2 className="font-semibold text-zinc-900">Carrinho</h2>
              <Badge tone="rose">{cart.length}</Badge>
            </div>

            {cart.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-400">
                Nenhum item ainda.
                <br />
                Selecione produto, cor e tamanho.
              </p>
            ) : (
              <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
                {cart.map((l) => (
                  <div key={l.key} className="flex items-center gap-2 rounded-xl border border-zinc-100 bg-zinc-50 p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900">{l.productName}</p>
                      <p className="text-xs text-zinc-500">
                        {l.colorName} · {l.sizeName}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {money(l.unitCents)} × {l.quantity} = <strong className="text-zinc-700">{money(l.unitCents * l.quantity)}</strong>
                      </p>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() =>
                            setCart((prev) =>
                              prev.map((x) => (x.key === l.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))
                            )
                          }
                          className="rounded-md bg-white p-1 text-zinc-600 shadow-sm hover:text-rose-600"
                          aria-label="Diminuir"
                        >
                          <Minus size={13} />
                        </button>
                        <span className="w-6 text-center text-sm font-semibold">{l.quantity}</span>
                        <button
                          onClick={() =>
                            setCart((prev) =>
                              prev.map((x) => (x.key === l.key ? { ...x, quantity: Math.min(x.available, x.quantity + 1) } : x))
                            )
                          }
                          className="rounded-md bg-white p-1 text-zinc-600 shadow-sm hover:text-rose-600"
                          aria-label="Aumentar"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      <button
                        onClick={() => setCart((prev) => prev.filter((x) => x.key !== l.key))}
                        className="text-xs text-zinc-400 hover:text-rose-600"
                      >
                        remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Cliente */}
            <div className="mt-4">
              <Field label="Cliente">
                <div className="relative">
                  <Input
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setCustomerOpen(true);
                      setCustomerId(null);
                    }}
                    onFocus={() => setCustomerOpen(true)}
                    onBlur={() => window.setTimeout(() => setCustomerOpen(false), 200)}
                    placeholder="Buscar cliente ou nova venda sem cliente..."
                  />
                  {customerOpen && filteredCustomers.length > 0 && (
                    <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg">
                      {filteredCustomers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={() => {
                            setCustomerId(c.id);
                            setCustomerName(c.name);
                            setCustomerSearch(c.name);
                            setCustomerOpen(false);
                          }}
                          className="block w-full px-3.5 py-2.5 text-left text-sm hover:bg-rose-50"
                        >
                          <span className="font-medium text-zinc-800">{c.name}</span>
                          {c.city && <span className="text-xs text-zinc-400"> · {c.city}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
              <button
                type="button"
                onClick={openQuick}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-700"
              >
                <Plus size={13} /> Cadastrar novo cliente
              </button>
              {customerId === null && (
                <Input
                  className="mt-2"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Ou digite o nome do cliente (opcional)"
                />
              )}
            </div>

            {/* Pagamento */}
            <div className="mt-4">
              <p className="mb-1.5 text-sm font-medium text-zinc-700">Forma de pagamento</p>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPayment(p.value)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      payment === p.value
                        ? p.value === "fiado"
                          ? "border-violet-600 bg-violet-600 text-white shadow-sm"
                          : "border-rose-600 bg-rose-600 text-white shadow-sm"
                        : "border-zinc-300 bg-white text-zinc-600"
                    }`}
                  >
                    {p.label}
                    <span className="mt-0.5 block text-[11px] font-normal opacity-80">{paymentHint(p.value, total)}</span>
                  </button>
                ))}
              </div>

              {isFiado && (
                <div className="mt-2.5 space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
                  <p className="text-xs font-medium text-violet-700">
                    Valor à vista: {money(totals.subtotalCents)} · Acréscimo fiado: {money(totals.surchargeCents)}
                    {totals.roundingCents > 0 ? ` · Arredondamento: ${money(totals.roundingCents)}` : ""} · Valor final: {money(totals.finalCents)}
                  </p>
                  <Field label="Data de vencimento">
                    <Input type="date" value={dueDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDueDate(e.target.value)} />
                  </Field>
                  {!hasCustomer && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-violet-700">
                      <AlertCircle size={13} /> Venda fiada exige um cliente — selecione ou digite o nome acima.
                    </p>
                  )}
                </div>
              )}

              {isDinheiro && (
                <div className="mt-2.5 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <Field label="Valor recebido em dinheiro" hint="Se deixado em branco, assume o valor final da venda (troco R$ 0,00).">
                    <Input
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      placeholder={centsToInput(totals.finalCents)}
                      inputMode="decimal"
                    />
                  </Field>
                  {cashReceived.trim() && (parseMoney(cashReceived) ?? 0) > 0 && (parseMoney(cashReceived) ?? 0) < totals.finalCents && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                      <AlertCircle size={13} /> O valor recebido não pode ser menor que o valor final da venda.
                    </p>
                  )}
                  {(cashReceived.trim() && (parseMoney(cashReceived) ?? 0) > totals.finalCents) ? (
                    <p className="text-xs font-medium text-emerald-700">
                      Troco: {money((parseMoney(cashReceived) ?? totals.finalCents) - totals.finalCents)}
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            {/* Documento fiscal */}
            <div className="mt-4">
              <p className="mb-1.5 text-sm font-medium text-zinc-700">Documento fiscal</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEmitFiscal(false)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                    !emitFiscal ? "border-zinc-900 bg-zinc-900 text-white shadow-sm" : "border-zinc-300 bg-white text-zinc-600"
                  }`}
                >
                  Não emitir
                </button>
                <button
                  type="button"
                  onClick={() => setEmitFiscal(true)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                    emitFiscal ? "border-rose-600 bg-rose-600 text-white shadow-sm" : "border-zinc-300 bg-white text-zinc-600"
                  }`}
                >
                  Emitir NFC-e
                </button>
              </div>
              {emitFiscal ? (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  Emissão fiscal ainda não configurada: o documento ficará registrado como pendente, mas NENHUM documento será autorizado
                  junto à SEFAZ até que um provedor homologado seja conectado.
                </p>
              ) : null}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3">
              <span className="text-sm text-zinc-500">
                {totals.surchargeCents > 0 ? (
                  <>
                    Valor à vista: {money(totals.subtotalCents)}
                    <span className="block text-xs text-zinc-400">Acréscimo: {money(totals.surchargeCents)}</span>
                    {totals.roundingCents > 0 && (
                      <span className="block text-xs text-zinc-400">Arredondamento: {money(totals.roundingCents)}</span>
                    )}
                  </>
                ) : (
                  "Total"
                )}
              </span>
              <span className="text-2xl font-bold text-rose-600">{money(totals.finalCents)}</span>
            </div>

            <Button size="lg" className="mt-3 w-full" disabled={!canFinalize} onClick={() => setConfirmOpen(true)}>
              <ShoppingBag size={18} /> Finalizar venda
            </Button>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Finalizar venda"
        message={`Confirma a venda de ${cart.length} item(ns) no valor final de ${money(totals.finalCents)} com pagamento em ${
          PAYMENT_OPTIONS.find((p) => p.value === payment)?.label ?? payment
        }${totals.surchargeCents > 0 ? ` (acréscimo de ${money(totals.surchargeCents)})` : ""}${isFiado ? (dueDate ? ` (vence em ${dueDate.split("-").reverse().join("/")})` : "") : ""}? O estoque será baixado automaticamente.`}
        confirmLabel="Finalizar venda"
        loading={finalizing}
        onConfirm={finalize}
        onClose={() => setConfirmOpen(false)}
      />

      <Modal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Cadastrar novo cliente"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setQuickOpen(false)}>Cancelar</Button>
            <Button onClick={saveQuick as any} loading={quickSaving}>Cadastrar e selecionar</Button>
          </>
        }
      >
        <form onSubmit={saveQuick} className="space-y-3">
          <Field label="Nome" required>
            <Input value={quickForm.name} onChange={(e) => setQuickForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nome completo" />
          </Field>
          <Field label="Telefone">
            <Input value={quickForm.phone} onChange={(e) => setQuickForm((f) => ({ ...f, phone: maskInputPhone(e.target.value) }))} placeholder="(00) 00000-0000" />
          </Field>
          <Field label="WhatsApp" hint="Somente números, com DDI se precisar">
            <Input value={quickForm.whatsapp} onChange={(e) => setQuickForm((f) => ({ ...f, whatsapp: digitsOnly(e.target.value).slice(0, 13) }))} placeholder="5511999990000" />
          </Field>
          <Field label="CPF/CNPJ">
            <Input value={quickForm.cpf} onChange={(e) => setQuickForm((f) => ({ ...f, cpf: maskInputCpf(e.target.value) }))} placeholder="000.000.000-00" />
          </Field>
        </form>
      </Modal>
    </div>
  );
}