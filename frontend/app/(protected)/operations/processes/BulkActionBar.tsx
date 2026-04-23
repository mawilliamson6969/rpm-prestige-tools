"use client";

import { useState } from "react";
import styles from "../operations.module.css";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import type { TeamUser } from "../types";

type Props = {
  selectedIds: number[];
  onClear: () => void;
  onRefresh: () => void;
  users: TeamUser[];
  stages: Array<{ id: number; name: string }>;
};

export default function BulkActionBar({
  selectedIds,
  onClear,
  onRefresh,
  users,
  stages,
}: Props) {
  const { authHeaders } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!selectedIds.length) return null;

  const doBulkStage = async (stageId: number) => {
    setBusy(true);
    try {
      await fetch(apiUrl("/processes/bulk/stage"), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ processIds: selectedIds, stageId }),
      });
      onRefresh();
      onClear();
    } finally {
      setBusy(false);
    }
  };

  const doBulkAssign = async (userId: number) => {
    setBusy(true);
    try {
      await fetch(apiUrl("/processes/bulk/assign"), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ processIds: selectedIds, userId }),
      });
      onRefresh();
      onClear();
    } finally {
      setBusy(false);
    }
  };

  const doBulkArchive = async () => {
    if (!confirm(`Archive ${selectedIds.length} process(es)?`)) return;
    setBusy(true);
    try {
      await fetch(apiUrl("/processes/bulk/archive"), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ processIds: selectedIds }),
      });
      onRefresh();
      onClear();
    } finally {
      setBusy(false);
    }
  };

  const doBulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.length} process(es)? They can be restored within 30 days.`)) return;
    setBusy(true);
    try {
      await fetch(apiUrl("/processes/bulk"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ processIds: selectedIds }),
      });
      onRefresh();
      onClear();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.bulkBar}>
      <span className={styles.bulkCount}>{selectedIds.length}</span>
      <span style={{ fontSize: "0.82rem" }}>selected</span>
      {stages.length ? (
        <select
          className={styles.bulkBtn}
          disabled={busy}
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) doBulkStage(Number(e.target.value));
            e.target.value = "";
          }}
        >
          <option value="">Move to stage…</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}
      <select
        className={styles.bulkBtn}
        disabled={busy}
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) doBulkAssign(Number(e.target.value));
          e.target.value = "";
        }}
      >
        <option value="">Assign to…</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName}
          </option>
        ))}
      </select>
      <button type="button" className={styles.bulkBtn} disabled={busy} onClick={doBulkArchive}>
        📁 Archive
      </button>
      <button
        type="button"
        className={`${styles.bulkBtn} ${styles.bulkBtnDanger}`}
        disabled={busy}
        onClick={doBulkDelete}
      >
        🗑 Delete
      </button>
      <button type="button" className={styles.bulkBtn} onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
