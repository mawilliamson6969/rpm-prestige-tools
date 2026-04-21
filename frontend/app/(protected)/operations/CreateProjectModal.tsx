"use client";

import { useEffect, useState } from "react";
import styles from "./operations.module.css";
import PropertyPicker, { type SelectedProperty } from "../../../components/PropertyPicker";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import type { Project, TeamUser } from "./types";
import { PROJECT_CATEGORIES, PROJECT_COLORS, PROJECT_ICONS } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
  users: TeamUser[];
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function CreateProjectModal({ open, onClose, onCreated, users }: Props) {
  const { authHeaders, user } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Operations");
  const [icon, setIcon] = useState("📁");
  const [color, setColor] = useState("#0098D0");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  const [property, setProperty] = useState<SelectedProperty | null>(null);
  const [propertyOwnerHint, setPropertyOwnerHint] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(todayIso());
  const [targetDate, setTargetDate] = useState("");
  const [budget, setBudget] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setCategory("Operations");
    setIcon("📁");
    setColor("#0098D0");
    setOwnerUserId(String(user?.id ?? ""));
    setMemberIds(new Set(user?.id ? [user.id] : []));
    setProperty(null);
    setPropertyOwnerHint(null);
    setStartDate(todayIso());
    setTargetDate("");
    setBudget("");
    setTagsInput("");
    setErr(null);
  }, [open, user]);

  if (!open) return null;

  const toggleMember = (id: number) => {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Project name is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/projects"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          category,
          icon,
          color,
          ownerUserId: ownerUserId ? Number(ownerUserId) : undefined,
          memberUserIds: Array.from(memberIds),
          propertyName: property?.propertyName.trim() || undefined,
          propertyId: property?.propertyId ?? undefined,
          startDate: startDate || undefined,
          targetDate: targetDate || undefined,
          budget: budget ? Number(budget) : undefined,
          tags: tagsInput
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(typeof body.error === "string" ? body.error : "Could not create project.");
      onCreated(body.project);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create project.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>New Project</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className={styles.form} onSubmit={submit}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          <div className={styles.field}>
            <label>Project name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          <div className={styles.field}>
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {PROJECT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>Owner</label>
              <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
                <option value="">— None —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.field}>
            <label>Icon</label>
            <div className={styles.iconPicker}>
              {PROJECT_ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  className={`${styles.iconPickerBtn} ${i === icon ? styles.iconPickerBtnActive : ""}`}
                  onClick={() => setIcon(i)}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <label>Color</label>
            <div className={styles.colorPicker}>
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  style={{ background: c }}
                  className={`${styles.colorPickerBtn} ${c === color ? styles.colorPickerBtnActive : ""}`}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <label>Team members</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {users.map((u) => (
                <label
                  key={u.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.25rem 0.5rem",
                    border: memberIds.has(u.id)
                      ? "1px solid #0098d0"
                      : "1px solid rgba(27, 40, 86, 0.15)",
                    borderRadius: "999px",
                    fontSize: "0.82rem",
                    color: "#1b2856",
                    cursor: "pointer",
                    background: memberIds.has(u.id) ? "rgba(0,152,208,0.08)" : "#fff",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={memberIds.has(u.id)}
                    onChange={() => toggleMember(u.id)}
                    style={{ margin: 0 }}
                  />
                  {u.displayName}
                </label>
              ))}
            </div>
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>Target date</label>
              <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Budget (optional)</label>
              <input
                type="number"
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className={styles.field}>
              <label>Property (optional)</label>
              <PropertyPicker
                value={property}
                onChange={(p) => {
                  setProperty(p);
                  setPropertyOwnerHint(null);
                  if (p?.propertyId || p?.propertyName) {
                    // Fire-and-forget: fetch property context to show who the owner is.
                    (async () => {
                      try {
                        const url = p.propertyId
                          ? apiUrl(`/property-context/${p.propertyId}`)
                          : apiUrl(`/property-context/by-name/${encodeURIComponent(p.propertyName)}`);
                        const res = await fetch(url, {
                          headers: { ...authHeaders() },
                          cache: "no-store",
                        });
                        if (!res.ok) return;
                        const body = await res.json();
                        if (body.owner?.owner_name) {
                          setPropertyOwnerHint(
                            `Owner: ${body.owner.owner_name}${
                              body.owner.owner_email ? ` · ${body.owner.owner_email}` : ""
                            }`
                          );
                        }
                      } catch {
                        /* ignore */
                      }
                    })();
                  }
                }}
              />
              {propertyOwnerHint ? (
                <div style={{ fontSize: "0.75rem", color: "#6a737b", marginTop: "0.25rem" }}>
                  {propertyOwnerHint}
                </div>
              ) : null}
            </div>
          </div>
          <div className={styles.field}>
            <label>Tags (comma separated)</label>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="realtor, q2, priority"
            />
          </div>
          <div className={styles.formActions}>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
              {saving ? "Creating…" : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
