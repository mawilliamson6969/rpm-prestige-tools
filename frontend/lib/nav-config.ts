import {
  Home,
  Inbox,
  CheckSquare,
  MessageSquare,
  BarChart3,
  PieChart,
  TrendingUp,
  Wrench,
  Building2,
  Target,
  Flag,
  Calendar,
  Users,
  BookOpen,
  ClipboardList,
  FileText,
  Folder,
  Video,
  Edit3,
  Briefcase,
  Megaphone,
  Star,
  Mail,
  PenTool,
  Bot,
  Building,
  Shield,
  CreditCard,
  Globe,
  Phone,
  type LucideIcon,
} from "lucide-react";

export type NavBadgeKey = "inbox-unread" | "agents-queue" | "forms-pending";

export type NavItem = {
  /** Stable identifier — used for prefs (pin/hide/order) persistence. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Internal route. Mutually exclusive with `external`. */
  href?: string;
  /** External URL. Renders the up-right arrow + brand chip. */
  external?: string;
  /** Brand color for external app icon chip. */
  brandColor?: string;
  /** Live numeric badge keyed by API source. */
  badge?: NavBadgeKey;
  /** Admin-only — hidden for non-admin users. */
  adminOnly?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
  /** Group starts collapsed unless overridden in user prefs. */
  defaultClosed?: boolean;
};

/* ============================================================
   PINNED — always visible at the top of the sidebar.
   Per design: Home / Inbox / My Tasks. We add Ask the AI as a
   pinned utility (locked-in user decision).
   ============================================================ */
export const NAV_PINNED: NavItem[] = [
  { id: "hub",     label: "Home",       icon: Home,         href: "/" },
  { id: "inbox",   label: "Inbox",      icon: Inbox,        href: "/inbox", badge: "inbox-unread" },
  { id: "myTasks", label: "My Tasks",   icon: CheckSquare,  href: "/operations/my-tasks" },
  { id: "ask",     label: "Ask the AI", icon: MessageSquare, href: "/ask" },
];

