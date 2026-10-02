const test = require("node:test");
const assert = require("node:assert/strict");
const { decodePlan, explain, assertSchedulable, assertWorthScheduling } = require("./plans");

const LIVE =
  "0x000000000000000000000000620b69e63699edf397146d1306e38fc9f289f981000000000000000000000000620b69e63699edf397146d1306e38fc9f289f9810000000000000000000000000000000000000000000000000000000000a5262e00000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000003b9aca00000000000000000000000000000000000000000000000000000000006abf7eca000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001";

test("decodes the HTS plan that was funded and then cancelled", () => {
  const plan = decodePlan(LIVE);
  assert.equal(plan.hbar, false);
  assert.equal(plan.amount, "5");
  assert.ok(Math.abs(plan.minPrice - 1e-8) < 1e-12);
  assert.equal(plan.maxPrice, 10);
  assert.equal(plan.funded, true);
  assert.equal(plan.paid, false);
  assert.equal(plan.cancelled, true);
  assert.equal(explain(plan, {}, plan.executeAt).state, "cancelled");
});

test("refuses a schedule that would fire before the plan is due", () => {
  const plan = { funded: true, paid: false, cancelled: false, executeAt: 1_000 };
  assert.throws(() => assertSchedulable(plan, 999), /too early/);
  assert.doesNotThrow(() => assertSchedulable(plan, 1000));
});

test("a paid plan is not schedulable", () => {
  assert.throws(
    () => assertSchedulable({ funded: true, paid: true, cancelled: false, executeAt: 1 }, 2),
    /not an open escrow/,
  );
});

test("an open plan inside the band would pay, and one outside would not", () => {
  const feeds = {
    maxAge: 3600,
    chainlink: { price: 0.1, ageSec: 30, fresh: true },
    supra: { price: 0.101, ageSec: 30, fresh: true },
  };
  const open = {
    funded: true,
    paid: false,
    cancelled: false,
    executeAt: 1_000,
    minPrice: 0.05,
    maxPrice: 0.2,
  };
  assert.equal(explain(open, feeds, 500).state, "too-early");
  assert.equal(explain(open, feeds, 1_000).state, "would-pay");
  assert.equal(explain({ ...open, minPrice: 1, maxPrice: 2 }, feeds, 1_000).state, "outside-band");
});

test("refuses to schedule a revert unless ALLOW_REVERT is set", () => {
  const outside = { state: "outside-band", detail: "Outside the band." };
  assert.throws(() => assertWorthScheduling(outside, false), /ALLOW_REVERT=1/);
  assert.doesNotThrow(() => assertWorthScheduling(outside, true));
  assert.doesNotThrow(() =>
    assertWorthScheduling({ state: "would-pay", detail: "Would pay." }, false),
  );
  assert.doesNotThrow(() =>
    assertWorthScheduling({ state: "too-early", detail: "Too early." }, false),
  );
});
