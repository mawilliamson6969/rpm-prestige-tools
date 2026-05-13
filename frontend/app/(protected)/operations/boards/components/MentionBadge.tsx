"use client";

/**
 * Renders an "@N" pill when the current user has N unseen @mentions
 * on the parent item. Lives in the shared boards/components folder so
 * the Renewals board, the generic [slug] board, and the Manage Boards
 * page can all import it. Styles are inline so this component is
 * self-contained — no CSS-module coupling.
 */
export default function MentionBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const display = count > 9 ? "9+" : String(count);
  return (
    <span
      title={`${count} unseen @mention${count === 1 ? "" : "s"}`}
      style={{
        display: "inline-block",
        minWidth: 18,
        padding: "0 0.4rem",
        height: 18,
        lineHeight: "18px",
        fontSize: "0.7rem",
        fontWeight: 700,
        color: "#fff",
        background: "#b32317",
        borderRadius: 999,
        textAlign: "center",
        marginLeft: "0.4rem",
        verticalAlign: "middle",
      }}
    >
      @{display}
    </span>
  );
}
