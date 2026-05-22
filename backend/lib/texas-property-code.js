/**
 * Texas Property Code (Chapter 92) reference loader.
 *
 * Surfaces the curated reference content for compliance-aware drafting in the
 * AI Assistant's `draft-notice` tool. Loads once at first call and caches the
 * concatenated text in memory.
 *
 * Source: copies of the texas-property-code skill's `quick_reference.md` and
 * `notice_templates.md` (the two files the skill itself uses for drafting).
 * The full 207 KB Chapter 92 statute is intentionally NOT bundled here — the
 * skill's quick_reference is the curated subset designed for exactly this use.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = join(__dirname, "legal", "texas-property-code");

let cached = null;

async function loadFile(name) {
  return readFile(join(REFERENCE_DIR, name), "utf8");
}

/**
 * Returns a single string suitable for injection into a system prompt:
 *
 *   TEXAS PROPERTY CODE REFERENCE (Chapter 92, Residential Tenancies)
 *   --- Quick Reference ---
 *   <quick_reference.md>
 *   --- Notice Templates ---
 *   <notice_templates.md>
 *
 * Cached after first read.
 */
export async function getTexasPropertyCodeContext() {
  if (cached) return cached;
  const [quickRef, templates] = await Promise.all([
    loadFile("quick_reference.md"),
    loadFile("notice_templates.md"),
  ]);
  cached = [
    "TEXAS PROPERTY CODE REFERENCE (Chapter 92 — Residential Tenancies)",
    "Use this reference when filling in the Compliance Check section. Cite specific",
    "sections (e.g. Sec. 92.103) when the requirement is on point. Do not invent",
    "citations — if a specific point isn't covered by the reference below, say so",
    "and recommend verification with counsel.",
    "",
    "===== QUICK REFERENCE =====",
    quickRef.trim(),
    "",
    "===== NOTICE TEMPLATES =====",
    templates.trim(),
    "===== END TEXAS PROPERTY CODE REFERENCE =====",
  ].join("\n");
  return cached;
}

/** Test hook — drop the cache so a follow-up call re-reads the files. */
export function __resetTexasPropertyCodeCache() {
  cached = null;
}
