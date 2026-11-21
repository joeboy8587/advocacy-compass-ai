import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyReview, reviewGaps, reviewFactors, readReview, writeReview, dispositions } from "./case-review.ts";
test("a high-weight single factor cannot complete a case review", () => {
  const r = emptyReview();
  r.factors.behavior = { assessment: "Supports a thread", weight: "High", observation: "Repeated orbit", source: "Detection IDs 1–3", alternative: "Training remains possible", gaps: "Mission unknown" };
  assert.ok(reviewGaps(r).includes("Recurring squawks"));
  assert.ok(reviewGaps(r).includes("Company records"));
  assert.ok(reviewGaps(r).includes("Shared addresses"));
});
test("every factor requires alternative explanations and limitations", () => {
  const r = emptyReview();
  for (const f of reviewFactors) r.factors[f.key] = { assessment: "Mixed", weight: "Medium", observation: "Observed", source: "Source record", alternative: "Alternative tested", gaps: "Unresolved" };
  Object.assign(r, { reviewer: "Investigator", synthesis: "Mixed evidence", nextStep: "Request flight logs", disposition: "Conflicting evidence" });
  assert.deepEqual(reviewGaps(r), []);
  r.factors.addresses.alternative = "";
  assert.deepEqual(reviewGaps(r), ["Shared addresses"]);
  r.factors.addresses.alternative = "Service address possible";
  r.factors.squawks.gaps = "";
  assert.deepEqual(reviewGaps(r), ["Recurring squawks"]);
});
test("thread outcomes never confer proof or confirmed case status", () => {
  assert.deepEqual(dispositions, ["Continue investigation", "Conflicting evidence", "Insufficient evidence"]);
  assert.equal(emptyReview().state, "draft");
});
test("saved review round-trips without overwriting unrelated case notes", () => {
  const r = emptyReview(); r.factors.companies.source = "FAA master dated 2026-11-21";
  const first = writeReview("Existing investigator notes", r);
  r.reviewer = "Reviewer";
  const second = writeReview(first + "\nLater evidence note", r);
  assert.deepEqual(readReview(second), r);
  assert.ok(second.includes("Existing investigator notes"));
  assert.ok(second.includes("Later evidence note"));
  assert.equal(second.split("[WATCHTOWER MULTI-FACTOR REVIEW v1]").length, 2);
});