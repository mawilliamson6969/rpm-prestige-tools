/** Browser calls `/api/...` (Nginx → Express). Local dev: set NEXT_PUBLIC_API_URL to Express origin (no `/api` prefix). */
export function ownerTerminationBasePath(): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
  if (base) return `${base}/forms/owner-termination`;
  return "/api/forms/owner-termination";
}
