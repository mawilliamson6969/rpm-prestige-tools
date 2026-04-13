/** Same key as `AuthContext` — JWT stored in `localStorage` for media URLs that cannot send `Authorization`. */
export const AUTH_TOKEN_STORAGE_KEY = "rpm_auth_token";

/** Append `token` query param when present (backend allows it only on video stream and thumbnail). */
export function apiUrlWithAuthQuery(path: string, token: string | null | undefined): string {
  const base = apiUrl(path);
  const t = token?.trim();
  if (!t) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(t)}`;
}

/** Browser calls `/api/...` (Nginx → Express). Local dev: set NEXT_PUBLIC_API_URL to Express origin (no `/api` prefix). */
export function ownerTerminationBasePath(): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
  if (base) return `${base}/forms/owner-termination`;
  return "/api/forms/owner-termination";
}

/**
 * Express paths like `/dashboard/executive` (no `/api` in env base).
 * Production: same-origin `/api/...` → Nginx → Express.
 * Dev without env: direct to `http://localhost:4000`.
 */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (base) return `${base}${p}`;
  if (process.env.NODE_ENV === "development") {
    return `http://localhost:4000${p}`;
  }
  return `/api${p}`;
}
