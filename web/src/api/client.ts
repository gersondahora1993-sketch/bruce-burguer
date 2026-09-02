const TOKEN_KEY = "nyellen_token";

const API_BASE = (
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_URL ?? ""
).replace(/\/+$/, "");

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Não foi possível conectar ao servidor. Verifique se a API está rodando.", 0);
  }

  if (response.status === 401 && path !== "/api/auth/login") {
    clearToken();
    window.location.href = "/login";
    throw new ApiError("Sessão expirada.", 401);
  }

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    /* sem corpo */
  }

  if (!response.ok) {
    const message =
      payload?.error || (typeof payload?.message === "string" ? payload.message : "Algo deu errado. Tente novamente.");
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  uploadImage: async <T>(path: string, file: Blob): Promise<T> => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    headers["Content-Type"] = file.type || "application/octet-stream";

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: file });
    } catch {
      throw new ApiError("Não foi possível conectar ao servidor. Verifique se a API está rodando.", 0);
    }

    if (response.status === 401) {
      clearToken();
      window.location.href = "/login";
      throw new ApiError("Sessão expirada.", 401);
    }

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      /* sem corpo */
    }

    if (!response.ok) {
      const message =
        payload?.error || (typeof payload?.message === "string" ? payload.message : "Algo deu errado. Tente novamente.");
      throw new ApiError(message, response.status);
    }
    return payload as T;
  },
};