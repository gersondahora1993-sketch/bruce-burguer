import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import type { AuthUser, TenantContext } from "./types.js";
import { env } from "./config.js";
import { db } from "./db.js";
import { getCurrentSubscription } from "./billing.js";

const SECRET = env.jwtSecret;

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, role: user.role, company_id: user.company_id }, SECRET, { expiresIn: "12h" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Não autenticado. Faça login para continuar." });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), SECRET) as jwt.JwtPayload;
    const id = Number(payload.id);
    const tokenCompanyId = Number.isSafeInteger(Number(payload.company_id)) ? Number(payload.company_id) : null;
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(401).json({ error: "Token inválido. Faça login novamente." });
      return;
    }
    req.auth = {
      id,
      tokenRole: typeof payload.role === "string" ? payload.role : null,
      tokenCompanyId,
    };
    next();
  } catch {
    res.status(401).json({ error: "Sessão expirada. Faça login novamente." });
  }
}

export function requireTenant(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: "Não autenticado. Faça login para continuar." });
    return;
  }

  const current = db
    .prepare(
      `SELECT u.id, u.role, u.active, u.company_id,
              c.id AS tenant_id, c.name AS tenant_name, c.slug AS tenant_slug, c.status AS tenant_status
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
        WHERE u.id = ?`,
    )
    .get(req.auth.id) as
    | {
        id: number;
        role: string;
        active: number;
        company_id: number | null;
        tenant_id: number | null;
        tenant_name: string | null;
        tenant_slug: string | null;
        tenant_status: TenantContext["status"] | null;
      }
    | undefined;

  if (!current || !current.active) {
    res.status(401).json({ error: "Usuário desativado ou não encontrado." });
    return;
  }
  if (!current.company_id || !current.tenant_id || !current.tenant_name || !current.tenant_slug || !current.tenant_status) {
    res.status(403).json({ error: "Empresa do usuário não encontrada." });
    return;
  }

  req.user = { id: current.id, role: current.role, company_id: current.company_id };
  req.tenant = {
    id: current.tenant_id,
    name: current.tenant_name,
    slug: current.tenant_slug,
    status: current.tenant_status,
  };
  next();
}

export function requireSubscriptionContext(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next();
    return;
  }
  req.subscription = getCurrentSubscription(req.user.company_id);
  next();
}

export function requireSubscription(req: Request, res: Response, next: NextFunction): void {
  const subscription = req.subscription ?? (req.user ? getCurrentSubscription(req.user.company_id) : null);
  if (!subscription || !["trialing", "active", "past_due", "grace_period"].includes(subscription.status)) {
    res.status(403).json({ error: "A assinatura não permite acesso a esta operação." });
    return;
  }
  req.subscription = subscription;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Você não tem permissão para realizar esta ação." });
      return;
    }
    next();
  };
}