/* ============================================================
   GROUPS — collapsible, each holds related routes.
   Growth & Team is split per user direction:
     - Operations  (internal coordination)
     - Growth      (outreach + sales)
   ============================================================ */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "dashboards",
    label: "Dashboards",
    items: [
      { id: "dash-executive",   label: "Executive",   icon: BarChart3,  href: "/dashboard?tab=executive" },
      { id: "dash-maintenance", label: "Maintenance", icon: Wrench,     href: "/dashboard?tab=maintenance" },
      { id: "dash-finance",     label: "Finance",     icon: PieChart,   href: "/dashboard?tab=finance" },
      { id: "dash-portfolio",   label: "Portfolio",   icon: Building2,  href: "/dashboard?tab=portfolio" },
      { id: "dash-leasing",     label: "Leasing",     icon: TrendingUp, href: "/dashboard?tab=leasing" },
    ],
  },
  {
    id: "eos",
    label: "EOS",
    items: [
      { id: "eos-scorecard",   label: "Scorecard",            icon: Target,   href: "/eos/scorecard" },
      { id: "eos-scorecards",  label: "Individual Scorecards", icon: Target,   href: "/eos/scorecards" },
      { id: "eos-rocks",       label: "Rocks",                icon: Flag,     href: "/eos/rocks" },
      { id: "eos-l10",         label: "L10 Meetings",         icon: Calendar, href: "/eos/l10" },
    ],
  },
  {
    id: "library",
    label: "Library",
    items: [
      { id: "wiki",      label: "Company Wiki", icon: BookOpen,       href: "/wiki" },
      { id: "playbooks", label: "Playbooks",    icon: ClipboardList,  href: "/playbooks" },
      { id: "documents", label: "Documents",    icon: FileText,       href: "/documents" },
      { id: "files",     label: "Files",        icon: Folder,         href: "/files" },
      { id: "videos",    label: "Videos",       icon: Video,          href: "/videos" },
      { id: "forms",     label: "Forms",        icon: Edit3,          href: "/forms", badge: "forms-pending" },
    ],
  },
  {
    id: "dashboards",
    label: "Dashboards",
    items: [
      { id: "dash-triage",   label: "Triage",            icon: Flag,          href: "/dashboards/triage" },
      { id: "dash-calendar", label: "Calendar",          icon: Calendar,      href: "/dashboards/calendar" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { id: "ops-tasks",     label: "Tasks",             icon: CheckSquare,   href: "/operations/tasks" },
      { id: "ops-projects",  label: "Projects",          icon: Briefcase,     href: "/operations/projects" },
      { id: "ops-processes", label: "Processes",         icon: ClipboardList, href: "/operations/processes" },
      { id: "ops-renewals",  label: "Renewals (Beta)",   icon: Calendar,      href: "/operations/boards/renewals" },
      { id: "ops-templates", label: "Templates",         icon: FileText,      href: "/operations/templates",      adminOnly: true },
      { id: "ops-boards",    label: "Manage Boards",     icon: ClipboardList, href: "/operations/boards/manage",  adminOnly: true },
      { id: "ops-sub-templates", label: "Subitem Templates", icon: FileText, href: "/operations/boards/templates/manage", adminOnly: true },
      { id: "walkthru",      label: "Walk-Thru Reports", icon: ClipboardList, href: "/admin/walkthru",            adminOnly: true },
    ],
  },
  {
    id: "growth",
    label: "Growth",
    items: [
      { id: "agents",        label: "AI Agents",          icon: Bot,         href: "/agents", badge: "agents-queue" },
      { id: "agentHub",      label: "Agent Hub",          icon: Users,       href: "/agent-hub" },
      { id: "marketing",     label: "Marketing Calendar", icon: Megaphone,   href: "/marketing/calendar" },
      { id: "reviews",       label: "Reviews",            icon: Star,        href: "/reviews" },
      { id: "mailers",       label: "Mailers",            icon: Mail,        href: "/mailers" },
      { id: "esign",         label: "E-Signatures",       icon: PenTool,     href: "/esign" },
      { id: "announcements", label: "Announcements",      icon: Megaphone,   href: "/announcements" },
    ],
  },
  {
    id: "apps",
    label: "External Apps",
    items: [
      { id: "ext-appfolio",   label: "AppFolio",     icon: Building, external: "https://rpmtx033.appfolio.com",            brandColor: "#1B2856" },
      { id: "ext-leadsimple", label: "LeadSimple",   icon: ClipboardList, external: "https://app.leadsimple.com",         brandColor: "#0098D0" },
      { id: "ext-rentengine", label: "RentEngine",   icon: TrendingUp, external: "https://app.rentengine.io/owner/default", brandColor: "#7A5AE0" },
      { id: "ext-blanket",    label: "Blanket",      icon: Shield, external: "https://rpmprestige.blankethomes.com/pm",     brandColor: "#1F8A5B" },
      { id: "ext-boom",       label: "Boom",         icon: CreditCard, external: "https://www.boompay.app/",                brandColor: "#B32317" },
      { id: "ext-intranet",   label: "RPM Intranet", icon: Globe, external: "https://rpmintranet.com/login",                 brandColor: "#6A737B" },
      { id: "ext-website",    label: "Our Website",  icon: Globe, external: "https://www.prestigerpm.com/",                  brandColor: "#1B2856" },
      { id: "ext-openphone",  label: "OpenPhone",    icon: Phone, external: "https://app.openphone.com",                     brandColor: "#7A5AE0" },
    ],
  },
];

/** Flat lookup of every nav item by id, for active-state + prefs use. */
export const ALL_NAV_ITEMS: NavItem[] = [
  ...NAV_PINNED,
  ...NAV_GROUPS.flatMap((g) => g.items),
];

export const NAV_ITEM_BY_ID: Map<string, NavItem> = new Map(
  ALL_NAV_ITEMS.map((it) => [it.id, it])
);

/**
 * Resolve the active nav item id from a Next.js pathname (and optional `tab`
 * search param for /dashboard). Returns the most-specific matching item, or
 * null if nothing matches.
 */
export function resolveActiveNavId(pathname: string, tab: string | null): string | null {
  if (!pathname || pathname === "/") return "hub";

  // Dashboard tabs are distinct items.
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    const tabId = `dash-${tab || "executive"}`;
    if (NAV_ITEM_BY_ID.has(tabId)) return tabId;
    return "dash-executive";
  }

  // Find the longest internal-href match.
  let best: { id: string; len: number } | null = null;
  for (const it of ALL_NAV_ITEMS) {
    if (!it.href) continue;
    const href = it.href.split("?")[0];
    if (href === "/") continue; // handled above
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (!best || href.length > best.len) {
        best = { id: it.id, len: href.length };
      }
    }
  }
  return best?.id ?? null;
}

/**
 * Lowercase, trimmed search query helper used by sidebar live-filter.
 * Returns true when the item matches OR when query is empty.
 */
export function navItemMatches(item: NavItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.label.toLowerCase().includes(q);
}
