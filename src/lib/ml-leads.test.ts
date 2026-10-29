import { test } from "node:test";
import assert from "node:assert/strict";
import { roundScore, mergeGhostTwins, cleanRegistration, leadFlags } from "./ml-leads.ts";

test("float32 scores shown to one decimal", () => {
  assert.equal(roundScore(69.98480987548828), 70);
  assert.equal(roundScore(69.7179), 69.7);
});
test("ghost twin collapses into identified address", () => {
  const out = mergeGhostTwins([
    { icao_hex: "~29B4A7", detections: 31 },
    { icao_hex: "29B4A7", detections: 10 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].icao_hex, "29B4A7");
  assert.equal(out[0].twin_detections, 31);
});
test("hex is not repeated as registration", () => {
  assert.equal(cleanRegistration("~A9F51F", "~A9F51F"), null);
  assert.equal(cleanRegistration("N4178N", "A50D2B"), "N4178N");
});
test("model 100 with rule score 0 is disagreement, saturated", () => {
  const f = leadFlags(100, 0, "A50D2B");
  assert.equal(f.saturated, true);
  assert.equal(f.disagreement, true);
});
