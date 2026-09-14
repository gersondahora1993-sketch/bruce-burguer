import { Router } from "express";
import { db, now } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { getFiscalProvider, type FiscalDocType } from "../fiscal/provider.js";
import { buildReceiptPdf, type PdfLine } from "../lib/receiptPdf.js";
import type { Request, Response } from "express";

const router = Router();

export const PAYMENT_METHODS = ["dinheiro", "pix", "cartao_debito", "cartao_credito", "fiado"];

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_debito: "Cartão de débito",
  cartao_credito: "Cartão de crédito",
  fiado: "Fiado",
};

export const SURCHARGE_CENTS: Record<string, number> = { cartao_credito: 1000, fiado: 1500 };

export function paymentTotals(paymentMethod: string, subtotalCents: number): { subtotal_cents: number; surcharge_cents: number; rounding_cents: number; total_cents: number } {
  const extra = SURCHARGE_CENTS[paymentMethod] ?? 0;
  if (!extra) {
    return { subtotal_cents: subtotalCents, surcharge_cents: 0, rounding_cents: 0, total_cents: subtotalCents };
  }
  if (paymentMethod === "fiado") {
    const finalTotal = Math.ceil((subtotalCents + extra) / 100) * 100;
    return { subtotal_cents: subtotalCents, surcharge_cents: extra, rounding_cents: finalTotal - subtotalCents - extra, total_cents: finalTotal };
  }
  return { subtotal_cents: subtotalCents, surcharge_cents: extra, rounding_cents: 0, total_cents: subtotalCents + extra };
}

router.get("/", requireAuth, (req: Request, res: Response) => {
  const { from, to, payment_method, status, search } = req.query;
  const where: string[] = [];
  const params: (string | number)[] = [];

  // Multi-tenant isolation: filter by company_id from authenticated user
  const companyId = (req.user as any).company_id;

  if (from && String(from)) {
    where.push("s.created_at >= ?");
    params.push(`${String(from)} 00:00:00`);
  }
  if (to && String(to)) {
    where.push("s.created_at <= ?");
    params.push(`${String(to)} 23:59:59`);
  }
  if (payment_method && payment_method !== "all" && PAYMENT_METHODS.includes(String(payment_method))) {
    where.push("s.payment_method = ?");
    params.push(String(payment_method));
  }
  if (status && status !== "all" && ["ativa", "cancelada"].includes(String(status))) {
    where.push("s.status = ?");
    params.push(String(status));
  }
  if (search && String(search).trim()) {
    where.push("(s.customer_name LIKE ? OR EXISTS (SELECT 1 FROM sale_items it WHERE it.sale_id = s.id AND it.company_id = s.company_id AND it.product_name LIKE ?))");
    const term = `%${String(search).trim()}%`;
    params.push(term, term);
  }

  const sellerId = Number(req.query.user_id);
  if (Number.isSafeInteger(sellerId) && sellerId > 0) {
    where.push("s.user_id = ?");
    params.push(sellerId);
  }
  if ((req.user as any).role !== "admin") {
    where.push("s.user_id = ?");
    params.push((req.user as any).id);
  }

  params.push(companyId);

  const rows = db
    .prepare(
      `SELECT s.id, s.customer_id, s.customer_name, s.total_cents, s.payment_method, s.status, s.user_id, s.cancelled_at, s.cancelled_by, s.created_at,
              u.name AS user_name, cu.name AS cancelled_by_name,
              (SELECT COUNT(*) FROM sale_items it WHERE it.sale_id = s.id AND it.company_id = s.company_id) AS item_count
       FROM sales s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN users cu ON cu.id = s.cancelled_by
       ${where.length ? "WHERE " + where.join(" AND ") + " AND " : "WHERE "}s.company_id = ?
       ORDER BY s.id DESC
       LIMIT 500`
    )
    .all(...params) as any[];

  res.json(rows);
});

