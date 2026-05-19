/**
 * Safe {{path.to.value}} template renderer.
 *
 * Looks up dotted paths on a scope object — no eval, no Function
 * constructor, no dynamic code. Unknown paths render as empty strings
 * (the alternative — leaving the placeholder visible — would surface
 * automation bugs in the messages tenants receive).
 */

function lookup(scope, path) {
  if (scope == null || !path) return undefined;
  const segments = String(path)
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  let cur = scope;
  for (const seg of segments) {
    if (cur == null) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

function stringify(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Replace every {{path}} in `template` with the value found at that path
 * in `scope`. Whitespace inside the braces is tolerated.
 */
export function render(template, scope) {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path) => {
    return stringify(lookup(scope, path));
  });
}

/**
 * Walk an arbitrary config tree and render every string leaf using
 * `render(value, scope)`. Used to resolve action configs before
 * dispatch so handlers see ready-to-use values.
 */
export function renderDeep(value, scope) {
  if (typeof value === "string") return render(value, scope);
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, scope));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = renderDeep(v, scope);
    }
    return out;
  }
  return value;
}
