"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  /** Short label used in the fallback message, e.g. "ticket list", "compose pane". */
  label: string;
  children: ReactNode;
  /** Optional fallback override; receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
};

type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof console !== "undefined") {
      console.error(`[InboxErrorBoundary:${this.props.label}]`, error, info);
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      return (
        <div
          role="alert"
          style={{
            padding: "1.5rem",
            margin: "0.75rem",
            border: "1px solid #f4c4be",
            background: "#fff5f4",
            color: "#1b2856",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "0.5rem",
            fontSize: "0.9rem",
          }}
        >
          <strong>Something went wrong in this panel.</strong>
          <span style={{ color: "#6a737b" }}>{this.props.label} couldn't render.</span>
          <button
            type="button"
            onClick={this.reset}
            style={{
              border: "1px solid #1b2856",
              background: "#1b2856",
              color: "#fff",
              padding: "0.35rem 0.75rem",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