router.get("/:id", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const sale = db
    .prepare(
      `SELECT s.*, u.name AS user_name
       FROM sales s LEFT JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.company_id = ?`
    )
    .get(Number(req.params.id), companyId) as any;

  if (!sale) {
    res.status(404).json({ error: "Venda não encontrada." });
    return;
  }

  if ((req.user as any).role !== "admin" && Number(sale.user_id) !== Number((req.user as any).id)) {
    res.status(404).json({ error: "Venda não encontrada." });
    return;
  }

  const items = db
    .prepare(
       `SELECT it.*, p.image_url
        FROM sale_items it
        JOIN sales parent_sale ON parent_sale.id = it.sale_id AND parent_sale.company_id = ?
         JOIN products p ON p.id = it.product_id AND p.company_id = ?
         JOIN product_variations v ON v.id = it.variation_id AND v.company_id = ?
        WHERE it.sale_id = ? AND it.company_id = parent_sale.company_id`
    )
    .all(companyId, companyId, companyId, sale.id);

  const fiscalDocument = db
    .prepare("SELECT * FROM fiscal_documents WHERE sale_id = ? ORDER BY id DESC LIMIT 1")
    .get(sale.id);

  res.json({ ...sale, items, fiscal_document: fiscalDocument ?? null });
});

/* --------------------- Comprovante de venda (não fiscal) --------------------- */

function money(cents: number): string {
  return "R$ " + (cents / 100).toFixed(2).replace(".", ",");
}

const DEFAULT_STORE_SETTINGS: Record<string, string> = {
  store_name: "Bruce Burguer",
  store_logo_url: "",
  store_cnpj: "",
  store_phone: "",
  whatsapp_number: "5522981667509",
  store_address: "Loteamento Nova Macuco, em frente à Mercearia do Davi",
  store_city: "São Francisco de Itabapoana",
  store_state: "RJ",
  store_zip: "",
};

