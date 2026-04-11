"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import styles from "./login.module.css";

function safeReturnUrl(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

export default function LoginClient() {
  const { login, token, loading } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading || !token) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const next = safeReturnUrl(params.get("returnUrl"));
    router.replace(next);
  }, [loading, token, router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.brand}>Real Property Management Prestige</h1>
          <p className={styles.sub}>Team tools</p>
        </header>
        <div className={styles.main}>
          <p style={{ color: "#6a737b" }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.brand}>Real Property Management Prestige</h1>
        <p className={styles.sub}>Team tools — sign in</p>
      </header>

      <div className={styles.main}>
        <div className={styles.card}>
          <h2>Sign in</h2>
          <form onSubmit={onSubmit}>
            <div className={styles.field}>
              <label htmlFor="login-user">Username</label>
              <input
                id="login-user"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="login-pass">Password</label>
              <input
                id="login-pass"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}
            <button type="submit" className={styles.submit} disabled={submitting}>
              {submitting ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>
      </div>

      <footer className={styles.footer}>© {new Date().getFullYear()} RPM Prestige — internal use</footer>
    </div>
  );
}
