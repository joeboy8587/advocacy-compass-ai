export const reviewFactors = [
  { key: "behavior", label: "Flight behavior", question: "What repeats across flights, locations and time windows?" },
  { key: "squawks", label: "Recurring squawks", question: "Does the code recur across dates or aircraft, and what assignment context is known?" },
  { key: "companies", label: "Company records", question: "What do dated FAA and company records actually establish?" },
  { key: "addresses", label: "Shared addresses", question: "Is the address a documented relationship, shared service, or unresolved coincidence?" },
] as const;
export type FactorKey = typeof reviewFactors[number]["key"];
export const assessments = ["Not reviewed", "Supports a thread", "Supports an alternative", "Mixed", "Unresolved"] as const;
export const dispositions = ["Continue investigation", "Conflicting evidence", "Insufficient evidence"] as const;
export type FactorReview = { assessment: typeof assessments[number]; weight: "Low" | "Medium" | "High"; observation: string; source: string; alternative: string; gaps: string };
export type CaseReview = { version: 1; factors: Record<FactorKey, FactorReview>; reviewer: string; synthesis: string; nextStep: string; disposition: "" | typeof dispositions[number]; state: "draft" | "reviewed"; savedAt: string | null };
export function emptyReview(): CaseReview {
  return { version: 1, factors: Object.fromEntries(reviewFactors.map(f => [f.key, { assessment: "Not reviewed", weight: "Low", observation: "", source: "", alternative: "", gaps: "" }])) as Record<FactorKey, FactorReview>, reviewer: "", synthesis: "", nextStep: "", disposition: "", state: "draft", savedAt: null };
}
const start = "[WATCHTOWER MULTI-FACTOR REVIEW v1]";
const end = "[/WATCHTOWER MULTI-FACTOR REVIEW]";
export function readReview(notes: string | null): CaseReview {
  const base = emptyReview();
  if (!notes) return base;
  const a = notes.indexOf(start), b = notes.indexOf(end, a);
  if (a < 0 || b < 0) return base;
  try {
    const value = JSON.parse(notes.slice(a + start.length, b));
    if (value.version !== 1) return base;
    for (const f of reviewFactors) {
      const item = value.factors?.[f.key];
      if (!item || !assessments.includes(item.assessment) || !["Low", "Medium", "High"].includes(item.weight) || !["observation", "source", "alternative", "gaps"].every(k => typeof item[k] === "string")) return base;
    }
    if (!["reviewer", "synthesis", "nextStep"].every(k => typeof value[k] === "string") || (value.disposition !== "" && !dispositions.includes(value.disposition))) return base;
    return { ...base, ...value };
  } catch { return base; }
}
export function writeReview(notes: string | null, review: CaseReview): string {
  let previous = notes ?? "";
  const a = previous.indexOf(start), b = previous.indexOf(end, a);
  if (a >= 0 && b >= 0) previous = previous.slice(0, a) + previous.slice(b + end.length);
  return `${previous.trim()}\n\n${start}\n${JSON.stringify(review, null, 2)}\n${end}`.trim();
}
export function reviewGaps(review: CaseReview): string[] {
  const missing: string[] = [];
  for (const f of reviewFactors) {
    const r = review.factors[f.key];
    if (r.assessment === "Not reviewed" || !r.observation.trim() || !r.source.trim() || !r.alternative.trim() || !r.gaps.trim()) missing.push(f.label);
  }
  if (!review.reviewer.trim()) missing.push("Reviewer");
  if (!review.synthesis.trim()) missing.push("Cross-factor assessment");
  if (!review.nextStep.trim()) missing.push("Next action");
  if (!review.disposition) missing.push("Thread outcome");
  return missing;
}