"use client";

import { useRef, useState } from "react";
import styles from "./operations.module.css";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import type { CustomFieldDefinition, TeamUser } from "./types";

type Props = {
  definition: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  users?: TeamUser[];
  entityType?: string;
  entityId?: number;
};

function asStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return String(v);
}

function asNum(v: unknown): number | "" {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

function asArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

function asObj<T extends object>(v: unknown, fallback: T): T {
  if (v && typeof v === "object" && !Array.isArray(v)) return { ...fallback, ...(v as T) };
  return fallback;
}

export default function CustomFieldEditor({
  definition,
  value,
  onChange,
  disabled,
  users = [],
  entityType,
  entityId,
}: Props) {
  const config = definition.fieldConfig || {};
  const required = definition.isRequired;
  const isEmpty = value === null || value === undefined || value === "" ||
    (Array.isArray(value) && value.length === 0);
  const missingClass = required && isEmpty ? styles.cfInputMissing : "";

  switch (definition.fieldType) {
    case "text":
      return (
        <input
          type="text"
          className={`${styles.cfInput} ${missingClass}`}
          value={asStr(value)}
          placeholder={definition.placeholder || ""}
          maxLength={config.maxLength}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "textarea":
      return (
        <textarea
          className={`${styles.cfTextarea} ${missingClass}`}
          value={asStr(value)}
          placeholder={definition.placeholder || ""}
          rows={config.rows || 4}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "number":
    case "currency":
    case "percentage": {
      const prefix =
        config.prefix ?? (definition.fieldType === "currency" ? "$" : "");
      const suffix =
        config.suffix ?? (definition.fieldType === "percentage" ? "%" : "");
      return (
        <div className={styles.cfPrefixWrap}>
          {prefix ? <span className={styles.cfPrefix}>{prefix}</span> : null}
          <input
            type="number"
            className={`${styles.cfInput} ${suffix ? styles.cfInputWithSuffix : ""} ${missingClass}`}
            value={asNum(value)}
            placeholder={definition.placeholder || ""}
            min={config.min}
            max={config.max}
            step={config.step ?? (definition.fieldType === "currency" ? 0.01 : 1)}
            disabled={disabled}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") onChange(null);
              else onChange(Number(raw));
            }}
          />
          {suffix ? <span className={styles.cfSuffix}>{suffix}</span> : null}
        </div>
      );
    }

    case "date":
      return (
        <input
          type="date"
          className={`${styles.cfInput} ${missingClass}`}
          value={asStr(value).slice(0, 10)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );

    case "datetime":
      return (
        <input
          type="datetime-local"
          className={`${styles.cfInput} ${missingClass}`}
          value={asStr(value).slice(0, 16)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );

    case "boolean": {
      const trueLabel = config.trueLabel || "Yes";
      const falseLabel = config.falseLabel || "No";
      return (
        <div className={styles.cfBoolean}>
          <button
            type="button"
            className={`${styles.cfBooleanBtn} ${value === true ? styles.cfBooleanBtnActive : ""}`}
            disabled={disabled}
            onClick={() => onChange(true)}
          >
            {trueLabel}
          </button>
          <button
            type="button"
            className={`${styles.cfBooleanBtn} ${value === false ? styles.cfBooleanBtnActive : ""}`}
            disabled={disabled}
            onClick={() => onChange(false)}
          >
            {falseLabel}
          </button>
        </div>
      );
    }

    case "select": {
      const options = config.options || [];
      return (
        <select
          className={`${styles.cfSelect} ${missingClass}`}
          value={asStr(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">
            {definition.placeholder || "— Select —"}
          </option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }

    case "multiselect": {
      const options = config.options || [];
      const selected = asArr(value);
      const toggle = (opt: string) => {
        if (disabled) return;
        const next = selected.includes(opt)
          ? selected.filter((x) => x !== opt)
          : [...selected, opt];
        onChange(next);
      };
      return (
        <div className={styles.cfChips}>
          {options.map((o) => (
            <button
              key={o}
              type="button"
              className={`${styles.cfChip} ${selected.includes(o) ? styles.cfChipActive : ""}`}
              onClick={() => toggle(o)}
              disabled={disabled}
            >
              {o}
            </button>
          ))}
        </div>
      );
    }

    case "email":
      return (
        <input
          type="email"
          className={`${styles.cfInput} ${missingClass}`}
          value={asStr(value)}
          placeholder={definition.placeholder || "name@example.com"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "phone":
      return (
        <input
          type="tel"
          className={`${styles.cfInput} ${missingClass}`}
          value={asStr(value)}
          placeholder={definition.placeholder || "555-555-5555"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "url":
      return (
        <input
          type="url"
          className={`${styles.cfInput} ${missingClass}`}
          value={asStr(value)}
          placeholder={definition.placeholder || "https://…"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "rating": {
      const max = config.max ?? 5;
      const current = Number(value) || 0;
      return (
        <div className={styles.cfRatingRow}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={`${styles.cfStar} ${n <= current ? styles.cfStarActive : ""}`}
              onClick={() => !disabled && onChange(n === current ? null : n)}
              disabled={disabled}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
            >
              {n <= current ? "★" : "☆"}
            </button>
          ))}
        </div>
      );
    }

    case "color":
      return (
        <input
          type="color"
          className={styles.cfInput}
          style={{ padding: 2, height: 40, width: 80 }}
          value={asStr(value) || "#0098D0"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "user": {
      const current = asStr(value);
      return (
        <select
          className={`${styles.cfSelect} ${missingClass}`}
          value={current}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— Unassigned —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
      );
    }

    case "property":
      return (
        <input
          type="text"
          className={`${styles.cfInput} ${missingClass}`}
          value={asObj(value, { propertyName: "" }).propertyName as string}
          placeholder={definition.placeholder || "Property name"}
          disabled={disabled}
          onChange={(e) => onChange({ propertyName: e.target.value, propertyId: null })}
        />
      );

    case "address": {
      const addr = asObj(value, { street: "", city: "", state: "", zip: "" });
      const update = (k: string, v: string) => onChange({ ...addr, [k]: v });
      return (
        <div className={styles.cfAddressGrid}>
          <input
            className={styles.cfInput}
            placeholder="Street"
            value={addr.street}
            onChange={(e) => update("street", e.target.value)}
            disabled={disabled}
          />
          <input
            className={styles.cfInput}
            placeholder="City"
            value={addr.city}
            onChange={(e) => update("city", e.target.value)}
            disabled={disabled}
          />
          <input
            className={styles.cfInput}
            placeholder="State"
            value={addr.state}
            maxLength={2}
            onChange={(e) => update("state", e.target.value.toUpperCase())}
            disabled={disabled}
          />
          <input
            className={styles.cfInput}
            placeholder="Zip"
            value={addr.zip}
            onChange={(e) => update("zip", e.target.value)}
            disabled={disabled}
          />
        </div>
      );
    }

    case "checklist": {
      const items = asObj(value, { items: (config.items ?? []) as string[], checked: [] as boolean[] });
      const toggleChecked = (i: number) => {
        const next = [...(items.checked ?? [])];
        next[i] = !next[i];
        onChange({ items: items.items, checked: next });
      };
      const updateLabel = (i: number, label: string) => {
        const nextItems = [...items.items];
        nextItems[i] = label;
        onChange({ items: nextItems, checked: items.checked });
      };
      const addItem = () => {
        onChange({
          items: [...items.items, "New item"],
          checked: [...(items.checked ?? []), false],
        });
      };
      const removeItem = (i: number) => {
        const nextItems = items.items.filter((_: string, idx: number) => idx !== i);
        const nextChecked = (items.checked ?? []).filter((_: boolean, idx: number) => idx !== i);
        onChange({ items: nextItems, checked: nextChecked });
      };
      return (
        <div>
          {items.items.map((label: string, i: number) => (
            <div key={i} className={styles.cfChecklistRow}>
              <input
                type="checkbox"
                checked={Boolean(items.checked?.[i])}
                onChange={() => toggleChecked(i)}
                disabled={disabled}
              />
              <input
                type="text"
                value={label}
                onChange={(e) => updateLabel(i, e.target.value)}
                disabled={disabled}
              />
              {!disabled ? (
                <button
                  type="button"
                  className={styles.pinBtn}
                  onClick={() => removeItem(i)}
                  aria-label="Remove"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          {!disabled ? (
            <button type="button" className={styles.smallBtn} onClick={addItem}>
              + Add item
            </button>
          ) : null}
        </div>
      );
    }

    case "file":
      return (
        <FileFieldEditor
          value={value}
          onChange={onChange}
          config={config}
          entityType={entityType}
          entityId={entityId}
          disabled={disabled}
        />
      );

    default:
      return (
        <input
          type="text"
          className={styles.cfInput}
          value={asStr(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function FileFieldEditor({
  value,
  onChange,
  config,
  entityType,
  entityId,
  disabled,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  config: { maxFiles?: number; acceptTypes?: string };
  entityType?: string;
  entityId?: number;
  disabled?: boolean;
}) {
  const { authHeaders } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const files: Array<{ url: string; filename: string; size?: number }> = Array.isArray(value)
    ? (value as Array<{ url: string; filename: string; size?: number }>)
    : [];

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !entityType || !entityId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entityType", entityType);
      fd.append("entityId", String(entityId));
      const res = await fetch(apiUrl("/custom-fields/upload"), {
        method: "POST",
        headers: { ...authHeaders() },
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Upload failed.");
      const next = [...files, { url: body.url, filename: body.filename, size: body.size }];
      onChange(next);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeFile = (i: number) => {
    onChange(files.filter((_, idx) => idx !== i));
  };

  const maxFiles = config.maxFiles ?? 5;
  const canUpload = !disabled && files.length < maxFiles;

  return (
    <div>
      <div
        className={styles.cfFileDrop}
        onClick={() => canUpload && inputRef.current?.click()}
        style={{ opacity: canUpload ? 1 : 0.6 }}
      >
        {uploading ? "Uploading…" : `📎 Click to upload (${files.length}/${maxFiles})`}
        <input
          ref={inputRef}
          type="file"
          accept={config.acceptTypes}
          style={{ display: "none" }}
          onChange={handleUpload}
        />
      </div>
      {files.length ? (
        <div className={styles.cfFileList}>
          {files.map((f, i) => (
            <div key={i} className={styles.cfFileItem}>
              <a href={apiUrl(f.url)} target="_blank" rel="noopener noreferrer">
                📎 {f.filename}
              </a>
              {!disabled ? (
                <button
                  type="button"
                  className={styles.pinBtn}
                  onClick={() => removeFile(i)}
                  aria-label="Remove"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
