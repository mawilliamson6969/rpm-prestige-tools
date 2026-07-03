"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Users } from "lucide-react";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import styles from "./techs.module.css";
import type { Tech } from "./types";

function fmtRate(r: number | null): string {
  return r == null ? "—" : `$${r.toFixed(2)}/hr`;
}

export default function TechsClient() {
  const { authHeaders, token } = useAuth();
  const [techs, setTechs] = useState<Tech[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tech | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (showInactive) params.set("active", "all");
      const res = await fetch(apiUrl(`/maintenance/techs?${params.toString()}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      }
      setTechs(body.techs || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load techs.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Techs</h1>
          <p className={styles.subtitle}>
            Internal maintenance roster — trade skills, hourly rates, and
            availability.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={load} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus size={14} /> New Tech
          </button>
        </div>
      </header>

      <div className={styles.searchRow}>
        <button
          type="button"
          className={`${styles.chip} ${!showInactive ? styles.chipActive : ""}`}
          onClick={() => setShowInactive(false)}
        >
          Active
        </button>
        <button
          type="button"
          className={`${styles.chip} ${showInactive ? styles.chipActive : ""}`}
          onClick={() => setShowInactive(true)}
        >
          All
        </button>
      </div>

      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      <div className={styles.card}>
        {loading ? (
          <div className={styles.loading}>Loading techs…</div>
        ) : techs.length === 0 ? (
          <div className={styles.empty}>
            <Users size={28} color="var(--text-secondary, #6a737b)" />
            <p>No techs yet. Add your first crew member.</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Skills</th>
                  <th>Rate</th>
                  <th>Contact</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {techs.map((t) => (
                  <tr
                    key={t.id}
                    className={styles.rowLink}
                    onClick={() => {
                      setEditing(t);
                      setModalOpen(true);
                    }}
                  >
                    <td>
                      <strong>{t.name}</strong>
                    </td>
                    <td>
                      {t.tradeSkills.length ? (
                        t.tradeSkills.slice(0, 4).map((s) => (
                          <span key={s} className={styles.tag}>
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={t.hourlyRate == null ? styles.muted : ""}>{fmtRate(t.hourlyRate)}</td>
                    <td className={t.phone || t.email ? "" : styles.muted}>
                      {t.phone || t.email || "—"}
                    </td>
                    <td>
                      <span className={t.isActive ? styles.statusOn : styles.statusOff}>
                        {t.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TechModal
        open={modalOpen}
        tech={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          load();
        }}
      />
    </div>
  );
}

function TechModal({
  open,
  tech,
  onClose,
  onSaved,
}: {
  open: boolean;
  tech: Tech | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { authHeaders } = useAuth();
  const isEdit = !!tech;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [skills, setSkills] = useState("");
  const [rate, setRate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setName(tech?.name ?? "");
    setEmail(tech?.email ?? "");
    setPhone(tech?.phone ?? "");
    setSkills((tech?.tradeSkills ?? []).join(", "));
    setRate(tech?.hourlyRate != null ? String(tech.hourlyRate) : "");
    setIsActive(tech?.isActive ?? true);
  }, [open, tech]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Name is required.");
      return;
    }
    if (rate.trim() && !(Number(rate) >= 0)) {
      setErr("Rate must be a non-negative number.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        tradeSkills: skills
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        hourlyRate: rate.trim() ? Number(rate) : null,
        isActive,
      };
      const res = await fetch(
        isEdit && tech ? apiUrl(`/maintenance/techs/${tech.id}`) : apiUrl("/maintenance/techs"),
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Save failed.");
      }
      onSaved();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not save tech.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{isEdit ? "Edit Tech" : "New Tech"}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className={styles.modalBody} onSubmit={submit}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          <div className={styles.field}>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className={styles.field}>
            <label>
              Trade skills <span className={styles.hint}>(comma-separated)</span>
            </label>
            <input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="HVAC, Plumbing, Drywall"
            />
          </div>
          <div className={styles.field}>
            <label>Hourly rate (USD)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="45.00"
            />
          </div>
          <div className={styles.checkRow}>
            <input
              id="active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <label htmlFor="active">Active (available for scheduling)</label>
          </div>
          <div className={styles.formFooter}>
            <button type="button" className={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
