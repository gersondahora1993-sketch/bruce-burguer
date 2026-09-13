import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Minus, Plus, ShoppingBag, Trash2, User, Phone, MapPin, StickyNote, Home } from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { Button, Card, EmptyState, Field, Input, Textarea } from "../../components/ui";
import { money } from "../../lib/format";
import type { PaymentMethod } from "../../types";
import { PAYMENT_OPTIONS } from "../../types";
import { useStoreCart } from "./StoreCartContext";
import type { StoreCartItem } from "./StoreCartContext";

const CHECKOUT_PAYMENTS = PAYMENT_OPTIONS.filter((p) => p.value !== "fiado");

interface OrderResult {
  order_id: number;
  total_cents: number;
  status: string;
  created_at: string;
}

interface SuccessItem {
  name: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
  addons: { name: string; quantity: number }[];
}

function itemUnitCents(item: StoreCartItem): number {
  return item.addons.reduce((sum, a) => sum + a.price_cents * a.quantity, 0) + item.unitCents;
}

function itemLineCents(item: StoreCartItem): number {
  return itemUnitCents(item) * item.quantity;
}

export default function StoreCart() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const { items, totalCents, setQuantity, remove, clear } = useStoreCart();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [complement, setComplement] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("pix");
  const [sending, setSending] = useState(false);

  const valid = name.trim().length > 0 && phone.trim().length > 0 && items.length > 0;

  async function submit() {
    if (!valid) {
      toastError("Informe seu nome e telefone para finalizar o pedido.");
      return;
    }
    setSending(true);
    try {
      const payload = items.map((i) =>
        i.productId != null
          ? {
              product_id: i.productId,
              quantity: i.quantity,
              addons: i.addons.map((a) => ({ addon_id: a.id, quantity: a.quantity })),
            }
          : { combo_id: i.comboId, quantity: i.quantity }
      );
      const res = await api.post<OrderResult>("/api/orders", {
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        street: street.trim(),
        neighborhood: neighborhood.trim(),
        complement: complement.trim(),
        reference: reference.trim(),
        notes: notes.trim(),
        payment_method: payment,
        items: payload,
      });
      const address = [street.trim(), neighborhood.trim(), complement.trim(), reference.trim()]
        .filter(Boolean)
        .join(", ");
      const successItems: SuccessItem[] = items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unit_cents: itemUnitCents(i),
        line_cents: itemLineCents(i),
        addons: i.addons.map((a) => ({ name: a.name, quantity: a.quantity })),
      }));
      clear();
      navigate("/loja/sucesso", {
        state: {
          orderId: res.order_id,
          totalCents: res.total_cents,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          address,
          notes: notes.trim(),
          paymentLabel: PAYMENT_OPTIONS.find((p) => p.value === payment)?.label ?? payment,
          items: successItems,
        },
      });
      success("Pedido registrado!");
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível registrar o pedido.");
    } finally {
      setSending(false);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Seu carrinho está vazio"
        description="Adicione produtos do catálogo para começar."
        action={
          <Link to="/loja">
            <Button>Ver produtos</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <Link to="/loja" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
        <ArrowLeft size={15} /> Continuar comprando
      </Link>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        {/* Itens */}
        <div className="space-y-3">
          {items.map((i) => (
            <Card key={i.key} className="flex items-center gap-3 p-3.5">
              {i.image ? (
                <img src={i.image} alt={i.name} className="h-16 w-16 shrink-0 rounded-xl object-cover" />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-500">
                  <ShoppingBag size={22} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-zinc-900">{i.name}</p>
                {i.addons.length > 0 && (
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {i.addons.map((a) => `${a.name}${a.quantity > 1 ? ` ×${a.quantity}` : ""}`).join(", ")}
                  </p>
                )}
                <p className="mt-0.5 text-sm font-semibold text-amber-600">{money(itemLineCents(i))}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-1">
                  <button onClick={() => setQuantity(i.key, i.quantity - 1)} className="rounded-md bg-zinc-100 p-1.5 text-zinc-600" aria-label="Diminuir">
                    <Minus size={13} />
                  </button>
                  <span className="w-7 text-center text-sm font-semibold">{i.quantity}</span>
                  <button onClick={() => setQuantity(i.key, i.quantity + 1)} className="rounded-md bg-zinc-100 p-1.5 text-zinc-600" aria-label="Aumentar">
                    <Plus size={13} />
                  </button>
                </div>
                <button onClick={() => remove(i.key)} className="text-xs text-zinc-400 hover:text-rose-600" aria-label="Remover item">
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>

        {/* Checkout */}
        <div className="lg:sticky lg:top-24 lg:h-fit">
          <Card className="space-y-4 p-4">
            <h2 className="border-b border-zinc-100 pb-2.5 font-semibold text-zinc-900">Finalizar pedido</h2>

            <Field label="Seu nome" required>
              <div className="relative">
                <User size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
                <Input className="pl-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" />
              </div>
            </Field>
            <Field label="Seu telefone" required hint="Para combinarmos a entrega/retirada">
              <div className="relative">
                <Phone size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
                <Input className="pl-9" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
              </div>
            </Field>
            <Field label="Endereço de entrega">
              <div className="relative">
                <Home size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
                <Input className="pl-9" value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Rua, número, bairro, cidade" />
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Bairro">
                <Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Bairro" />
              </Field>
              <Field label="Complemento">
                <Input value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Ex.: casa 12" />
              </Field>
            </div>
            <Field label="Ponto de referência">
              <div className="relative">
                <MapPin size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
                <Input className="pl-9" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Referência para encontrar o endereço" />
              </div>
            </Field>
            <Field label="Observação" hint="Opcional">
              <div className="relative">
                <StickyNote size={15} className="absolute top-3 left-3 text-zinc-400" />
                <Textarea className="pl-9" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </Field>

            <div>
              <p className="mb-1.5 text-sm font-medium text-zinc-700">Forma de pagamento</p>
              <div className="grid grid-cols-2 gap-2">
                {CHECKOUT_PAYMENTS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPayment(p.value)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      payment === p.value ? "border-amber-600 bg-amber-600 text-white shadow-sm" : "border-zinc-300 bg-white text-zinc-600"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-zinc-100 pt-3">
              <span className="text-sm text-zinc-500">Total</span>
              <span className="text-2xl font-bold text-amber-600">{money(totalCents)}</span>
            </div>

            <Button size="lg" className="w-full" disabled={!valid || sending} loading={sending} onClick={submit}>
              <ShoppingBag size={18} /> Finalizar pedido
            </Button>
            <p className="text-center text-[11px] text-zinc-400">
              Após o pedido você pode confirmar direto pelo WhatsApp.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}