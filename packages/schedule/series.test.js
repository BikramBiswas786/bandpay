import { test } from "node:test";
import assert from "node:assert/strict";
import { seriesStep, assertSeriesFits } from "./series.js";

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

test("a series that ends after 62 days is refused", () => {
  assert.throws(() => assertSeriesFits(0, 12, 6 * 24 * 60 * 60), /62 days/);
});

test("two instalments a day apart still fit", () => {
  assert.doesNotThrow(() => assertSeriesFits(3600, 2, 86400));
});
