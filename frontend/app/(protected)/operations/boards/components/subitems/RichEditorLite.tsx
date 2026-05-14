"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./subitems.module.css";

/**
 * Minimal rich-text-lite editor for instruction step bodies / email
 * template bodies. Same approach as Phase 4's UpdateComposer but without
 * @mention / attachment / submit logic — this is a pure value-binding
 * editor that hands the latest HTML to a parent component on every
 * keystroke.
 *
 * Keystroke binding rather than blur-binding because the parent uses
 * controlled state (the template editor batches saves explicitly).
 */
export default function RichEditorLite({
  valueHtml,
  onChange,
  placeholder,
  minHeight = 70,
  onInsertVariableRequest,
}: {
  valueHtml: string;
  onChange: (nextHtml: string, nextText: string) => void;
  placeholder?: string;
  minHeight?: number;
  /** Called with a function the parent can invoke to insert a variable at the caret. */
  onInsertVariableRequest?: (insert: (token: string) => void) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const lastSeenHtml = useRef<string>("");

  // Hydrate the editor once from external state. After that the editor
  // owns the cursor and we DO NOT re-sync from props on every render —
  // doing so would clobber the cursor mid-typing.
  useEffect(() => {
    if (ref.current && lastSeenHtml.current !== valueHtml && document.activeElement !== ref.current) {
      ref.current.innerHTML = valueHtml || "";
      lastSeenHtml.current = valueHtml || "";
    }
  }, [valueHtml]);

  // Expose an "insert token at caret" callback to the parent so the
  // variable picker can wire to it.
  useEffect(() => {
    if (!onInsertVariableRequest) return;
    onInsertVariableRequest((token) => {
      if (!ref.current) return;
      ref.current.focus();
      try {
        document.execCommand("insertText", false, token);
      } catch {
        /* ignore */
      }
      const html = ref.current.innerHTML;
      const text = ref.current.innerText;
      lastSeenHtml.current = html;
      onChange(html, text);
    });
  }, [onInsertVariableRequest, onChange]);

  function syncToolbar() {
    try {
      setBold(document.queryCommandState("bold"));
      setItalic(document.queryCommandState("italic"));
    } catch {
      /* ignore */
    }
  }

  function exec(cmd: "bold" | "italic" | "createLink", value?: string) {
    if (!ref.current) return;
    ref.current.focus();
    try {
      document.execCommand(cmd, false, value);
    } catch {
      /* ignore */
    }
    syncToolbar();
    handleInput();
  }

  function insertLink() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.toString().trim() === "") {
      alert("Select the text you want to turn into a link first.");
      return;
    }
    const url = window.prompt("Link URL (https://…):");
    if (!url) return;
    exec("createLink", url);
  }

  function handleInput() {
    if (!ref.current) return;
    const html = ref.current.innerHTML;
    const text = ref.current.innerText;
    lastSeenHtml.current = html;
    onChange(html, text);
  }

  function handleKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        exec("bold");
      } else if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        exec("italic");
      }
    }
  }

  return (
    <div>
      <div className={styles.editorToolbar}>
        <button
          type="button"
          className={`${styles.toolbarBtn} ${bold ? styles.toolbarBtnActive : ""}`}
          onClick={() => exec("bold")}
          aria-label="Bold"
          title="Bold (Cmd/Ctrl+B)"
        >
          <b>B</b>
        </button>
        <button
          type="button"
          className={`${styles.toolbarBtn} ${italic ? styles.toolbarBtnActive : ""}`}
          onClick={() => exec("italic")}
          aria-label="Italic"
          title="Italic (Cmd/Ctrl+I)"
        >
          <i>I</i>
        </button>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={insertLink}
          aria-label="Link"
          title="Link"
        >
          🔗
        </button>
      </div>
      <div
        ref={ref}
        className={styles.editor}
        style={{ minHeight }}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={handleKey}
        onKeyUp={syncToolbar}
        onClick={syncToolbar}
      />
    </div>
  );
}
