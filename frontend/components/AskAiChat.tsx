"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import styles from "./ask-ai.module.css";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  query?: string;
  rowCount?: number;
  error?: boolean;
};

const SUGGESTED = [
  "How many vacant units do we have?",
  "What's our total delinquency?",
  "Show me all open work orders",
  "When does the lease expire at [property]?",
  "Who owns [property address]?",
  "What's our occupancy rate?",
  "How much revenue have we earned this year?",
  "Show me all properties managed by [owner name]",
  "Which vendors have the most work orders?",
  "List all leases expiring in the next 60 days",
];

type HistoryItem = {
  id: number;
  question: string;
  createdAt: string;
};

export default function AskAiChat({
  variant = "page",
}: {
  variant?: "page" | "widget";
}) {
  const { authHeaders, token } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/ask/history"), { headers: { ...authHeaders() } });
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j.history)) {
        setHistory(
          j.history.map((h: { id: number; question: string; createdAt: string }) => ({
            id: h.id,
            question: h.question,
            createdAt: h.createdAt,
          }))
        );
      }
    } catch {
      /* ignore */
    }
  }, [authHeaders, token]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: q,
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/ask"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ question: q }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errText =
          typeof j.error === "string"
            ? j.error
            : res.status === 503
              ? "AI assistant is not configured. Contact your administrator."
              : "I couldn't find an answer to that question. Try rephrasing or ask something more specific.";
        setMessages((m) => [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: errText,
            error: true,
          },
        ]);
        return;
      }
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: j.answer ?? "",
          query: j.query,
          rowCount: j.rowCount,
        },
      ]);
      loadHistory();
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: "Something went wrong. Try again.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const newChat = () => {
    setMessages([]);
    setInput("");
  };

  const shellClass = variant === "page" ? styles.page : styles.widgetBody;

  const chatArea = (
    <>
      {variant === "page" ? (
        <div className={styles.toolbar}>
          <h1>Ask the AI</h1>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Link href="/" className={styles.ghostBtn}>
              ← Team Hub
            </Link>
            <button type="button" className={styles.ghostBtn} onClick={newChat}>
              New conversation
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.chatMain} style={variant === "widget" ? { border: "none", borderRadius: 0, minHeight: 0 } : undefined}>
        <div className={styles.messages}>
          {messages.length === 0 && !loading ? (
            <div className={styles.suggested}>
              <p className={styles.suggestedTitle}>Suggested questions</p>
              <div className={styles.suggestedGrid}>
                {SUGGESTED.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={styles.suggestionCard}
                    onClick={() => void send(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={msg.role === "user" ? styles.bubbleUser : `${styles.bubbleAi} ${msg.error ? styles.bubbleError : ""}`}
            >
              {msg.content}
              {msg.role === "assistant" && msg.query && !msg.error ? (
                <details className={styles.sqlDetails}>
                  <summary>SQL query ({msg.rowCount ?? 0} rows)</summary>
                  <pre className={styles.sqlPre}>{msg.query}</pre>
                </details>
              ) : null}
            </div>
          ))}
          {loading ? (
            <div className={styles.bubbleAi} aria-live="polite">
              <span style={{ marginRight: "0.5rem", color: "#6a737b" }}>Searching your data</span>
              <span className={styles.loadingDots}>
                <span />
                <span />
                <span />
              </span>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
        <div className={styles.inputBar}>
          <textarea
            className={styles.textarea}
            rows={variant === "widget" ? 2 : 2}
            placeholder="Ask anything about your properties, tenants, owners, work orders, finances..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            disabled={loading}
          />
          <button type="button" className={styles.sendBtn} disabled={loading || !input.trim()} onClick={() => void send(input)}>
            Send
          </button>
        </div>
      </div>
    </>
  );

  if (variant === "widget") {
    return <div className={shellClass}>{chatArea}</div>;
  }

  return (
    <div className={shellClass}>
      <div className={styles.layout}>
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>{chatArea}</div>
        <aside className={styles.historyAside}>
          <h2>Recent questions</h2>
          <ul className={styles.historyList}>
            {history.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className={styles.historyItem}
                  onClick={() => void send(h.question)}
                >
                  {h.question.length > 72 ? `${h.question.slice(0, 72)}…` : h.question}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
