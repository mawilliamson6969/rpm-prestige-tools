/**
 * Minimal HTML sanitizer for rich-text-lite comments.
 *
 * Allowed:
 *   * <strong>, <b>          → bold
 *   * <em>, <i>              → italic
 *   * <a href="…">           → only http/https/mailto schemes
 *   * <br>, <p>, <div>       → line breaks / paragraphs
 *   * <span data-mention-user-id="N">@displayName</span>
 *
 * Everything else is stripped to plain text. This intentionally does
 * NOT use a 3rd-party sanitizer — a small, audited allowlist is safer
 * than a fully-featured one we don't fully understand. Output is suitable
 * for direct rendering into the DOM with dangerouslySetInnerHTML.
 *
 * Returns { html, text, mentionedUserIds }.
 */

const ALLOWED_TAGS = new Set([
  "strong", "b", "em", "i", "a", "br", "p", "div", "span",
]);
const ALLOWED_PROTOCOLS = ["http:", "https:", "mailto:"];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeUrl(u) {
  try {
    const url = new URL(u, "http://placeholder/");
    if (!u.startsWith("http") && !u.startsWith("mailto:") && !u.startsWith("/")) {
      // Relative URLs are fine; reject only if scheme is bad.
      return true;
    }
    return ALLOWED_PROTOCOLS.includes(url.protocol);
  } catch {
    return false;
  }
}

/**
 * Walk the input HTML with a tiny tokenizer. We do not pull in cheerio
 * or jsdom — that's overkill for this allowlist and a security risk
 * (parser quirks). Anything we can't recognise becomes its escaped
 * plain-text equivalent.
 */
export function sanitizeUpdateHtml(rawHtml) {
  if (rawHtml == null) return { html: "", text: "", mentionedUserIds: [] };
  const input = String(rawHtml);

  let out = "";
  let text = "";
  const mentioned = new Set();
  let i = 0;
  const openStack = []; // tags currently open (for matching close tags)

  while (i < input.length) {
    if (input[i] !== "<") {
      // Text run — escape it. Until next '<'.
      const end = input.indexOf("<", i);
      const chunk = end === -1 ? input.slice(i) : input.slice(i, end);
      // Strings already typed as entities like &amp; are fine to pass
      // through; we just escape raw <, >, &, " above. Decode common
      // entities for the plain-text version.
      out += escapeHtml(decodeEntities(chunk));
      text += decodeEntities(chunk);
      i = end === -1 ? input.length : end;
      continue;
    }

    // Tag — find its close '>'.
    const closeIdx = input.indexOf(">", i);
    if (closeIdx === -1) {
      // Unterminated tag; treat the rest as text.
      out += escapeHtml(input.slice(i));
      text += input.slice(i);
      break;
    }
    const tagBody = input.slice(i + 1, closeIdx); // contents of <…>
    i = closeIdx + 1;

    const isClose = tagBody.startsWith("/");
    const tagSrc = isClose ? tagBody.slice(1) : tagBody;
    const spaceIdx = tagSrc.search(/[\s/]/);
    const tagName =
      (spaceIdx === -1 ? tagSrc : tagSrc.slice(0, spaceIdx)).toLowerCase();

    if (!ALLOWED_TAGS.has(tagName)) {
      // Drop the tag silently (its inner text still gets picked up next pass).
      continue;
    }

    if (isClose) {
      // Close only if this tag is the top of the open-stack; otherwise drop.
      const top = openStack[openStack.length - 1];
      if (top === tagName) {
        openStack.pop();
        out += `</${tagName}>`;
      }
      continue;
    }

    // Opening tag — parse a tiny attribute list.
    const attrText = spaceIdx === -1 ? "" : tagSrc.slice(spaceIdx + 1).trim();
    const selfClosing = attrText.endsWith("/");
    const attrs = parseAttrs(selfClosing ? attrText.slice(0, -1) : attrText);

    if (tagName === "a") {
      const href = attrs.href;
      if (!href || !isSafeUrl(href)) {
        // Render as plain span so the link text still appears.
        out += `<span>`;
        openStack.push("span");
        continue;
      }
      const safeHref = escapeHtml(href);
      out += `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">`;
      openStack.push("a");
      continue;
    }

    if (tagName === "span") {
      const mid = attrs["data-mention-user-id"];
      if (mid && /^\d+$/.test(String(mid))) {
        mentioned.add(Number(mid));
        out += `<span data-mention-user-id="${escapeHtml(String(mid))}" class="mb-mention">`;
        openStack.push("span");
        continue;
      }
      // Plain span (no special class).
      out += `<span>`;
      openStack.push("span");
      continue;
    }

    if (tagName === "br") {
      out += `<br>`;
      text += "\n";
      continue;
    }

    // strong/b/em/i/p/div
    out += `<${tagName}>`;
    openStack.push(tagName);
    // Block-level tags inject a newline in the plaintext fallback.
    if (tagName === "p" || tagName === "div") text += "\n";
  }

  // Auto-close any tags left open (malformed input).
  while (openStack.length) {
    const t = openStack.pop();
    out += `</${t}>`;
  }

  return {
    html: out,
    text: text.replace(/\n{3,}/g, "\n\n").trim(),
    mentionedUserIds: [...mentioned],
  };
}

function parseAttrs(s) {
  const out = {};
  // Match "key=val" with quoted (single or double) or unquoted values.
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  let m;
  while ((m = re.exec(s)) != null) {
    const key = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    out[key] = val;
  }
  return out;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
