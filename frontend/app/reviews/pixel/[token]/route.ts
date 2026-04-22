import { apiUrl } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const clean = token.replace(/\.png$/i, "");
  const res = await fetch(apiUrl(`/reviews/pixel/${encodeURIComponent(clean)}.png`), {
    cache: "no-store",
  });
  const buf = await res.arrayBuffer();
  return new Response(buf, {
    status: res.status,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
