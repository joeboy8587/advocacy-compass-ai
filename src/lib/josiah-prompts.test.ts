import { test } from "node:test";
import { strict as assert } from "node:assert";
import { selectMode, systemFor, SNARK_MODE, LEGAL_MODE, COPILOT_LAYER } from "./josiah-prompts";

test("explicit internal Snark selection is preserved for a case discussion", () => {
  assert.equal(selectMode("[SNARK] Discuss WTPR-2026-0020"), "SNARK");
  const prompt = systemFor("SNARK", true);
  assert.equal(prompt.includes(SNARK_MODE), true);
  assert.equal(prompt.includes(LEGAL_MODE), false);
  assert.equal(prompt.includes(COPILOT_LAYER), true);
});

test("Legal selection remains separate from internal Snark", () => {
  assert.equal(selectMode("[LEGAL] Draft our records request"), "LEGAL");
  const prompt = systemFor("LEGAL", true);
  assert.equal(prompt.includes(LEGAL_MODE), true);
  assert.equal(prompt.includes(SNARK_MODE), false);
});