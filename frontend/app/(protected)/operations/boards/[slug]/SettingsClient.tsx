"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, Plus, Trash2, Info } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import styles from "./settings.module.css";

/**
 * Phase 7.5 — Settings tab (closes the last per-process stub).
 *
 * Frontend-only. Wired to existing routes:
 *   GET  /processes/templates                  (resolve slug → template)
 *   PUT  /processes/templates/:id              (identity / SLA / behavior)
 *   GET/POST /processes/templates/:id/roles    (process type roles)
 *   DELETE /processes/process-type-roles/:id
 *
 * The design's SettingsStub lists "owners, SLA defaults, default
 * starting stage, version history, permissions". Of those, identity /
 * SLA / aging / assignment+duplication rules / roles are backed by the
 * schema and editable here. Version history is not modeled — called
 * out honestly rather than faked.
 */

interface Template {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  color: string | null;
  estimatedDays: number | null;
  isActive: boolean;
  agingGreenHours: number;
  agingYellowHours: number;
  assignmentRule: string;
  duplicationRule: string;
}

interface Role {
  id: number;
  roleName: string;
  isRequired: boolean;
}

const COLOR_SWATCHES = [
  "#1B2856",
  "#0098D0",
  "#3D8C49",
  "#D89A2F",
  "#B32317",
  "#7E4FBF",
  "#2D7A6C",
  "#6A737B",
];
const ASSIGNMENT_RULES = [
  { v: "manual", l: "Manual" },
  { v: "round_robin", l: "Round-robin" },
  { v: "least_busy", l: "Least busy" },
];
const DUP_RULES = [
  { v: "none", l: "Allow duplicates" },
  { v: "skip", l: "Skip if duplicate" },
  { v: "block", l: "Block duplicates" },
];

