import { Router } from "express";
import { db, now } from "../db.js";
import { buildReceiptPdf, type PdfLine } from "../lib/receiptPdf.js";
import { requireAuth, requireRole } from "../auth.js";
import type { Request, Response } from "express";

const router = Router();

router.use(requireRole("admin"));

export const RECEIPT_METHODS = ["dinheiro", "pix", "cartao_debito", "cartao_credito"];

function todayDate(): string {
  return now().slice(0, 10);
}

function receivedCents(receivableId: number, companyId: number): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS t FROM cash_entries WHERE receivable_id = ? AND company_id = ?")
    .get(receivableId, companyId) as { t: number };
  return Number(row.t) || 0;
}

function loadBusinessSettings(companyId: number): Record<string, string> {
  const row = db
    .prepare(
      `SELECT business_name, slogan, whatsapp, address, city, uf, cep, hours, logo_url
       FROM business_settings WHERE company_id = ?`
    )
    .get(companyId) as {
      business_name: string;
      slogan: string;
      whatsapp: string;
      address: string;
      city: string;
      uf: string;
      cep: string;
      hours: string;
      logo_url: string;
    } | undefined;

  if (!row) {
    return {
      store_name: "Bruce Burguer",
      store_logo_url: "",
      store_phone: "",
      whatsapp_number: "5522981667509",
      store_address: "Loteamento Nova Macuco, em frente à Mercearia do Davi",
      store_city: "São Francisco de Itabapoana",
      store_state: "RJ",
      store_zip: "",
      opening_hours: "Terça a sábado, das 18:30 às 23:00",
    };
  }

  return {
    store_name: row.business_name,
    store_logo_url: row.logo_url || "",
    store_phone: "",
    whatsapp_number: row.whatsapp,
    store_address: row.address,
    store_city: row.city,
    store_state: row.uf,
    store_zip: row.cep,
    opening_hours: row.hours || "Terça a sábado, das 18:30 às 23:00",
  };
}

const RECEIVED_SUBQUERY = `COALESCE((SELECT SUM(ce.amount_cents) FROM cash_entries ce WHERE ce.receivable_id = r.id AND ce.company_id = r.company_id), 0)`;
const REMAINING_SQL = `r.total_cents - ${RECEIVED_SUBQUERY}`;

