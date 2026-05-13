"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./detail.module.css";
import MentionDropdown, { type MentionableUser } from "./MentionDropdown";

/**
 * Rich-text-lite composer.
 *
 * Implementation notes:
 *   * contenteditable + execCommand for bold/italic. execCommand is
 *     deprecated but still works in every browser we support, and the
 *     alternatives (Lexical, TipTap) are ~50KB+ — we deliberately don't
 *     add a dep for "make this text bold."
 *   * Links: prompt for URL, then document.execCommand("createLink").
 *     The server's sanitizer rejects javascript: schemes.
 *   * @mentions: on `@`, we open the dropdown. Selecting a user inserts
 *     a non-editable <span data-mention-user-id="…" class="mb-mention">
 *     into the contenteditable. The sanitizer preserves these spans and
 *     extracts the user ids server-side.
 *   * The composer does NOT track mentioned IDs in a separate state —
 *     they're recovered from the HTML at submit time. Single source of
 *     truth.
 *   * Attachments are uploaded only AFTER the comment row is created
 *     (because attachments FK to mb_item_updates(id)). So the composer
 *     stages files locally and uploads them in sequence post-create.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".pdf",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv",
]);

interface UpdateComposerProps {
  placeholder?: string;
  users: MentionableUser[];
  submitting?: boolean;
  errorText?: string | null;
  /**
   * Called when the user clicks submit. The composer hands back the
   * sanitized html (the contenteditable's innerHTML), the staged files,
   * and the visible plain-text body. Returns true on success so we can
   * clear the editor.
   */
  onSubmit: (data: {
    bodyHtml: string;
    text: string;
    files: File[];
  }) => Promise<boolean>;
  compact?: boolean;
  initialHtml?: string;
  onCancel?: () => void;
  submitLabel?: string;
}

