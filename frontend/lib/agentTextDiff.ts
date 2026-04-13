/** Minimal line diff for prompt version display (not a full Myers diff). */
export function simpleLineDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const max = Math.max(a.length, b.length);
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) out.push(`  ${x ?? ""}`);
    else {
      if (x !== undefined) out.push(`- ${x}`);
      if (y !== undefined) out.push(`+ ${y}`);
    }
  }
  return out.join("\n");
}
