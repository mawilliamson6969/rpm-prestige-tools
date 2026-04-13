"use client";

import { useMemo, useRef } from "react";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark.css";
import { parseWikiHeadings, type WikiHeading } from "./markdown-toc";
import styles from "./markdown-body.module.css";

type Props = {
  markdown: string;
  className?: string;
};

export function useWikiHeadings(markdown: string): WikiHeading[] {
  return useMemo(() => parseWikiHeadings(markdown), [markdown]);
}

export default function MarkdownBody({ markdown, className }: Props) {
  const headings = useWikiHeadings(markdown);
  const hi = useRef(0);

  const components = useMemo(
    () => ({
      h2(props: ComponentPropsWithoutRef<"h2">) {
        const cur = headings[hi.current];
        if (cur?.level === 2) {
          const id = cur.id;
          hi.current += 1;
          return <h2 id={id} {...props} />;
        }
        return <h2 {...props} />;
      },
      h3(props: ComponentPropsWithoutRef<"h3">) {
        const cur = headings[hi.current];
        if (cur?.level === 3) {
          const id = cur.id;
          hi.current += 1;
          return <h3 id={id} {...props} />;
        }
        return <h3 {...props} />;
      },
    }),
    [headings]
  );

  hi.current = 0;

  return (
    <div className={`${styles.md} ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
