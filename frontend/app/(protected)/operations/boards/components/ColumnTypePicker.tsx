"use client";

import styles from "./customization.module.css";
import type { UserCreatableColumnType } from "@/types/mb";
import { USER_CREATABLE_COLUMN_TYPES } from "@/types/mb";

const META: Record<UserCreatableColumnType, { label: string; description: string }> = {
  text: { label: "Text", description: "Single-line plain text" },
  number: { label: "Number", description: "Whole or decimal numbers" },
  date: { label: "Date", description: "Calendar date" },
  status: { label: "Status", description: "Workflow state with colored chips" },
  person: { label: "Person", description: "Assign a team member" },
  dropdown: { label: "Dropdown", description: "Pick one from a fixed list" },
};

export default function ColumnTypePicker({
  value,
  onChange,
  disabled,
}: {
  value: UserCreatableColumnType | null;
  onChange: (next: UserCreatableColumnType) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.typeGrid} role="radiogroup" aria-label="Column type">
      {USER_CREATABLE_COLUMN_TYPES.map((t) => {
        const meta = META[t];
        const active = value === t;
        return (
          <button
            type="button"
            key={t}
            role="radio"
            aria-checked={active}
            className={`${styles.typeCard} ${active ? styles.typeCardActive : ""}`}
            onClick={() => onChange(t)}
            disabled={disabled}
          >
            <span className={styles.typeName}>{meta.label}</span>
            <span className={styles.typeDesc}>{meta.description}</span>
          </button>
        );
      })}
    </div>
  );
}
