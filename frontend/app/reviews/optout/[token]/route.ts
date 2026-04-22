import { apiUrl } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const res = await fetch(apiUrl(`/reviews/optout/${encodeURIComponent(token)}`), {
    cache: "no-store",
  });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
