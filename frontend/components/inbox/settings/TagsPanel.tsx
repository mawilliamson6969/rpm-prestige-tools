"use client";

import { useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import useTagDefinitions, { type TagDefinition } from "../../../hooks/inbox/useTagDefinitions";
import styles from "./settings.module.css";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export default function TagsPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const { tags, loading, error, create, update, remove } = useTagDefinitions();

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6A737B");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  return (
    <>
      <header className={styles.hd}>
        <div>
          <h1 className={styles.title}>Tags</h1>
          <p className={styles.sub}>
            Catalog of tag names used to categorize conversations. Threads
            can also be tagged with names not in this list — the catalog
            just controls colors + descriptions for the tag pickers.
          </p>
        </div>
        <div className={styles.hdActions}>
          {isAdmin ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setShowNew((s) => !s)}
            >
              {showNew ? "Cancel" : "+ New tag"}
            </button>
          ) : null}
        </div>
      </header>

      {showNew && isAdmin ? (
        <div className={styles.card} style={{ marginBottom: 16, padding: 14 }}>
          <div className={styles.formRow}>
            <input
              className={styles.input}
              placeholder="Tag name (e.g. urgent, renewal)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ width: 220 }}
              autoFocus
            />
            <input
              type="color"
              className={styles.tagColorInput}
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              aria-label="Color"
            />
            <input
              className={styles.input}
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}
            />
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={!newName.trim() || creating || !HEX_COLOR_RE.test(newColor)}
              onClick={async () => {
                setCreating(true);
                setCreateErr(null);
                const r = await create({
                  name: newName.trim(),
                  color: newColor,
                  description: newDesc.trim() || null,
                });
                setCreating(false);
                if (r.ok) {
                  setNewName("");
                  setNewDesc("");
                  setNewColor("#6A737B");
                  setShowNew(false);
                } else {
                  setCreateErr(r.error ?? "Create failed.");
                }
              }}
            >
              {creating ? "Saving…" : "Create"}
            </button>
          </div>
          {createErr ? (
            <div style={{ marginTop: 8, color: "#B32317", fontSize: 12 }}>{createErr}</div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className={styles.empty}>Couldn&rsquo;t load tags — {error}.</div>
      ) : loading && tags.length === 0 ? (
        <div className={styles.empty}>Loading tags…</div>
      ) : tags.length === 0 ? (
        <div className={styles.empty}>No tags yet.</div>
      ) : (
        <div className={styles.card}>
          {tags.map((t) => (
            <TagRow
              key={t.id}
              tag={t}
              isAdmin={isAdmin}
              update={update}
              remove={remove}
            />
          ))}
        </div>
      )}
    </>
  );
}

function TagRow({
  tag,
  isAdmin,
  update,
  remove,
}: {
  tag: TagDefinition;
  isAdmin: boolean;
  update: ReturnType<typeof useTagDefinitions>["update"];
  remove: ReturnType<typeof useTagDefinitions>["remove"];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [desc, setDesc] = useState(tag.description ?? "");
  const [saving, setSaving] = useState(false);

  if (editing && isAdmin) {
    return (
      <div className={styles.tagRow}>
        <input
          type="color"
          className={styles.tagColorInput}
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Color"
        />
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: 180 }}
        />
        <input
          className={styles.input}
          placeholder="Description"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          type="button"
          className={styles.btn}
          onClick={() => {
            setName(tag.name);
            setColor(tag.color);
            setDesc(tag.description ?? "");
            setEditing(false);
          }}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={saving || !name.trim() || !HEX_COLOR_RE.test(color)}
          onClick={async () => {
            setSaving(true);
            const r = await update(tag.id, {
              name: name.trim(),
              color,
              description: desc.trim() || null,
            });
            setSaving(false);
            if (r.ok) setEditing(false);
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.tagRow}>
      <span className={styles.tagSwatch} style={{ background: tag.color }} aria-hidden />
      <div className={styles.tagName}>
        {tag.name}
        {tag.description ? <div className={styles.tagDesc}>{tag.description}</div> : null}
      </div>
      <span className={styles.tagUsage}>
        {tag.usage_count} {tag.usage_count === 1 ? "thread" : "threads"}
      </span>
      {isAdmin ? (
        <div className={styles.tableRowAction}>
          <button type="button" className={styles.btn} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={async () => {
              if (
                !window.confirm(
                  `Delete tag "${tag.name}"? Existing threads keep the tag name; only the catalog entry is removed.`
                )
              )
                return;
              await remove(tag.id);
            }}
            title="Delete"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