router.get("/", requireAuth, (req: Request, res: Response) => {
  const { status, search, from, to } = req.query;
  const where: string[] = [];
  const params: (string | number)[] = [];

  const today = todayDate();
  const statusValue = String(status || "all");
  const companyId = (req.user as any).company_id;
  where.push("r.company_id = ?");
  params.push(companyId);

  if (statusValue === "pago") {
    where.push("r.status = 'pago'");
  } else if (statusValue === "vencido") {
    where.push("r.status = 'pendente' AND r.due_date < ?");
    params.push(today);
  } else if (statusValue === "pendente") {
    where.push("r.status = 'pendente' AND r.due_date >= ?");
    params.push(today);
  }
  if (search && String(search).trim()) {
    where.push("r.customer_name LIKE ?");
    params.push(`%${String(search).trim()}%`);
  }
  if (from && String(from)) {
    where.push("r.created_at >= ?");
    params.push(`${String(from)} 00:00:00`);
  }
  if (to && String(to)) {
    where.push("r.created_at <= ?");
    params.push(`${String(to)} 23:59:59`);
  }

  const rows = db
    .prepare(
      `SELECT r.*, ${RECEIVED_SUBQUERY} AS received_cents, s.created_at AS sale_date,
              CASE WHEN r.due_date < ? THEN 1 ELSE 0 END AS overdue,
              CASE WHEN r.status = 'pendente' AND r.due_date < ? THEN CAST(julianday(?) - julianday(r.due_date) AS INTEGER) ELSE 0 END AS days_overdue
       FROM receivables r
        LEFT JOIN sales s ON s.id = r.sale_id AND s.company_id = r.company_id
        WHERE ${where.join(" AND ")}
       ORDER BY r.status = 'pendente' DESC, r.due_date ASC, r.id DESC
       LIMIT 500`
    )
    .all(today, today, today, ...params) as any[];

  const mapped = rows.map((r) => ({
    ...r,
    vencido: r.status === "pendente" && r.overdue === 1,
    received_cents: Number(r.received_cents) || 0,
    remaining_cents: Math.max(0, r.total_cents - (Number(r.received_cents) || 0)),
  }));

  const summary = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN r.status = 'pendente' THEN ${REMAINING_SQL} ELSE 0 END), 0) AS total_pendente,
         COALESCE(SUM(CASE WHEN r.status = 'pendente' AND r.due_date < ? THEN ${REMAINING_SQL} ELSE 0 END), 0) AS total_vencido,
         COALESCE(SUM(CASE WHEN r.status = 'pago' THEN r.total_cents ELSE 0 END), 0)
           + COALESCE(SUM(CASE WHEN r.status = 'pendente' THEN ${RECEIVED_SUBQUERY} ELSE 0 END), 0) AS total_recebido
        FROM receivables r
        WHERE r.company_id = ?`
      )
      .get(today, companyId) as any;

  res.json({
    rows: mapped,
    summary: {
      total_aberto: summary.total_pendente,
      total_vencido: summary.total_vencido,
      total_recebido: summary.total_recebido,
    },
  });
});

router.get("/:id", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const rec = db
    .prepare(
      `SELECT r.*, s.created_at AS sale_date, s.user_id AS sale_user_id
       FROM receivables r LEFT JOIN sales s ON s.id = r.sale_id AND s.company_id = r.company_id
       WHERE r.id = ? AND r.company_id = ?`
    )
    .get(Number(req.params.id), companyId) as any;

  if (!rec) {
    res.status(404).json({ error: "Conta a receber não encontrada." });
    return;
  }

  const items = db
    .prepare(
      `SELECT it.product_name, it.color_name, it.size_name, it.quantity, it.unit_price_cents, it.total_cents
        FROM sale_items it
        JOIN sales s ON s.id = it.sale_id AND s.company_id = ?
        JOIN products p ON p.id = it.product_id AND p.company_id = ?
        WHERE it.sale_id = ?`
    )
    .all(companyId, companyId, rec.sale_id);

  const payments = db
    .prepare(
      `SELECT id, amount_cents, payment_method, user_id, created_at
        FROM cash_entries WHERE receivable_id = ? AND company_id = ?
        ORDER BY id DESC`
    )
    .all(rec.id, companyId) as any[];

  const received = receivedCents(rec.id, companyId);
  res.json({
    ...rec,
    received_cents: received,
    remaining_cents: Math.max(0, rec.total_cents - received),
    items,
    payments,
  });
});

router.post("/:id/pay", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const rec = db.prepare("SELECT * FROM receivables WHERE id = ? AND company_id = ?").get(Number(req.params.id), companyId) as any;

  if (!rec) {
    res.status(404).json({ error: "Conta a receber não encontrada." });
    return;
  }

  const paymentMethod = String(req.body?.payment_method ?? "pix");
  if (!RECEIPT_METHODS.includes(paymentMethod)) {
    res.status(400).json({ error: "Forma de pagamento inválida para recebimento." });
    return;
  }

  let requested: number | null = null;
  if (req.body?.amount_cents !== undefined && req.body?.amount_cents !== null) {
    requested = Math.round(Number(req.body.amount_cents));
    if (!Number.isFinite(requested) || requested <= 0) {
      res.status(400).json({ error: "Informe um valor de recebimento válido." });
      return;
    }
  }

  const tx = db.transaction(() => {
    const openCash = db
      .prepare("SELECT * FROM cash_sessions WHERE status = 'aberto' AND company_id = ? ORDER BY id DESC LIMIT 1")
      .get(companyId) as any;
    if (!openCash) {
      throw new Error("Abra o caixa antes de registrar um recebimento.");
    }

    const received = receivedCents(rec.id, companyId);
    const remaining = rec.total_cents - received;

    if (rec.status === "pago" || remaining <= 0) {
      throw new Error("Esta conta já foi recebida.");
    }

    const amount = requested === null ? remaining : Math.min(requested, remaining);
    if (requested !== null && requested > remaining) {
      throw new Error("O valor recebido é maior que o saldo em aberto.");
    }

    db.prepare(
      `INSERT INTO cash_entries (cash_session_id, type, receivable_id, sale_id, customer_name, reference, amount_cents, payment_method, user_id, company_id, created_at)
       VALUES (?, 'recebimento', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      openCash.id,
      rec.id,
      rec.sale_id,
      rec.customer_name,
      `Recebimento de conta a receber #${String(rec.id).padStart(4, "0")}`,
      amount,
      paymentMethod,
      req.user?.id ?? null,
      companyId,
      now()
    );

    const entryId = Number(
      (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id
    );

    const settled = remaining - amount === 0;
    if (settled) {
      db.prepare("UPDATE receivables SET status = 'pago', paid_at = ? WHERE id = ? AND company_id = ?").run(now(), rec.id, companyId);
    }

    return {
      payment_id: entryId,
      receivable_id: rec.id,
      amount_cents: amount,
      payment_method: paymentMethod,
      remaining_cents: remaining - amount,
      status: settled ? "pago" : "pendente",
      paid_at: settled ? now() : null,
    };
  });

  try {
    const result = tx();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Não foi possível registrar o recebimento." });
  }
});

