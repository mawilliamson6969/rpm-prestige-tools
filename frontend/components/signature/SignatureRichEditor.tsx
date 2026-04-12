"use client";

import { useCallback, useEffect, useRef } from "react";
import styles from "./signature-rich-editor.module.css";

type Props = {
  /** When this changes, editor content resets from initialHtml. */
  resetKey: string | number;
  initialHtml: string;
  onChange: (html: string) => void;
};

export default function SignatureRichEditor({ resetKey, initialHtml, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = initialHtml.trim() ? initialHtml : "<br/>";
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [resetKey, initialHtml]);

  const runCmd = useCallback(
    (command: string, value?: string) => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      document.execCommand(command, false, value);
      onChange(el.innerHTML);
    },
    [onChange]
  );

  const onInput = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const onLink = () => {
    const url = typeof window !== "undefined" ? window.prompt("Link URL (https://…)", "https://") : null;
    if (url == null || url.trim() === "") return;
    runCmd("createLink", url.trim());
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
        <button type="button" onClick={() => runCmd("bold")} title="Bold">
          B
        </button>
        <button type="button" className={styles.italicBtn} onClick={() => runCmd("italic")} title="Italic">
          I
        </button>
        <button type="button" onClick={() => runCmd("underline")} title="Underline">
          U
        </button>
        <button type="button" onClick={onLink} title="Insert link">
          Link
        </button>
        <span className={styles.colorWrap}>
          Color
          <input
            className={styles.colorInput}
            type="color"
            aria-label="Text color"
            defaultValue="#1b2856"
            onMouseDown={(e) => e.preventDefault()}
            onChange={(e) => runCmd("foreColor", e.target.value)}
          />
        </span>
      </div>
      <div
        ref={ref}
        className={styles.editable}
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        role="textbox"
        aria-multiline="true"
        aria-label="Signature content"
      />
    </div>
  );
}