export default function UpdateComposer({
  placeholder = "Write a comment…",
  users,
  submitting,
  errorText,
  onSubmit,
  compact,
  initialHtml,
  onCancel,
  submitLabel = "Comment",
}: UpdateComposerProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [mentionState, setMentionState] = useState<{
    query: string;
    position: { top: number; left: number };
    range: Range;
  } | null>(null);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [textTouched, setTextTouched] = useState(false);

  // Hydrate initial HTML once.
  useEffect(() => {
    if (initialHtml && editorRef.current) {
      editorRef.current.innerHTML = initialHtml;
    }
  }, [initialHtml]);

  // Track selection / mention trigger.
  const updateMentionState = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) {
      setMentionState(null);
      return;
    }
    const text = (node as Text).data;
    const upTo = text.slice(0, range.startOffset);
    const at = upTo.lastIndexOf("@");
    if (at < 0) {
      setMentionState(null);
      return;
    }
    // The `@` must be either at the start of the text or preceded by
    // whitespace, NBSP, or punctuation — otherwise it's an email
    // (e.g. someone@example.com), not a mention trigger.
    const charBefore = at === 0 ? "" : upTo[at - 1];
    if (charBefore && !/[\s (,;]/.test(charBefore)) {
      setMentionState(null);
      return;
    }
    const query = upTo.slice(at + 1);
    if (/[\s\n]/.test(query)) {
      // Whitespace after `@` closes the typeahead.
      setMentionState(null);
      return;
    }

    // Position the popup under the cursor.
    const probe = range.cloneRange();
    probe.collapse(true);
    const rect = probe.getBoundingClientRect();
    const editorEl = editorRef.current;
    const editorRect = editorEl?.getBoundingClientRect();
    if (!editorRect || rect.bottom === 0) {
      setMentionState(null);
      return;
    }
    const rangeForReplace = document.createRange();
    rangeForReplace.setStart(node, at);
    rangeForReplace.setEnd(node, range.startOffset);

    setMentionState({
      query,
      position: {
        top: rect.bottom - editorRect.top + 6,
        left: rect.left - editorRect.left,
      },
      range: rangeForReplace,
    });
  }, []);

  const handleInput = useCallback(() => {
    setTextTouched(true);
    updateMentionState();
    syncToolbarState();
  }, [updateMentionState]);

  function syncToolbarState() {
    try {
      setBold(document.queryCommandState("bold"));
      setItalic(document.queryCommandState("italic"));
    } catch {
      // queryCommandState can throw on detached selections; ignore.
    }
  }

  function exec(cmd: "bold" | "italic" | "createLink", value?: string) {
    if (!editorRef.current) return;
    editorRef.current.focus();
    try {
      document.execCommand(cmd, false, value);
    } catch {
      /* ignore */
    }
    syncToolbarState();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Cmd/Ctrl+B / +I shortcuts.
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

  function pickMention(user: MentionableUser) {
    if (!editorRef.current) return;
    const ms = mentionState;
    setMentionState(null);
    if (!ms) return;

    // Replace "@query" with a mention pill + trailing space.
    const range = ms.range;
    range.deleteContents();

    const pill = document.createElement("span");
    pill.contentEditable = "false";
    pill.className = "mb-mention";
    pill.setAttribute("data-mention-user-id", String(user.id));
    pill.textContent = `@${user.displayName}`;
    range.insertNode(pill);

    // Trailing space, and place cursor after.
    const space = document.createTextNode(" ");
    pill.parentNode?.insertBefore(space, pill.nextSibling);

    const sel = window.getSelection();
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);

    editorRef.current.focus();
    setTextTouched(true);
  }

  function addFiles(list: FileList | File[]) {
    setFileError(null);
    const next: File[] = [];
    for (const f of Array.from(list)) {
      const ext = (f.name.includes(".")
        ? f.name.slice(f.name.lastIndexOf(".")).toLowerCase()
        : "");
      if (!ALLOWED_EXT.has(ext)) {
        setFileError(`"${f.name}" is not an allowed file type.`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        setFileError(`"${f.name}" is over 10 MB.`);
        continue;
      }
      next.push(f);
    }
    if (next.length === 0) return;
    setFiles((existing) => [...existing, ...next]);
  }

  function removeFile(idx: number) {
    setFiles((arr) => arr.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML.trim();
    const text = editorRef.current.innerText.trim();
    if (!text && files.length === 0) return;

    const ok = await onSubmit({ bodyHtml: html, text, files });
    if (ok) {
      editorRef.current.innerHTML = "";
      setFiles([]);
      setTextTouched(false);
    }
  }

  const visibleText = (editorRef.current?.innerText ?? "").trim();
  const canSubmit = (visibleText.length > 0 || files.length > 0) && !submitting;

  return (
    <div
      className={`${styles.composer} ${dragging ? styles.dropTarget : ""} ${compact ? "" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
      }}
    >
      <div className={styles.composerToolbar}>
        <button
          type="button"
          className={`${styles.composerBtn} ${bold ? styles.composerBtnActive : ""}`}
          onClick={() => exec("bold")}
          aria-label="Bold"
          title="Bold (Cmd/Ctrl+B)"
        >
          <b>B</b>
        </button>
        <button
          type="button"
          className={`${styles.composerBtn} ${italic ? styles.composerBtnActive : ""}`}
          onClick={() => exec("italic")}
          aria-label="Italic"
          title="Italic (Cmd/Ctrl+I)"
        >
          <i>I</i>
        </button>
        <button
          type="button"
          className={styles.composerBtn}
          onClick={insertLink}
          aria-label="Link"
          title="Link"
        >
          🔗
        </button>
        <span className={styles.composerSpacer} />
        <label className={styles.attachLabel} htmlFor="mb-composer-file">
          📎 Attach
        </label>
        <input
          ref={fileInputRef}
          id="mb-composer-file"
          type="file"
          className={styles.attachInput}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            // Reset input so re-picking the same filename works.
            e.target.value = "";
          }}
        />
      </div>

      <div style={{ position: "relative" }}>
        <div
          ref={editorRef}
          className={styles.editor}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          role="textbox"
          aria-multiline="true"
          onInput={handleInput}
          onKeyDown={onKeyDown}
          onKeyUp={updateMentionState}
          onClick={updateMentionState}
        />
        {mentionState ? (
          <MentionDropdown
            query={mentionState.query}
            position={mentionState.position}
            users={users}
            onPick={pickMention}
            onClose={() => setMentionState(null)}
          />
        ) : null}
      </div>

      {files.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className={styles.attachPreview}>
              📎 {f.name} ({Math.round(f.size / 1024)} KB)
              <button
                type="button"
                className={styles.attachRemove}
                onClick={() => removeFile(i)}
                aria-label={`Remove ${f.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {fileError ? <div className={styles.composerErr}>{fileError}</div> : null}
      {errorText ? <div className={styles.composerErr}>{errorText}</div> : null}

      <div className={styles.composerFooter}>
        {onCancel ? (
          <button
            type="button"
            className={styles.composerBtn}
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className={styles.submitBtn}
          onClick={submit}
          disabled={!canSubmit}
        >
          {submitting ? "Posting…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
