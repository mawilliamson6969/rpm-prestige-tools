export type CardSize = "small" | "medium" | "large";

export type HubCardLayout = {
  cardId: string;
  visible: boolean;
  order: number;
  size: CardSize;
  section: string;
};

export type HubWidgetLayout = {
  widgetId: string;
  visible: boolean;
  order: number;
  size: CardSize;
  config: Record<string, unknown>;
};

export type LayoutPrefs = {
  hubLayout: HubCardLayout[];
  sidebarOrder: string[];
  sidebarCollapsed: string[];
  sidebarPinned: string[];
  sidebarHidden: string[];
  hubWidgets: HubWidgetLayout[];
};

export type HubCardDef = {
  id: string;
  title: string;
  description: string;
  href?: string;
  external?: boolean;
  section: string;
  icon?: string;
  adminOnly?: boolean;
  component?: "agents" | "wiki" | "playbook" | "files" | "inbox" | "videos";
};

export const DEFAULT_HUB_CARDS: HubCardDef[] = [
  {
    id: "dashboard",
    title: "KPI Dashboard",
    description: "Live AppFolio data: doors, occupancy, property breakdown",
    href: "/dashboard",
    section: "Dashboards",
    icon: "📊",
  },
  {
    id: "agents",
    title: "AI Agents",
    description: "Manage automated leasing, maintenance, accounting, and reporting agents.",
    href: "/agents",
    section: "AI & Automation",
    icon: "🤖",
    component: "agents",
  },
  {
    id: "ask_ai",
    title: "Ask the AI",
    description:
      "Ask any question about your properties, tenants, work orders, or finances and get instant answers",
    href: "/ask",
    section: "AI & Automation",
    icon: "💬",
  },
  {
    id: "operations",
    title: "Operations Hub",
    description: "📋 Task management, projects, process workflows, and team operations",
    href: "/operations/tasks",
    section: "Operations",
    icon: "🗂️",
  },
  {
    id: "wiki",
    title: "Wiki",
    description: "Company knowledge base, SOPs, and policies",
    href: "/wiki",
    section: "Knowledge Base",
    icon: "📚",
    component: "wiki",
  },
  {
    id: "playbooks",
    title: "Playbooks",
    description: "Operational playbooks and SOPs",
    href: "/playbooks",
    section: "Knowledge Base",
    icon: "📋",
    component: "playbook",
  },
  {
    id: "files",
    title: "Files",
    description: "Shared company file manager",
    href: "/files",
    section: "Tools",
    icon: "📁",
    component: "files",
  },
  {
    id: "inbox",
    title: "Shared Inbox",
    description: "Unified email for tenants, owners, vendors",
    href: "/inbox",
    section: "Communications",
    icon: "📧",
    component: "inbox",
  },
  {
    id: "videos",
    title: "Video Messages",
    description: "Record and share video messages with the team",
    href: "/videos",
    section: "Communications",
    icon: "🎬",
    component: "videos",
  },
  {
    id: "marketing",
    title: "Marketing Calendar",
    description: "Plan and schedule content across all channels",
    href: "/marketing/calendar",
    section: "Marketing",
    icon: "📅",
  },
  {
    id: "eos_scorecard",
    title: "EOS Scorecard",
    description: "Track weekly and monthly measurables",
    href: "/eos/scorecard",
    section: "EOS",
    icon: "📈",
  },
  {
    id: "forms",
    title: "Form Builder",
    description: "📋 Create, share, and manage custom forms",
    href: "/forms",
    section: "Forms",
    icon: "📝",
  },
  {
    id: "walkthru",
    title: "Walk-Thru Reports",
    description: "Digital move-in/move-out property condition reports",
    href: "/admin/walkthru",
    section: "Forms",
    icon: "📝",
    adminOnly: true,
  },
  {
    id: "reviews",
    title: "Review Manager",
    description: "Google review management, request campaigns, and team leaderboard",
    href: "/reviews",
    section: "Marketing",
    icon: "⭐",
  },
];

export const DEFAULT_HUB_LAYOUT: HubCardLayout[] = DEFAULT_HUB_CARDS.map((c, i) => ({
  cardId: c.id,
  visible: true,
  order: i,
  size: "medium",
  section: c.section,
}));

export type WidgetDef = {
  id: string;
  name: string;
  description: string;
  icon: string;
  defaultSize: CardSize;
  defaultConfig: Record<string, unknown>;
};