export default function SettingsClient({ slug }: { slug: string }) {
  const { authHeaders, token, isAdmin } = useAuth();
  const [tpl, setTpl] = useState<Template | null>(null);
  const [form, setForm] = useState<Template | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newRole, setNewRole] = useState("");
  const [newRoleReq, setNewRoleReq] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const tRes = await fetch(apiUrl("/processes/templates"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!tRes.ok) throw new Error("Could not load templates.");
      const tBody = await tRes.json();
      const m = (tBody.templates || []).find(
        (t: Record<string, unknown>) => t.slug === slug
      );
      if (!m) throw new Error(`No process template matches "${slug}".`);
      const t: Template = {
        id: Number(m.id),
        name: String(m.name ?? ""),
        description: (m.description as string | null) ?? null,
        category: (m.category as string | null) ?? null,
        icon: (m.icon as string | null) ?? "📋",
        color: (m.color as string | null) ?? "#0098D0",
        estimatedDays: m.estimatedDays != null ? Number(m.estimatedDays) : 14,
        isActive: m.isActive !== false,
        agingGreenHours: Number(m.agingGreenHours ?? 48),
        agingYellowHours: Number(m.agingYellowHours ?? 96),
        assignmentRule: String(m.assignmentRule ?? "manual"),
        duplicationRule: String(m.duplicationRule ?? "none"),
      };
      setTpl(t);
      setForm(t);

      const rRes = await fetch(apiUrl(`/processes/templates/${t.id}/roles`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      }).catch(() => null);
      const rBody = rRes && rRes.ok ? await rRes.json() : { roles: [] };
      setRoles(
        (rBody.roles || []).map((r: Record<string, unknown>) => ({
          id: Number(r.id),
          roleName: String(r.roleName ?? r.role_name ?? ""),
          isRequired: Boolean(r.isRequired ?? r.is_required),
        }))
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, slug, token]);

  useEffect(() => {
    load();
  }, [load]);

  function set<K extends keyof Template>(k: K, v: Template[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setSaved(false);
  }

  async function saveForm() {
    if (!form || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/processes/templates/${form.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: form.name,
          description: form.description ?? "",
          category: form.category ?? "",
          icon: form.icon ?? "📋",
          color: form.color ?? "#0098D0",
          estimatedDays: form.estimatedDays ?? 14,
          isActive: form.isActive,
          agingGreenHours: form.agingGreenHours,
          agingYellowHours: form.agingYellowHours,
          assignmentRule: form.assignmentRule,
          duplicationRule: form.duplicationRule,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not save settings.");
      }
      setTpl(form);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  async function addRole() {
    if (!tpl || busy || !newRole.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/processes/templates/${tpl.id}/roles`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ roleName: newRole.trim(), isRequired: newRoleReq }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not add role.");
      }
      setNewRole("");
      setNewRoleReq(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add role.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRole(id: number) {
    if (busy || !window.confirm("Remove this role?")) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/processes/process-type-roles/${id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not remove role.");
      }
      setRoles((cur) => cur.filter((r) => r.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove role.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !form) {
    return <div data-pms className={styles.loading}>Loading settings…</div>;
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(tpl);
  const ro = !isAdmin;

  return (
    <div data-pms className={styles.root}>
      <div className={styles.header}>
        <div>
          <div className={`${styles.eyebrow} pms-cond`}>{tpl?.name ?? slug}</div>
          <h1 className={`${styles.title} pms-cond`}>General Settings</h1>
          <p className={styles.sub}>
            Identity, SLA defaults, assignment behavior, and the roles this process expects.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={saveForm}
            disabled={busy || !dirty}
          >
            <Save size={14} /> {saved && !dirty ? "Saved" : "Save changes"}
          </button>
        )}
      </div>

      {err && <div className={styles.err}>{err}</div>}

      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHead}>Identity</div>
          <div className={styles.cardBody}>
            <Field label="Name">
              <input
                className={styles.input}
                value={form.name}
                disabled={ro}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label="Description">
              <textarea
                className={styles.textarea}
                rows={3}
                value={form.description ?? ""}
                disabled={ro}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
            <div className={styles.row2}>
              <Field label="Category">
                <input
                  className={styles.input}
                  value={form.category ?? ""}
                  disabled={ro}
                  onChange={(e) => set("category", e.target.value)}
                />
              </Field>
              <Field label="Icon">
                <input
                  className={styles.input}
                  value={form.icon ?? ""}
                  disabled={ro}
                  maxLength={4}
                  onChange={(e) => set("icon", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Color">
              <div className={styles.swatchRow}>
                {COLOR_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={styles.swatch}
                    style={{
                      background: c,
                      outline: c === form.color ? "2px solid var(--pms-ink)" : "none",
                    }}
                    disabled={ro}
                    onClick={() => set("color", c)}
                    aria-label={c}
                  />
                ))}
              </div>
            </Field>
            <Field label="Status">
              <button
                type="button"
                className={`${styles.statusToggle} ${form.isActive ? styles.statusLive : styles.statusDraft}`}
                disabled={ro}
                onClick={() => set("isActive", !form.isActive)}
              >
                {form.isActive ? "● LIVE" : "○ DRAFT"}
              </button>
            </Field>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>SLA &amp; aging</div>
          <div className={styles.cardBody}>
            <Field label="Target duration (days)">
              <input
                className={styles.input}
                type="number"
                value={form.estimatedDays ?? 14}
                disabled={ro}
                onChange={(e) => set("estimatedDays", Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Card stays green for (hours)">
              <input
                className={styles.input}
                type="number"
                value={form.agingGreenHours}
                disabled={ro}
                onChange={(e) => set("agingGreenHours", Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Card turns red after (hours)">
              <input
                className={styles.input}
                type="number"
                value={form.agingYellowHours}
                disabled={ro}
                onChange={(e) => set("agingYellowHours", Number(e.target.value) || 0)}
              />
            </Field>
            <p className={styles.hint}>
              Cards on the board age green → yellow → red as a process sits without progress.
            </p>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>Behavior</div>
          <div className={styles.cardBody}>
            <Field label="Assignment rule">
              <select
                className={styles.input}
                value={form.assignmentRule}
                disabled={ro}
                onChange={(e) => set("assignmentRule", e.target.value)}
              >
                {ASSIGNMENT_RULES.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Duplicate handling">
              <select
                className={styles.input}
                value={form.duplicationRule}
                disabled={ro}
                onChange={(e) => set("duplicationRule", e.target.value)}
              >
                {DUP_RULES.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
            </Field>
            <div className={styles.deferred}>
              <Info size={13} /> Version history isn&rsquo;t modeled yet — deferred.
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>Roles &amp; permissions</div>
          <div className={styles.cardBody}>
            {roles.length === 0 ? (
              <div className={styles.empty}>No roles defined for this process.</div>
            ) : (
              <div className={styles.roleList}>
                {roles.map((r) => (
                  <div key={r.id} className={styles.roleRow}>
                    <span className={styles.roleName}>{r.roleName}</span>
                    {r.isRequired && <span className={styles.reqTag}>required</span>}
                    {isAdmin && (
                      <button
                        type="button"
                        className={styles.roleDel}
                        onClick={() => deleteRole(r.id)}
                        disabled={busy}
                        title="Remove role"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {isAdmin && (
              <div className={styles.addRole}>
                <input
                  className={styles.input}
                  placeholder="Role name (e.g. PM, Inspector)…"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addRole();
                  }}
                />
                <label className={styles.reqToggle}>
                  <input
                    type="checkbox"
                    checked={newRoleReq}
                    onChange={(e) => setNewRoleReq(e.target.checked)}
                  />
                  Required
                </label>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnLight}`}
                  onClick={addRole}
                  disabled={busy || !newRole.trim()}
                >
                  <Plus size={13} /> Add
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}
