import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, MessageCircle, ShoppingBag } from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { Button, Card } from "../../components/ui";
import { money } from "../../lib/format";
import { buildStoreOrderMessage, sendOrderWhatsApp, type WhatsappOrderItem } from "../../lib/whatsapp";
import type { StoreInfo } from "../../types";

interface SuccessState {
  orderId: number;
  totalCents: number;
  customerName: string;
  customerPhone: string;
  address: string;
  notes: string;
  paymentLabel: string;
  items: WhatsappOrderItem[];
}

export default function StoreSuccess() {
  const location = useLocation();
  const navigate = useNavigate();
  const { error: toastError } = useToast();
  const [store, setStore] = useState<StoreInfo | null>(null);
  const state = (location.state ?? {}) as Partial<SuccessState>;

  useEffect(() => {
    api.get<StoreInfo>("/api/catalog/store").then(setStore).catch(() => null);
  }, []);

  if (!state.orderId) {
    return (
      <div className="py-20 text-center">
        <p className="font-semibold text-zinc-900">Pedido não encontrado</p>
        <Link to="/loja" className="mt-3 inline-block text-sm font-medium text-rose-600 hover:underline">
          Voltar para a loja
        </Link>
      </div>
    );
  }

  function sendWhatsApp() {
    const digits = store?.whatsapp_digits_only;
    if (!digits) {
      toastError("A loja ainda não cadastrou o WhatsApp para confirmar pedidos.");
      return;
    }
    const message = buildStoreOrderMessage({
      orderId: state.orderId,
      customerName: state.customerName ?? "",
      customerPhone: state.customerPhone ?? "",
      address: state.address ?? "",
      notes: state.notes ?? "",
      paymentLabel: state.paymentLabel ?? "",
      totalCents: state.totalCents ?? 0,
      items: state.items ?? [],
    });
    sendOrderWhatsApp(digits, message);
  }

  return (
    <div className="mx-auto max-w-lg">
      <Card className="p-6 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 size={34} />
        </div>
        <h2 className="font-display text-2xl font-bold text-zinc-900">Pedido recebido!</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Pedido #{String(state.orderId).padStart(4, "0")} · Total <strong className="text-zinc-800">{money(state.totalCents ?? 0)}</strong>
        </p>
        <p className="mt-2 text-sm text-zinc-500">Vamos analisar o pedido e entraremos em contato para confirmar.</p>

        {store?.whatsapp_digits_only ? (
          <Button variant="whatsapp" size="lg" className="mt-5 w-full" onClick={sendWhatsApp}>
            <MessageCircle size={18} /> Confirmar pedido pelo WhatsApp
          </Button>
        ) : (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Agora é só aguardar nosso contato para confirmar o pedido.
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => navigate("/loja")}>
            <ShoppingBag size={15} /> Continuar comprando
          </Button>
          <Button variant="secondary" onClick={() => navigate("/loja")}>
            Ver mais produtos
          </Button>
        </div>
      </Card>
    </div>
  );
}