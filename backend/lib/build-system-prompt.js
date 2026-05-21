import { BRAND_VOICE } from "./ai-tools.js";
import { getTexasPropertyCodeContext } from "./texas-property-code.js";

/**
 * Build the full system prompt for a tool or saved template.
 *
 * Layout:
 *   BRAND_VOICE
 *   [TEXAS PROPERTY CODE REFERENCE — draft-notice only]
 *   tool.systemPrompt
 *
 * The Texas Property Code block is injected ONLY when the request is for the
 * built-in `draft-notice` tool. This gives that tool's Compliance Check
 * section real statute references to cite instead of relying on the model's
 * general knowledge. The existing "review before sending" / "you are not a
 * lawyer" instructions in the tool's own prompt stay in place.
 */
export async function buildSystemPrompt(tool) {
  const parts = [BRAND_VOICE];
  if (tool?.id === "draft-notice" && tool?.builtIn !== false) {
    try {
      const ref = await getTexasPropertyCodeContext();
      if (ref) parts.push(ref);
    } catch (e) {
      // Reference file load failure should NOT break the tool — the existing
      // cautious prompt still flags compliance items, just without citations.
      console.error("[build-system-prompt] Texas Property Code reference unavailable:", e.message);
    }
  }
  parts.push(tool.systemPrompt);
  return parts.join("\n\n").trim();
}
