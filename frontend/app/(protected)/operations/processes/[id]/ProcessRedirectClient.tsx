"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/**
 * Reads the process's template, finds the template's slug, and
 * redirects to the unified URL pattern. Falls back to /renewals if
 * the slug can't be resolved (better than 404'ing the user).
 */
export default function ProcessRedirectClient({ legacyId }: { legacyId: string }) {
  const router = useRouter();
  const { authHeaders, token } = useAuth();

  useEffect(() => {
    if (!token) return;
    const id = Number(legacyId);
    if (!Number.isFinite(id) || id <= 0) {
      router.replace("/operations/boards/renewals");
      return;
    }
    (async () => {
      try {
        const res = await fetch(apiUrl(`/processes/${id}`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        if (!res.ok) {
          router.replace("/operations/boards/renewals");
          return;
        }
        const body = await res.json();
        const templateId = body.process?.templateId ?? body.process?.template_id;
        if (!templateId) {
          router.replace(`/operations/boards/renewals/items/${id}`);
          return;
        }
        const tRes = await fetch(apiUrl(`/processes/templates/${templateId}`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        if (!tRes.ok) {
          router.replace(`/operations/boards/renewals/items/${id}`);
          return;
        }
        const tBody = await tRes.json();
        const slug: string =
          (tBody.template?.slug as string | null) ?? "renewals";
        router.replace(`/operations/boards/${slug}/items/${id}`);
      } catch {
        router.replace("/operations/boards/renewals");
      }
    })();
  }, [authHeaders, legacyId, router, token]);

  return (
    <div style={{ padding: "2rem", color: "#6a737b", fontFamily: "system-ui" }}>
      Redirecting to the unified board…
    </div>
  );
}
