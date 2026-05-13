"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import AskAiMessage from "./AskAiMessage";
import styles from "./ask-ai.module.css";
import { CHAR_COUNT_THRESHOLD, EMPTY_STATE_EXAMPLE_PROMPTS, EXTENDED_SUGGESTIONS, TEXTAREA_MAX_LINES } from "./askAiConstants";
import { useAskAiScroll } from "./useAskAiScroll";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  query?: string;
  rowCount?: number;
  error?: boolean;
  createdAtMs?: number;
  retryQuestion?: string;
};

type HistoryItem = {
  id: number;
  question: string;
  createdAt: string;
};

const LINE_HEIGHT_PX = 22;
const TEXTAREA_PAD_PX = 28;

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
  const [fadeAssistantId, setFadeAssistantId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const lastMessage = messages[messages.length - 1];
  const { scrollRef, bottomRef } = useAskAiScroll(messages.length, loading, lastMessage?.id);

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
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const maxH = TEXTAREA_MAX_LINES * LINE_HEIGHT_PX + TEXTAREA_PAD_PX;
    const next = Math.min(ta.scrollHeight, maxH);
    ta.style.height = `${next}px`;
  }, [input, variant]);

  const pushUserMessage = (q: string): ChatMessage => ({
    id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: "user",
    content: q,
    createdAtMs: Date.now(),
  });

  const errorAssistant = (errText: string, retryQuestion: string): ChatMessage => ({
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: "assistant",
    content: errText,
    error: true,
    createdAtMs: Date.now(),
    retryQuestion,
  });

  const okAssistant = (content: string, query?: string, rowCount?: number): ChatMessage => ({
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: "assistant",
    content,
    query,
    rowCount,
    createdAtMs: Date.now(),
  });

  const send = async (text: string, opts?: { skipAppendUser?: boolean; dropAssistantErrorFirst?: boolean }) => {
    const q = text.trim();
    if (!q || loading) return;
    if (opts?.dropAssistantErrorFirst) {
      setMessages((m) => {
        const next = [...m];
        const last = next[next.length - 1];
        if (last?.role === "assistant" && last.error) next.pop();
        return next;
      });
    }
    if (!opts?.skipAppendUser) {
      setMessages((m) => [...m, pushUserMessage(q)]);
      setInput("");
    }
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
        setMessages((m) => [...m, errorAssistant(errText, q)]);
        return;
      }
      const assistant = okAssistant(j.answer ?? "", j.query, j.rowCount);
      setMessages((m) => [...m, assistant]);
      setFadeAssistantId(assistant.id);
      window.setTimeout(() => setFadeAssistantId((cur) => (cur === assistant.id ? null : cur)), 480);
      loadHistory();
    } catch {
      setMessages((m) => [...m, errorAssistant("Something went wrong. Try again.", q)]);
    } finally {
      setLoading(false);
    }
  };

  const fillExample = (prompt: string) => {
    setInput(prompt);
    textareaRef.current?.focus();
  };

  const newChat = () => {
    setMessages([]);
    setInput("");
  };

  const clearInput = () => {
    setInput("");
    textareaRef.current?.focus();
  };

  const retryWithQuestion = (question: string) => {
    void send(question, { skipAppendUser: true, dropAssistantErrorFirst: true });
  };

  const shellClass = variant === "page" ? styles.page : styles.widgetBody;

  const showCharCount = input.length >= CHAR_COUNT_THRESHOLD;

  const chatMain = (
    <div
      className={styles.chatMain}
      style={variant === "widget" ? { border: "none", borderRadius: 0, minHeight: 0 } : undefined}
    >
      <div ref={scrollRef} className={styles.messages} role="log" aria-relevant="additions" aria-label="Conversation">
        {messages.length === 0 && !loading ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyHero}>
              <div className={styles.emptyIcon} aria-hidden>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                  />
                </svg>
              </div>
              <h2 className={styles.emptyTitle}>Ask about your portfolio</h2>
              <p className={styles.emptySubtitle}>
                Natural-language questions across properties, leases, tenants, work orders, and finances — grounded in your data.
              </p>
            </div>
            <p className={styles.examplesLabel}>Try an example</p>
            <div className={styles.examplesRow}>
              {EMPTY_STATE_EXAMPLE_PROMPTS.map((s) => (
                <button key={s} type="button" className={styles.exampleChip} onClick={() => fillExample(s)}>
                  {s}
                </button>
              ))}
            </div>
            <details className={styles.moreExamples}>
              <summary>More ideas</summary>
              <div className={styles.suggestedGrid}>
                {EXTENDED_SUGGESTIONS.filter((s) => !EMPTY_STATE_EXAMPLE_PROMPTS.includes(s)).map((s) => (
                  <button key={s} type="button" className={styles.suggestionCard} onClick={() => fillExample(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </details>
          </div>
        ) : null}

        {messages.map((msg) => (
          <AskAiMessage
            key={msg.id}
            message={msg}
            fadeInAssistant={msg.role === "assistant" && msg.id === fadeAssistantId}
            onRetry={msg.error && msg.retryQuestion ? () => retryWithQuestion(msg.retryQuestion!) : undefined}
          />
        ))}

        {loading ? (
          <div className={styles.turnAssistant} aria-live="polite" aria-busy="true">
            <div className={styles.turnInner}>
              <div className={styles.turnMeta}>
                <span className={styles.turnBadge} aria-hidden>
                  AI
                </span>
              </div>
              <div className={`${styles.bubbleAi} ${styles.loadingBubble}`}>
                <span className={styles.loadingLabel}>Searching your data</span>
                <span className={styles.loadingDots} aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className={styles.inputDock}>
        <div className={styles.inputRow}>
          <div className={styles.textareaShell}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              rows={1}
              placeholder="Ask anything about properties, tenants, work orders…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              disabled={loading}
              aria-label="Message to AI"
            />
            <div className={styles.inputChrome}>
              <div className={styles.inputActions}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={clearInput}
                  disabled={!input.trim()}
                  aria-label="Clear input"
                  title="Clear input"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
                <button type="button" className={styles.iconBtn} onClick={newChat} aria-label="New conversation" title="New conversation">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
              {showCharCount ? <span className={styles.charCount}>{input.length.toLocaleString()} characters</span> : null}
            </div>
          </div>
          <button
            type="button"
            className={styles.sendBtn}
            disabled={loading || !input.trim()}
            onClick={() => void send(input)}
            aria-label="Send message"
          >
            <span className={styles.sendIcon} aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </span>
          </button>
        </div>
        <p className={styles.inputHint}>
          <kbd className={styles.kbd}>Enter</kbd> to send · <kbd className={styles.kbd}>Shift</kbd>+<kbd className={styles.kbd}>Enter</kbd>{" "}
          new line
        </p>
      </div>
    </div>
  );

  const chatArea = (
    <>
      {variant === "page" ? (
        <header className={styles.toolbar}>
          <h1 className={styles.toolbarTitle}>Ask the AI</h1>
          <div className={styles.toolbarActions}>
            <Link href="/" className={styles.ghostBtn}>
              ← Team Hub
            </Link>
            <button type="button" className={styles.ghostBtn} onClick={newChat}>
              New conversation
            </button>
          </div>
        </header>
      ) : null}
      {chatMain}
    </>
  );

  if (variant === "widget") {
    return <div className={shellClass}>{chatArea}</div>;
  }

  return (
    <div className={shellClass}>
      <div className={styles.layout}>
        <div className={styles.chatColumn}>{chatArea}</div>
        <aside className={styles.historyAside} aria-label="Recent questions">
          <h2 className={styles.historyHeading}>Recent questions</h2>
          <ul className={styles.historyList}>
            {history.map((h) => (
              <li key={h.id}>
                <button type="button" className={styles.historyItem} onClick={() => void send(h.question)}>
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
