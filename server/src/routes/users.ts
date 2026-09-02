import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, now } from "../db.js";
import { requireRole } from "../auth.js";
import type { Request, Response } from "express";

const router = Router();

const ALLOWED_ROLES = ["admin", "vendedora", "funcionaria"];

router.use(requireRole("admin"));

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

router.get("/", (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const users = db
    .prepare(
      `SELECT id, name, email, role, active, created_at
         FROM users
        WHERE company_id = ?
        ORDER BY role = 'admin' DESC, name COLLATE NOCASE ASC`
    )
    .all(companyId);
  res.json(users);
});

router.post("/", (req: Request, res: Response) => {
  const body = req.body ?? {};
  const companyId = (req.user as any).company_id;
  const name = text(body.name);
  const email = text(body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const role = ALLOWED_ROLES.includes(body.role) ? body.role : "vendedora";

  if (!name) {
    res.status(400).json({ error: "Informe o nome do usuário." });
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: "Informe um e-mail válido." });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "A senha deve ter pelo menos 6 caracteres." });
    return;
  }

  const exists = db.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").get(email);
  if (exists) {
    res.status(400).json({ error: "Este e-mail já está em uso." });
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, active, company_id, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    )
    .run(name, email, bcrypt.hashSync(password, 10), role, companyId, now());
  res.status(201).json({
    id: Number(info.lastInsertRowid),
    name,
    email,
    role,
    active: 1,
  });
});

router.patch("/:id", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const companyId = (req.user as any).company_id;
  const body = req.body ?? {};

  const user = db
    .prepare("SELECT id, name, email, role, active FROM users WHERE id = ? AND company_id = ?")
    .get(id, companyId) as { id: number; name: string; email: string; role: string; active: number } | undefined;
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado." });
    return;
  }

  const name = typeof body.name === "string" ? body.name.trim() : user.name;
  if (!name) {
    res.status(400).json({ error: "Informe o nome do usuário." });
    return;
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : user.email;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: "Informe um e-mail válido." });
    return;
  }
  const role = body.role === undefined ? user.role : ALLOWED_ROLES.includes(body.role) ? body.role : user.role;
  const active = body.active === undefined ? user.active : body.active === true ? 1 : 0;

  if (id === (req.user as any).id && (role !== "admin" || active !== 1)) {
    res.status(400).json({ error: "Você não pode rebaixar ou desativar a si mesmo." });
    return;
  }

  const emailUsed = db.prepare("SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?").get(email, id);
  if (emailUsed) {
    res.status(400).json({ error: "Este e-mail já está em uso." });
    return;
  }

  db.prepare("UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ? AND company_id = ?").run(
    name,
    email,
    role,
    active,
    id,
    companyId
  );
  res.json({ id, name, email, role, active });
});

router.post("/:id/password", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const companyId = (req.user as any).company_id;
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (password.length < 6) {
    res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres." });
    return;
  }

  const info = db
    .prepare("UPDATE users SET password_hash = ? WHERE id = ? AND company_id = ?")
    .run(bcrypt.hashSync(password, 10), id, companyId);
  if (info.changes === 0) {
    res.status(404).json({ error: "Usuário não encontrado." });
    return;
  }
  res.json({ ok: true });
});

export default router;