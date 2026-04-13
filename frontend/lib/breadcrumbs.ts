import type { ReadonlyURLSearchParams } from "next/navigation";

export type Crumb = { label: string; href?: string };

function titleCaseSlug(s: string) {
  return s
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Human-readable breadcrumbs for the app chrome (pathname + optional dashboard tab).
 */
export function buildBreadcrumbs(pathname: string, searchParams: ReadonlyURLSearchParams | null): Crumb[] {
  const path = pathname || "/";
  const parts = path.split("/").filter(Boolean);

  if (path === "/" || parts.length === 0) {
    return [{ label: "Hub" }];
  }

  const out: Crumb[] = [{ label: "Hub", href: "/" }];

  const segLabel = (seg: string) => {
    const map: Record<string, string> = {
      dashboard: "Dashboard",
      inbox: "Inbox",
      agents: "Agents",
      queue: "Review queue",
      ask: "Ask the AI",
      videos: "Videos",
      wiki: "Wiki",
      files: "Files",
      marketing: "Marketing",
      calendar: "Calendar",
      eos: "EOS",
      scorecard: "Scorecard",
      rocks: "Rocks",
      l10: "L10 Meetings",
      meetings: "Meetings",
      admin: "Admin",
      users: "User Management",
      forms: "Form Submissions",
      signatures: "Email signatures",
      settings: "Settings",
      announcements: "Announcements",
      terminations: "Terminations",
      manage: "Manage",
      new: "New",
      edit: "Edit",
      owner: "Owner",
    };
    return map[seg.toLowerCase()] ?? titleCaseSlug(seg);
  };

  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    acc += `/${parts[i]}`;
    const isLast = i === parts.length - 1;
    const label = segLabel(parts[i]);
    if (isLast) {
      out.push({ label });
    } else {
      out.push({ label, href: acc });
    }
  }

  if (path.startsWith("/dashboard") && searchParams) {
    const tab = searchParams.get("tab");
    const tabLabels: Record<string, string> = {
      executive: "Executive",
      maintenance: "Maintenance",
      finance: "Finance",
      portfolio: "Portfolio",
      leasing: "Leasing",
      crm: "CRM",
    };
    if (tab && tabLabels[tab]) {
      const dashIdx = out.findIndex((c) => c.label === "Dashboard");
      if (dashIdx >= 0) {
        out.splice(dashIdx + 1, out.length - dashIdx - 1);
        out.push({ label: tabLabels[tab] });
      }
    }
  }

  return out;
}
