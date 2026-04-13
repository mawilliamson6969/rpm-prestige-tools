function slugPart(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export type WikiHeading = { level: 2 | 3; id: string; text: string };

/** Ordered H2/H3 headings with stable ids (matches render order). */
export function parseWikiHeadings(markdown: string): WikiHeading[] {
  const lines = markdown.split(/\n");
  const used = new Map<string, number>();
  const out: WikiHeading[] = [];
  for (const line of lines) {
    const m = /^(#{2,3})\s+(.+)$/.exec(line);
    if (!m) continue;
    const level = m[1].length === 3 ? 3 : 2;
    const text = m[2].trim().replace(/\s+#+\s*$/, "");
    let base = slugPart(text) || "section";
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    out.push({ level, id, text });
  }
  return out;
}
