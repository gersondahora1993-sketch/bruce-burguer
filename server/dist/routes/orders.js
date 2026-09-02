import { Router } from "express";
import { db, now } from "../db.js";
import { requireAuth, requireSubscriptionContext, requireTenant } from "../auth.js";
import { env } from "../config.js";
const router = Router();
export const ORDER_STATUSES = ["novo", "confirmado", "em_preparacao", "pronto", "entregue", "cancelado"];
router.post("/", (req, res) => {
    const body = req.body ?? {};
    const companyId = env.publicCompanyId;
    const userId = null;
    if (!companyId) {
        res.status(503).json({ error: "Pedidos públicos não estão configurados para uma empresa." });
        return;
    }
    const customerName = typeof body.customer_name === "string" ? body.customer_name.trim() : "";
    const customerPhone = typeof body.customer_phone === "string" ? body.customer_phone.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const paymentMethod = typeof body.payment_method === "string" ? body.payment_method : "pix";
    if (!customerName) {
        res.status(400).json({ error: "Informe o seu nome." });
        return;
    }
    if (!customerPhone) {
        res.status(400).json({ error: "Informe o seu telefone." });
        return;
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
        res.status(400).json({ error: "O carrinho está vazio." });
        return;
    }
    const items = [];
    for (const it of body.items) {
        const variation_id = Number(it?.variation_id);
        const quantity = Number(it?.quantity);
        if (!variation_id || !Number.isInteger(quantity) || quantity <= 0) {
            res.status(400).json({ error: "Item do pedido inválido." });
            return;
        }
        items.push({ variation_id, quantity });
    }
    const tx = db.transaction(() => {
        const fetched = items.map((it) => {
            const row = db
                .prepare(`SELECT v.id, v.stock, v.company_id AS variation_company_id, p.id AS product_id, p.name AS product_name, p.sale_price_cents,
                  p.company_id AS product_company_id, p.active AS product_active, col.name AS color_name, s.name AS size_name
           FROM product_variations v
           JOIN products p ON p.id = v.product_id
           JOIN colors col ON col.id = v.color_id
           JOIN sizes s ON s.id = v.size_id
           WHERE v.id = ? AND v.company_id = ? AND p.company_id = ?`)
                .get(it.variation_id, companyId, companyId);
            return { ...it, row };
        });
        const invalid = fetched.filter((f) => !f.row ||
            f.row.variation_company_id !== companyId ||
            f.row.product_company_id !== companyId ||
            f.row.product_active !== 1);
        if (invalid.length > 0) {
            throw new Error("Alguns produtos não estão mais disponíveis ou não pertencem à sua loja. Atualize o carrinho.");
        }
        let total = 0;
        const orderItems = fetched.map((f) => {
            const line = f.row.sale_price_cents * f.quantity;
            total += line;
            return { ...f, unit: f.row.sale_price_cents, line };
        });
        const ts = now();
        const info = db
            .prepare(`INSERT INTO orders (customer_name, customer_phone, address, notes, payment_method, total_cents, status, user_id, company_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'novo', ?, ?, ?)`)
            .run(customerName, customerPhone, address, notes, paymentMethod, total, userId ?? null, companyId, ts);
        const orderId = Number(info.lastInsertRowid);
        const insertItem = db.prepare(`INSERT INTO order_items (order_id, product_id, variation_id, product_name, color_name, size_name, quantity, unit_price_cents, total_cents, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const st of orderItems) {
            insertItem.run(orderId, st.row.product_id, st.row.id, st.row.product_name, st.row.color_name, st.row.size_name, st.quantity, st.unit, st.line, companyId);
        }
        return {
            order_id: orderId,
            total_cents: total,
            status: "novo",
            created_at: ts,
            items: orderItems.map((st) => ({
                name: st.row.product_name,
                color: st.row.color_name,
                size: st.row.size_name,
                quantity: st.quantity,
                unit: st.unit,
                line: st.line,
            })),
        };
    });
    try {
        const result = tx();
        res.status(201).json(result);
    }
    catch (err) {
        res.status(400).json({ error: err?.message ?? "Não foi possível registrar o pedido." });
    }
});
router.get("/", requireAuth, requireTenant, requireSubscriptionContext, (req, res) => {
    const { status, search } = req.query;
    const where = [];
    const params = [];
    const companyId = req.user.company_id;
    where.push("o.company_id = ?");
    params.push(companyId);
    if (status && status !== "all" && ORDER_STATUSES.includes(String(status))) {
        where.push("o.status = ?");
        params.push(String(status));
    }
    if (search && String(search).trim()) {
        where.push("(o.customer_name LIKE ? OR o.customer_phone LIKE ? OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.company_id = o.company_id AND oi.product_name LIKE ?))");
        const term = `%${String(search).trim()}%`;
        params.push(term, term, term);
    }
    const rows = db
        .prepare(`SELECT o.*,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.company_id = o.company_id) AS item_count
       FROM orders o
       WHERE ${where.join(" AND ")}
       ORDER BY CASE WHEN o.status IN ('novo','confirmado','em_preparacao','pronto') THEN 0 ELSE 1 END, o.id DESC
       LIMIT 300`)
        .all(...params);
    res.json(rows);
});
router.get("/:id", requireAuth, requireTenant, requireSubscriptionContext, (req, res) => {
    const companyId = req.user.company_id;
    const order = db.prepare("SELECT * FROM orders WHERE id = ? AND company_id = ?").get(Number(req.params.id), companyId);
    if (!order) {
        res.status(404).json({ error: "Pedido não encontrado." });
        return;
    }
    const items = db
        .prepare(`SELECT oi.*, p.image_url
         FROM order_items oi
         JOIN orders parent_order ON parent_order.id = oi.order_id AND parent_order.company_id = ?
           JOIN products p ON p.id = oi.product_id AND p.company_id = ?
           JOIN product_variations v ON v.id = oi.variation_id AND v.company_id = ?
         WHERE oi.order_id = ? AND oi.company_id = parent_order.company_id`)
        .all(companyId, companyId, companyId, order.id);
    res.json({ ...order, items });
});
const STATUS_FLOW = ["novo", "confirmado", "em_preparacao", "pronto", "entregue", "cancelado"];
function loadOrderWithItems(orderId, companyId) {
    const order = db.prepare("SELECT * FROM orders WHERE id = ? AND company_id = ?").get(orderId, companyId);
    if (!order)
        return null;
    const items = db
        .prepare(`SELECT oi.*, p.company_id AS product_company_id
       FROM order_items oi
       JOIN orders parent_order ON parent_order.id = oi.order_id AND parent_order.company_id = ?
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ? AND oi.company_id = parent_order.company_id AND p.company_id = ?`)
        .all(companyId, orderId, companyId);
    const variationItems = items.map((it) => {
        const v = db
            .prepare("SELECT company_id FROM product_variations WHERE id = ? AND company_id = ?")
            .get(it.variation_id, companyId);
        return { ...it, variation_company_id: v?.company_id ?? null };
    });
    if (variationItems.length !== items.length)
        return null;
    const mismatch = variationItems.some((it) => it.variation_company_id !== companyId || it.product_company_id !== companyId);
    if (mismatch)
        return null;
    return { order, items };
}
function buildOrderResult(orderId, companyId) {
    return db.prepare("SELECT * FROM orders WHERE id = ? AND company_id = ?").get(orderId, companyId);
}
router.patch("/:id/status", requireAuth, requireTenant, requireSubscriptionContext, (req, res) => {
    const companyId = req.user.company_id;
    const userId = req.user.id;
    const orderId = Number(req.params.id);
    const target = req.body?.status;
    if (!ORDER_STATUSES.includes(target)) {
        res.status(400).json({ error: "Status inválido." });
        return;
    }
    const tx = db.transaction(() => {
        const loaded = loadOrderWithItems(orderId, companyId);
        if (!loaded)
            return { status: 404, body: { error: "Pedido não encontrado." } };
        const order = loaded.order;
        const curIdx = STATUS_FLOW.indexOf(order.status);
        const tgtIdx = STATUS_FLOW.indexOf(target);
        if (order.status === target) {
            return { status: 200, body: buildOrderResult(order.id, companyId) };
        }
        const ts = now();
        /* ------------------------- Cancelamento ------------------------- */
        if (target === "cancelado") {
            if (order.status === "cancelado") {
                return { status: 400, body: { error: "O pedido já foi cancelado." } };
            }
            db.prepare("UPDATE orders SET status = 'cancelado' WHERE id = ? AND company_id = ?").run(order.id, companyId);
            if (curIdx > STATUS_FLOW.indexOf("novo")) {
                const refund = db.prepare(`INSERT INTO stock_movements (variation_id, product_id, type, quantity, stock_before, stock_after, reason, user_id, company_id, sale_id, order_id, created_at)
           VALUES (?, ?, 'entrada', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`);
                for (const it of loaded.items) {
                    const v = db
                        .prepare("SELECT stock, company_id FROM product_variations WHERE id = ? AND company_id = ?")
                        .get(it.variation_id, companyId);
                    if (!v || v.company_id !== companyId)
                        continue;
                    db.prepare("UPDATE product_variations SET stock = stock + ? WHERE id = ? AND company_id = ?").run(it.quantity, it.variation_id, companyId);
                    refund.run(it.variation_id, it.product_id, it.quantity, v.stock, v.stock + it.quantity, `Cancelamento de pedido #${String(order.id).padStart(4, "0")}`, userId ?? null, companyId, order.id, ts);
                }
            }
            return { status: 200, body: buildOrderResult(order.id, companyId) };
        }
        /* ------------------------- Avanço de status ------------------------- */
        if (tgtIdx !== curIdx + 1) {
            return { status: 400, body: { error: "Transição de status inválida para este pedido." } };
        }
        if (target === "confirmado") {
            const fetched = loaded.items.map((it) => {
                const v = db
                    .prepare(`SELECT v.id, v.stock, v.company_id, p.company_id AS product_company_id,
                    col.name AS color_name, s.name AS size_name
             FROM product_variations v
        JOIN products p ON p.id = v.product_id
             JOIN colors col ON col.id = v.color_id
             JOIN sizes s ON s.id = v.size_id
             WHERE v.id = ? AND v.company_id = ? AND p.company_id = ?`)
                    .get(it.variation_id, companyId, companyId);
                return { it, v };
            });
            const shortages = fetched
                .filter((f) => !f.v ||
                f.v.company_id !== companyId ||
                f.v.product_company_id !== companyId ||
                f.v.stock < f.it.quantity)
                .map((f) => {
                if (!f.v || f.v.company_id !== companyId || f.v.product_company_id !== companyId) {
                    return `${f.it.product_name} — produto indisponível`;
                }
                return `${f.it.product_name} (${f.v.color_name}/${f.v.size_name}) — disponível: ${f.v.stock}`;
            });
            if (shortages.length > 0) {
                return { status: 400, body: { error: "Estoque insuficiente para: " + shortages.join("; ") } };
            }
            const saleMovement = db.prepare(`INSERT INTO stock_movements (variation_id, product_id, type, quantity, stock_before, stock_after, reason, user_id, company_id, sale_id, order_id, created_at)
         VALUES (?, ?, 'venda_online', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`);
            for (const f of fetched) {
                db.prepare("UPDATE product_variations SET stock = stock - ? WHERE id = ? AND company_id = ?").run(f.it.quantity, f.it.variation_id, companyId);
                saleMovement.run(f.it.variation_id, f.it.product_id, f.it.quantity, f.v.stock, f.v.stock - f.it.quantity, `Pedido online #${String(order.id).padStart(4, "0")}`, userId ?? null, companyId, order.id, ts);
            }
        }
        db.prepare("UPDATE orders SET status = ? WHERE id = ? AND company_id = ?").run(target, order.id, companyId);
        return { status: 200, body: buildOrderResult(order.id, companyId) };
    });
    try {
        const result = tx();
        res.status(result.status).json(result.body);
    }
    catch (err) {
        res.status(400).json({ error: err?.message ?? "Não foi possível atualizar o pedido." });
    }
});
export default router;
