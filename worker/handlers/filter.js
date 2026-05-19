/**
 * Filter step. Compares a field (looked up by dotted path against the
 * event + context scope) to a value using the chosen operator. When the
 * condition fails the run is marked 'filtered_out' and remaining steps
 * are skipped.
 *
 * config: { field: 'event.payload.priority', operator: 'equals', value: 'Emergency' }
 */

import { render } from "../templating.js";

function lookup(scope, path) {
  if (!path) return undefined;
  const segments = String(path).split(".").map((s) => s.trim()).filter(Boolean);
  let cur = scope;
  for (const seg of segments) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

function normalize(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function asNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function runFilter({ config, scope }) {
  const field = String(config.field || "").trim();
  if (!field) {
    return { status: "failed", error: "filter: 'field' is required." };
  }
  const operator = String(config.operator || "equals").trim();
  const rhs = typeof config.value === "string" ? render(config.value, scope) : config.value;

  const lhs = lookup(scope, field);
  const lhsStr = normalize(lhs).toLowerCase();
  const rhsStr = normalize(rhs).toLowerCase();
  let passed;
  switch (operator) {
    case "equals":
      passed = lhsStr === rhsStr;
      break;
    case "not_equals":
      passed = lhsStr !== rhsStr;
      break;
    case "contains":
      passed = lhsStr.includes(rhsStr);
      break;
    case "not_contains":
      passed = !lhsStr.includes(rhsStr);
      break;
    case "exists":
      passed = lhs != null && lhs !== "";
      break;
    case "not_exists":
      passed = lhs == null || lhs === "";
      break;
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const a = asNumber(lhs);
      const b = asNumber(rhs);
      if (a == null || b == null) {
        passed = false;
      } else if (operator === "gt") passed = a > b;
      else if (operator === "lt") passed = a < b;
      else if (operator === "gte") passed = a >= b;
      else passed = a <= b;
      break;
    }
    default:
      return { status: "failed", error: `filter: unknown operator "${operator}".` };
  }

  if (passed) {
    return { status: "success", output: { field, operator, passed: true } };
  }
  // Signal to the dispatcher that the automation should stop cleanly.
  return {
    status: "filtered_out",
    output: { field, operator, lhs, rhs, passed: false },
  };
}