function loadBusinessSettings(companyId: number): Record<string, string> {
  const row = db
    .prepare(
      `SELECT business_name, slogan, whatsapp, address, city, uf, cep, logo_url
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
      logo_url: string;
    } | undefined;

  if (!row) return DEFAULT_STORE_SETTINGS;

  return {
    store_name: row.business_name,
    store_logo_url: row.logo_url || "",
    store_cnpj: "",
    store_phone: "",
    whatsapp_number: row.whatsapp,
    store_address: row.address,
    store_city: row.city,
    store_state: row.uf,
    store_zip: row.cep,
  };
}

function loadReceiptData(companyId: number, saleId: number): any {
  const sale = db
    .prepare(
      `SELECT s.*, u.name AS user_name, cu.name AS cancelled_by_name
       FROM sales s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN users cu ON cu.id = s.cancelled_by
       WHERE s.id = ? AND s.company_id = ?`
    )
    .get(saleId, companyId) as any;
  if (!sale) return null;

  const items = db
    .prepare(
      `SELECT product_name, color_name, size_name, quantity, unit_price_cents, total_cents
       FROM sale_items
       WHERE sale_id = ? AND company_id = ?
       ORDER BY id ASC`
    )
    .all(saleId, companyId) as { product_name: string; color_name: string; size_name: string; quantity: number; unit_price_cents: number; total_cents: number }[];

  const settings = loadBusinessSettings(companyId);

  const subtotal = items.reduce((a, it) => a + it.total_cents, 0);

  let fiado: any = null;
  if (sale.payment_method === "fiado") {
    const rec = db
      .prepare("SELECT id, total_cents, due_date, status FROM receivables WHERE sale_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1")
      .get(saleId, companyId) as { id: number; total_cents: number; due_date: string; status: string } | undefined;
    if (rec) {
      const receivedRow = db
        .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS t FROM cash_entries WHERE receivable_id = ? AND company_id = ?")
        .get(rec.id, companyId) as { t: number };
      const received = Number(receivedRow?.t) || 0;
      fiado = {
        receivable_id: rec.id,
        total_cents: rec.total_cents,
        due_date: rec.due_date,
        received_cents: received,
        remaining_cents: Math.max(0, rec.total_cents - received),
        status: rec.status,
        quitado: rec.status === "pago" || rec.total_cents - received <= 0,
      };
    }
  }

  const amountReceived = sale.payment_method === "dinheiro" ? (Number(sale.amount_received_cents) || sale.total_cents) : sale.total_cents;
  const change = sale.payment_method === "dinheiro" ? Math.max(0, amountReceived - sale.total_cents) : 0;
  const paymentLabel = PAYMENT_LABELS[sale.payment_method] ?? sale.payment_method;

  const saleNumber = `#${String(sale.id).padStart(4, "0")}`;
  const lines: string[] = [];
  for (const it of items) {
    const variant = [it.color_name, it.size_name].filter(Boolean).join("/");
    lines.push(`${it.quantity}x ${it.product_name}${variant ? ` (${variant})` : ""} — ${money(it.unit_price_cents)} cada = ${money(it.total_cents)}`);
  }

  // Acréscimo comercial fixo por forma; o restante do diff é arredondamento (fiado)
  const surchargeDiff = sale.total_cents - subtotal;
  const commercialSurcharge = SURCHARGE_CENTS[sale.payment_method] ?? 0;
  const surchargeCents = surchargeDiff > 0 ? Math.min(commercialSurcharge, surchargeDiff) : 0;
  const roundingCents = Math.max(0, surchargeDiff - surchargeCents);

  const whatsappText =
    `*${settings.store_name || "Bruce Burguer"}*\n` +
    `COMPROVANTE DE VENDA — NÃO É DOCUMENTO FISCAL\n\n` +
    `Venda: ${saleNumber}\n` +
    `Data: ${new Date(sale.created_at).toLocaleString("pt-BR")}\n` +
    `Vendedora: ${sale.user_name || "-"}\n` +
    `Cliente: ${sale.customer_name || "-"}\n\n` +
    (lines.length ? lines.join("\n") + "\n\n" : "") +
    `Valor à vista: ${money(subtotal)}\n` +
    `Pagamento: ${paymentLabel}\n` +
    (surchargeCents > 0 ? `Acréscimo: ${money(surchargeCents)}\n` : "") +
    (roundingCents > 0 ? `Arredondamento: ${money(roundingCents)}\n` : "") +
    `VALOR FINAL: ${money(sale.total_cents)}\n` +
    (sale.payment_method === "dinheiro" ? `Valor recebido: ${money(amountReceived)}\nTroco: ${money(change)}\n` : "") +
    (fiado ? `Vencimento: ${fiado.due_date.split("-").reverse().join("/")}\nSaldo fiado: ${money(fiado.remaining_cents)} (${fiado.quitado ? "QUITADO" : "pendente"})\n` : "") +
    (sale.status === "cancelada" ? `\nVENDA CANCELADA\n` : "") +
    `\nObrigado pela preferência!\nCOMPROVANTE DE VENDA — NÃO É DOCUMENTO FISCAL`;

  return {
    store: {
      store_name: settings.store_name,
      store_logo_url: settings.store_logo_url || "/logo/bruce-burguer.png",
      store_cnpj: settings.store_cnpj,
      store_phone: settings.store_phone,
      whatsapp_number: settings.whatsapp_number,
      store_address: settings.store_address,
      store_city: settings.store_city,
      store_state: settings.store_state,
      store_zip: settings.store_zip,
    },
    sale: {
      id: sale.id,
      customer_id: sale.customer_id,
      customer_name: sale.customer_name,
      total_cents: sale.total_cents,
      amount_received_cents: amountReceived,
      change_cents: change,
      payment_method: sale.payment_method,
      status: sale.status,
      cancelled_at: sale.cancelled_at,
      cancelled_by_name: sale.cancelled_by_name,
      created_at: sale.created_at,
      user_id: sale.user_id,
      user_name: sale.user_name,
    },
    items,
    subtotal_cents: subtotal,
    surcharge_cents: surchargeCents,
    rounding_cents: roundingCents,
    discount_cents: 0,
    payment_label: paymentLabel,
    fiado,
    whatsapp_text: whatsappText,
  };
}

function canViewSale(req: Request, sale: any): boolean {
  return (req.user as any).role === "admin" || Number(sale.user_id) === Number((req.user as any).id);
}

function findSaleForReceipt(req: Request, res: Response): any {
  const companyId = (req.user as any).company_id;
  const sale = db.prepare("SELECT * FROM sales WHERE id = ? AND company_id = ?").get(Number(req.params.id), companyId) as any;
  if (!sale) {
    res.status(404).json({ error: "Venda não encontrada." });
    return null;
  }
  if (!canViewSale(req, sale)) {
    res.status(404).json({ error: "Venda não encontrada." });
    return null;
  }
  return sale;
}

router.get("/:id/comprovante", requireAuth, (req: Request, res: Response) => {
  const sale = findSaleForReceipt(req, res);
  if (!sale) return;
  const data = loadReceiptData((req.user as any).company_id, sale.id);
  res.json(data);
});

function receiptToPdfLines(data: any): PdfLine[] {
  const lines: PdfLine[] = [
    { text: data.store.store_name || "Bruce Burguer", bold: true, size: 16, align: "center" },
  ];
  if (data.store.store_cnpj) lines.push({ text: `CNPJ: ${data.store.store_cnpj}`, size: 9, align: "center" });
  if (data.store.store_phone) lines.push({ text: `Telefone: ${data.store.store_phone}`, size: 9, align: "center" });
  if (data.store.store_address || data.store.store_city) {
    lines.push({ text: [data.store.store_address, data.store.store_city, data.store.store_state].filter(Boolean).join(", "), size: 9, align: "center" });
  }
  lines.push(
    { text: "COMPROVANTE DE VENDA", bold: true, size: 13, align: "center", gap: 8 },
    { text: "NÃO É DOCUMENTO FISCAL", bold: true, size: 11, align: "center" },
    { text: "", gap: 6 },
    { text: `Venda: #${String(data.sale.id).padStart(4, "0")}` },
    { text: `Data: ${new Date(data.sale.created_at).toLocaleString("pt-BR")}` },
    { text: `Vendedora: ${data.sale.user_name || "-"}` },
    { text: `Cliente: ${data.sale.customer_name || "-"}` },
    { text: "", gap: 4 },
  );
  for (const it of data.items) {
    const variant = [it.color_name, it.size_name].filter(Boolean).join("/");
    lines.push({ text: `${it.quantity}x ${it.product_name}${variant ? ` (${variant})` : ""}` });
    lines.push({ text: `${money(it.unit_price_cents)} cada = ${money(it.total_cents)}`, size: 10 });
  }
  lines.push(
    { text: "", gap: 4 },
    { text: `Valor à vista: ${money(data.subtotal_cents)}` },
    { text: `Pagamento: ${data.payment_label}` },
  );
  if (data.surcharge_cents > 0) {
    lines.push({ text: `Acréscimo: ${money(data.surcharge_cents)}` });
  }
  if (data.rounding_cents > 0) {
    lines.push({ text: `Arredondamento: ${money(data.rounding_cents)}` });
  }
  lines.push(
    { text: `VALOR FINAL: ${money(data.sale.total_cents)}`, bold: true, size: 14, gap: 4 },
  );
  if (data.sale.payment_method === "dinheiro") {
    lines.push({ text: `Valor recebido: ${money(data.sale.amount_received_cents)}` });
    lines.push({ text: `Troco: ${money(data.sale.change_cents)}` });
  }
  if (data.fiado) {
    lines.push({ text: `Vencimento: ${data.fiado.due_date.split("-").reverse().join("/")}` });
    lines.push({ text: `Saldo fiado: ${money(data.fiado.remaining_cents)} (${data.fiado.quitado ? "QUITADO" : "pendente"})` });
  }
  if (data.sale.status === "cancelada") {
    lines.push({ text: "", gap: 6 });
    lines.push({ text: "VENDA CANCELADA", bold: true, size: 14, align: "center" });
  }
  lines.push(
    { text: "", gap: 8 },
    { text: "Obrigado pela preferência!", align: "center" },
    { text: "COMPROVANTE DE VENDA", bold: true, align: "center" },
    { text: "NÃO É DOCUMENTO FISCAL", bold: true, align: "center" },
  );
  return lines;
}

router.get("/:id/comprovante/pdf", requireAuth, (req: Request, res: Response) => {
  const sale = findSaleForReceipt(req, res);
  if (!sale) return;
  const data = loadReceiptData((req.user as any).company_id, sale.id);
  const pdf = buildReceiptPdf(receiptToPdfLines(data));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="comprovante-venda-${sale.id}.pdf"`);
  res.send(pdf);
});

router.post("/", requireAuth, (req: Request, res: Response) => {
  const body = req.body ?? {};

  if (!Array.isArray(body.items) || body.items.length === 0) {
    res.status(400).json({ error: "O carrinho está vazio." });
    return;
  }
  if (!PAYMENT_METHODS.includes(body.payment_method)) {
    res.status(400).json({ error: "Selecione uma forma de pagamento." });
    return;
  }

  const companyId = (req.user as any).company_id;
  const userId = (req.user as any).id;
  const isFiado = body.payment_method === "fiado";
  const customerIdRaw = body.customer_id ? Number(body.customer_id) : 0;
  const customerId = Number.isInteger(customerIdRaw) && customerIdRaw > 0 ? customerIdRaw : null;
  const customerName = typeof body.customer_name === "string" ? body.customer_name.trim() : "";

  if (customerId) {
    const cust = db.prepare("SELECT status FROM customers WHERE id = ? AND company_id = ?").get(customerId, companyId) as { status: string } | undefined;
    if (!cust) {
      res.status(400).json({ error: "Cliente não encontrado nesta loja." });
      return;
    }
    if (cust.status === "inativo") {
      res.status(400).json({ error: "Este cliente está inativo e não pode ser selecionado para novas vendas." });
      return;
    }
  }

  if (isFiado && !customerId && !customerName) {
    res.status(400).json({ error: "Venda fiada exige um cliente." });
    return;
  }

  let dueDate = typeof body.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date.trim())
    ? body.due_date.trim()
    : "";
  if (isFiado && !dueDate) {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    const p = (n: number) => String(n).padStart(2, "0");
    dueDate = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  interface CartItem {
    variation_id: number;
    quantity: number;
  }
  const items: CartItem[] = [];

  for (const it of body.items) {
    const variation_id = Number(it?.variation_id);
    const quantity = Number(it?.quantity);
    if (!variation_id || !Number.isInteger(quantity) || quantity <= 0) {
      res.status(400).json({ error: "Item do carrinho inválido." });
      return;
    }
    items.push({ variation_id, quantity });
  }

  const tx = db.transaction(() => {
    const openCash = db
      .prepare("SELECT id FROM cash_sessions WHERE status = 'aberto' AND company_id = ? ORDER BY id DESC LIMIT 1")
      .get(companyId) as { id: number } | undefined;
    if (!openCash) {
      throw new Error("Abra o caixa antes de finalizar uma venda.");
    }

    const fetched = items.map((it) => {
      const row = db
        .prepare(
          `SELECT v.id, v.stock, v.company_id AS variation_company_id, p.id AS product_id, p.name AS product_name, p.sale_price_cents, p.company_id AS product_company_id,
                  col.name AS color_name, s.name AS size_name
            FROM product_variations v
            JOIN products p ON p.id = v.product_id
            JOIN colors col ON col.id = v.color_id AND col.company_id = p.company_id
            JOIN sizes s ON s.id = v.size_id AND s.company_id = p.company_id
           WHERE v.id = ? AND v.company_id = ? AND p.company_id = ?`
        )
        .get(it.variation_id, companyId, companyId) as any;
      return { ...it, row };
    });

    const invalid = fetched.filter((f) => !f.row || f.row.variation_company_id !== companyId || f.row.product_company_id !== companyId || f.row.stock < f.quantity);
    if (invalid.length > 0) {
      const msgs = invalid.map((f) => {
        if (!f.row) return `Produto não encontrado`;
        if (f.row.variation_company_id !== companyId || f.row.product_company_id !== companyId) return `${f.row.product_name} — produto de outra empresa`;
        return `${f.row.product_name} (${f.row.color_name}/${f.row.size_name}) — disponível: ${f.row.stock}`;
      });
      throw new Error("Não foi possível finalizar a venda: " + msgs.join("; "));
    }

    let subtotal = 0;
    const saleItems = fetched.map((f) => {
      const line = f.row.sale_price_cents * f.quantity;
      subtotal += line;
      return { ...f, unit: f.row.sale_price_cents, line };
    });

    // Acréscimo por forma de pagamento (crédito +R$10 fixos; fiado +R$15 com arredondamento para cima ao real)
    const priced = paymentTotals(body.payment_method, subtotal);
    const surchargeCents = priced.surcharge_cents;
    const total = priced.total_cents;

    const amountReceivedRaw = Number(body.amount_received_cents);
    let amountReceived = total;
    let change = 0;
    if (body.payment_method === "dinheiro" && Number.isSafeInteger(amountReceivedRaw) && amountReceivedRaw > 0) {
      if (amountReceivedRaw < total) {
        throw new Error("O valor recebido em dinheiro não pode ser menor que o total da venda.");
      }
      amountReceived = amountReceivedRaw;
      change = amountReceived - total;
    } else {
      amountReceived = total;
      change = 0;
    }

    const ts = now();
    let resolvedCustomerName = customerName;
    if (customerId && !resolvedCustomerName) {
      const cust = db.prepare("SELECT name FROM customers WHERE id = ? AND company_id = ?").get(customerId, companyId) as { name: string } | undefined;
      if (cust) resolvedCustomerName = cust.name;
    }

    const info = db
      .prepare(
        `INSERT INTO sales (customer_id, customer_name, total_cents, payment_method, user_id, company_id, amount_received_cents, change_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        customerId,
        resolvedCustomerName,
        total,
        body.payment_method,
        userId ?? null,
        companyId,
        amountReceived,
        change,
        ts
      );
    const saleId = Number(info.lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, variation_id, product_name, color_name, size_name, quantity, unit_price_cents, total_cents, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertMovement = db.prepare(
      `INSERT INTO stock_movements (variation_id, product_id, type, quantity, stock_before, stock_after, reason, user_id, company_id, sale_id, created_at)
       VALUES (?, ?, 'saida', ?, ?, ?, 'Venda', ?, ?, ?, ?)`
    );

    for (const st of saleItems) {
      insertItem.run(saleId, st.row.product_id, st.row.id, st.row.product_name, st.row.color_name, st.row.size_name, st.quantity, st.unit, st.line, companyId);
      db.prepare("UPDATE product_variations SET stock = stock - ? WHERE id = ? AND company_id = ?").run(st.quantity, st.row.id, companyId);
      insertMovement.run(st.row.id, st.row.product_id, st.quantity, st.row.stock, st.row.stock - st.quantity, userId ?? null, companyId, saleId, now());
    }

    let receivableId: number | null = null;
    if (isFiado) {
      const rec = db
        .prepare(
          `INSERT INTO receivables (sale_id, customer_id, customer_name, total_cents, due_date, status, company_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'pendente', ?, ?)`
        )
        .run(saleId, customerId, resolvedCustomerName, total, dueDate, companyId, ts);
      receivableId = Number(rec.lastInsertRowid);
    } else {
      db.prepare(
        `INSERT INTO cash_entries (cash_session_id, type, sale_id, customer_name, reference, amount_cents, payment_method, user_id, company_id, created_at)
         VALUES (?, 'venda', ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        openCash?.id ?? null,
        saleId,
        resolvedCustomerName,
        `Venda #${String(saleId).padStart(4, "0")}`,
        total,
        body.payment_method,
        userId ?? null,
        companyId,
        ts
      );
    }

    return {
      saleId,
      total_cents: total,
      subtotal_cents: priced.subtotal_cents,
      surcharge_cents: surchargeCents,
      rounding_cents: priced.rounding_cents,
      amount_received_cents: amountReceived,
      change_cents: change,
      receivable_id: receivableId,
      due_date: isFiado ? dueDate : undefined,
      items: saleItems.map((st) => ({ name: st.row.product_name, color: st.row.color_name, size: st.row.size_name, quantity: st.quantity, unit: st.unit, line: st.line })),
    };
  });

  try {
    const result = tx();
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Não foi possível finalizar a venda." });
  }
});

