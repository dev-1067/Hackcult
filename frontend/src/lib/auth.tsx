import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, loadSession, onSessionChange, saveSession, type Session } from "./api";
import type { Role, User } from "./types";

const RANK: Record<Role, number> = { viewer: 0, contributor: 1, curator: 2, admin: 3 };

interface AuthState {
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => void;
  updateUser: (u: User) => void;
  can: (role: Role) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => loadSession()?.user ?? null);

  useEffect(() => onSessionChange((s) => setUser(s?.user ?? null)), []);

  // Re-validate a stored session on load (role or account status may have changed).
  useEffect(() => {
    if (!loadSession()) return;
    api
      .get<User>("/auth/me")
      .then((u) => {
        const s = loadSession();
        if (s) saveSession({ ...s, user: u });
      })
      .catch(() => undefined);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const s = await api.post<Session>("/auth/login", { email, password });
    saveSession(s);
    return s.user;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const s = await api.post<Session>("/auth/register", { name, email, password });
    saveSession(s);
    return s.user;
  }, []);

  const logout = useCallback(() => saveSession(null), []);

  const updateUser = useCallback((u: User) => {
    const s = loadSession();
    if (s) saveSession({ ...s, user: u });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      login,
      register,
      logout,
      updateUser,
      can: (role: Role) => !!user && RANK[user.role] >= RANK[role],
    }),
    [user, login, register, logout, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
