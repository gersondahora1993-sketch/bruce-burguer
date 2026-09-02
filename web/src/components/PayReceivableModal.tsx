import { useEffect, useState } from "react";
import { HandCoins } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Button, Field, Input, Modal, Select } from "./ui";
import { money } from "../lib/format";

export interface PayReceivableTarget {
  id: number;
  customer_name: string;
  total_cents: number;
  remaining_cents: number;
}

const RECEIPT_METHODS = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "Pix" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "cartao_credito", label: "Cartão de crédito" },
];

export default function PayReceivableModal({
  target,
  onClose,
  onPaid,
}: {
  target: PayReceivableTarget | null;
  onClose: () => void;
  onPaid: (paymentId: number, amountCents: number) => void;
}) {
  const { success, error: toastError } = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("pix");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (target) {
      setAmount(String(target.remaining_cents));
      setMethod("pix");
    }
  }, [target?.id]);

  const remaining = target?.remaining_cents ?? 0;
  const cents = Math.round(Number(amount.replace(/\D/g, "")) || 0);
  const isFull = cents === remaining;

  async function submit() {
    if (!target) return;
    if (cents <= 0) {
      toastError("Informe o valor recebido.");
      return;
    }
    if (cents > remaining) {
      toastError("O valor informado é maior que o saldo em aberto.");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{ payment_id: number; amount_cents: number }>(`/api/receivables/${target.id}/pay`, {
        amount_cents: cents,
        payment_method: method,
      });
      success(isFull ? "Recebimento registrado — conta quitada!" : "Recebimento parcial registrado!");
      setAmount("");
      setMethod("pix");
      onPaid(res.payment_id, res.amount_cents);
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível registrar o recebimento.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title="Registrar recebimento"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={loading}>
            <HandCoins size={15} /> Receber pagamento
          </Button>
        </>
      }
    >
      {target && (
        <div className="space-y-4">
          <div className="rounded-xl bg-zinc-50 px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Conta original</span>
              <span className="font-semibold text-zinc-800">{money(target.total_cents)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-zinc-500">Saldo em aberto</span>
              <span className="font-bold text-zinc-900">{money(remaining)}</span>
            </div>
          </div>
          <Field label="Valor recebido (R$)" hint={isFull ? "Quita a conta por completo." : cents > 0 ? "Recebimento parcial." : undefined}>
            <Input
              inputMode="numeric"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
          <Field label="Forma de pagamento do recebimento">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {RECEIPT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-xs text-zinc-400">
            O valor recebido entra no caixa como entrada. O estoque não é alterado neste passo.
          </p>
        </div>
      )}
    </Modal>
  );
}