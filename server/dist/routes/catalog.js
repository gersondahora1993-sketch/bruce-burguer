import { Router } from "express";
import { db } from "../db.js";
function isMissingRequiredValue(value) {
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}
export function catalogRouter(table, fields, sortColumns, extraInsert, tenantAware = false) {
    const router = Router();
    const columns = fields.map((f) => f.column);
    function companyId(req) {
        if (!tenantAware)
            return null;
        const id = Number(req.user?.company_id);
        return Number.isSafeInteger(id) && id > 0 ? id : null;
    }
    router.get("/", (req, res) => {
        const { includeInactive } = req.query;
        const tenantId = companyId(req);
        if (tenantAware && tenantId === null) {
            res.status(401).json({ error: "Tenant não identificado." });
            return;
        }
        const activeClause = includeInactive === "1" ? "" : " WHERE active = 1";
        const tenantClause = tenantAware ? `${activeClause ? " AND" : " WHERE"} company_id = ?` : "";
        const rows = db
            .prepare(`SELECT * FROM ${table}${activeClause}${tenantClause} ORDER BY ${sortColumns}`)
            .all(...(tenantAware ? [tenantId] : []));
        res.json(rows);
    });
    router.get("/all", (req, res) => {
        const tenantId = companyId(req);
        if (tenantAware && tenantId === null) {
            res.status(401).json({ error: "Tenant não identificado." });
            return;
        }
        const tenantClause = tenantAware ? " WHERE company_id = ?" : "";
        res.json(db.prepare(`SELECT * FROM ${table}${tenantClause} ORDER BY ${sortColumns}`).all(...(tenantAware ? [tenantId] : [])));
    });
    router.post("/", (req, res) => {
        const body = req.body ?? {};
        const data = [];
        for (const f of fields) {
            const raw = body[f.column];
            if (isMissingRequiredValue(raw)) {
                if (f.required) {
                    res.status(400).json({ error: `Informe ${f.label}.` });
                    return;
                }
                data.push(f.default ?? "");
                continue;
            }
            data.push(f.type === "int" ? Number(raw) : String(raw).trim());
        }
        const tenantId = companyId(req);
        if (tenantAware && tenantId === null) {
            res.status(401).json({ error: "Tenant não identificado." });
            return;
        }
        const allColumns = [...columns, ...(tenantAware ? ["company_id"] : []), ...(extraInsert ? [extraInsert.column] : [])];
        const placeholders = [
            ...columns.map(() => "?"),
            ...(tenantAware ? ["?"] : []),
            ...(extraInsert ? [extraInsert.valueSql] : []),
        ];
        const values = [
            ...data,
            ...(tenantAware ? [tenantId] : []),
            ...(extraInsert?.valueParams ? extraInsert.valueParams(req) : []),
        ];
        try {
            const info = db
                .prepare(`INSERT INTO ${table} (${allColumns.join(", ")}) VALUES (${placeholders.join(", ")})`)
                .run(...values);
            res.status(201).json({ id: Number(info.lastInsertRowid) });
        }
        catch (err) {
            if (String(err?.message ?? err).includes("UNIQUE")) {
                res.status(400).json({ error: `J├í existe um registro com este valor.` });
                return;
            }
            res.status(400).json({ error: "N├úo foi poss├¡vel salvar o registro." });
        }
    });
    router.put("/:id", (req, res) => {
        const id = Number(req.params.id);
        if (!id) {
            res.status(400).json({ error: "Registro inv├ílido." });
            return;
        }
        const body = req.body ?? {};
        const sets = [];
        const values = [];
        for (const f of fields) {
            const raw = body[f.column];
            if (isMissingRequiredValue(raw)) {
                if (f.required) {
                    res.status(400).json({ error: `Informe ${f.label}.` });
                    return;
                }
            }
            else {
                sets.push(`${f.column} = ?`);
                values.push(f.type === "int" ? Number(raw) : String(raw).trim());
            }
        }
        if (sets.length === 0) {
            res.status(400).json({ error: "Nenhum dado para atualizar." });
            return;
        }
        try {
            const tenantId = companyId(req);
            if (tenantAware && tenantId === null) {
                res.status(401).json({ error: "Tenant não identificado." });
                return;
            }
            const info = db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?${tenantAware ? " AND company_id = ?" : ""}`).run(...values, id, ...(tenantAware ? [tenantId] : []));
            if (info.changes === 0) {
                res.status(404).json({ error: "Registro nao encontrado." });
                return;
            }
            res.json({ ok: true });
        }
        catch (err) {
            if (String(err?.message ?? err).includes("UNIQUE")) {
                res.status(400).json({ error: `J├í existe um registro com este valor.` });
                return;
            }
            res.status(400).json({ error: "N├úo foi poss├¡vel atualizar o registro." });
        }
    });
    router.patch("/:id/status", (req, res) => {
        const id = Number(req.params.id);
        const tenantId = companyId(req);
        if (tenantAware && tenantId === null) {
            res.status(401).json({ error: "Tenant não identificado." });
            return;
        }
        if (!Number.isInteger(id) || id <= 0) {
            res.status(400).json({ error: "Registro invalido." });
            return;
        }
        const active = req.body?.active ? 1 : 0;
        const info = db.prepare(`UPDATE ${table} SET active = ? WHERE id = ?${tenantAware ? " AND company_id = ?" : ""}`).run(active, id, ...(tenantAware ? [tenantId] : []));
        if (info.changes === 0) {
            res.status(404).json({ error: "Registro n├úo encontrado." });
            return;
        }
        res.json({ ok: true });
    });
    router.delete("/:id", (req, res) => {
        const id = Number(req.params.id);
        const tenantId = companyId(req);
        if (tenantAware && tenantId === null) {
            res.status(401).json({ error: "Tenant não identificado." });
            return;
        }
        if (!Number.isInteger(id) || id <= 0) {
            res.status(400).json({ error: "Registro invalido." });
            return;
        }
        try {
            const info = db.prepare(`DELETE FROM ${table} WHERE id = ?${tenantAware ? " AND company_id = ?" : ""}`).run(id, ...(tenantAware ? [tenantId] : []));
            if (info.changes === 0) {
                res.status(404).json({ error: "Registro nao encontrado." });
                return;
            }
            res.json({ ok: true });
        }
        catch {
            res.status(400).json({ error: "Este registro est├í em uso e n├úo pode ser exclu├¡do. Desative-o." });
        }
    });
    return router;
}
