import { Router } from "express";
import { db } from "../db.js";
import type { Request, Response } from "express";

const router = Router();

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

function isValidDoc(doc: string): boolean {
  const d = doc.replace(/[^\d]/g, "");
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
    let dv = (sum * 10) % 11;
    if (dv === 10) dv = 0;
    if (dv !== Number(d[9])) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
    dv = (sum * 10) % 11;
    if (dv === 10) dv = 0;
    return dv === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false;
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(d[i]) * w1[i];
    let dv = sum % 11;
    dv = dv < 2 ? 0 : 11 - dv;
    if (dv !== Number(d[12])) return false;
    sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(d[i]) * w2[i];
    dv = sum % 11;
    dv = dv < 2 ? 0 : 11 - dv;
    return dv === Number(d[13]);
  }
  return false;
}

function str(body: any, key: string): string {
  return typeof body?.[key] === "string" ? body[key].trim() : "";
}

function validateDocField(body: any, res: Response): boolean {
  const doc = str(body, "cpf");
  if (doc && !isValidDoc(doc)) {
    res.status(400).json({ error: "CPF/CNPJ inválido. Verifique os dígitos informados." });
    return false;
  }
  return true;
}

router.get("/", (req: Request, res: Response) => {
  const { search, status } = req.query;
  const clauses: string[] = [];
  const params: string[] = [];

  // Multi-tenant isolation: filter by company_id from authenticated user
  const companyId = (req.user as any).company_id;

  const statusValue = String(status ?? "");
  if (statusValue && statusValue !== "todos" && (statusValue === "ativo" || statusValue === "inativo")) {
    clauses.push("status = ?");
    params.push(statusValue);
  }

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    clauses.push("(name LIKE ? OR cpf LIKE ? OR phone LIKE ? OR whatsapp LIKE ? OR email LIKE ? OR city LIKE ?)");
    params.push(term, term, term, term, term, term);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")} AND company_id = ?` : `WHERE company_id = ?`;
  params.push(companyId);

  const rows = db
    .prepare(`SELECT * FROM customers ${where} ORDER BY name COLLATE NOCASE ASC LIMIT 200`)
    .all(...params);
  res.json(rows);
});