router.post("/:id/fiscal/emit", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const sale = db
    .prepare(
      `SELECT s.*, u.name AS user_name
       FROM sales s LEFT JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.company_id = ?`
    )
    .get(Number(req.params.id), companyId) as any;

  if (!sale) {
    res.status(404).json({ error: "Venda não encontrada." });
    return;
  }
  if (sale.status === "cancelada") {
    res.status(400).json({ error: "Venda cancelada não pode emitir documento fiscal." });
    return;
  }

  const type: FiscalDocType = req.body?.type === "nfe" ? "nfe" : "nfce";
  const existing = db
    .prepare("SELECT * FROM fiscal_documents WHERE sale_id = ? AND type = ? ORDER BY id DESC LIMIT 1")
    .get(sale.id, type) as any;

  if (existing && existing.status !== "cancelado" && existing.status !== "rejeitado") {
    res.status(409).json({
      error: "Já existe um documento fiscal para esta venda. Nenhuma nova emissão foi feita.",
      document_id: existing.id,
      status: existing.status,
    });
    return;
  }

  const items = db
    .prepare(
      `SELECT it.*
       FROM sale_items it
       JOIN sales parent_sale ON parent_sale.id = it.sale_id
       WHERE it.sale_id = ? AND it.company_id = parent_sale.company_id`
    )
    .all(sale.id) as any[];

  const provider = getFiscalProvider();
  const input = {
    saleId: sale.id,
    totalCents: sale.total_cents,
    customerName: sale.customer_name ?? "",
    items: items.map((it) => ({
      name: it.product_name,
      color: it.color_name,
      size: it.size_name,
      quantity: it.quantity,
      unitPriceCents: it.unit_price_cents,
      lineCents: it.total_cents,
    })),
    type,
  };

  const result = provider.emitirNfce(input);
  const ts = now();

  let documentId: number;
  if (provider.configured && result.ok && result.status === "autorizado") {
    const info = db
      .prepare(
        `INSERT INTO fiscal_documents (sale_id, type, status, number, series, access_key, protocol, xml, issued_at, provider, created_at, updated_at)
         VALUES (?, ?, 'autorizado', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sale.id,
        type,
        result.number ?? "",
        result.series ?? "",
        result.access_key ?? "",
        result.protocol ?? "",
        result.xml ?? "",
        result.issued_at ?? ts,
        provider.name,
        ts,
        ts
      );
    documentId = Number(info.lastInsertRowid);
  } else {
    const info = db
      .prepare(
        `INSERT INTO fiscal_documents (sale_id, type, status, provider, created_at, updated_at)
         VALUES (?, ?, 'nao_configurado', ?, ?, ?)`
      )
      .run(sale.id, type, provider.name, ts, ts);
    documentId = Number(info.lastInsertRowid);
  }

  const doc = db.prepare("SELECT * FROM fiscal_documents WHERE id = ?").get(documentId) as any;
  res.status(provider.configured ? 201 : 202).json({
    ok: provider.configured,
    configured: provider.configured,
    message: provider.configured
      ? "Documento fiscal emitido com sucesso."
      : "Emissão fiscal não configurada: o documento foi registrado como pendente, porém NENHUM documento foi autorizado. Conecte um provedor fiscal (SEFAZ/emissor homologado) para emissão real.",
    document: doc,
  });
});

router.delete("/:id", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const userId = (req.user as any).id;
  const tx = db.transaction((): { status: number; body: any } => {
    const sale = db.prepare("SELECT * FROM sales WHERE id = ? AND company_id = ?").get(Number(req.params.id), companyId) as any;
    if (!sale) return { status: 404, body: { error: "Venda não encontrada." } };

    if ((req.user as any).role !== "admin" && Number(sale.user_id) !== Number((req.user as any).id)) {
      return { status: 403, body: { error: "Você não tem permissão para cancelar esta venda." } };
    }

    if (sale.status === "cancelada") {
      return { status: 400, body: { error: "Esta venda já foi cancelada. Nenhuma operação foi repetida." } };
    }

    if (sale.payment_method === "fiado") {
      const rec = db.prepare("SELECT * FROM receivables WHERE sale_id = ? AND company_id = ?").get(sale.id, companyId) as any;
      if (rec) {
        const received = db
          .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS t FROM cash_entries WHERE receivable_id = ? AND company_id = ?")
          .get(rec.id, companyId) as { t: number };
        if (rec.status === "pago" || (Number(received.t) || 0) > 0) {
          return {
            status: 400,
            body: {
              error:
                "Esta venda fiada já possui recebimento(s) e não pode ser cancelada pelo sistema. " +
                "Basta quitar o saldo restante (se houver) e realizar a devolução dos produtos manualmente.",
            },
          };
        }
      }
    }

    const items = db
      .prepare(
        `SELECT it.*
         FROM sale_items it
         JOIN sales parent_sale ON parent_sale.id = it.sale_id
         WHERE it.sale_id = ? AND it.company_id = parent_sale.company_id`
      )
      .all(sale.id) as any[];
    const ts = now();

    const refund = db.prepare(
      `INSERT INTO stock_movements (variation_id, product_id, type, quantity, stock_before, stock_after, reason, user_id, company_id, sale_id, order_id, created_at)
       VALUES (?, ?, 'entrada', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    );
    for (const it of items) {
      const v = db.prepare("SELECT stock, company_id FROM product_variations WHERE id = ? AND company_id = ?").get(it.variation_id, companyId) as { stock: number; company_id: number } | undefined;
      if (!v || v.company_id !== companyId) continue;
      db.prepare("UPDATE product_variations SET stock = stock + ? WHERE id = ? AND company_id = ?").run(it.quantity, it.variation_id, companyId);
      refund.run(
        it.variation_id,
        it.product_id,
        it.quantity,
        v.stock,
        v.stock + it.quantity,
        `Cancelamento de venda #${String(sale.id).padStart(4, "0")}`,
        userId ?? null,
        companyId,
        sale.id,
        ts
      );
    }

    if (sale.payment_method === "fiado") {
      db.prepare("DELETE FROM receivables WHERE sale_id = ? AND company_id = ?").run(sale.id, companyId);
    } else {
      const vendaEntry = db
        .prepare("SELECT * FROM cash_entries WHERE sale_id = ? AND company_id = ? AND type = 'venda'")
        .get(sale.id, companyId) as any;
      if (vendaEntry) {
        db.prepare(
          `INSERT INTO cash_entries (cash_session_id, type, sale_id, customer_name, reference, amount_cents, payment_method, user_id, company_id, created_at)
           VALUES (?, 'cancelamento', ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          vendaEntry.cash_session_id ?? null,
          sale.id,
          sale.customer_name ?? "",
          `Cancelamento de venda #${String(sale.id).padStart(4, "0")}`,
          sale.total_cents,
          sale.payment_method,
          userId ?? null,
          companyId,
          ts
        );
      }
    }

    db.prepare("UPDATE sales SET status = 'cancelada', cancelled_at = ?, cancelled_by = ? WHERE id = ? AND company_id = ?").run(ts, userId ?? null, sale.id, companyId);
    return { status: 200, body: { ok: true, sale_id: sale.id, status: "cancelada", cancelled_at: ts } };
  });

  try {
    const result = tx();
    res.status(result.status).json(result.body);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Não foi possível cancelar a venda." });
  }
});

export default router;
