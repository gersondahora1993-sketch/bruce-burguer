import { Router } from "express";
import { db, now } from "../db.js";
import { requireAuth } from "../auth.js";
import type { Request, Response } from "express";

const router = Router();

export const CASH_ENTRY_TYPES = [
  "abertura",
  "venda",
  "cancelamento",
  "recebimento",
  "sangria",
  "reforco",
  "despesa",
  "entrada",
  "saida",
] as const;

export type CashEntryType = (typeof CASH_ENTRY_TYPES)[number];

const MANUAL_TYPES: CashEntryType[] = ["sangria", "reforco", "despesa", "entrada", "saida"];

const TYPE_LABELS: Record<string, string> = {
  abertura: "Abertura de caixa",
  venda: "Venda",
  cancelamento: "Cancelamento de venda",
  recebimento: "Recebimento de conta a receber",
  sangria: "Sangria",
  reforco: "Reforço de caixa",
  despesa: "Despesa",
  entrada: "Entrada manual",
  saida: "Saída manual",
};

function openSession(companyId: number) {
  return db.prepare("SELECT * FROM cash_sessions WHERE status = 'aberto' AND company_id = ? ORDER BY id DESC LIMIT 1").get(companyId) as any;
}

function sessionEntries(sessionId: number, companyId: number) {
  return db
    .prepare(
      `SELECT ce.*, u.name AS user_name
       FROM cash_entries ce LEFT JOIN users u ON u.id = ce.user_id
       WHERE ce.cash_session_id = ? AND ce.company_id = ?
       ORDER BY ce.id ASC`
    )
    .all(sessionId, companyId) as any[];
}

function fiadoSalesCents(session: any, companyId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS t
       FROM sales WHERE created_at >= ? AND created_at <= ? AND payment_method = 'fiado' AND status = 'ativa' AND company_id = ?`
    )
    .get(session.opened_at, session.closed_at ?? now(), companyId) as { t: number };
  return Number(row.t) || 0;
}

function breakdown(session: any, companyId: number) {
  const entries = sessionEntries(session.id, companyId);
  const byPayment: Record<string, number> = { dinheiro: 0, pix: 0, cartao_debito: 0, cartao_credito: 0 };
  let vendaTotal = 0;
  let recTotal = 0;
  let cancelTotal = 0;
  let entradasExtras = 0;
  let saidas = 0;

  for (const e of entries) {
    const amount = Number(e.amount_cents) || 0;
    if (e.type === "venda" || e.type === "recebimento" || e.type === "cancelamento") {
      const sign = e.type === "cancelamento" ? -1 : 1;
      byPayment[e.payment_method] = (byPayment[e.payment_method] ?? 0) + sign * amount;
      if (e.type === "venda") vendaTotal += amount;
      else if (e.type === "recebimento") recTotal += amount;
      else cancelTotal += amount;
    } else if (e.type === "reforco" || e.type === "entrada") {
      entradasExtras += amount;
    } else if (e.type === "sangria" || e.type === "despesa" || e.type === "saida") {
      saidas += amount;
    }
  }

  const totalSales = vendaTotal + recTotal - cancelTotal;
  const expected = Number(session.opening_cents) + totalSales + entradasExtras - saidas;

  return { byPayment, totalSales, entradasExtras, saidas, expected, fiado: fiadoSalesCents(session, companyId) };
}

function serializeSession(session: any, companyId: number) {
  const b = breakdown(session, companyId);
  return {
    ...session,
    sales: { ...b.byPayment, fiado: b.fiado, total: b.totalSales },
    total_saidas_cents: b.saidas,
    expected_cents: b.expected,
    entries: sessionEntries(session.id, companyId),
  };
}

router.get("/", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const sessions = db
    .prepare(
      `SELECT cs.*, u.name AS user_name
       FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.user_id
       WHERE cs.company_id = ?
       ORDER BY cs.id DESC LIMIT 100`
    )
    .all(companyId) as any[];

  const mapped = sessions.map((session) => serializeSession(session, companyId));
  const open = openSession(companyId);
  const current = open ? serializeSession(open, companyId) : null;

  res.json({ sessions: mapped, current });
});

router.post("/open", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  if (openSession(companyId)) {
    res.status(400).json({ error: "Já existe um caixa aberto. Feche o caixa atual antes de abrir outro." });
    return;
  }

  const opening = Math.max(0, Math.round(Number(req.body?.opening_cents) || 0));
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO cash_sessions (user_id, opened_at, opening_cents, status, company_id)
       VALUES (?, ?, ?, 'aberto', ?)`
    )
    .run((req.user as any).id ?? null, ts, opening, companyId);
  const sessionId = Number(info.lastInsertRowid);

  db.prepare(
    `INSERT INTO cash_entries (cash_session_id, type, reference, amount_cents, payment_method, user_id, company_id, created_at)
     VALUES (?, 'abertura', ?, ?, 'dinheiro', ?, ?, ?)`
  ).run(sessionId, "Abertura de caixa", opening, (req.user as any).id ?? null, companyId, ts);

  const session = db.prepare("SELECT * FROM cash_sessions WHERE id = ? AND company_id = ?").get(sessionId, companyId) as any;
  res.status(201).json(serializeSession(session, companyId));
});

