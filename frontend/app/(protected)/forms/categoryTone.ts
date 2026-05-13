export type CategoryTone = "navy" | "red" | "teal" | "blue" | "neutral";

/** Soft tint mapping from RPM palette only. */
export function categoryTone(category: string | null | undefined): CategoryTone {
  const c = (category || "").toLowerCase();
  if (c.includes("operations") || c.includes("onboarding") || c.includes("marketing")) return "navy";
  if (c.includes("maintenance")) return "red";
  if (c.includes("leasing")) return "teal";
  if (c.includes("owner")) return "blue";
  return "neutral";
}
