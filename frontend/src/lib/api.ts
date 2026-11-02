import type { User } from "./types";

const STORAGE_KEY = "lipisetu-auth";
export const API = "/api/v1";

export interface Session {
  access_token: string;
  refresh_token: string;
  user: User;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode): session lives in memory only */
  }
  listeners.forEach((fn) => fn(s));
}

type Listener = (s: Session | null) => void;
const listeners = new Set<Listener>();
export function onSessionChange(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  const s = loadSession();
  if (!s?.refresh_token) return false;
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${API}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      if (!r.ok) return false;
      saveSession((await r.json()) as Session);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

async function toError(r: Response): Promise<ApiError> {
  try {
    const body = await r.json();
    return new ApiError(r.status, body?.error?.code ?? "error", body?.error?.message ?? r.statusText);
  } catch {
    return new ApiError(r.status, "error", r.status >= 500 ? "The server is unavailable. Please try again." : r.statusText);
  }
}

export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const s = loadSession();
  const headers = new Headers(init.headers);
  if (s) headers.set("Authorization", `Bearer ${s.access_token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let r: Response;
  try {
    r = await fetch(path.startsWith("/") && !path.startsWith(API) ? `${API}${path}` : path, { ...init, headers });
  } catch {
    throw new ApiError(0, "network", "Cannot reach the server. Check that the backend is running.");
  }
  if (r.status === 401 && retry && s && (await refresh())) {
    return request<T>(path, init, false);
  }
  if (r.status === 401 && s) {
    saveSession(null);
  }
  if (!r.ok) throw await toError(r);
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown, headers?: HeadersInit) =>
    request<T>(path, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body ?? {}), headers }),
  patch: <T,>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: (path: string) => request<void>(path, { method: "DELETE" }),
};

/** Download a protected file (adds the auth header, then saves via an object URL). */
export async function download(path: string, filename: string) {
  const s = loadSession();
  const r = await fetch(`${API}${path}`, { headers: s ? { Authorization: `Bearer ${s.access_token}` } : {} });
  if (!r.ok) throw await toError(r);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}
