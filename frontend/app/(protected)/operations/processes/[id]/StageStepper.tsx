"use client";

import type { ProcessStageRecord } from "../../types";

type Props = {
  stages: ProcessStageRecord[];
  currentTemplateStageId: number | null;
};

function shortFor(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

/**
 * Horizontal stepper of named stages. Completed stages show a check + short
 * name, the current stage expands with the full name in a colored pill, future
 * stages show a numbered outline. Compresses completed labels when there are
 * more than 6 stages so the current stage has room to expand.
 */
export default function StageStepper({ stages, currentTemplateStageId }: Props) {
  if (!stages.length) return null;

  const compress = stages.length > 6;
  const currentIndex = stages.findIndex((s) =>
    currentTemplateStageId != null
      ? s.templateStageId === currentTemplateStageId
      : s.status === "active"
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        marginBottom: "1.25rem",
        overflowX: "auto",
        padding: "0.4rem 0.2rem",
      }}
    >
      {stages.map((stage, i) => {
        const isCurrent =
          currentIndex >= 0 ? i === currentIndex : stage.status === "active";
        const isCompleted =
          !isCurrent &&
          (stage.status === "completed" ||
            stage.status === "skipped" ||
            (currentIndex > 0 && i < currentIndex));
        const isFuture = !isCurrent && !isCompleted;
        const showFullName = isCurrent || !compress;
        const color = stage.color || "#0098D0";

        return (
          <div
            key={stage.id}
            style={{ display: "flex", alignItems: "center", flexShrink: 0 }}
          >
            <div
              title={stage.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: isCurrent ? "0.4rem 0.8rem" : "0.3rem 0.55rem",
                borderRadius: 999,
                background: isCurrent
                  ? color
                  : isCompleted
                  ? "rgba(16, 185, 129, 0.12)"
                  : "transparent",
                border: isFuture
                  ? "1px solid rgba(27, 40, 86, 0.18)"
                  : isCompleted
                  ? "1px solid rgba(16, 185, 129, 0.35)"
                  : "1px solid transparent",
                color: isCurrent ? "#fff" : isCompleted ? "#10b981" : "#6a737b",
                fontSize: "0.78rem",
                fontWeight: isCurrent ? 700 : 600,
                whiteSpace: "nowrap",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  background: isCompleted
                    ? "#10b981"
                    : isCurrent
                    ? "rgba(255, 255, 255, 0.3)"
                    : "rgba(27, 40, 86, 0.06)",
                  color: isCompleted ? "#fff" : isCurrent ? "#fff" : "#6a737b",
                  fontSize: "0.66rem",
                  fontWeight: 700,
                }}
              >
                {isCompleted ? "✓" : i + 1}
              </span>
              {showFullName ? (
                <span>{isCurrent ? stage.name : shortFor(stage.name)}</span>
              ) : null}
            </div>
            {i < stages.length - 1 ? (
              <div
                aria-hidden
                style={{
                  width: 16,
                  height: 2,
                  background: isCompleted
                    ? "rgba(16, 185, 129, 0.45)"
                    : "rgba(27, 40, 86, 0.12)",
                  margin: "0 0.1rem",
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
