"use client";

type Props = {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
};

export default function RetryState({ message, onRetry, retrying }: Props) {
  return (
    <div
      role="alert"
      style={{
        padding: "1.5rem 1rem",
        textAlign: "center",
        color: "#6a737b",
        fontSize: "0.9rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
        alignItems: "center",
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        style={{
          border: "1px solid #1b2856",
          background: retrying ? "#cfd4dc" : "#1b2856",
          color: retrying ? "#6a737b" : "#fff",
          padding: "0.4rem 0.85rem",
          borderRadius: 6,
          cursor: retrying ? "not-allowed" : "pointer",
          fontSize: "0.85rem",
        }}
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