router.post("/:id/entries", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const session = db.prepare("SELECT * FROM cash_sessions WHERE id = ? AND company_id = ?").get(Number(req.params.id), companyId) as any;

  if (!session) {
    res.status(404).json({ error: "Sessão de caixa não encontrada." });
    return;
  }
  if (session.status === "fechado") {
    res.status(400).json({ error: "Este caixa já foi fechado. Abra um novo caixa para lançar movimentações." });
    return;
  }

  const type = String(req.body?.type ?? "");
  if (!MANUAL_TYPES.includes(type as CashEntryType)) {
    res.status(400).json({ error: "Tipo de movimentação inválido. Use sangria, reforco, despesa, entrada ou saida." });
    return;
  }

  const amount = Math.round(Number(req.body?.amount_cents));
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Informe um valor de movimentação válido." });
    return;
  }

  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  const reference = description || TYPE_LABELS[type];

  const info = db
    .prepare(
      `INSERT INTO cash_entries (cash_session_id, type, reference, description, amount_cents, payment_method, user_id, company_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'dinheiro', ?, ?, ?)`
    )
    .run(session.id, type, reference, description, amount, (req.user as any).id ?? null, companyId, now());

  const entry = db
    .prepare(
      `SELECT ce.*, u.name AS user_name
       FROM cash_entries ce LEFT JOIN users u ON u.id = ce.user_id
       WHERE ce.id = ? AND ce.company_id = ?`
    )
    .get(Number(info.lastInsertRowid), companyId) as any;

  res.status(201).json(entry);
});

router.post("/:id/close", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const session = db.prepare("SELECT * FROM cash_sessions WHERE id = ? AND company_id = ?").get(Number(req.params.id), companyId) as any;

  if (!session) {
    res.status(404).json({ error: "Sessão de caixa não encontrada." });
    return;
  }
  if (session.status === "fechado") {
    res.status(400).json({ error: "Esta sessão de caixa já foi fechada." });
    return;
  }

  const closedAt = now();
  const closing = Math.max(0, Math.round(Number(req.body?.closing_cents) || 0));
  const b = breakdown(session, companyId);
  const diff = closing - b.expected;

  db.prepare(
    `UPDATE cash_sessions
     SET closed_at = ?, total_sales_cents = ?, total_saidas_cents = ?, expected_cents = ?,
         dinheiro_cents = ?, pix_cents = ?, debito_cents = ?, credito_cents = ?, fiado_cents = ?,
         closing_cents = ?, diff_cents = ?, status = 'fechado'
     WHERE id = ? AND company_id = ?`
  ).run(
    closedAt,
    b.totalSales,
    b.saidas,
    b.expected,
    b.byPayment.dinheiro,
    b.byPayment.pix,
    b.byPayment.cartao_debito,
    b.byPayment.cartao_credito,
    b.fiado,
    closing,
    diff,
    session.id,
    companyId
  );

  const updated = db.prepare("SELECT * FROM cash_sessions WHERE id = ? AND company_id = ?").get(session.id, companyId) as any;
  res.json(serializeSession(updated, companyId));
});

export default router;