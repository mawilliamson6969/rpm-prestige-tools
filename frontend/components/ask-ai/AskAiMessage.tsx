"use client";

import type { ChatMessage } from "./AskAiChat";
import AskAiMarkdown from "./AskAiMarkdown";
import styles from "./ask-ai.module.css";

function formatAssistantTime(ms: number | undefined): string {
  if (ms == null) return "";
  const d = ms;
  const now = Date.now();
  const delta = Math.max(0, now - d);
  if (delta < 10_000) return "Just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86400_000) return `${Math.floor(delta / 3600_000)}h ago`;
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
      new Date(d)
    );
  } catch {
    return "";
  }
}

export default function AskAiMessage({
  message,
  fadeInAssistant,
  onRetry,
}: {
  message: ChatMessage;
  fadeInAssistant?: boolean;
  onRetry?: () => void;
}) {
  const meta = formatAssistantTime(message.createdAtMs);
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const shellClass = isUser ? styles.turnUser : styles.turnAssistant;
  const bubbleClass = isUser
    ? styles.bubbleUser
    : `${styles.bubbleAi} ${message.error ? styles.bubbleError : ""} ${fadeInAssistant && !message.error ? styles.bubbleFadeIn : ""}`;

  const showTime = Boolean(meta);

  const copyAnswer = async () => {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={shellClass}>
      <div className={styles.turnInner}>
        <div className={styles.turnMeta}>
          {!isUser && (
            <span className={styles.turnBadge} aria-hidden>
              AI
            </span>
          )}
          {isUser ? (
            <span className={styles.turnBadgeUser} aria-hidden>
              You
            </span>
          ) : null}
        </div>
        <div className={bubbleClass}>
          {showTime ? <span className={styles.timeHint}>{meta}</span> : null}

          <div className={styles.turnBody}>
            {isUser ? (
              <p className={styles.userText}>{message.content}</p>
            ) : message.error ? (
              <div className={styles.errorBlock}>
                <p className={styles.errorText}>{message.content}</p>
                {onRetry ? (
                  <button type="button" className={styles.retryBtn} onClick={onRetry}>
                    Try again
                  </button>
                ) : null}
              </div>
            ) : (
              <AskAiMarkdown content={message.content} />
            )}
          </div>

          {!isAssistant || message.error || !message.content ? null : (
            <button
              type="button"
              className={styles.copyAnswerBtn}
              onClick={() => void copyAnswer()}
              aria-label="Copy answer"
            >
              Copy
            </button>
          )}

          {isAssistant && message.query && !message.error ? (
            <details className={styles.sqlDetails}>
              <summary>SQL query ({message.rowCount ?? 0} rows)</summary>
              <pre className={styles.sqlPre}>{message.query}</pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
