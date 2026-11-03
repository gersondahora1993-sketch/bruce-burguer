import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Printer, ArrowLeft, Tags } from "lucide-react";
import { api } from "../api/client";
import { Button, EmptyState, PageLoader } from "../components/ui";
import { money } from "../lib/format";
import { code128Svg } from "../lib/barcode128";
import {
  BARCODE_HEIGHT_PX,
  BARCODE_MODULE_WIDTH,
  BARCODE_WIDTH_MM,
  LABEL_HEIGHT_MM,
  LABEL_PADDING_MM,
  LABEL_WIDTH_MM,
  parseLabelItems,
} from "../lib/labels";
import type { Product } from "../types";

interface LabelData {
  product: Product;
  code: string;
}

export default function LabelsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<Product[]>("/api/products")
      .then(setProducts)
      .catch((err: any) => setError(err?.message ?? "Não foi possível carregar os produtos."));
  }, []);

  const entries = useMemo(() => parseLabelItems(params.get("items")), [params]);

  const labels = useMemo<LabelData[]>(() => {
    if (!products) return [];
    const out: LabelData[] = [];
    for (const entry of entries) {
      const product = products.find((p) => p.id === entry.productId);
      if (!product) continue;
      const code = String(product.id);
      for (let i = 0; i < entry.quantity; i++) out.push({ product, code });
    }
    return out;
  }, [products, entries]);

  const totalCopies = labels.length;

  if (error) {
    return (
      <div className="mx-auto mt-10 max-w-xl">
        <EmptyState title="Erro ao carregar etiquetas" description={error} />
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => navigate("/products")}>
            <ArrowLeft size={16} /> Voltar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <style>{`
        @media print {
          @page { size: ${LABEL_WIDTH_MM}mm ${LABEL_HEIGHT_MM}mm; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; }
          .labels-toolbar { display: none !important; }
          .labels-print { gap: 0 !important; margin: 0 !important; padding: 0 !important; }
          .label-card {
            width: ${LABEL_WIDTH_MM}mm !important;
            height: ${LABEL_HEIGHT_MM}mm !important;
            margin: 0 !important;
            padding: ${LABEL_PADDING_MM}mm !important;
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .label-card:last-child { page-break-after: auto; break-after: auto; }
        }
        .label-barcode svg { display: block; width: ${BARCODE_WIDTH_MM}mm; height: auto; margin: 0 auto; }
      `}</style>

      <div className="labels-toolbar mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-zinc-900">Etiquetas de código de barras</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {products === null
              ? "Carregando produtos..."
              : totalCopies === 0
                ? "Nenhuma etiqueta selecionada."
                : `${totalCopies} ${totalCopies === 1 ? "etiqueta" : "etiquetas"} prontas para imprimir.`}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Etiqueta {LABEL_WIDTH_MM}×{LABEL_HEIGHT_MM} mm — configure a impressora (Tomate MDK-2074A) com papel de
            40×40 mm e margens em "none" antes de imprimir.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate("/products")}>
            <ArrowLeft size={16} /> Voltar
          </Button>
          <Button onClick={() => window.print()} disabled={totalCopies === 0}>
            <Printer size={16} /> Imprimir etiquetas
          </Button>
        </div>
      </div>

      {products === null ? (
        <PageLoader />
      ) : totalCopies === 0 ? (
        <EmptyState
          title="Nenhuma etiqueta para imprimir"
          description="Selecione produtos na tela Produtos e use a impressão individual ou em lote."
          action={
            <Button variant="secondary" onClick={() => navigate("/products")}>
              <Tags size={16} /> Ir para Produtos
            </Button>
          }
        />
      ) : (
        <div className="labels-print flex flex-wrap gap-2">
          {labels.map((l, i) => (
            <div key={i} className="label-card flex w-[40mm] flex-col bg-white p-[1.2mm] text-zinc-900">
              <p className="line-clamp-2 text-center font-sans text-[8px] font-semibold leading-[1.15]">
                {l.product.name}
              </p>
              <p className="mt-[1px] text-center font-display text-[13px] font-bold leading-[1.1]">
                {money(l.product.sale_price_cents)}
              </p>
              <div
                className="label-barcode flex min-h-0 flex-1 items-center justify-center"
                dangerouslySetInnerHTML={{
                  __html: code128Svg(l.code, {
                    moduleWidth: BARCODE_MODULE_WIDTH,
                    height: BARCODE_HEIGHT_PX,
                  }),
                }}
              />
              <p className="mt-[1px] line-clamp-1 text-center font-mono text-[7.5px] leading-[1.2] tracking-widest">
                {l.code}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}