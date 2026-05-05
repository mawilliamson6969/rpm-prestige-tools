"use client";

import { Children, isValidElement, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import styles from "./ask-ai.module.css";

function parseFenceLang(className?: string): string {
  const m = /language-(\w+)/.exec(className ?? "");
  return m ? m[1] : "";
}

function PreWithCopy({ children }: { children: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  let language = "";
  Children.forEach(children, (ch) => {
    if (language || !isValidElement<{ className?: string }>(ch)) return;
    const cn = ch.props.className;
    if (typeof cn === "string") language = parseFenceLang(cn);
  });

  const copy = async () => {
    const text = preRef.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text.endsWith("\n") ? text.slice(0, -1) : text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={styles.codeBlockWrap}>
      <div className={styles.codeBlockBar}>
        {language ? <span className={styles.codeLang}>{language}</span> : <span className={styles.codeLangMuted}>code</span>}
        <button type="button" className={styles.codeCopyBtn} onClick={() => void copy()} aria-label="Copy code">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre ref={preRef} className={styles.codeBlockPre}>
        {children}
      </pre>
    </div>
  );
}

export default function AskAiMarkdown({ content }: { content: string }) {
  return (
    <div className={styles.markdownBody}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre({ children }) {
            return <PreWithCopy>{children}</PreWithCopy>;
          },
          code({ className, children, ...rest }) {
            const isInline = !String(className ?? "").includes("language-");
            if (isInline) {
              return (
                <code className={styles.inlineCode} {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
          a({ href, children, ...rest }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className={styles.mdLink} {...rest}>
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return <blockquote className={styles.mdBlockquote}>{children}</blockquote>;
          },
          ul({ children }) {
            return <ul className={styles.mdUl}>{children}</ul>;
          },
          ol({ children }) {
            return <ol className={styles.mdOl}>{children}</ol>;
          },
          h1({ children }) {
            return <h3 className={styles.mdH1}>{children}</h3>;
          },
          h2({ children }) {
            return <h3 className={styles.mdH2}>{children}</h3>;
          },
          h3({ children }) {
            return <h4 className={styles.mdH3}>{children}</h4>;
          },
          p({ children }) {
            return <p className={styles.mdP}>{children}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
