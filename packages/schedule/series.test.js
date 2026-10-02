import { test } from "node:test";
import assert from "node:assert/strict";
import { seriesStep } from "./series.js";

test("one plan needs no interval", () => {
  assert.deepEqual(seriesStep(4, 0, 1, 0), { planId: 4, extraSeconds: 0 });
});

test("three instalments step the plan id and the due time", () => {
  assert.deepEqual(seriesStep(2, 2, 3, 86400), { planId: 4, extraSeconds: 172800 });
});

test("a series without an interval is refused", () => {
  assert.throws(() => seriesStep(0, 0, 3, 0), /EVERY_SECONDS/);
});

test("more than twelve instalments is refused", () => {
  assert.throws(() => seriesStep(0, 0, 13, 60), /COUNT/);
});