router.get("/:id", (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const row = db.prepare("SELECT * FROM customers WHERE id = ? AND company_id = ?").get(Number(req.params.id), companyId) as any;
  if (!row) {
    res.status(404).json({ error: "Cliente não encontrado." });
    return;
  }

  const stats = db
    .prepare(
      `SELECT
         COUNT(CASE WHEN s.status = 'ativa' THEN 1 END) AS sale_count,
         COALESCE(SUM(CASE WHEN s.status = 'ativa' THEN s.total_cents ELSE 0 END), 0) AS total_spent_cents,
         COALESCE(SUM(CASE WHEN s.status = 'ativa' AND s.payment_method = 'fiado' THEN s.total_cents ELSE 0 END), 0) AS total_fiado_cents,
         COALESCE(SUM(CASE WHEN r.status = 'pendente' THEN r.total_cents - COALESCE((SELECT SUM(ce.amount_cents) FROM cash_entries ce WHERE ce.receivable_id = r.id AND ce.company_id = r.company_id), 0) ELSE 0 END), 0) AS open_balance_cents
        FROM sales s
        LEFT JOIN receivables r ON r.sale_id = s.id AND r.company_id = s.company_id
        WHERE s.customer_id = ? AND s.company_id = ?`
    )
    .get(row.id, companyId) as any;

  const cancelledRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sales WHERE customer_id = ? AND company_id = ? AND status = 'cancelada'`
    )
    .get(row.id, companyId) as { n: number };

  const receivedRow = db
    .prepare(
       `SELECT COALESCE(SUM(ce.amount_cents), 0) AS t
        FROM cash_entries ce
        JOIN receivables r ON r.id = ce.receivable_id AND r.company_id = ce.company_id
        WHERE r.customer_id = ? AND r.company_id = ? AND ce.company_id = ? AND ce.type = 'recebimento'`
    )
    .get(row.id, companyId, companyId) as { t: number };

  const recentSales = db
    .prepare(
       `SELECT s.id, s.total_cents, s.payment_method, s.status, s.created_at
        FROM sales s WHERE s.customer_id = ? AND s.company_id = ?
        ORDER BY s.id DESC LIMIT 10`
    )
    .all(row.id, companyId) as any[];

  const salesHistory = db
    .prepare(
       `SELECT s.id, s.total_cents, s.payment_method, s.status, s.created_at, s.cancelled_at
        FROM sales s WHERE s.customer_id = ? AND s.company_id = ?
        ORDER BY s.id DESC`
    )
    .all(row.id, companyId) as any[];

  const payments = db
    .prepare(
      `SELECT ce.id, ce.receivable_id, ce.reference, ce.amount_cents, ce.payment_method, ce.created_at, u.name AS user_name
        FROM cash_entries ce
        JOIN receivables r ON r.id = ce.receivable_id AND r.company_id = ce.company_id
        LEFT JOIN users u ON u.id = ce.user_id
        WHERE r.customer_id = ? AND r.company_id = ? AND ce.company_id = ? AND ce.type = 'recebimento'
        ORDER BY ce.id DESC`
    )
    .all(row.id, companyId, companyId) as any[];

  const receivables = db
    .prepare(
       `SELECT id, sale_id, total_cents, due_date, status, paid_at,
              COALESCE((SELECT SUM(ce.amount_cents) FROM cash_entries ce WHERE ce.receivable_id = receivables.id AND ce.company_id = receivables.company_id), 0) AS received_cents
        FROM receivables WHERE customer_id = ? AND company_id = ?
        ORDER BY status = 'pendente' DESC, due_date ASC`
    )
    .all(row.id, companyId) as any[];

  const receivablesMapped = receivables.map((r) => ({
    ...r,
    received_cents: Number(r.received_cents) || 0,
    remaining_cents: Math.max(0, r.total_cents - (Number(r.received_cents) || 0)),
  }));

  res.json({
    ...row,
    stats: {
      sale_count: stats.sale_count,
      total_spent_cents: stats.total_spent_cents,
      total_fiado_cents: stats.total_fiado_cents,
      open_balance_cents: stats.open_balance_cents,
      total_received_cents: Number(receivedRow.t) || 0,
      cancelled_count: Number(cancelledRow.n) || 0,
    },
    recent_sales: recentSales,
    sales_history: salesHistory,
    payments,
    receivables: receivablesMapped,
  });
});

router.post("/", (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (typeof body.name !== "string" || !body.name.trim()) {
    res.status(400).json({ error: "Informe o nome do cliente." });
    return;
  }
  if (!validateDocField(body, res)) return;

  const ts = now();
  const companyId = (req.user as any).company_id;
  const info = db
    .prepare(
      `INSERT INTO customers (name, cpf, phone, whatsapp, email, address, number, complement, neighborhood, city, uf, cep, notes, status, created_at, updated_at, created_by, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativo', ?, '', ?, ?)`
    )
    .run(
      body.name.trim(),
      str(body, "cpf"),
      str(body, "phone"),
      str(body, "whatsapp"),
      str(body, "email"),
      str(body, "address"),
      str(body, "number"),
      str(body, "complement"),
      str(body, "neighborhood"),
      str(body, "city"),
      str(body, "uf"),
      str(body, "cep"),
      str(body, "notes"),
      ts,
      req.user?.id ?? null,
      companyId
    );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.put("/:id", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const companyId = (req.user as any).company_id;
  const existing = db.prepare("SELECT id FROM customers WHERE id = ? AND company_id = ?").get(id, companyId);
  if (!existing) {
    res.status(404).json({ error: "Cliente não encontrado." });
    return;
  }
  const body = req.body ?? {};
  if (typeof body.name !== "string" || !body.name.trim()) {
    res.status(400).json({ error: "Informe o nome do cliente." });
    return;
  }
  if (!validateDocField(body, res)) return;

  db.prepare(
    `UPDATE customers SET name = ?, cpf = ?, phone = ?, whatsapp = ?, email = ?, address = ?, number = ?, complement = ?, neighborhood = ?, city = ?, uf = ?, cep = ?, notes = ?, updated_at = ?, updated_by = ? WHERE id = ? AND company_id = ?`
  ).run(
    body.name.trim(),
    str(body, "cpf"),
    str(body, "phone"),
    str(body, "whatsapp"),
    str(body, "email"),
    str(body, "address"),
    str(body, "number"),
    str(body, "complement"),
    str(body, "neighborhood"),
    str(body, "city"),
    str(body, "uf"),
    str(body, "cep"),
    str(body, "notes"),
    now(),
    req.user?.id ?? null,
    id,
    companyId
  );
  res.json({ ok: true });
});

router.patch("/:id/status", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const companyId = (req.user as any).company_id;
  const existing = db.prepare("SELECT status FROM customers WHERE id = ? AND company_id = ?").get(id, companyId) as { status: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: "Cliente não encontrado." });
    return;
  }

  const active = req.body?.active === true || req.body?.status === "ativo";
  const nextStatus = active ? "ativo" : "inativo";
  if (nextStatus === existing.status) {
    res.json({ ok: true, status: nextStatus });
    return;
  }

  const ts = now();
  db.prepare(
    `UPDATE customers SET status = ?, updated_at = ?, updated_by = ?, inactivated_at = ?, inactivated_by = ? WHERE id = ? AND company_id = ?`
  ).run(
    nextStatus,
    ts,
    req.user?.id ?? null,
    active ? "" : ts,
    active ? null : (req.user?.id ?? null),
    id,
    companyId
  );
  res.json({ ok: true, status: nextStatus });
});

router.delete("/:id", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const companyId = (req.user as any).company_id;
  let info;
  try {
    const tx = db.transaction(() => {
      db.prepare("UPDATE sales SET customer_id = NULL WHERE customer_id = ? AND company_id = ?").run(id, companyId);
      return db.prepare("DELETE FROM customers WHERE id = ? AND company_id = ?").run(id, companyId);
    });
    info = tx();
  } catch {
    res.status(400).json({ error: "Não foi possível excluir o cliente." });
    return;
  }
  if (info.changes === 0) {
    res.status(404).json({ error: "Cliente não encontrado." });
    return;
  }
  res.json({ ok: true });
});

export default router;
