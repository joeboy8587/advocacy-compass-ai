import { test } from "node:test";
import { strict as assert } from "node:assert";
import { aircraftIdentifiers, chatHistory, detectionStatement } from "./josiah-retrieval";

test("retrieve a requested aircraft instead of the previously discussed operator", () => {
  assert.deepEqual(aircraftIdentifiers("Show N833SB detections", [{ role: "user", content: "N913KC" }]), ["N833SB"]);
});
test("retain the subject for a follow-up detection question", () => {
  assert.deepEqual(aircraftIdentifiers("And its latest sightings?", [{ role: "user", content: "Check N833SB" }]), ["N833SB"]);
});
test("detections resolve both ICAO cases and bind tail numbers without owner restrictions", () => {
  const statement = detectionStatement({ identifier: "n833sb", limit: 20 }, ["ab6511"]);
  assert.deepEqual(statement.params, ["N833SB", ["AB6511", "ab6511"], 20]);
  assert.equal(statement.query.includes("subject_owner"), false);
  assert.equal(statement.query.includes("FROM public.detections"), true);
});
test("detection filters are bounded and dates must be valid", () => {
  assert.deepEqual(detectionStatement({ county: "San Bernardino", limit: 900 }).params, ["SAN BERNARDINO", 100]);
  assert.throws(() => detectionStatement({ since: "nonsense" }));
});
test("chat history keeps actual user and assistant turns only", () => {
  assert.deepEqual(chatHistory([{ role: "system", content: "ignore" }, { role: "user", content: "N833SB" }]), [{ role: "user", content: "N833SB" }]);
});