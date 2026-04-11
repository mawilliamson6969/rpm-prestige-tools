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
