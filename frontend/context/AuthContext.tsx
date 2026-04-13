"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiUrl, AUTH_TOKEN_STORAGE_KEY } from "../lib/api";

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "viewer";
};

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  authHeaders: () => Record<string, string>;
  isAdmin: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async (t: string) => {
    const res = await fetch(apiUrl("/auth/me"), {
      headers: { Authorization: `Bearer ${t}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error("Session expired.");
    }
    const body = await res.json();
    const u = body.user;
    if (!u) throw new Error("Invalid session.");
    setUser({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    setToken(t);
    if (!t) {
      setLoading(false);
      return;
    }
    refreshUser(t)
      .catch(() => {
        localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(apiUrl("/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof body.error === "string" ? body.error : "Sign in failed.");
    }
    const t = body.token as string | undefined;
    const u = body.user;
    if (!t || !u) throw new Error("Invalid response from server.");
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, t);
    setToken(t);
    setUser({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
    });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const authHeaders = useCallback((): Record<string, string> => {
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      loading,
      login,
      logout,
      refreshUser: async () => {
        const t = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
        if (!t) return;
        await refreshUser(t);
      },
      authHeaders,
      isAdmin: user?.role === "admin",
    }),
    [token, user, loading, login, logout, refreshUser, authHeaders]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Wraps segments that require any authenticated user. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { token, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (loading) return;
    if (!token) {
      const q = searchParams?.toString();
      const returnUrl = `${pathname || "/"}${q ? `?${q}` : ""}`;
      router.replace(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
    }
  }, [loading, token, router, pathname, searchParams]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "40vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#6a737b",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Loading…
      </div>
    );
  }
  if (!token) return null;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading, token } = useAuth();

  if (loading || !token) {
    return (
      <div style={{ minHeight: "40vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading…
      </div>
    );
  }
  if (user?.role !== "admin") {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ color: "#1b2856" }}>Access denied</h1>
        <p style={{ color: "#6a737b" }}>This area is restricted to administrators.</p>
      </main>
    );
  }
  return <>{children}</>;
}

/** Admins only; non-admins are redirected to /dashboard (use for admin-only tools). */
export function RequireAdminRedirect({ children }: { children: ReactNode }) {
  const { user, loading, token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !token) return;
    if (user?.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [loading, token, user, router]);

  if (loading || !token) {
    return (
      <div
        style={{
          minHeight: "40vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#6a737b",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Loading…
      </div>
    );
  }
  if (user?.role !== "admin") {
    return null;
  }
  return <>{children}</>;
}
