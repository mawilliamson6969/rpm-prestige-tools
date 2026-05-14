import type { SubitemVariableMap } from "@/types/mb";

/**
 * Replace {{item.x}} / {{subitem.x}} tokens. Unknown variables become
 * "[MISSING: name]" so the user notices the unresolved gap rather than
 * shipping a comment with a literal `{{item.tenant_name}}` in it.
 *
 * The regex deliberately allows alphanumerics + underscores and tolerates
 * any whitespace around the dots (a forgiving user expects {{ item.x }}
 * to work the same as {{item.x}}).
 */
const VAR_RE = /\{\{\s*(item|subitem)\s*\.\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function resolvePlain(text: string, vars: SubitemVariableMap | null): string {
  if (!vars) return text;
  return text.replace(VAR_RE, (_m, scope, key) => {
    const bag = scope === "item" ? vars.item : vars.subitem;
    const v = bag?.[key];
    if (v == null || v === "") return `[MISSING: ${scope}.${key}]`;
    return String(v);
  });
}

/**
 * Same substitution but produces HTML. The input is treated as HTML
 * already (we don't escape it), but the substitution text is escaped
 * so values can't inject markup. Unknown variables render with a
 * visible warning span (.missingVar in the css module).
 */
export function resolveHtml(
  html: string,
  vars: SubitemVariableMap | null,
  missingClass = "missingVar"
): string {
  if (!vars) return html;
  return html.replace(VAR_RE, (_m, scope, key) => {
    const bag = scope === "item" ? vars.item : vars.subitem;
    const v = bag?.[key];
    if (v == null || v === "") {
      return `<span class="${missingClass}">[MISSING: ${scope}.${key}]</span>`;
    }
    return escapeHtml(String(v));
  });
}

export function availableVariables(vars: SubitemVariableMap | null): {
  itemKeys: Array<{ key: string; label: string }>;
  subitemKeys: Array<{ key: string; label: string }>;
} {
  if (!vars) return { itemKeys: [], subitemKeys: [] };
  return {
    itemKeys: vars.item_columns.map((c) => ({ key: `item.${c.key}`, label: c.name })),
    subitemKeys: vars.subitem_columns.map((c) => ({
      key: `subitem.${c.key}`,
      label: c.name,
    })),
  };
}
