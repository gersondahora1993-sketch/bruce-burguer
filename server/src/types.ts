export interface AuthUser {
  id: number;
  role: string;
  company_id: number;
}

export interface AuthContext {
  id: number;
  tokenRole: string | null;
  tokenCompanyId: number | null;
}

export interface TenantContext {
  id: number;
  name: string;
  slug: string;
  status: "ativo" | "suspenso" | "cancelado";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      auth?: AuthContext;
      tenant?: TenantContext;
      subscription?: any | null;
    }
  }
}

export {};
