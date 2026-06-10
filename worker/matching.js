/**
 * Trigger matching for "custom.event" automations.
 *
 * An automation with trigger_type 'custom.event' stores a pattern in
 * trigger_config.event_type_pattern and matches event-bus types:
 *   - exactly:            "appfolio.sync.failed"
 *   - or by prefix, when the pattern ends in ".*":
 *                         "appfolio.sync.*" matches appfolio.sync.failed
 *                         and appfolio.sync.recovered
 *
 * No regex — exact-or-prefix only. An empty/missing pattern matches
 * nothing (the API rejects saving one, but old or hand-edited rows must
 * fail closed, not fire on every event).
 *
 * Dependency-free on purpose: worker/index.js self-bootstraps on import,
 * so testable logic lives in leaf modules like this one (same pattern as
 * templating.js).
 */

export function customPatternMatches(pattern, eventType) {
  const p = String(pattern ?? "").trim();
  if (!p || typeof eventType !== "string") return false;
  if (p.endsWith(".*")) {
    // Keep the dot: "appfolio.sync.*" → prefix "appfolio.sync." so it
    // can't match a sibling like "appfolio.synchronizer.x".
    return eventType.startsWith(p.slice(0, -1));
  }
  return eventType === p;
}
