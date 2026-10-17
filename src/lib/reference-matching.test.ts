import { test } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeRegistration, sameEntity } from "./reference-matching";
test("strip only the leading N, preserving internal registration letters", () => { assert.equal(normalizeRegistration("N12AN"), "12AN"); });
test("company matches require the whole title-owner name, not a substring", () => { assert.equal(sameEntity("FVX RESEARCH HOLDINGS", "FVX RESEARCH"), false); assert.equal(sameEntity(" fvx  research ", "FVX RESEARCH"), true); });