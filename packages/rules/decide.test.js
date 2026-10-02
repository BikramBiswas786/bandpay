const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { decide } = require("./decide");
const hour = 3600;
const live = (price, ageSec = 60) => ({ price, ageSec, staleAfterSec: hour });

test("fresh chainlink inside the band pays", () => {
  const d = decide({ chainlink: live(0.1), supra: live(0.101), minPrice: 0.05, maxPrice: 0.2 });
  assert.equal(d.ok, true);
  assert.equal(d.source, "chainlink");
});

test("stale chainlink uses supra", () => {
  const d = decide({ chainlink: live(0.1, hour + 1), supra: live(0.11), minPrice: 0.05, maxPrice: 0.2 });
  assert.equal(d.source, "supra");
});

test("disagreement above 3% reverts", () => {
  const d = decide({ chainlink: live(0.1), supra: live(0.14), minPrice: 0.05, maxPrice: 0.2 });
  assert.equal(d.reason, "disagree");
});

test("both stale reverts", () => {
  const d = decide({ chainlink: live(0.1, hour + 1), supra: live(0.1, hour + 1), minPrice: 0.05, maxPrice: 0.2 });
  assert.equal(d.reason, "no-price");
});

test("outside the band reverts", () => {
  const d = decide({ chainlink: live(0.5), supra: live(0.5), minPrice: 0.05, maxPrice: 0.2 });
  assert.equal(d.reason, "outside-band");
});

test("the page and the rules use the same decide.js", () => {
  const rules = fs.readFileSync(path.join(__dirname, "decide.js"));
  const page = fs.readFileSync(path.join(__dirname, "../nextjs/lib/decide.js"));
  assert.equal(rules.equals(page), true);
});
