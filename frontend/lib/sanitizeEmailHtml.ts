/** Strip obvious script/event handlers from HTML used in signature previews and replies. */
export function sanitizeEmailHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\shref\s*=\s*["']\s*javascript:[^"']*["']/gi, "");
}
