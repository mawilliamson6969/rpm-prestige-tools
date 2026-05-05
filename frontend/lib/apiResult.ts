export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

const STATUS_FALLBACKS: Record<number, string> = {
  400: "That request couldn't be processed.",
  401: "You're not signed in.",
  403: "You don't have permission to do that.",
  404: "We couldn't find that.",
  408: "The request timed out.",
  409: "That conflicts with something else — try refreshing.",
  413: "That attachment is too large.",
  422: "Some fields are invalid.",
  429: "Too many requests. Slow down a moment.",
  500: "The server hit an error.",
  502: "The server is unreachable right now.",
  503: "The server is temporarily unavailable.",
  504: "The server took too long to respond.",
};

function statusFallback(status: number): string {
  if (STATUS_FALLBACKS[status]) return STATUS_FALLBACKS[status];
  if (status >= 500) return "The server hit an error.";
  if (status >= 400) return "That request couldn't be processed.";
  return "Request failed.";
}

/** Pulls an `error` string out of a JSON body, falling back to a status-keyed message. */
export function parseApiError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const maybe = (body as Record<string, unknown>).error;
    if (typeof maybe === "string" && maybe.trim()) return maybe;
    const msg = (body as Record<string, unknown>).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return statusFallback(status);
}

/** "Couldn't reach the server" / network-level failures. */
export function networkErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    if (err.name === "AbortError") return "Request was cancelled.";
    return err.message;
  }
  return "Couldn't reach the server.";
}