export const WIDGET_LIBRARY: WidgetDef[] = [
  {
    id: "my_tasks",
    name: "My Tasks",
    description: "Your most urgent tasks and to-dos",
    icon: "📋",
    defaultSize: "large",
    defaultConfig: { limit: 5 },
  },
  {
    id: "quick_stat",
    name: "Quick Stat",
    description: "Single KPI metric with trend indicator",
    icon: "📊",
    defaultSize: "small",
    defaultConfig: { metric: "occupancy_rate" },
  },
  {
    id: "recent_activity",
    name: "Recent Activity",
    description: "Latest actions across the platform",
    icon: "🔔",
    defaultSize: "medium",
    defaultConfig: { limit: 10 },
  },
  {
    id: "open_work_orders",
    name: "Open Work Orders",
    description: "Current work order summary",
    icon: "🔧",
    defaultSize: "medium",
    defaultConfig: {},
  },
  {
    id: "delinquency_summary",
    name: "Delinquency Summary",
    description: "Outstanding balances and aging",
    icon: "💰",
    defaultSize: "medium",
    defaultConfig: {},
  },
  {
    id: "lease_expirations",
    name: "Lease Expirations",
    description: "Upcoming lease renewals needed",
    icon: "📅",
    defaultSize: "medium",
    defaultConfig: {},
  },
  {
    id: "unread_inbox",
    name: "Unread Inbox",
    description: "Unread email count and recent messages",
    icon: "📧",
    defaultSize: "medium",
    defaultConfig: {},
  },
  {
    id: "active_processes",
    name: "Active Processes",
    description: "Running processes by type",
    icon: "⚙️",
    defaultSize: "medium",
    defaultConfig: {},
  },
  {
    id: "announcements",
    name: "Announcements",
    description: "Team announcements",
    icon: "📢",
    defaultSize: "medium",
    defaultConfig: { limit: 3 },
  },
  {
    id: "recent_submissions",
    name: "Recent Submissions",
    description: "Latest form submissions",
    icon: "📝",
    defaultSize: "medium",
    defaultConfig: { limit: 5 },
  },
];

export const QUICK_STAT_METRICS: { value: string; label: string }[] = [
  { value: "occupancy_rate", label: "Occupancy Rate" },
  { value: "total_doors", label: "Total Doors" },
  { value: "vacant_units", label: "Vacant Units" },
  { value: "total_delinquency", label: "Total Delinquency" },
  { value: "open_work_orders", label: "Open Work Orders" },
  { value: "active_processes", label: "Active Processes" },
  { value: "active_leads", label: "Active Leads" },
  { value: "revenue_mtd", label: "Revenue MTD" },
  { value: "profit_margin", label: "Profit Margin" },
  { value: "avg_rent", label: "Avg Rent" },
];

export type SidebarNavItem = {
  id: string;
  type: "link" | "dropdown";
  label: string;
  icon: string;
  href?: string;
  section?: "tools" | "external" | "admin" | "primary";
  adminOnly?: boolean;
};

export const DEFAULT_SIDEBAR_ITEMS: SidebarNavItem[] = [
  { id: "hub", type: "link", label: "Hub", icon: "🏠", href: "/", section: "primary" },
  { id: "dashboard", type: "dropdown", label: "Dashboard", icon: "📊", section: "primary" },
  { id: "inbox", type: "link", label: "Inbox", icon: "📧", href: "/inbox", section: "primary" },
  { id: "agents", type: "link", label: "Agents", icon: "🤖", href: "/agents", section: "primary" },
  { id: "eos", type: "dropdown", label: "EOS", icon: "📈", section: "tools" },
  { id: "operations", type: "dropdown", label: "Operations", icon: "🗂️", section: "tools" },
  { id: "ask", type: "link", label: "Ask the AI", icon: "💬", href: "/ask", section: "tools" },
  { id: "videos", type: "link", label: "Videos", icon: "🎬", href: "/videos", section: "tools" },
  { id: "wiki", type: "link", label: "Wiki", icon: "📚", href: "/wiki", section: "tools" },
  { id: "playbooks", type: "link", label: "Playbooks", icon: "📋", href: "/playbooks", section: "tools" },
  { id: "files", type: "link", label: "Files", icon: "📁", href: "/files", section: "tools" },
  { id: "forms", type: "link", label: "Forms", icon: "📋", href: "/forms", section: "tools" },
  { id: "marketing", type: "link", label: "Marketing", icon: "📅", href: "/marketing/calendar", section: "tools" },
  { id: "reviews", type: "link", label: "Reviews", icon: "⭐", href: "/reviews", section: "tools" },
];

export const DEFAULT_PREFS: LayoutPrefs = {
  hubLayout: DEFAULT_HUB_LAYOUT,
  sidebarOrder: DEFAULT_SIDEBAR_ITEMS.map((i) => i.id),
  sidebarCollapsed: [],
  sidebarPinned: [],
  sidebarHidden: [],
  hubWidgets: [],
};

export function mergePrefs(saved: Partial<LayoutPrefs> | null | undefined): LayoutPrefs {
  if (!saved) return DEFAULT_PREFS;
  const hubLayout = Array.isArray(saved.hubLayout) && saved.hubLayout.length > 0
    ? saved.hubLayout
    : DEFAULT_PREFS.hubLayout;
  const sidebarOrder = Array.isArray(saved.sidebarOrder) && saved.sidebarOrder.length > 0
    ? saved.sidebarOrder
    : DEFAULT_PREFS.sidebarOrder;
  return {
    hubLayout,
    sidebarOrder,
    sidebarCollapsed: Array.isArray(saved.sidebarCollapsed) ? saved.sidebarCollapsed : [],
    sidebarPinned: Array.isArray(saved.sidebarPinned) ? saved.sidebarPinned : [],
    sidebarHidden: Array.isArray(saved.sidebarHidden) ? saved.sidebarHidden : [],
    hubWidgets: Array.isArray(saved.hubWidgets) ? saved.hubWidgets : [],
  };
}
