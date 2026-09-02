import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FileDown, Printer, Share2, ArrowLeft, Ban, MapPin, Phone, Building2 } from "lucide-react";
import { api, clearToken, getToken } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Button, Card, PageHeader, PageLoader } from "../components/ui";
import { money } from "../lib/format";
import type { SaleReceipt } from "../types";

const API_BASE = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_URL ?? "").replace(/\/+$/, "");

export default function SaleReceiptPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { error: toastError } = useToast();
  const [data, setData] = useState<SaleReceipt | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.get<SaleReceipt>(`/api/sales/${id}/comprovante`));
    } catch (err: any) {
      if (err?.status === 404) {
        setNotFound(true);
      } else {
        toastError(err?.message ?? "Não foi possível carregar o comprovante.");
      }
    }
  }, [id, toastError]);

  useEffect(() => {
    load();
  }, [load]);

  async function fetchPdfBlob(): Promise<Blob> {
    if (!id) throw new Error("Comprovante indisponível.");
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/api/sales/${id}/comprovante/pdf`, { headers });
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

  const LOGO_FALLBACK = "/logo/nyellen-fashion.png";

  async function handlePrint() {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>(".sale-receipt .receipt-logo"));
    await Promise.all(
      images.map((img) =>
        Promise.resolve().then(async () => {
          const ensureLoaded = async () => {
            if (img.complete && img.naturalWidth > 0) return;
            try {
              if (typeof img.decode === "function") {
                await img.decode();
                return;
              }
              await new Promise<void>((resolve) => {
                img.addEventListener("load", () => resolve(), { once: true });
                img.addEventListener("error", () => resolve(), { once: true });
              });
            } catch {
              /* tratado abaixo */
            }
          };
          await ensureLoaded();
          if (img.complete && img.naturalWidth === 0 && !img.dataset.fallbackApplied) {
            img.dataset.fallbackApplied = "1";
            img.src = LOGO_FALLBACK;
            await ensureLoaded();
          }
        }),
      ),
    );
    window.print();
  }

  async function downloadPdf(print: boolean) {
    if (!id || pdfBusy) return;
    setPdfBusy(true);
    try {
      const blob = await fetchPdfBlob();
      const url = URL.createObjectURL(blob);
      if (print) {
        const win = window.open(url, "_blank");
        if (!win) {
          URL.revokeObjectURL(url);
          toastError("O navegador bloqueou a janela de impressão. Permita pop-ups para este site.");
          return;
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `comprovante-venda-${id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível gerar o comprovante em PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function shareReceipt() {
    if (!data) return;
    const text = data.whatsapp_text;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: `Comprovante de venda #${String(data.sale.id).padStart(4, "0")}`, text });
        return;
      } catch {
        /* usuário cancelou ou compartilhamento indisponível */
      }
    }
    const phone = (data.store.whatsapp_number ?? "").replace(/\D/g, "");
    const target = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(target, "_blank");
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-md">
        <Card className="p-8 text-center">
          <p className="text-lg font-semibold text-zinc-900">Comprovante não encontrado</p>
          <p className="mt-1 text-sm text-zinc-500">Esta venda não existe, pertence a outra loja ou você não tem permissão para vê-la.</p>
          <Button className="mt-5" onClick={() => navigate("/sales")}>
            <ArrowLeft size={15} /> Voltar ao histórico
          </Button>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <PageHeader title="Comprovante de venda" subtitle="Aguarde enquanto o comprovante é carregado..." />
        <Card className="p-6"><PageLoader /></Card>
      </div>
    );
  }

  const cancelled = data.sale.status === "cancelada";
  const saleNumber = `#${String(data.sale.id).padStart(4, "0")}`;
  const storeAddress = [data.store.store_address, data.store.store_city, data.store.store_state].filter(Boolean).join(", ");

  return (
    <div>
      <PageHeader title="Comprovante de venda" subtitle={cancelled ? "Venda cancelada — documento apenas informativo" : "Venda finalizada — documento apenas informativo"} />

      <div className="receipt-actions mb-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          <ArrowLeft size={15} /> Voltar
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handlePrint} disabled={pdfBusy}>
            <Printer size={15} /> Imprimir
          </Button>
          <Button variant="secondary" onClick={() => downloadPdf(false)} disabled={pdfBusy}>
            <FileDown size={15} /> Baixar PDF
          </Button>
          <Button variant="whatsapp" onClick={shareReceipt}>
            <Share2 size={15} /> Compartilhar
          </Button>
        </div>
      </div>

      <div className="sale-receipt mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="text-center">
          {data.store.store_logo_url ? (
            <img
              src={data.store.store_logo_url}
              alt=""
              className="receipt-logo mx-auto mb-2 h-12 max-w-[160px] object-contain"
              onError={(e) => {
                const img = e.currentTarget;
                if (img.dataset.fallbackApplied) return;
                img.dataset.fallbackApplied = "1";
                img.src = LOGO_FALLBACK;
              }}
            />
          ) : null}
          <p className="font-display text-xl font-bold text-zinc-900">{data.store.store_name || "Nyellen Fashion"}</p>
          {data.store.store_cnpj && (
            <p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-zinc-500">
              <Building2 size={12} /> CNPJ: {data.store.store_cnpj}
            </p>
          )}
          {data.store.store_phone && (
            <p className="flex items-center justify-center gap-1 text-xs text-zinc-500">
              <Phone size={12} /> {data.store.store_phone}
            </p>
          )}
          {storeAddress && (
            <p className="flex items-start justify-center gap-1 text-xs text-zinc-500">
              <MapPin size={12} className="mt-0.5 shrink-0" /> {storeAddress}
            </p>
          )}
        </div>

        <div className="mt-3 border-y border-dashed border-zinc-300 py-2 text-center">
          <p className="text-sm font-bold tracking-wide text-zinc-900 uppercase">Comprovante de venda</p>
          <p className="text-[11px] font-semibold tracking-wide text-rose-600 uppercase">Não é documento fiscal</p>
        </div>

        {cancelled && (
          <div className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white">
            <Ban size={15} /> VENDA CANCELADA
          </div>
        )}

        <div className="mt-4 space-y-1.5 text-sm text-zinc-700">
          <div className="flex justify-between">
            <span className="text-zinc-500">Venda</span>
            <span className="font-semibold">{saleNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Data</span>
            <span>{new Date(data.sale.created_at).toLocaleString("pt-BR")}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Vendedora</span>
            <span className="text-right font-medium">{data.sale.user_name || "-"}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Cliente</span>
            <span className="text-right font-medium">{data.sale.customer_name || "Não informado"}</span>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Itens</p>
          <div className="space-y-2">
            {data.items.map((it, i) => {
              const variant = [it.color_name, it.size_name].filter(Boolean).join("/");
              return (
                <div key={i} className="sale-item-row rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-zinc-800">
                      {it.quantity}x {it.product_name}
                      {variant ? <span className="text-zinc-400"> ({variant})</span> : null}
                    </span>
                    <span className="shrink-0 font-semibold text-zinc-800">{money(it.total_cents)}</span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {money(it.unit_price_cents)} cada
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Valor à vista</span>
            <span className="font-medium text-zinc-800">{money(data.subtotal_cents)}</span>
          </div>
          {data.surcharge_cents > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Acréscimo ({data.payment_label})</span>
              <span className="font-medium text-zinc-800">{money(data.surcharge_cents)}</span>
            </div>
          )}
          {data.rounding_cents > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Arredondamento</span>
              <span className="font-medium text-zinc-800">{money(data.rounding_cents)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-zinc-200 pt-2">
            <span className="text-base font-semibold text-zinc-900">VALOR FINAL</span>
            <span className={`text-xl font-bold ${cancelled ? "text-zinc-400 line-through" : "text-zinc-900"}`}>{money(data.sale.total_cents)}</span>
          </div>
        </div>

        <div className="mt-3 space-y-1.5 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Pagamento</span>
            <span className="font-semibold text-zinc-800">{data.payment_label}</span>
          </div>
          {data.sale.payment_method === "dinheiro" && (
            <>
              <div className="flex justify-between">
                <span className="text-zinc-500">Valor recebido</span>
                <span className="font-medium text-zinc-800">{money(data.sale.amount_received_cents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Troco</span>
                <span className="font-medium text-zinc-800">{money(data.sale.change_cents)}</span>
              </div>
            </>
          )}
          {data.fiado && (
            <>
              <div className="flex justify-between">
                <span className="text-zinc-500">Vencimento</span>
                <span className="font-medium text-zinc-800">{data.fiado.due_date.split("-").reverse().join("/")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Saldo fiado</span>
                <span className={`font-semibold ${data.fiado.quitado ? "text-emerald-600" : "text-violet-700"}`}>
                  {data.fiado.quitado ? "QUITADO" : money(data.fiado.remaining_cents)}
                </span>
              </div>
            </>
          )}
          {cancelled && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Cancelamento</span>
              <span className="text-right font-medium text-rose-600">
                {data.sale.cancelled_at ? new Date(data.sale.cancelled_at).toLocaleString("pt-BR") : ""}
                {data.sale.cancelled_by_name ? ` · ${data.sale.cancelled_by_name}` : ""}
              </span>
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-dashed border-zinc-200 pt-3 text-center">
          <p className="text-sm text-zinc-600">Obrigado pela preferência!</p>
          <p className="mt-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Comprovante de venda — não é documento fiscal</p>
        </div>
      </div>
    </div>
  );
}