function loadComprovante(recId: number, paymentId: number, companyId: number): any {
  const rec = db
    .prepare(
      `SELECT r.*, s.created_at AS sale_date, s.total_cents AS sale_total_cents, s.payment_method AS sale_payment_method
        FROM receivables r LEFT JOIN sales s ON s.id = r.sale_id AND s.company_id = r.company_id
       WHERE r.id = ? AND r.company_id = ?`
    )
    .get(recId, companyId) as any;
  if (!rec) return { error: "Conta a receber não encontrada." };

const payment = db
      .prepare(
        `SELECT ce.*, u.name AS user_name
         FROM cash_entries ce LEFT JOIN users u ON u.id = ce.user_id
          WHERE ce.id = ? AND ce.receivable_id = ? AND ce.company_id = ?`
      )
      .get(paymentId, recId, companyId) as any;
    if (!payment) return { error: "Recebimento não encontrado." };

    const totalReceivedRow = db
      .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS t FROM cash_entries WHERE receivable_id = ? AND company_id = ?")
      .get(recId, companyId) as { t: number };
    const totalReceived = Number(totalReceivedRow?.t) || 0;

  const remaining = rec.total_cents - totalReceived;
  return {
    store: loadBusinessSettings(companyId),
    receivable: rec,
    payment: payment,
    sale_total_cents: rec.sale_total_cents,
    total_received_cents: totalReceived,
    remaining_cents: Math.max(0, remaining),
    quitado: remaining <= 0,
  };
}

function money(cents: number): string {
  return "R$ " + (cents / 100).toFixed(2).replace(".", ",");
}

const METHOD_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_debito: "Cartão de débito",
  cartao_credito: "Cartão de crédito",
};

function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

router.get("/:id/comprovante/:paymentId", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const data = loadComprovante(Number(req.params.id), Number(req.params.paymentId), companyId);
  if (data.error) {
    res.status(404).json({ error: data.error });
    return;
  }

  const wpp = data.store.whatsapp_number;
  const mLabel = methodLabel(data.payment.payment_method);

  res.json({
    ...data,
    method_label: mLabel,
    whatsapp_text:
      `*${data.store.store_name || "Bruce Burguer"}*\n` +
      `Comprovante de recebimento\n\n` +
      `Cliente: ${data.receivable.customer_name || "-"}\n` +
      `Venda: #${String(data.receivable.sale_id).padStart(4, "0")}\n` +
      `Recebido: ${money(data.payment.amount_cents)} (${mLabel})\n` +
      `Total da conta: ${money(data.receivable.total_cents)}\n` +
      (data.remaining_cents > 0 ? `Saldo restante: ${money(data.remaining_cents)}\n` : `Situação: QUITADO\n`) +
      `Data: ${new Date(data.payment.created_at).toLocaleString("pt-BR")}\n` +
      `Usuário: ${data.payment.user_name || "-"}\n` +
      (wpp ? `\nContato: ${wpp}` : ""),
  });
});

router.get("/:id/comprovante/:paymentId/pdf", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const data = loadComprovante(Number(req.params.id), Number(req.params.paymentId), companyId);
  if (data.error) {
    res.status(404).json({ error: data.error });
    return;
  }

  const mLabel = methodLabel(data.payment.payment_method);

  const lines: PdfLine[] = [
    { text: data.store.store_name || "Bruce Burguer", bold: true, size: 16, align: "center" },
    { text: "COMPROVANTE DE RECEBIMENTO", bold: true, size: 13, align: "center", gap: 10 },
    { text: "", gap: 6 },
    { text: `Cliente: ${data.receivable.customer_name || "-"}` },
    { text: `Venda: #${String(data.receivable.sale_id).padStart(4, "0")}` },
    { text: `Conta a receber: #${String(data.receivable.id).padStart(4, "0")}` },
    { text: "", gap: 4 },
    { text: `Valor recebido: ${money(data.payment.amount_cents)}`, bold: true, size: 14 },
    { text: `Forma de pagamento: ${mLabel}` },
    { text: `Total da conta: ${money(data.receivable.total_cents)}` },
    { text: `Total já recebido: ${money(data.total_received_cents)}` },
    { text: `Saldo restante: ${money(data.remaining_cents)} ${data.remaining_cents <= 0 ? "(QUITADO)" : ""}`, bold: data.remaining_cents <= 0 },
    { text: "", gap: 4 },
    { text: `Data do recebimento: ${new Date(data.payment.created_at).toLocaleString("pt-BR")}` },
    { text: `Registrado por: ${data.payment.user_name || "-"}` },
    { text: "", gap: 8 },
    { text: "Este comprovante é emitido pelo sistema de gestão", size: 9 },
    { text: "e não possui validade fiscal.", size: 9 },
  ];

  const pdf = buildReceiptPdf(lines);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="comprovante-recebimento-${data.receivable.id}-${data.payment.id}.pdf"`);
  res.send(pdf);
});

export default router;
