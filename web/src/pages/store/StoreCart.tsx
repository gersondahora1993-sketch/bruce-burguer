import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Minus, Plus, ShoppingBag, Trash2, User, Phone, MapPin, StickyNote } from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { Button, Card, EmptyState, Field, Input, Textarea } from "../../components/ui";
import { money } from "../../lib/format";
import type { PaymentMethod } from "../../types";
import { PAYMENT_OPTIONS } from "../../types";
import { useStoreCart } from "./StoreCartContext";

const CHECKOUT_PAYMENTS = PAYMENT_OPTIONS.filter((p) => p.value !== "fiado");

interface OrderResult {
  order_id: number;
  total_cents: number;
  status: string;
  created_at: string;
}

export default function StoreCart() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const { items, totalCents, setQuantity, remove, clear } = useStoreCart();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
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
      const res = await api.post<OrderResult>("/api/orders", {
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        address: address.trim(),
        notes: notes.trim(),
        payment_method: payment,
        items: items.map((i) => ({ variation_id: i.variationId, quantity: i.quantity })),
      });
      clear();
      navigate("/loja/sucesso", {
        state: {
          orderId: res.order_id,
          totalCents: res.total_cents,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          address: address.trim(),
          notes: notes.trim(),
          paymentLabel: PAYMENT_OPTIONS.find((p) => p.value === payment)?.label ?? payment,
          items: items.map((i) => ({
            name: i.name,
            color: i.colorName,
            size: i.sizeName,
            quantity: i.quantity,
            unit_cents: i.unitCents,
            line_cents: i.unitCents * i.quantity,
          })),
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
            <Card key={i.variationId} className="flex items-center gap-3 p-3.5">
              {i.image ? (
                <img src={i.image} alt={i.name} className="h-16 w-16 shrink-0 rounded-xl object-cover" />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-300">
                  <ShoppingBag size={22} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-zinc-900">{i.name}</p>
                <p className="text-xs text-zinc-500">
                  {i.colorName} · {i.sizeName}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-rose-600">{money(i.unitCents * i.quantity)}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-1">
                  <button onClick={() => setQuantity(i.variationId, i.quantity - 1)} className="rounded-md bg-zinc-100 p-1.5 text-zinc-600" aria-label="Diminuir">
                    <Minus size={13} />
                  </button>
                  <span className="w-7 text-center text-sm font-semibold">{i.quantity}</span>
                  <button onClick={() => setQuantity(i.variationId, i.quantity + 1)} className="rounded-md bg-zinc-100 p-1.5 text-zinc-600" aria-label="Aumentar">
                    <Plus size={13} />
                  </button>
                </div>
                <button onClick={() => remove(i.variationId)} className="text-xs text-zinc-400 hover:text-rose-600" aria-label="Remover item">
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
                <MapPin size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
                <Input className="pl-9" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, bairro, cidade" />
              </div>
            </Field>
            <Field label="Observação" hint="Opcional — ex.: cor da embalagem, horário">
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
                      payment === p.value ? "border-rose-600 bg-rose-600 text-white shadow-sm" : "border-zinc-300 bg-white text-zinc-600"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-zinc-100 pt-3">
              <span className="text-sm text-zinc-500">Total</span>
              <span className="text-2xl font-bold text-rose-600">{money(totalCents)}</span>
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