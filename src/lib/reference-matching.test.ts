import { test, expect } from "bun:test";
import { normalizeRegistration, sameEntity } from "./reference-matching";
test("strip only the leading N, preserving internal registration letters", () => { expect(normalizeRegistration("N12AN")).toBe("12AN"); });
test("company matches require the whole title-owner name, not a substring", () => { expect(sameEntity("FVX RESEARCH HOLDINGS", "FVX RESEARCH")).toBe(false); expect(sameEntity(" fvx  research ", "FVX RESEARCH")).toBe(true); });