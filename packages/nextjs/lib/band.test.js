const { test } = require("node:test");
const assert = require("node:assert/strict");
const { bandError } = require("./band");

const ok = { amount: "0.1", minutes: "60", min: "0.05", max: "0.20" };

test("a normal band is allowed", () => {
  assert.equal(bandError(ok), "");
});

test("nonsense, zero, a past due, and 139 days are refused", () => {
  assert.match(bandError({ ...ok, min: "-1" }), /Invalid band/);
  assert.match(bandError({ ...ok, min: "abc" }), /Invalid band/);
  assert.match(bandError({ ...ok, amount: "0" }), /more than 0/);
  assert.match(bandError({ ...ok, minutes: "-5" }), /whole number/);
  assert.match(bandError({ ...ok, minutes: "200000" }), /62 days/);
});

test("min above max is an invalid band, not a price result", () => {
  assert.match(bandError({ ...ok, min: "2", max: "1" }), /Min is above max/);
});
