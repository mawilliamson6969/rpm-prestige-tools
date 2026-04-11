"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useMemo, useState } from "react";

const NAVY = "#1B2856";
const LIGHT_BLUE = "#0098D0";
const GREY = "#6A737B";
const WHITE = "#FFFFFF";
const OFF_WHITE = "#F5F5F5";

type FormStatus = "live" | "coming-soon";

type FormItem = {
  title: string;
  href: string;
  description: string;
  status: FormStatus;
};

type Category = {
  id: string;
  title: string;
  forms: FormItem[];
};

const CATEGORIES: Category[] = [
  {
    id: "owner",
    title: "Owner Services",
    forms: [
      {
        title: "Owner Request to Terminate Management",
        href: "/owner-termination",
        description: "Submit or process an owner's request to terminate property management services",
        status: "live",
      },
      {
        title: "Owner Onboarding Form",
        href: "/owner-onboarding",
        description: "New owner intake form for property details, contact info, and management preferences",
        status: "coming-soon",
      },
      {
        title: "Owner Feedback Survey",
        href: "/owner-survey",
        description: "Share your experience with our management services",
        status: "coming-soon",
      },
    ],
  },
  {
    id: "tenant",
    title: "Tenant Services",
    forms: [
      {
        title: "Maintenance Request",
        href: "/maintenance-request",
        description: "Report a maintenance issue at your property",
        status: "coming-soon",
      },
      {
        title: "Tenant Pre-Screening",
        href: "/tenant-prescreening",
        description: "Pre-qualification questionnaire for prospective tenants",
        status: "coming-soon",
      },
      {
        title: "Move-Out Inspection",
        href: "/move-out-inspection",
        description: "Document property condition at move-out",
        status: "coming-soon",
      },
    ],
  },
  {
    id: "vendor",
    title: "Vendor Management",
    forms: [
      {
        title: "Vendor Registration",
        href: "/vendor-registration",
        description: "Register as an approved vendor with RPM Prestige",
        status: "coming-soon",
      },
    ],
  },
  {
    id: "internal",
    title: "Internal / Staff",
    forms: [
      {
        title: "Mileage Log",
        href: "/mileage-log",
        description: "Log business mileage for reimbursement and tax records",
        status: "coming-soon",
      },
    ],
  },
];

function matchesQuery(form: FormItem, categoryTitle: string, q: string): boolean {
  if (!q.trim()) return true;
  const s = q.trim().toLowerCase();
  return (
    form.title.toLowerCase().includes(s) ||
    form.description.toLowerCase().includes(s) ||
    categoryTitle.toLowerCase().includes(s)
  );
}

function Badge({ status }: { status: FormStatus }) {
  if (status === "live") {
    return (
      <span
        style={{
          fontSize: "0.72rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          padding: "0.25rem 0.55rem",
          borderRadius: 6,
          background: "#e8f5e9",
          color: "#1b5e20",
          border: "1px solid #a5d6a7",
        }}
      >
        Live
      </span>
    );
  }
  return (
    <span
      style={{
        fontSize: "0.72rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        padding: "0.25rem 0.55rem",
        borderRadius: 6,
        background: "#eceff1",
        color: GREY,
        border: "1px solid #cfd8dc",
      }}
    >
      Coming Soon
    </span>
  );
}

export default function FormsHub() {
  const [query, setQuery] = useState("");

  const visibleCategories = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      ...cat,
      forms: cat.forms.filter((f) => matchesQuery(f, cat.title, query)),
    })).filter((cat) => cat.forms.length > 0);
  }, [query]);

  const cardBase: CSSProperties = {
    borderRadius: 12,
    padding: "1.15rem 1.25rem",
    border: `1px solid rgba(27, 40, 86, 0.12)`,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minHeight: 120,
    transition: "box-shadow 0.2s ease, border-color 0.2s ease, transform 0.2s ease",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: OFF_WHITE,
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        color: NAVY,
      }}
    >
      <header
        style={{
          background: `linear-gradient(180deg, ${WHITE} 0%, ${OFF_WHITE} 100%)`,
          borderBottom: `1px solid rgba(27, 40, 86, 0.08)`,
          padding: "clamp(1.5rem, 4vw, 2.5rem) clamp(1rem, 4vw, 2.5rem) 1.75rem",
        }}
      >
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.8rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: LIGHT_BLUE,
            }}
          >
            Real Property Management Prestige
          </p>
          <h1 style={{ margin: "0.5rem 0 0", fontSize: "clamp(1.5rem, 4vw, 2rem)", fontWeight: 800, color: NAVY }}>
            Forms &amp; Documents
          </h1>
          <p style={{ margin: "0.65rem 0 0", fontSize: "1.05rem", color: GREY, maxWidth: 520, lineHeight: 1.5 }}>
            Submit and manage company forms securely
          </p>

          <label htmlFor="forms-search" className="sr-only">
            Search forms
          </label>
          <div style={{ marginTop: "1.5rem", maxWidth: 420 }}>
            <input
              id="forms-search"
              type="search"
              placeholder="Search forms…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "0.65rem 0.9rem",
                fontSize: "1rem",
                borderRadius: 10,
                border: `1px solid ${GREY}`,
                outline: "none",
                background: WHITE,
              }}
            />
          </div>
        </div>
      </header>

      <main style={{ flex: 1, padding: "1.5rem clamp(1rem, 4vw, 2.5rem) 3rem" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          {visibleCategories.length === 0 && (
            <p style={{ color: GREY, textAlign: "center", padding: "2rem" }}>No forms match your search.</p>
          )}
          {visibleCategories.map((cat) => (
            <section key={cat.id} style={{ marginBottom: "2.25rem" }}>
              <h2
                style={{
                  margin: "0 0 1rem",
                  fontSize: "1.05rem",
                  fontWeight: 700,
                  color: NAVY,
                  paddingBottom: 8,
                  borderBottom: `2px solid ${LIGHT_BLUE}`,
                }}
              >
                {cat.title}
              </h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: "1rem",
                }}
              >
                {cat.forms.map((form) => {
                  const isLive = form.status === "live";
                  const inner = (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, lineHeight: 1.35, color: isLive ? NAVY : GREY }}>
                          {form.title}
                        </h3>
                        <Badge status={form.status} />
                      </div>
                      <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.5, color: isLive ? GREY : "#8a9199", flex: 1 }}>
                        {form.description}
                      </p>
                    </>
                  );

                  if (isLive) {
                    return (
                      <Link
                        key={form.href}
                        href={form.href}
                        style={{
                          ...cardBase,
                          background: WHITE,
                          textDecoration: "none",
                          color: "inherit",
                          boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
                        }}
                        className="forms-hub-card-live"
                      >
                        {inner}
                      </Link>
                    );
                  }

                  return (
                    <div
                      key={form.href}
                      aria-disabled
                      style={{
                        ...cardBase,
                        background: "#f0f1f3",
                        opacity: 0.88,
                        cursor: "not-allowed",
                        pointerEvents: "none",
                        userSelect: "none",
                      }}
                    >
                      {inner}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </main>

      <footer
        style={{
          borderTop: `1px solid rgba(27, 40, 86, 0.1)`,
          padding: "1.25rem clamp(1rem, 4vw, 2rem)",
          background: WHITE,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: "0.88rem",
          color: GREY,
        }}
      >
        <span>© 2026 Real Property Management Prestige</span>
        <Link href="/admin/terminations" style={{ color: LIGHT_BLUE, fontWeight: 600, textDecoration: "none" }}>
          Admin
        </Link>
      </footer>
    </div>
  );
}
