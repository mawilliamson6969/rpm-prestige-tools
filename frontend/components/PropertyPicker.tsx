"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./property-context.module.css";
import { apiUrl } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export type PropertySearchResult = {
  property_id: number | null;
  property_name: string | null;
  property_address: string | null;
  property_type: string | null;
  occupancy_status: string | null;
};

export type SelectedProperty = {
  propertyId: number | null;
  propertyName: string;
  address?: string | null;
  type?: string | null;
  occupancyStatus?: string | null;
};

type Props = {
  value: SelectedProperty | null;
  onChange: (p: SelectedProperty | null) => void;
  onViewDetails?: (p: SelectedProperty) => void;
  placeholder?: string;
  allowFreeText?: boolean;
};

function statusDotClass(status: string | null | undefined): string {
  switch (status) {
    case "Current":
      return styles.dotCurrent;
    case "Notice-Unrented":
      return styles.dotNotice;
    case "Vacant-Unrented":
      return styles.dotVacant;
    default:
      return styles.dotUnknown;
  }
}

export default function PropertyPicker({
  value,
  onChange,
  onViewDetails,
  placeholder = "Search properties…",
  allowFreeText = true,
}: Props) {
  const { authHeaders, token } = useAuth();
  const [query, setQuery] = useState(value?.propertyName ?? "");
  const [results, setResults] = useState<PropertySearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value?.propertyName ?? "");
  }, [value?.propertyName]);

  const search = useCallback(
    async (q: string) => {
      if (!token || q.trim().length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          apiUrl(`/property-context/search?q=${encodeURIComponent(q.trim())}`),
          { headers: { ...authHeaders() }, cache: "no-store" }
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const body = await res.json();
        setResults(Array.isArray(body.properties) ? body.properties : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [authHeaders, token]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (open && query.trim().length >= 2) search(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, search]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (r: PropertySearchResult) => {
    if (!r.property_name) return;
    const selected: SelectedProperty = {
      propertyId: r.property_id,
      propertyName: r.property_name,
      address: r.property_address,
      type: r.property_type,
      occupancyStatus: r.occupancy_status,
    };
    setQuery(r.property_name);
    onChange(selected);
    setOpen(false);
  };

  const clear = () => {
    setQuery("");
    onChange(null);
  };

  return (
    <div className={styles.pickerWrap} ref={wrapRef}>
      <input
        className={styles.pickerInput}
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (allowFreeText && value?.propertyName !== e.target.value) {
            onChange(
              e.target.value.trim()
                ? { propertyId: null, propertyName: e.target.value }
                : null
            );
          }
        }}
        onFocus={() => {
          if (query.trim().length >= 2) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open ? (
        <div className={styles.dropdown}>
          {loading ? (
            <div className={styles.pickerLoading}>Searching…</div>
          ) : results.length === 0 ? (
            <div className={styles.pickerEmpty}>
              {query.trim().length < 2
                ? "Type at least 2 characters"
                : allowFreeText
                ? "No match — will save as free text"
                : "No properties found"}
            </div>
          ) : (
            results.map((r) => (
              <div
                key={`${r.property_id}-${r.property_name}`}
                className={styles.row}
                onClick={() => pick(r)}
              >
                <span
                  className={`${styles.occupancyDot} ${statusDotClass(r.occupancy_status)}`}
                  title={r.occupancy_status || "status unknown"}
                />
                <div className={styles.rowName}>
                  {r.property_name}
                  {r.property_address ? (
                    <div className={styles.rowAddr}>{r.property_address}</div>
                  ) : null}
                </div>
                {r.property_type ? (
                  <span className={styles.typeBadge}>
                    {r.property_type === "Single-Family" ? "SFR" : "MF"}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
      {value?.propertyName && onViewDetails ? (
        <button
          type="button"
          className={styles.detailLink}
          onClick={() => onViewDetails(value)}
        >
          View property details →
        </button>
      ) : null}
      {value ? (
        <button
          type="button"
          className={styles.detailLink}
          onClick={clear}
          style={{ marginLeft: value.propertyName && onViewDetails ? "0.75rem" : 0 }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
