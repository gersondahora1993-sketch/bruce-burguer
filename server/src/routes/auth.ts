import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { signToken, requireAuth, requireTenant } from "../auth.js";

const router = Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    res.status(400).json({ error: "Informe e-mail e senha." });
    return;
  }
  const user = db
    .prepare("SELECT id, name, email, password_hash, role, active, company_id FROM users WHERE lower(email) = lower(?)")
    .get(email.trim()) as { id: number; name: string; email: string; password_hash: string; role: string; active: number; company_id: number } | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: "E-mail ou senha incorretos." });
    return;
  }
  if (!user.active) {
    res.status(403).json({ error: "Usuário desativado. Contate o administrador." });
    return;
  }
  const token = signToken({ id: user.id, role: user.role, company_id: user.company_id });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.get("/me", requireAuth, requireTenant, (req, res) => {
  const user = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?").get(req.user!.id);
  if (!user) {
    res.status(401).json({ error: "Usuário não encontrado." });
    return;
  }
  res.json(user);
});

router.put("/profile", requireAuth, requireTenant, (req, res) => {
  const { name, email } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Informe o nome." });
    return;
  }
  if (typeof email !== "string" || !email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
    res.status(400).json({ error: "Informe um e-mail válido." });
    return;
  }
  const exists = db.prepare("SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?").get(email.trim(), req.user!.id);
  if (exists) {
    res.status(400).json({ error: "Este e-mail já está em uso." });
    return;
  }
  db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(name.trim(), email.trim(), req.user!.id);
  res.json({ id: req.user!.id, name: name.trim(), email: email.trim() });
});

router.put("/password", requireAuth, requireTenant, (req, res) => {
  const { current, next } = req.body ?? {};
  if (typeof current !== "string" || typeof next !== "string" || !current || !next) {
    res.status(400).json({ error: "Informe a senha atual e a nova senha." });
    return;
  }
  if (next.length < 6) {
    res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres." });
    return;
  }
  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user!.id) as { password_hash: string };
  if (!bcrypt.compareSync(current, user.password_hash)) {
    res.status(400).json({ error: "Senha atual incorreta." });
    return;
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(next, 10), req.user!.id);
  res.json({ ok: true });
});

export default router;
