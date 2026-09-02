import { Router } from "express";
import { db, now } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { getFiscalProvider, type FiscalDocStatus, type FiscalDocType } from "../fiscal/provider.js";
import type { Request, Response } from "express";

const router = Router();

router.use(requireRole("admin"));

const STATUS_LABELS: Record<FiscalDocStatus, string> = {
  nao_configurado: "Emissão não configurada",
  pendente_provedor: "Aguardando provedor fiscal",
  autorizado: "Autorizado",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
};

export function fiscalStatusLabel(status: FiscalDocStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function loadDocument(documentId: number, companyId: number): any {
  return db
    .prepare(
      `SELECT fd.*, s.total_cents AS sale_total_cents, s.payment_method AS sale_payment_method,
              s.customer_name AS sale_customer_name, s.status AS sale_status, s.created_at AS sale_created_at
       FROM fiscal_documents fd
       JOIN sales s ON s.id = fd.sale_id
       WHERE fd.id = ? AND s.company_id = ?`
    )
    .get(documentId, companyId) as any;
}

router.get("/status", (_req: Request, res: Response) => {
  const provider = getFiscalProvider();
  res.json({
    configured: provider.configured,
    provider: provider.name,
    message: provider.configured
      ? `Provedor fiscal conectado: ${provider.name}.`
      : "Emissão fiscal não configurada. Nenhum documento foi ou será emitido como autorizado até que um provedor homologado (SEFAZ/emissor) seja conectado.",
  });
});

router.get("/documents", requireAuth, (req: Request, res: Response) => {
  const { from, to, search } = req.query;
  const where: string[] = [];
  const companyId = (req.user as any).company_id;
  const params: (string | number)[] = [companyId];
  where.push("s.company_id = ?");

  if (from && String(from)) {
    where.push("fd.created_at >= ?");
    params.push(`${String(from)} 00:00:00`);
  }
  if (to && String(to)) {
    where.push("fd.created_at <= ?");
    params.push(`${String(to)} 23:59:59`);
  }
  if (search && String(search).trim()) {
    where.push("(s.customer_name LIKE ? OR CAST(s.id AS TEXT) LIKE ?)");
    const term = `%${String(search).trim()}%`;
    params.push(term, term);
  }

  const rows = db
    .prepare(
      `SELECT fd.*, s.total_cents AS sale_total_cents, s.payment_method AS sale_payment_method,
              s.customer_name AS sale_customer_name, s.status AS sale_status, s.created_at AS sale_created_at
        FROM fiscal_documents fd
        JOIN sales s ON s.id = fd.sale_id
        WHERE ${where.join(" AND ")}
       ORDER BY fd.id DESC
       LIMIT 500`
    )
    .all(...params) as any[];

  res.json(rows);
});

router.get("/documents/:id", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const doc = loadDocument(Number(req.params.id), companyId);

  if (!doc) {
    res.status(404).json({ error: "Documento fiscal não encontrado." });
    return;
  }
  res.json(doc);
});

router.post("/:documentId/consultar", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const doc = loadDocument(Number(req.params.documentId), companyId);
  if (!doc) {
    res.status(404).json({ error: "Documento fiscal não encontrado." });
    return;
  }

  const provider = getFiscalProvider();
  if (!provider.configured) {
    res.status(400).json({
      ok: false,
      message: "Emissão fiscal não configurada. Não é possível consultar este documento em um provedor.",
      status: doc.status,
    });
    return;
  }

  const result = provider.consultarDocumento({ documentId: doc.id, saleId: doc.sale_id });
  res.json(result);
});

router.post("/:documentId/cancel", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const doc = loadDocument(Number(req.params.documentId), companyId);
  if (!doc) {
    res.status(404).json({ error: "Documento fiscal não encontrado." });
    return;
  }

  if (doc.status !== "autorizado") {
    res.status(400).json({
      ok: false,
      message:
        doc.status === "nao_configurado"
          ? "Este documento nunca foi autorizado (emissão não configurada). Nada foi cancelado."
          : "Somente documentos autorizados podem ser cancelados. Nada foi cancelado.",
      status: doc.status,
    });
    return;
  }

  const reason = String(req.body?.reason ?? "").trim() || "Cancelamento manual";
  const provider = getFiscalProvider();
  if (!provider.configured) {
    res.status(400).json({
      ok: false,
      message: "Emissão fiscal não configurada. Não é possível cancelar o documento no provedor.",
      status: doc.status,
    });
    return;
  }

  const result = provider.cancelarDocumento({ documentId: doc.id, saleId: doc.sale_id }, reason);
  if (result.ok && result.status === "cancelado") {
    db.prepare(
      "UPDATE fiscal_documents SET status = 'cancelado', cancellation_reason = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM sales s WHERE s.id = fiscal_documents.sale_id AND s.company_id = ?)"
    ).run(reason, now(), doc.id, companyId);
  }
  res.json(result);
});

router.get("/:documentId/xml", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const doc = loadDocument(Number(req.params.documentId), companyId);
  if (!doc) {
    res.status(404).json({ error: "Documento fiscal não encontrado." });
    return;
  }
  if (doc.status !== "autorizado" || !doc.xml) {
    res.status(400).json({
      ok: false,
      message: "XML fiscal indisponível: Nenhum documento foi autorizado (emissão fiscal não configurada).",
      status: doc.status,
    });
    return;
  }
  const provider = getFiscalProvider();
  if (!provider.configured) {
    res.status(400).json({ ok: false, message: "Emissão fiscal não configurada. XML indisponível.", status: doc.status });
    return;
  }
  res.json(provider.obterXml({ documentId: doc.id, saleId: doc.sale_id }));
});

router.get("/:documentId/danfe", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const doc = loadDocument(Number(req.params.documentId), companyId);
  if (!doc) {
    res.status(404).json({ error: "Documento fiscal não encontrado." });
    return;
  }
  if (doc.status !== "autorizado") {
    res.status(400).json({
      ok: false,
      message: "DANFE indisponível: Nenhum documento foi autorizado (emissão fiscal não configurada).",
      status: doc.status,
    });
    return;
  }
  const provider = getFiscalProvider();
  if (!provider.configured) {
    res.status(400).json({ ok: false, message: "Emissão fiscal não configurada. DANFE indisponível.", status: doc.status });
    return;
  }
  res.json(provider.obterDanfe({ documentId: doc.id, saleId: doc.sale_id }));
});

router.get("/:documentId/qrcode", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const doc = loadDocument(Number(req.params.documentId), companyId);
  if (!doc) {
    res.status(404).json({ error: "Documento fiscal não encontrado." });
    return;
  }
  if (doc.status !== "autorizado") {
    res.status(400).json({
      ok: false,
      message: "QR Code indisponível: Nenhum documento foi autorizado (emissão fiscal não configurada).",
      status: doc.status,
    });
    return;
  }
  const provider = getFiscalProvider();
  if (!provider.configured) {
    res.status(400).json({ ok: false, message: "Emissão fiscal não configurada. QR Code indisponível.", status: doc.status });
    return;
  }
  res.json(provider.obterQrCode({ documentId: doc.id, saleId: doc.sale_id }));
});

export default router;
