import { useEffect, useRef, useState } from "react";
import { FileDown, Printer, Send } from "lucide-react";
import { api, clearToken, getToken } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Button, Modal } from "./ui";
import { money } from "../lib/format";

const API_BASE = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_URL ?? "").replace(/\/+$/, "");

export interface ComprovanteData {
  store: {
    store_name: string;
    store_logo_url: string;
    store_phone: string;
    store_address: string;
    store_city: string;
    store_state: string;
    store_zip: string;
    opening_hours: string;
    whatsapp_number: string;
  };
  receivable: {
    id: number;
    sale_id: number;
    customer_name: string;
    total_cents: number;
    due_date: string;
  };
  payment: {
    id: number;
    amount_cents: number;
    payment_method: string;
    user_name: string | null;
    created_at: string;
  };
  total_received_cents: number;
  remaining_cents: number;
  quitado: boolean;
  method_label: string;
  whatsapp_text: string;
}

export default function ReceiptModal({
  receivableId,
  paymentId,
  onClose,
}: {
  receivableId: number | null;
  paymentId: number | null;
  onClose: () => void;
}) {
  const { error: toastError } = useToast();
  const [data, setData] = useState<ComprovanteData | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.length = 0;
    };
  }, []);

  useEffect(() => {
    if (!receivableId || !paymentId) return;
    api
      .get<ComprovanteData>(`/api/receivables/${receivableId}/comprovante/${paymentId}`)
      .then(setData)
      .catch((err: any) => toastError(err?.message ?? "Não foi possível carregar o comprovante."));
  }, [receivableId, paymentId, toastError]);

  async function fetchPdfBlob(): Promise<Blob> {
    if (!receivableId || !paymentId) throw new Error("Comprovante indisponível.");
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${API_BASE}/api/receivables/${receivableId}/comprovante/${paymentId}/pdf`, {
        headers,
      });
    } catch {
      throw new Error("Não foi possível conectar ao servidor para gerar o PDF.");
    }

    if (response.status === 401) {
      clearToken();
      window.location.href = "/login";
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    if (!response.ok) {
      let message = "Não foi possível gerar o comprovante em PDF.";
      try {
        const payload = await response.json();
        if (typeof payload?.error === "string" && payload.error) message = payload.error;
      } catch {
        /* corpo sem JSON */
      }
      throw new Error(message);
    }
    return response.blob();
  }

  const trackUrl = (url: string) => {
    objectUrls.current.push(url);
  };

  const releaseUrl = (url: string) => {
    const idx = objectUrls.current.indexOf(url);
    if (idx >= 0) objectUrls.current.splice(idx, 1);
    URL.revokeObjectURL(url);
  };

  async function openPdf(print: boolean) {
    if (!receivableId || !paymentId || pdfBusy) return;
    setPdfBusy(true);
    try {
      const blob = await fetchPdfBlob();
      const url = URL.createObjectURL(blob);
      trackUrl(url);
      if (print) {
        const win = window.open(url, "_blank");
        if (!win) {
          releaseUrl(url);
          toastError("O navegador bloqueou a janela de impressão. Permita pop-ups para este site.");
          return;
        }
        win.addEventListener("unload", () => releaseUrl(url));
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `comprovante-${receivableId}-${paymentId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => releaseUrl(url), 1000);
      }
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível gerar o comprovante em PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  function sendWhatsApp() {
    if (!data?.whatsapp_text) return;
    const phone = data.store.whatsapp_number.replace(/\D/g, "");
    const target = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(data.whatsapp_text)}` : `https://wa.me/?text=${encodeURIComponent(data.whatsapp_text)}`;
    window.open(target, "_blank");
  }

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return (
    <Modal
      open={!!receivableId && !!paymentId}
      onClose={onClose}
      title="Comprovante de recebimento"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={() => openPdf(true)} disabled={pdfBusy}>
            <Printer size={15} /> Imprimir
          </Button>
          <Button variant="secondary" onClick={() => openPdf(false)} disabled={pdfBusy}>
            <FileDown size={15} /> Baixar PDF
          </Button>
          <Button variant="whatsapp" onClick={sendWhatsApp} disabled={!data}>
            <Send size={15} /> WhatsApp
          </Button>
        </>
      }
    >
      {!data ? (
        <div className="flex h-40 items-center justify-center text-sm text-zinc-400">Carregando comprovante...</div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="text-center">
            {data.store.store_logo_url ? (
              <img src={data.store.store_logo_url} alt="Logo" className="mx-auto mb-2 h-12 object-contain" />
            ) : null}
            <p className="font-display text-lg font-bold text-zinc-900">{data.store.store_name || "Bruce Burguer"}</p>
            <p className="text-xs tracking-wide text-zinc-500 uppercase">Comprovante de recebimento</p>
          </div>

          <div className="mt-4 space-y-1.5 text-sm text-zinc-700">
            <div className="flex justify-between">
              <span className="text-zinc-500">Cliente</span>
              <span className="font-medium">{data.receivable.customer_name || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Venda</span>
              <span className="font-medium">#{String(data.receivable.sale_id).padStart(4, "0")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Recebimento</span>
              <span className="font-medium">#{String(data.payment.id).padStart(4, "0")}</span>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-zinc-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-500">Valor recebido</span>
              <span className="text-xl font-bold text-emerald-600">{money(data.payment.amount_cents)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-sm">
              <span className="text-zinc-500">Forma de pagamento</span>
              <span className="font-medium text-zinc-800">{data.method_label}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-sm">
              <span className="text-zinc-500">Total da conta</span>
              <span className="font-medium text-zinc-800">{money(data.receivable.total_cents)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-sm">
              <span className="text-zinc-500">Total já recebido</span>
              <span className="font-medium text-zinc-800">{money(data.total_received_cents)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2">
              <span className="text-sm font-medium text-zinc-600">Saldo restante</span>
              <span className={`text-base font-bold ${data.quitado ? "text-emerald-600" : "text-violet-700"}`}>
                {data.quitado ? "QUITADO" : money(data.remaining_cents)}
              </span>
            </div>
          </div>

          <div className="mt-4 space-y-1.5 text-sm text-zinc-600">
            <div className="flex justify-between">
              <span className="text-zinc-500">Data do recebimento</span>
              <span>{formatDateTime(data.payment.created_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Registrado por</span>
              <span>{data.payment.user_name || "-"}</span>
            </div>
            {data.store.store_address || data.store.store_city ? (
              <div className="flex justify-between">
                <span className="text-zinc-500">Endereço</span>
                <span className="text-right">
                  {[data.store.store_address, data.store.store_city, data.store.store_state].filter(Boolean).join(", ")}
                </span>
              </div>
            ) : null}
          </div>

          <p className="mt-5 border-t border-dashed border-zinc-200 pt-3 text-center text-[11px] text-zinc-400">
            Comprovante emitido pelo sistema de gestão da loja. Não possui validade fiscal.
          </p>
        </div>
      )}
    </Modal>
  );
}