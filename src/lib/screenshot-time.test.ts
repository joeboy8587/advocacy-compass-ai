import { test } from "node:test";
import { strict as assert } from "node:assert";
import { exifCapture, screenshotMatchStatus } from "./screenshot-time";

test("N43RR November EXIF retains the instant and Pacific evening date", () => {
  assert.deepEqual(exifCapture({ DateTimeOriginal: "2026-11-17T02:47:17.000Z", OffsetTimeOriginal: "-08:00" }), {
    utc: "2026-11-17T02:47:17.000Z", offsetMin: -480, date: "2026-11-16", time: "18:47:17",
  });
});
test("parsed EXIF Dates are not converted to UTC a second time", () => {
  assert.equal(exifCapture({ DateTimeOriginal: new Date("2026-10-08T19:41:05Z"), OffsetTimeOriginal: "-07:00" })?.time, "12:41:05");
});
test("naive EXIF without an offset is not assumed to be an instant", () => {
  assert.equal(exifCapture({ DateTimeOriginal: "2026:11:16 18:47:17" }), null);
});
test("raw Android EXIF local clock plus offset produces the correct instant", () => {
  assert.deepEqual(exifCapture({ DateTimeOriginal: "2026:11:16 18:47:17", OffsetTimeOriginal: "-08:00" }), {
    utc: "2026-11-17T02:47:17.000Z", offsetMin: -480, date: "2026-11-16", time: "18:47:17",
  });
});
test("time-of-day candidates on a different date cannot confirm a named aircraft", () => {
  assert.equal(screenshotMatchStatus(true, "time_of_day", 25, 2), "TIME_HINT");
  assert.equal(screenshotMatchStatus(true, "exact", 25, 2), "CONFIRMED_NAMED");
});